#!/usr/bin/env pwsh
# Copyright (c) Microsoft Corporation.
# SPDX-License-Identifier: MIT
#Requires -Version 7.0
<#
.SYNOPSIS
    Deploy the public interactive model test controller.
.DESCRIPTION
    Reuse the monitoring demo resources. Host the frontend in SWA Standard and
    the API in Functions Flex Consumption with a managed identity and Blob ledger.
.PARAMETER NodePath
    Absolute Node 22+ executable path.
.PARAMETER ValidateOnly
    Build and verify settings without provisioning or stopping the local worker.
.PARAMETER PublishOnly
    Resume code publication after infrastructure and settings are already configured.
.EXAMPLE
    .\scripts\Deploy-LoadWebApp.ps1 -NodePath 'C:\tools\node.exe' -ValidateOnly
.NOTES
    Stop the local worker before seeding the cloud budget. No models auto-start.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$NodePath,
    [Parameter(Mandatory = $false)][switch]$ValidateOnly,
    [Parameter(Mandatory = $false)][switch]$PublishOnly
)
$ErrorActionPreference = 'Stop'
$Root = Split-Path $PSScriptRoot -Parent
$Settings = Get-Content (Join-Path $Root 'artifacts\settings.json') -Raw | ConvertFrom-Json
$ApiName = 'aoaimon20261014d-loadapi'
$WebName = 'aoaimon20261014d-loadweb'
$StorageName = 'aoaimon1014loadstore'
$VNetName = 'aoaimon20261014d-load-vnet'
$Subscription = $Settings.subscriptionId
$Group = $Settings.resourceGroupName
$Location = $Settings.location
$Artifact = Join-Path $Root 'artifacts\webapp'
$Package = Join-Path $Artifact 'api'
$ApiId = "/subscriptions/$Subscription/resourceGroups/$Group/providers/Microsoft.Web/sites/$ApiName"
$StorageId = "/subscriptions/$Subscription/resourceGroups/$Group/providers/Microsoft.Storage/storageAccounts/$StorageName"
$VNetId = "/subscriptions/$Subscription/resourceGroups/$Group/providers/Microsoft.Network/virtualNetworks/$VNetName"

#region Functions
function Invoke-Az {
    param([Parameter(Mandatory = $true)][string[]]$Arguments)
    Write-Output "Deploy step: $($Arguments[0]) $($Arguments[1])"
    & az @Arguments --subscription $Subscription --only-show-errors --output none
    if ($LASTEXITCODE -ne 0) { throw "Azure operation failed: $($Arguments[0]) $($Arguments[1])." }
}
function Read-Az {
    param([Parameter(Mandatory = $true)][string[]]$Arguments)
    $Value = & az @Arguments --subscription $Subscription --only-show-errors --output json
    if ($LASTEXITCODE -ne 0) { throw "Azure read failed: $($Arguments[0]) $($Arguments[1])." }
    return ($Value | ConvertFrom-Json)
}
#endregion Functions

#region Main Execution
if ($MyInvocation.InvocationName -ne '.') {
Push-Location $Root
$PreviousPath = $env:PATH
$env:PATH = "$(Split-Path -Parent $NodePath);$env:PATH"
try {
    $Major = & $NodePath -p 'process.versions.node.split(".")[0]'
    if ($LASTEXITCODE -ne 0 -or [int]$Major -lt 22) { throw 'Node 22+ is required.' }
    & $NodePath (Join-Path $Root 'node_modules\typescript\bin\tsc') -p tsconfig.json
    if ($LASTEXITCODE -ne 0) { throw 'TypeScript build failed.' }
    $Account = Read-Az @('account', 'show')
    if ($Account.id -ne $Subscription) { throw 'Azure subscription mismatch.' }
    if ($ValidateOnly) {
        Write-Output "Validated Node/build/context. Target: $Group/$Location; SWA Standard, Functions Flex 512 MB, LRS Storage."
        return
    }
    if (-not $PublishOnly) {
    & (Join-Path $PSScriptRoot 'Stop-LoadTest.ps1')
    $StatePath = Join-Path $Root 'artifacts\loadtest\status.json'
    for ($Attempt = 0; $Attempt -lt 30; $Attempt++) {
        $State = Get-Content $StatePath -Raw | ConvertFrom-Json
        if ($State.status -eq 'stopped') { break }
        Start-Sleep -Seconds 2
    }
    if ($State.status -ne 'stopped') { throw 'Local worker has not stopped; cloud budget was not seeded.' }
    $SeedDay = ([DateTimeOffset]::Parse($State.updatedAt)).UtcDateTime.ToString('yyyy-MM-dd')
    if (-not [double]::IsFinite([double]$State.accountedUsd) -or $State.accountedUsd -lt 0) {
        throw 'Invalid final local budget; cloud deployment was not started.'
    }

    Invoke-Az @('storage', 'account', 'create', '--name', $StorageName, '--resource-group', $Group,
        '--location', $Location, '--sku', 'Standard_LRS', '--min-tls-version', 'TLS1_2',
        '--allow-blob-public-access', 'false', '--allow-shared-key-access', 'false',
        '--public-network-access', 'Disabled', '--tags', 'demo-purpose=interactive-load-test')
    Invoke-Az @('network', 'vnet', 'create', '--name', $VNetName, '--resource-group', $Group,
        '--location', $Location, '--address-prefixes', '10.242.0.0/24',
        '--tags', 'demo-purpose=interactive-load-test')
    Invoke-Az @('network', 'vnet', 'subnet', 'create', '--name', 'functions', '--vnet-name', $VNetName,
        '--resource-group', $Group, '--address-prefixes', '10.242.0.0/26',
        '--delegations', 'Microsoft.App/environments')
    Invoke-Az @('network', 'vnet', 'subnet', 'create', '--name', 'private-endpoints', '--vnet-name', $VNetName,
        '--resource-group', $Group, '--address-prefixes', '10.242.0.64/26',
        '--disable-private-endpoint-network-policies', 'true')
    foreach ($Service in @('blob', 'queue')) {
        $Zone = "privatelink.$Service.core.windows.net"
        $ZoneId = "/subscriptions/$Subscription/resourceGroups/$Group/providers/Microsoft.Network/privateDnsZones/$Zone"
        $EndpointName = "$StorageName-$Service-pe"
        Invoke-Az @('network', 'private-dns', 'zone', 'create', '--name', $Zone, '--resource-group', $Group)
        Invoke-Az @('network', 'private-dns', 'link', 'vnet', 'create', '--name', "$VNetName-link",
            '--zone-name', $Zone, '--resource-group', $Group, '--virtual-network', $VNetId,
            '--registration-enabled', 'false')
        Invoke-Az @('network', 'private-endpoint', 'create', '--name', $EndpointName,
            '--resource-group', $Group, '--location', $Location, '--vnet-name', $VNetName,
            '--subnet', 'private-endpoints', '--private-connection-resource-id', $StorageId,
            '--group-id', $Service, '--connection-name', "load-$Service")
        Invoke-Az @('network', 'private-endpoint', 'dns-zone-group', 'create', '--name', 'load-storage',
            '--endpoint-name', $EndpointName, '--resource-group', $Group,
            '--private-dns-zone', $ZoneId, '--zone-name', $Service)
    }
    Invoke-Az @('functionapp', 'create', '--resource-group', $Group, '--name', $ApiName,
        '--storage-account', $StorageName, '--flexconsumption-location', $Location,
        '--runtime', 'node', '--runtime-version', '22', '--functions-version', '4',
        '--instance-memory', '512', '--maximum-instance-count', '40',
        '--assign-identity', '[system]', '--deployment-storage-auth-type', 'SystemAssignedIdentity',
        '--vnet', $VNetName, '--subnet', 'functions',
        '--app-insights', $Settings.applicationInsightsName)
    $Function = Read-Az @('rest', '--method', 'get', '--url',
        "https://management.azure.com${ApiId}?api-version=2024-04-01")
    if (-not $Function.properties.defaultHostName) { throw 'Function hostname is not available.' }
    $Principal = $Function.identity.principalId
    foreach ($Role in @('Storage Blob Data Owner', 'Storage Queue Data Contributor')) {
        Invoke-Az @('role', 'assignment', 'create', '--assignee-object-id', $Principal,
            '--assignee-principal-type', 'ServicePrincipal', '--role', $Role, '--scope', $StorageId)
    }
    Invoke-Az @('role', 'assignment', 'create', '--assignee-object-id', $Principal,
        '--assignee-principal-type', 'ServicePrincipal', '--role', 'Cognitive Services OpenAI User',
        '--scope', $Settings.openAiResourceId)
    $AlertRoot = "/subscriptions/$Subscription/resourceGroups/$Group/providers/Microsoft.Insights/scheduledQueryRules"
    foreach ($Kind in @('guardrail', 'throttle', 'budget')) {
        Invoke-Az @('role', 'assignment', 'create', '--assignee-object-id', $Principal,
            '--assignee-principal-type', 'ServicePrincipal', '--role', 'Monitoring Contributor',
            '--scope', "$AlertRoot/$($Settings.openAiAccountName)-demo-$Kind")
    }
    Invoke-Az @('functionapp', 'scale', 'config', 'set', '--name', $ApiName, '--resource-group', $Group,
        '--trigger-type', 'http', '--trigger-settings', 'perInstanceConcurrency=64')
    $Insights = Read-Az @('monitor', 'app-insights', 'component', 'show', '--app',
        $Settings.applicationInsightsName, '--resource-group', $Group, '--query', 'connectionString')
    if (-not $Insights) { throw 'Existing Application Insights connection is unavailable.' }
    $AppSettings = @{
        APPLICATIONINSIGHTS_CONNECTION_STRING = $Insights
        AOAI_ENDPOINT = $Settings.endpoint
        LOAD_STATE_CONTAINER_URL = "https://$StorageName.blob.core.windows.net/load-state"
        LOAD_INITIAL_ACCOUNTED_USD = [string]$State.accountedUsd
        LOAD_INITIAL_DAY = $SeedDay
        LOAD_ALERT_RESOURCE_ROOT = $AlertRoot
        LOAD_OPENAI_ACCOUNT = $Settings.openAiAccountName
        LOAD_LOCATION = $Location
        LOAD_WORKSPACE_RESOURCE_ID = $Settings.workspaceResourceId
        LOAD_ACTION_GROUP_ID = $Settings.actionGroupId
        AzureWebJobsStorage__accountName = $StorageName
        AzureWebJobsStorage__credential = 'managedidentity'
    }
    $SettingsFile = Join-Path ([IO.Path]::GetTempPath()) ("load-web-settings-" + [guid]::NewGuid() + '.json')
    try {
        [IO.File]::WriteAllText($SettingsFile, ($AppSettings | ConvertTo-Json))
        Invoke-Az @('functionapp', 'config', 'appsettings', 'set', '--name', $ApiName,
            '--resource-group', $Group, '--settings', "@$SettingsFile")
    } finally { Remove-Item -LiteralPath $SettingsFile -Force }
    Invoke-Az @('functionapp', 'config', 'appsettings', 'delete', '--name', $ApiName,
        '--resource-group', $Group, '--setting-names', 'AzureWebJobsStorage')
    Invoke-Az @('storage', 'account', 'update', '--name', $StorageName, '--resource-group', $Group,
        '--allow-shared-key-access', 'false')
    } else {
        $State = Get-Content (Join-Path $Root 'artifacts\loadtest\status.json') -Raw | ConvertFrom-Json
        if ($State.status -ne 'stopped') { throw 'Stop the local worker before publishing the cloud API.' }
        $Function = Read-Az @('rest', '--method', 'get', '--url',
            "https://management.azure.com${ApiId}?api-version=2024-04-01")
        if (-not $Function.properties.defaultHostName) { throw 'Function hostname is not available.' }
    }

    foreach ($LinkedRole in @(
        @{ Role = 'Log Analytics Reader'; Scope = $Settings.workspaceResourceId },
        @{ Role = 'Reader'; Scope = $Settings.actionGroupId }
    )) {
        Invoke-Az @('role', 'assignment', 'create', '--assignee-object-id', $Function.identity.principalId,
            '--assignee-principal-type', 'ServicePrincipal', '--role', $LinkedRole.Role, '--scope', $LinkedRole.Scope)
    }

    New-Item -ItemType Directory -Path $Package -Force | Out-Null
    Copy-Item (Join-Path $Root 'apps\load-demo\api\host.json') $Package -Force
    Copy-Item (Join-Path $Root 'apps\load-demo\api\package.json') $Package -Force
    foreach ($Folder in @('dist', 'config')) {
        Copy-Item (Join-Path $Root $Folder) $Package -Recurse -Force
    }
    & robocopy (Join-Path $Root 'node_modules') (Join-Path $Package 'node_modules') /E /COPY:DAT /R:1 /W:1 /MT:8 /NFL /NDL /NJH /NJS /NP
    if ($LASTEXITCODE -ge 8) { throw 'Runtime dependency packaging failed.' }
    $Zip = Join-Path $Artifact 'api.zip'
    if (Test-Path -LiteralPath $Zip) { Remove-Item -LiteralPath $Zip -Force }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [IO.Compression.ZipFile]::CreateFromDirectory($Package, $Zip)
    Invoke-Az @('staticwebapp', 'create', '--name', $WebName, '--resource-group', $Group,
        '--location', $Location, '--sku', 'Standard', '--tags', 'demo-purpose=interactive-load-test')
    Invoke-Az @('staticwebapp', 'backends', 'link', '--name', $WebName, '--resource-group', $Group,
        '--backend-resource-id', $ApiId, '--backend-region', $Location)
    $AuthUrl = "https://management.azure.com${ApiId}/config/authsettingsV2?api-version=2024-04-01"
    $Auth = Read-Az @('rest', '--method', 'get', '--url', $AuthUrl)
    $Auth.properties.platform.enabled = $false
    $Auth.properties.globalValidation.requireAuthentication = $false
    $Auth.properties.globalValidation.unauthenticatedClientAction = 'AllowAnonymous'
    $AuthFile = Join-Path ([IO.Path]::GetTempPath()) ("load-web-auth-" + [guid]::NewGuid() + '.json')
    try {
        [IO.File]::WriteAllText($AuthFile, (@{ properties = $Auth.properties } | ConvertTo-Json -Depth 40))
        Invoke-Az @('rest', '--method', 'put', '--url', $AuthUrl, '--body', "@$AuthFile")
    } finally { Remove-Item -LiteralPath $AuthFile -Force }
    Invoke-Az @('functionapp', 'deployment', 'source', 'config-zip', '--name', $ApiName,
        '--resource-group', $Group, '--src', $Zip, '--build-remote', 'false', '--timeout', '600')

    $Web = Read-Az @('staticwebapp', 'show', '--name', $WebName, '--resource-group', $Group)
    $Secrets = Read-Az @('staticwebapp', 'secrets', 'list', '--name', $WebName, '--resource-group', $Group)
    $PreviousToken = $env:SWA_CLI_DEPLOYMENT_TOKEN
    try {
        $env:SWA_CLI_DEPLOYMENT_TOKEN = $Secrets.properties.apiKey
        $SwaCli = Join-Path $env:APPDATA 'npm\node_modules\@azure\static-web-apps-cli\dist\cli\bin.js'
        & $NodePath $SwaCli deploy (Join-Path $Root 'apps\load-demo\web') --env production --no-use-keychain
        if ($LASTEXITCODE -ne 0) { throw 'Static Web App content deployment failed.' }
    } finally { $env:SWA_CLI_DEPLOYMENT_TOKEN = $PreviousToken; $Secrets = $null }
    $Result = @{ url = "https://$($Web.defaultHostname)"; staticWebAppName = $WebName;
        functionAppName = $ApiName; functionHost = $Function.properties.defaultHostName; functionResourceId = $ApiId;
        storageAccountName = $StorageName; virtualNetworkName = $VNetName;
        accessMode = 'public-anonymous'; seededAccountedUsd = $State.accountedUsd;
        subscriptionId = $Subscription; resourceGroupName = $Group; location = $Location }
    [IO.File]::WriteAllText((Join-Path $Artifact 'deployment.json'), ($Result | ConvertTo-Json))
    Write-Output "Deployed public demo: $($Result.url). Shared server budget applies to all visitors. No cloud test auto-started."
} finally { $env:PATH = $PreviousPath; Pop-Location }
}
#endregion Main Execution
