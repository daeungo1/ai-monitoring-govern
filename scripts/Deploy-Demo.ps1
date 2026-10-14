#!/usr/bin/env pwsh
# Copyright (c) Microsoft Corporation.
# SPDX-License-Identifier: MIT
#Requires -Version 7.0
<#
.SYNOPSIS
    Validate and deploy an isolated Azure OpenAI monitoring demo.
.DESCRIPTION
    Checks each configured model and quota, protects non-demo resource groups,
    runs ARM validation and what-if, then deploys only when -Execute is supplied.
.PARAMETER SubscriptionId
    Explicit destination subscription.
.PARAMETER ResourceGroupName
    Dedicated demo resource group.
.PARAMETER ResourcePrefix
    Globally unique lowercase prefix for resource names.
.PARAMETER Location
    Region with quota for every configured model.
.PARAMETER AlertEmail
    Optional notification email. Omit to test rules without sending mail.
.PARAMETER Execute
    Authorize resource creation after preflight. Omit for validation only.
.EXAMPLE
    .\scripts\Deploy-Demo.ps1 -SubscriptionId <id> -ResourceGroupName rg-aoai-demo -ResourcePrefix uniquedemo -Execute
.NOTES
    Requires Azure CLI, Bicep and Entra user permissions for resource creation and scoped RBAC.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$SubscriptionId,
    [Parameter(Mandatory)][string]$ResourceGroupName,
    [Parameter(Mandatory)][ValidatePattern('^[a-z0-9]{3,40}$')][string]$ResourcePrefix,
    [string]$Location = 'eastus2',
    [string]$AlertEmail,
    [switch]$Execute
)
$ErrorActionPreference = 'Stop'

#region Functions
function Invoke-Azure {
    param([Parameter(Mandatory)][string[]]$Arguments)
    $Result = & az @Arguments
    if ($LASTEXITCODE -ne 0) { throw "Azure CLI failed: $($Arguments[0..1] -join ' ')." }
    return $Result
}
#endregion

#region Main
if ($MyInvocation.InvocationName -ne '.') {
    $Root = Split-Path $PSScriptRoot -Parent
    Push-Location $Root
    try {
        $Account = (Invoke-Azure @('account', 'show', '--subscription', $SubscriptionId, '-o', 'json')) | ConvertFrom-Json
        $User = (Invoke-Azure @('ad', 'signed-in-user', 'show', '-o', 'json')) | ConvertFrom-Json
        $Exists = Invoke-Azure @('group', 'exists', '--name', $ResourceGroupName, '--subscription', $SubscriptionId)
        if ($Exists -eq 'true') {
            $Group = (Invoke-Azure @('group', 'show', '--name', $ResourceGroupName, '--subscription', $SubscriptionId, '-o', 'json')) | ConvertFrom-Json
            if ($Group.tags.project -ne 'azure-openai-monitoring-demo') {
                throw 'Refusing to modify a resource group not owned by this demo.'
            }
        }
        $Models = (Get-Content -LiteralPath 'config\models.json' -Raw | ConvertFrom-Json).models
        $Catalog = (Invoke-Azure @('cognitiveservices', 'model', 'list', '-l', $Location, '--subscription', $SubscriptionId, '-o', 'json')) | ConvertFrom-Json
        $Usage = (Invoke-Azure @('cognitiveservices', 'usage', 'list', '-l', $Location, '--subscription', $SubscriptionId, '-o', 'json')) | ConvertFrom-Json
        foreach ($Model in $Models) {
            $Available = @($Catalog | Where-Object {
                $_.model.name -eq $Model.model -and $_.model.version -eq $Model.modelVersion -and
                $_.model.lifecycleStatus -eq 'GenerallyAvailable' -and
                $_.model.capabilities.chatCompletion -eq 'true' -and
                $_.model.skus.name -contains $Model.deploymentSku
            })
            if ($Available.Count -eq 0) { throw "Model/version/SKU unavailable: $($Model.model)." }
            $Quota = $Usage | Where-Object { $_.name.value -eq "OpenAI.$($Model.deploymentSku).$($Model.model)" }
            if ($null -eq $Quota -or ($Quota.limit - $Quota.currentValue) -lt $Model.capacity) {
                throw "Insufficient regional quota for $($Model.model)."
            }
        }
        $Parameters = @{
            '$schema' = 'https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#'
            contentVersion = '1.0.0.0'
            parameters = @{
                resourceGroupName = @{ value = $ResourceGroupName }
                resourcePrefix = @{ value = $ResourcePrefix }
                location = @{ value = $Location }
                principalId = @{ value = $User.id }
                deployedBy = @{ value = $User.displayName }
                sessionId = @{ value = [guid]::NewGuid().ToString() }
                models = @{ value = @($Models) }
                shouldSkipQueryValidation = @{ value = ($Exists -ne 'true') }
            }
        }
        if ($AlertEmail) { $Parameters.parameters.alertEmail = @{ value = $AlertEmail } }
        New-Item -ItemType Directory -Path 'artifacts' -Force | Out-Null
        $Parameters | ConvertTo-Json -Depth 15 | Set-Content -LiteralPath 'artifacts\deploy.parameters.json' -Encoding utf8
        $Name = 'aoai-monitor-demo'
        $Base = @('--name', $Name, '--subscription', $SubscriptionId, '--location', $Location,
            '--template-file', 'infra\main.bicep', '--parameters', '@artifacts\deploy.parameters.json')
        Write-Host "Subscription: $($Account.name) ($SubscriptionId); RG: $ResourceGroupName; Region: $Location"
        Invoke-Azure (@('deployment', 'sub', 'validate') + $Base + @('--query', 'properties.provisioningState', '-o', 'tsv'))
        Invoke-Azure (@('deployment', 'sub', 'what-if') + $Base + @('--result-format', 'ResourceIdOnly'))
        if ($Execute) {
            $Result = (Invoke-Azure (@('deployment', 'sub', 'create') + $Base + @('-o', 'json'))) | ConvertFrom-Json
            if ($Result.properties.provisioningState -ne 'Succeeded') { throw 'Deployment did not succeed.' }
            $Settings = $Result.properties.outputs.settings.value
            $Settings | Add-Member -NotePropertyName subscriptionId -NotePropertyValue $SubscriptionId
            $Settings | ConvertTo-Json -Depth 15 | Set-Content -LiteralPath 'artifacts\settings.json' -Encoding utf8
            Write-Host 'Deployment complete. Run Use-Demo.ps1 for live calls and replay. Ingestion is not yet verified.'
        }
    }
    finally { Pop-Location }
}
#endregion
