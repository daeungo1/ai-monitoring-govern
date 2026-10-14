#!/usr/bin/env pwsh
# Copyright (c) Microsoft Corporation.
# SPDX-License-Identifier: MIT
#Requires -Version 7.0
<#
.SYNOPSIS
    Enable worker-scoped demo alerts or disable only those dedicated rules.
.DESCRIPTION
    Uses existing authorized Action Group. Leaves operational alerts unchanged.
    Synthetic guardrail/429 rules and live 70% budget warning are explicitly labeled.
.PARAMETER Disable
    Disable this repository's three dedicated demo rules on shutdown.
.PARAMETER NodePath
    Node executable used to generate validated payloads.
.EXAMPLE
    .\scripts\Set-DemoScenarioAlerts.ps1
.NOTES
    Evaluating Azure log alerts has a cost beyond the model token budget.
#>
[CmdletBinding()]
param([switch]$Disable, [string]$NodePath = 'node')
$ErrorActionPreference = 'Stop'

#region Main
if ($MyInvocation.InvocationName -ne '.') {
    Push-Location (Split-Path $PSScriptRoot -Parent)
    try {
        $Settings = Get-Content -LiteralPath 'artifacts\settings.json' -Raw | ConvertFrom-Json
        if ($Disable) {
            if (!(Test-Path -LiteralPath 'artifacts\loadtest\demo-alerts.json')) { return }
            $Manifest = Get-Content -LiteralPath 'artifacts\loadtest\demo-alerts.json' -Raw | ConvertFrom-Json
        }
        else {
            $Group = & az resource show --ids $Settings.actionGroupId --subscription $Settings.subscriptionId `
                --api-version 2023-01-01 -o json | ConvertFrom-Json
            if ($LASTEXITCODE -ne 0 -or !$Group.properties.enabled -or !$Group.properties.emailReceivers.Count) {
                throw 'Demo alerts require an enabled existing email Action Group.'
            }
            $Generated = & $NodePath 'dist\demo-alerts.js'
            if ($LASTEXITCODE -ne 0) { throw 'Cannot generate worker-scoped demo alert payloads.' }
            $Manifest = $Generated | ConvertFrom-Json
        }
        $Existing = & az resource list --subscription $Settings.subscriptionId `
            --resource-group $Settings.resourceGroupName --resource-type Microsoft.Insights/scheduledQueryRules -o json | ConvertFrom-Json
        if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect existing alert ownership.' }
        foreach ($Rule in $Manifest.rules) {
            if ($Rule.kind -notin @('guardrail', 'throttle', 'budget')) { throw 'Invalid demo rule kind.' }
            $Expected = "/subscriptions/$($Settings.subscriptionId)/resourceGroups/$($Settings.resourceGroupName)/providers/Microsoft.Insights/scheduledQueryRules/$($Settings.openAiAccountName)-demo-$($Rule.kind)"
            if ($Rule.id -cne $Expected) { throw 'Demo manifest resource is outside its dedicated scope.' }
            $Previous = $Existing | Where-Object { $_.id -eq $Rule.id }
            if ($Previous -and $Previous.tags.'demo-purpose' -ne 'continuous-scenarios') {
                throw 'Refusing to overwrite an alert without demo ownership tags.'
            }
        }
        if (!$Disable) {
            $Manifest | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath 'artifacts\loadtest\demo-alerts.json' -Encoding utf8
        }
        foreach ($Rule in $Manifest.rules) {
            $Url = "https://management.azure.com$($Rule.id)?api-version=2023-12-01"
            if ($Disable) {
                if (!($Existing | Where-Object { $_.id -eq $Rule.id })) { continue }
                '{"properties":{"enabled":false}}' | Set-Content -LiteralPath 'artifacts\loadtest\disable-alert.json' -Encoding utf8
                & az rest --method patch --url $Url --body '@artifacts\loadtest\disable-alert.json' --output none
            }
            else {
                $BodyPath = $Rule.path.Replace('/', '\')
                & az rest --method put --url $Url --body "@$BodyPath" --output none
            }
            if ($LASTEXITCODE -ne 0) { throw "Demo alert update failed: $($Rule.kind)" }
            $Readback = & az rest --method get --url $Url -o json | ConvertFrom-Json
            if ($LASTEXITCODE -ne 0 -or $Readback.properties.enabled -ne (!$Disable)) {
                throw "Demo alert read-back failed: $($Rule.kind)"
            }
            Write-Output "$($Rule.name): enabled=$($Readback.properties.enabled)"
        }
    }
    finally { Pop-Location }
}
#endregion Main
