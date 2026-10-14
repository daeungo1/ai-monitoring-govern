#!/usr/bin/env pwsh
# Copyright (c) Microsoft Corporation.
# SPDX-License-Identifier: MIT
#Requires -Version 7.0
<#
.SYNOPSIS
    Send one Azure Monitor LogAlert V2 test email.
.DESCRIPTION
    Tests the Action Group notification path with an Azure-generated payload.
    Does not simulate a real model incident or prove recipient inbox delivery.
.PARAMETER EmailAddress
    Authorized test recipient.
.PARAMETER SettingsFile
    Generated non-secret deployment settings.
.EXAMPLE
    .\scripts\Test-AlertEmail.ps1 -EmailAddress operator@example.com
.NOTES
    Generates one notification. Azure CLI waits for the test result.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$EmailAddress,
    [string]$SettingsFile = 'artifacts\settings.json'
)
$ErrorActionPreference = 'Stop'

#region Main
if ($MyInvocation.InvocationName -ne '.') {
    Push-Location (Split-Path $PSScriptRoot -Parent)
    try {
        $Settings = Get-Content -LiteralPath $SettingsFile -Raw | ConvertFrom-Json
        $ActionGroupName = ($Settings.actionGroupId -split '/')[-1]
        $Result = & az monitor action-group test-notifications create `
            --subscription $Settings.subscriptionId --resource-group $Settings.resourceGroupName `
            --action-group-name $ActionGroupName --alert-type logalertv2 `
            --add-action email demo-owner $EmailAddress usecommonalertschema -o json
        if ($LASTEXITCODE -ne 0) { throw 'Azure Monitor test notification failed.' }
        $Result | Set-Content -LiteralPath 'artifacts\email-test.json' -Encoding utf8
        $Test = $Result | ConvertFrom-Json
        if ($Test.state -ne 'Complete' -or @($Test.actionDetails).Count -lt 1 -or
            @($Test.actionDetails | Where-Object Status -ne 'Succeeded').Count -gt 0) {
            throw 'Azure Monitor did not report successful dispatch for every test receiver.'
        }
        $Result
    }
    finally { Pop-Location }
}
#endregion
