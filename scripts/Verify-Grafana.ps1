#!/usr/bin/env pwsh
# Copyright (c) Microsoft Corporation.
# SPDX-License-Identifier: MIT
#Requires -Version 7.0
<#
.SYNOPSIS
    Verify actual Azure Monitor queries through Managed Grafana.
.DESCRIPTION
    Uses Entra data-plane authentication and the workspace managed identity.
    It never prints tokens and fails if panels report query errors.
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
    [Parameter(Mandatory)][string]$ResourceGroupName
)
$ErrorActionPreference = 'Stop'
if ($MyInvocation.InvocationName -ne '.') {
    Push-Location (Split-Path $PSScriptRoot -Parent)
    try {
        $Endpoint = & az grafana show -n $GrafanaName -g $ResourceGroupName --query properties.endpoint -o tsv
        if ($LASTEXITCODE -ne 0) { throw 'Cannot resolve Grafana endpoint.' }
        $Token = & az account get-access-token --resource ce34e7e5-485f-4d76-964f-b3d2b16d1e4f --query accessToken -o tsv
        if ($LASTEXITCODE -ne 0 -or !$Token) { throw 'Grafana Entra authentication unavailable.' }
        $Dashboard = Get-Content -LiteralPath 'infra\grafana-dashboard.json' -Raw | ConvertFrom-Json -AsHashtable
        $Results = @()
        foreach ($Panel in $Dashboard.panels) {
            $Target = $Panel.targets[0]
            $Target.azureLogAnalytics.query = $Target.azureLogAnalytics.query.Replace('${deployment:raw}', 'all').Replace('${mode:raw}', 'live')
            $Target.intervalMs = 300000
            $Target.maxDataPoints = 288
            $Body = @{
                queries = @($Target)
                from = ([DateTimeOffset]::UtcNow.AddHours(-24).ToUnixTimeMilliseconds()).ToString()
                to = ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()).ToString()
            } | ConvertTo-Json -Depth 30
            $Response = Invoke-RestMethod -Uri "$Endpoint/api/ds/query" -Method Post `
                -Headers @{ Authorization = "Bearer $Token" } -ContentType 'application/json' -Body $Body -TimeoutSec 60
            $Result = $Response.results.A
            if ($Result.error -or ($Result.status -and $Result.status -ge 400)) {
                throw "Grafana panel query failed: $($Panel.title): $($Result.error)"
            }
            $Results += @{ title = $Panel.title; frames = @($Result.frames).Count; status = $Result.status }
        }
        @{ verifiedAt = [DateTimeOffset]::UtcNow.ToString('o'); endpoint = $Endpoint; panels = $Results } |
            ConvertTo-Json -Depth 10 | Set-Content -LiteralPath 'artifacts\grafana-verification.json' -Encoding utf8
        Write-Output "Verified $($Results.Count) Grafana data-source queries via managed identity."
    }
    finally { $Token = $null; Pop-Location }
}
