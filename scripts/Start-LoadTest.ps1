#!/usr/bin/env pwsh
# Copyright (c) Microsoft Corporation.
# SPDX-License-Identifier: MIT
#Requires -Version 7.0
<#
.SYNOPSIS
    Run controlled continuous streaming load.
.DESCRIPTION
    Loads ingestion configuration only in this process; worker persists sanitized
    state and dailyreport.md. Start in a detached terminal/session for persistence.
.PARAMETER NodePath
    Node 22+ executable.
.PARAMETER MaxWaves
    Optional finite canary count. Zero means continue until explicitly stopped.
.PARAMETER Resume
    Explicitly clear an earlier STOP marker.
.PARAMETER DemoScenarios
    Export clearly labeled synthetic guardrail/429 scenarios once per hour.
.EXAMPLE
    .\scripts\Start-LoadTest.ps1 -MaxWaves 3
.NOTES
    Default ordinary concurrency is 2; bursts target 30 RPS for 2s every 5m.
    The daily retail-estimate ceiling is 20 USD, with a 70% warning.
#>
[CmdletBinding()]
param(
    [string]$NodePath = 'node',
    [ValidateRange(0, 100)][int]$MaxWaves = 0,
    [switch]$Resume,
    [switch]$DemoScenarios
)
$ErrorActionPreference = 'Stop'
if ($MyInvocation.InvocationName -ne '.') {
    Push-Location (Split-Path $PSScriptRoot -Parent)
    $SavedConnection = $env:APPLICATIONINSIGHTS_CONNECTION_STRING
    $SavedWaves = $env:LOAD_MAX_WAVES
    $SavedScenarios = $env:LOAD_SCENARIO_INTERVAL_SECONDS
    try {
        if (Test-Path -LiteralPath 'artifacts\loadtest\STOP') {
            if (!$Resume) { throw 'Existing STOP marker. Use -Resume only when intentional.' }
            Remove-Item -LiteralPath 'artifacts\loadtest\STOP'
        }
        $Settings = Get-Content -LiteralPath 'artifacts\settings.json' -Raw | ConvertFrom-Json
        $Connection = & az resource show --ids $Settings.applicationInsightsResourceId `
            --subscription $Settings.subscriptionId --api-version 2020-02-02 --query properties.ConnectionString -o tsv
        if ($LASTEXITCODE -ne 0 -or !$Connection) { throw 'Cannot resolve telemetry ingestion configuration.' }
        $env:APPLICATIONINSIGHTS_CONNECTION_STRING = $Connection
        if ($MaxWaves -gt 0) { $env:LOAD_MAX_WAVES = "$MaxWaves" }
        else { Remove-Item Env:\LOAD_MAX_WAVES -ErrorAction SilentlyContinue }
        if ($DemoScenarios) { $env:LOAD_SCENARIO_INTERVAL_SECONDS = '3600' }
        else { Remove-Item Env:\LOAD_SCENARIO_INTERVAL_SECONDS -ErrorAction SilentlyContinue }
        & $NodePath 'dist\load-worker.js'
        if ($LASTEXITCODE -ne 0) { throw 'Load worker exited with a critical error; inspect sanitized state.' }
    }
    finally {
        $env:APPLICATIONINSIGHTS_CONNECTION_STRING = $SavedConnection
        $env:LOAD_MAX_WAVES = $SavedWaves
        $env:LOAD_SCENARIO_INTERVAL_SECONDS = $SavedScenarios
        Pop-Location
    }
}
