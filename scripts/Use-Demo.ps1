#!/usr/bin/env pwsh
# Copyright (c) Microsoft Corporation.
# SPDX-License-Identifier: MIT
#Requires -Version 7.0
<#
.SYNOPSIS
    Run live, synthetic replay, offline or Azure verification modes.
.DESCRIPTION
    Loads non-secret deployment settings and fetches the ingestion connection
    string into this process only. Does not create a .env or persist credentials.
.PARAMETER Mode
    Offline has no Azure dependency; live invokes all selected models; replay exports fixtures.
.PARAMETER SettingsFile
    Generated deployment settings file.
.PARAMETER Deployments
    Comma-separated deployment selection. Omit to use all configured models.
.PARAMETER CountPerModel
    Number of safe calls per model, between 1 and 20.
.PARAMETER LiveRunId
    Live run UUID required by verify.
.PARAMETER ReplayRunId
    Synthetic replay run UUID required by verify.
.PARAMETER NodePath
    Node 22+ executable. Defaults to node on PATH.
.EXAMPLE
    .\scripts\Use-Demo.ps1 -Mode live -CountPerModel 1
.NOTES
    Requires npm run build, Azure CLI login and Node 22 or newer.
#>
[CmdletBinding()]
param(
    [ValidateSet('offline', 'live', 'replay', 'verify')][string]$Mode = 'offline',
    [string]$SettingsFile = 'artifacts\settings.json',
    [string]$Deployments,
    [ValidateRange(1, 20)][int]$CountPerModel = 1,
    [string]$LiveRunId,
    [string]$ReplayRunId,
    [string]$NodePath = 'node'
)
$ErrorActionPreference = 'Stop'

#region Main
if ($MyInvocation.InvocationName -ne '.') {
    Push-Location (Split-Path $PSScriptRoot -Parent)
    $Variables = @('AZURE_OPENAI_ENDPOINT', 'APPLICATIONINSIGHTS_CONNECTION_STRING', 'LOG_ANALYTICS_WORKSPACE_ID',
        'DEMO_DEPLOYMENTS', 'DEMO_REQUEST_COUNT', 'VERIFY_LIVE_RUN_ID', 'VERIFY_REPLAY_RUN_ID', 'VERIFY_COUNT_PER_MODEL')
    $Saved = @{}
    foreach ($Name in $Variables) { $Saved[$Name] = [Environment]::GetEnvironmentVariable($Name, 'Process') }
    try {
        if ($Deployments) { $env:DEMO_DEPLOYMENTS = $Deployments }
        else { Remove-Item Env:\DEMO_DEPLOYMENTS -ErrorAction SilentlyContinue }
        $env:DEMO_REQUEST_COUNT = "$CountPerModel"
        if ($Mode -ne 'offline') {
            $Settings = Get-Content -LiteralPath $SettingsFile -Raw | ConvertFrom-Json
            $env:AZURE_OPENAI_ENDPOINT = $Settings.endpoint
            $env:LOG_ANALYTICS_WORKSPACE_ID = $Settings.workspaceId
        }
        if ($Mode -in @('live', 'replay')) {
            $ConnectionString = & az resource show --ids $Settings.applicationInsightsResourceId `
                --subscription $Settings.subscriptionId --api-version 2020-02-02 --query properties.ConnectionString -o tsv
            if ($LASTEXITCODE -ne 0 -or !$ConnectionString) { throw 'Cannot read Application Insights ingestion settings.' }
            $env:APPLICATIONINSIGHTS_CONNECTION_STRING = $ConnectionString
        }
        if ($Mode -eq 'verify') {
            if (!$LiveRunId -or !$ReplayRunId) { throw 'Verify requires LiveRunId and ReplayRunId.' }
            $env:VERIFY_LIVE_RUN_ID = $LiveRunId
            $env:VERIFY_REPLAY_RUN_ID = $ReplayRunId
            $env:VERIFY_COUNT_PER_MODEL = "$CountPerModel"
            & $NodePath 'dist\verify.js'
        }
        else { & $NodePath 'dist\cli.js' $Mode }
        if ($LASTEXITCODE -ne 0) { throw "Demo $Mode failed. Inspect sanitized output and do not claim success." }
    }
    finally {
        foreach ($Name in $Variables) { [Environment]::SetEnvironmentVariable($Name, $Saved[$Name], 'Process') }
        Pop-Location
    }
}
#endregion
