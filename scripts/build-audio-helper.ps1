$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$projectFile = Join-Path $projectRoot 'native\audio-capture\TelaAudioCapture.vcxproj'
$outputDirectory = Join-Path $projectRoot 'native\bin'
$vswhere = 'C:\Program Files (x86)\Microsoft Visual Studio\Installer\vswhere.exe'

if (-not (Test-Path -LiteralPath $vswhere)) {
  throw 'Visual Studio Build Tools nao foi encontrado.'
}

$installationPath = & $vswhere -latest -products '*' -property installationPath
if (-not $installationPath) {
  $installationPath = & $vswhere -all -products '*' -property installationPath | Select-Object -First 1
}
if (-not $installationPath) {
  throw 'O compilador C++ do Visual Studio nao foi encontrado.'
}

$msbuild = Join-Path $installationPath 'MSBuild\Current\Bin\MSBuild.exe'
if (-not (Test-Path -LiteralPath $msbuild)) {
  throw "MSBuild nao encontrado em $msbuild"
}

New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
$msbuildOutputDirectory = $outputDirectory.Replace('\', '/') + '/'
$platformToolset = if ($installationPath -match '[\\/]2022[\\/]') { 'v143' } else { 'v142' }
& $msbuild $projectFile /restore /m /p:Configuration=Release /p:Platform=x64 "/p:PlatformToolset=$platformToolset" "/p:OutDir=$msbuildOutputDirectory" /p:DebugSymbols=false /p:DebugType=None

if ($LASTEXITCODE -ne 0) {
  throw "A compilacao do capturador de audio terminou com codigo $LASTEXITCODE"
}

$executable = Join-Path $outputDirectory 'TelaAudioCapture.exe'
if (-not (Test-Path -LiteralPath $executable)) {
  throw 'TelaAudioCapture.exe nao foi gerado.'
}

Write-Output "Capturador de audio pronto: $executable"
