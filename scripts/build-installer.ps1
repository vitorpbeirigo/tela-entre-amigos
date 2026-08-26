$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$localBase = [System.IO.Path]::GetFullPath($env:LOCALAPPDATA)
$buildOutput = [System.IO.Path]::GetFullPath((Join-Path $localBase 'TelaBuild'))
$artifactOutput = Join-Path $projectRoot 'artifacts'

if (-not $buildOutput.StartsWith($localBase, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Diretorio temporario fora do LOCALAPPDATA: $buildOutput"
}

if (Test-Path -LiteralPath $buildOutput) {
  Remove-Item -LiteralPath $buildOutput -Recurse -Force
}

New-Item -ItemType Directory -Path $buildOutput -Force | Out-Null
New-Item -ItemType Directory -Path $artifactOutput -Force | Out-Null

$builder = Join-Path $projectRoot 'node_modules\.bin\electron-builder.cmd'
& $builder --win nsis --publish never "--config.directories.output=$buildOutput"

if ($LASTEXITCODE -ne 0) {
  throw "electron-builder terminou com codigo $LASTEXITCODE"
}

$installer = Get-ChildItem -LiteralPath $buildOutput -Filter 'Tela-Setup-*.exe' |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1

if (-not $installer) {
  throw 'O instalador Tela-Setup nao foi encontrado.'
}

$destination = Join-Path $artifactOutput $installer.Name
Copy-Item -LiteralPath $installer.FullName -Destination $destination -Force

Get-ChildItem -LiteralPath $buildOutput -File |
  Where-Object { $_.Name -eq 'latest.yml' -or $_.Name -like 'Tela-Setup-*.blockmap' } |
  ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $artifactOutput $_.Name) -Force
  }

Write-Output "Instalador pronto: $destination"
