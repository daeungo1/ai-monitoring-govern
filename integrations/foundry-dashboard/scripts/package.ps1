#!/usr/bin/env pwsh
# Copyright (c) Microsoft Corporation.
# SPDX-License-Identifier: MIT
#Requires -Version 7.0
<#
.SYNOPSIS
    Package the compiled dashboard for Azure App Service.
.DESCRIPTION
    Retain attribution and both startup scripts without local credentials or native dependencies.
.EXAMPLE
    pwsh -File scripts\package.ps1
.NOTES
    Run npm run build before packaging. This script does not deploy resources.
#>
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
if ($MyInvocation.InvocationName -eq '.') { return }
#region Main Execution
$root = Split-Path $PSScriptRoot -Parent
if (-not (Test-Path (Join-Path $root 'dist\index.html'))) { throw 'Run npm run build before packaging.' }
if (-not (Test-Path (Join-Path $root 'build\server\index.js'))) { throw 'Run npm run build to compile the server before packaging.' }
$artifacts = Join-Path $root 'artifacts'
New-Item -ItemType Directory -Path $artifacts -Force | Out-Null
$output = Join-Path $artifacts 'foundry-dashboard.zip'
$files = @('package-lock.json', 'LICENSE', 'UPSTREAM.md', 'INTEGRATION.md',
    'build\server\index.js', 'build\server\cache.js', 'build\server\errors.js',
    'build\server\time.js', 'build\server\retail-snapshot.js',
    'build\server\adapters\workspace.js', 'build\server\adapters\openai-platform.js',
    'build\shared\contracts\index.js', 'build\config\model-prices.json')
$folders = @('dist')
$timestamp = [DateTimeOffset]::new(2026, 1, 1, 0, 0, 0, [TimeSpan]::Zero)
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
if (Test-Path $output) { Remove-Item -LiteralPath $output }
$archive = [IO.Compression.ZipFile]::Open($output, [IO.Compression.ZipArchiveMode]::Create)
try {
    $manifest = Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw | ConvertFrom-Json
    $manifest.scripts = [PSCustomObject]@{
        start = $manifest.scripts.start
        'start:azure' = $manifest.scripts.'start:azure'
    }
    $manifest.PSObject.Properties.Remove('devDependencies')
    $entry = $archive.CreateEntry('package.json')
    $entry.LastWriteTime = $timestamp
    $writer = New-Object IO.StreamWriter($entry.Open())
    try { $writer.Write(($manifest | ConvertTo-Json -Depth 20)) } finally { $writer.Dispose() }
    foreach ($folder in $folders) {
        $files += Get-ChildItem -LiteralPath (Join-Path $root $folder) -File -Recurse |
            ForEach-Object { $_.FullName.Substring($root.Length + 1) }
    }
    foreach ($file in ($files | Sort-Object -Unique)) {
        $written = $archive.CreateEntry($file.Replace('\', '/'), [IO.Compression.CompressionLevel]::Optimal)
        $written.LastWriteTime = $timestamp
        $source = [IO.File]::OpenRead((Join-Path $root $file))
        $destination = $written.Open()
        try { $source.CopyTo($destination) } finally { $source.Dispose(); $destination.Dispose() }
    }
} finally { $archive.Dispose() }
Write-Output $output
#endregion Main Execution
