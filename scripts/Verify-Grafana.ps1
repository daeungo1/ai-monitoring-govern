#!/usr/bin/env pwsh
# Copyright (c) Microsoft Corporation.
# SPDX-License-Identifier: MIT
#Requires -Version 7.0
<#
.SYNOPSIS
    Verify actual native Azure Monitor and LAW queries through Managed Grafana.
.DESCRIPTION
    Uses Entra data-plane authentication and the workspace managed identity.
    Submits every target and distinguishes no data from numeric zero.
    Never prints tokens, tests email or changes Azure resources.
.PARAMETER GrafanaName
    Deployed Managed Grafana workspace name.
.PARAMETER ResourceGroupName
    Dedicated demo resource group.
.EXAMPLE
    .\scripts\Verify-Grafana.ps1 -GrafanaName aoaimon1014-grafana -ResourceGroupName rg-aoai-monitor-demo-20261014
.NOTES
    Requires Azure CLI login and a Grafana data-plane role.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$GrafanaName,
    [Parameter(Mandatory)][string]$ResourceGroupName,
    [ValidatePattern('^(all|\*|[\w.-]+)$')][string]$Deployment = 'all',
    [ValidateSet('live', 'fixture')][string]$Mode = 'live',
    [string]$RunId = '',
    [string]$Workload = 'all',
    [string]$Profile = 'all',
    [ValidateRange(1, 168)][int]$Hours = 24
)
$ErrorActionPreference = 'Stop'
if ($MyInvocation.InvocationName -ne '.') {
    Push-Location (Split-Path $PSScriptRoot -Parent)
    try {
        $Endpoint = & az grafana show -n $GrafanaName -g $ResourceGroupName --query properties.endpoint -o tsv
        if ($LASTEXITCODE -ne 0 -or !$Endpoint) { throw 'Cannot resolve Grafana endpoint.' }
        $Token = & az account get-access-token --resource ce34e7e5-485f-4d76-964f-b3d2b16d1e4f --query accessToken -o tsv
        if ($LASTEXITCODE -ne 0 -or !$Token) { throw 'Grafana Entra authentication unavailable.' }
        $Dashboard = Get-Content -LiteralPath 'infra\grafana-dashboard.json' -Raw | ConvertFrom-Json -AsHashtable
        $Results = @()
        $Failures = @()
        $From = ([DateTimeOffset]::UtcNow.AddHours(-$Hours).ToUnixTimeMilliseconds()).ToString()
        $To = ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()).ToString()
        $NativeDeployment = if ($Deployment -eq 'all') { '*' } else { $Deployment }
        foreach ($Panel in $Dashboard.panels) {
            foreach ($OriginalTarget in @($Panel.targets)) {
                if (!$OriginalTarget -or $OriginalTarget.hide) { continue }
                $Target = $OriginalTarget | ConvertTo-Json -Depth 30 | ConvertFrom-Json -AsHashtable
                switch ($Target.queryType) {
                    'Azure Log Analytics' {
                        $Query = $Target.azureLogAnalytics.query.Replace('${deployment:raw}', $Deployment).Replace('${mode:raw}', $Mode)
                        foreach ($Binding in @{ run = $RunId; workload = $Workload; profile = $Profile }.GetEnumerator()) {
                            $Value = ConvertTo-Json -InputObject ([string]$Binding.Value) -Compress
                            $Query = $Query.Replace(('${' + $Binding.Key + ':json}'), $Value)
                        }
                        $Target.azureLogAnalytics.query = $Query
                    }
                    'Azure Monitor' {
                        if (!$Target.azureMonitor.metricName -or !$Target.azureMonitor.resources) {
                            throw "Native metric definition is incomplete: $($Panel.title)"
                        }
                        foreach ($Dimension in $Target.azureMonitor.dimensionFilters) {
                            $Dimension.filters = @($Dimension.filters | ForEach-Object { $_.Replace('${deployment:raw}', $NativeDeployment) })
                        }
                    }
                    default { throw "Unsupported target type: $($Target.queryType)" }
                }
                $Target.intervalMs = 300000
                $Target.maxDataPoints = $Hours * 12
                $Body = @{ queries = @($Target); from = $From; to = $To } | ConvertTo-Json -Depth 30
                try {
                    $Response = Invoke-RestMethod -Uri "$Endpoint/api/ds/query" -Method Post `
                        -Headers @{ Authorization = "Bearer $Token" } -ContentType 'application/json' -Body $Body -TimeoutSec 90
                    $Result = $Response.results.($Target.refId)
                    if (!$Result -or $Result.error -or ($Result.status -and $Result.status -ge 400)) {
                        throw "Query result failed or missing: $($Result.error)"
                    }
                    $NonNullValues = 0
                    $Rows = 0
                    foreach ($Frame in @($Result.frames)) {
                        if (!$Frame.schema -or !$Frame.data) { continue }
                        $Fields = @($Frame.schema.fields)
                        $Values = @($Frame.data.values)
                        if ($Values.Count) { $Rows += @($Values[0]).Count }
                        for ($Index = 0; $Index -lt $Fields.Count; $Index++) {
                            if ($Fields[$Index].type -eq 'number') {
                                $NonNullValues += @($Values[$Index] | Where-Object { $null -ne $_ }).Count
                            }
                        }
                    }
                    $State = if ($Target.queryType -eq 'Azure Monitor' -and $NonNullValues -eq 0) { 'no_data' }
                        elseif ($Rows -eq 0) { 'no_data' } else { 'data' }
                    $Results += @{ id = $Panel.id; title = $Panel.title; refId = $Target.refId; queryType = $Target.queryType
                        metric = $Target.azureMonitor.metricName; frames = @($Result.frames).Count; rows = $Rows
                        nonNullValues = $NonNullValues; status = $Result.status; state = $State }
                }
                catch {
                    $Failures += "$($Panel.title) [$($Target.refId)]: $($_.Exception.Message)"
                    $Results += @{ id = $Panel.id; title = $Panel.title; refId = $Target.refId; queryType = $Target.queryType; state = 'error'
                        error = $_.Exception.Message }
                }
            }
        }
        @{ verifiedAt = [DateTimeOffset]::UtcNow.ToString('o'); endpoint = $Endpoint; hours = $Hours
            filters = @{ deployment = $Deployment; mode = $Mode; run = $RunId; workload = $Workload; profile = $Profile }
            nativeScope = 'Always real service traffic; ignores LAW mode/run/workload/profile.'
            panels = $Results; failures = $Failures } |
            ConvertTo-Json -Depth 10 | Set-Content -LiteralPath 'artifacts\grafana-verification.json' -Encoding utf8
        if ($Failures.Count) { throw "Grafana verification failed ($($Failures.Count) targets): $($Failures -join '; ')" }
        $NativeCount = @($Results | Where-Object queryType -eq 'Azure Monitor').Count
        $LogCount = @($Results | Where-Object queryType -eq 'Azure Log Analytics').Count
        $NoData = @($Results | Where-Object state -eq 'no_data').Count
        Write-Output "Verified $($Results.Count) Grafana queries via managed identity ($NativeCount native, $LogCount LAW; $NoData no_data, not zero)."
    }
    finally { $Token = $null; Pop-Location }
}
