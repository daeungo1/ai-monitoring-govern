#!/usr/bin/env pwsh
# Copyright (c) Microsoft Corporation.
# SPDX-License-Identifier: MIT
#Requires -Version 7.0
<#
.SYNOPSIS
    Request graceful stop of this project's load worker.
.DESCRIPTION
    Writes a project-scoped STOP marker; no name-based process termination.
.EXAMPLE
    .\scripts\Stop-LoadTest.ps1
.NOTES
    Active streams are cancelled and unknown final usage stays unknown.
#>
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
if ($MyInvocation.InvocationName -ne '.') {
    $Directory = Join-Path (Split-Path $PSScriptRoot -Parent) 'artifacts\loadtest'
    New-Item -ItemType Directory -Path $Directory -Force | Out-Null
    [IO.File]::WriteAllText((Join-Path $Directory 'STOP'), [DateTimeOffset]::UtcNow.ToString('o'))
    & (Join-Path $PSScriptRoot 'Set-DemoScenarioAlerts.ps1') -Disable
    Write-Output 'Stop requested. Check artifacts\loadtest\status.json until status is stopped.'
}
