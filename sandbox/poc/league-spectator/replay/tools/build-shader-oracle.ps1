$ErrorActionPreference = 'Stop'
$workspace = (Get-Location).Path
$target = Join-Path $workspace '.cache/replay-spike/research/shader-oracle'
New-Item -ItemType Directory -Force -Path $target | Out-Null
$vswhere = 'C:/Program Files (x86)/Microsoft Visual Studio/Installer/vswhere.exe'
$visualStudio = (& $vswhere -latest -products '*' -property installationPath).Trim()
if (-not $visualStudio) { throw 'Visual Studio was not located' }
$setup = Join-Path $visualStudio 'VC/Auxiliary/Build/vcvars64.bat'
if (-not (Test-Path -LiteralPath $setup)) { throw 'The native x64 C++ build environment is missing' }
$source = Join-Path $PSScriptRoot 'shader-oracle.cpp'
$binary = Join-Path $target 'shader-oracle.exe'
$objectFile = Join-Path $target 'shader-oracle.obj'
$command = '"{0}" >nul && cl.exe /nologo /std:c++20 /EHsc /O2 /W4 /DUNICODE /D_UNICODE "{1}" /Fe:"{2}" /Fo:"{3}" /link d3d11.lib d3dcompiler.lib dxgi.lib' -f $setup, $source, $binary, $objectFile
& $env:ComSpec /d /s /c $command
if ($LASTEXITCODE -ne 0) { throw 'Native shader oracle compilation failed' }
$result = [ordered]@{
    schema = 1
    target = 'Windows x64 native D3D11 WARP'
    sourceSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $source).Hash.ToLowerInvariant()
    builderSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $PSCommandPath).Hash.ToLowerInvariant()
    binarySha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $binary).Hash.ToLowerInvariant()
    libraries = @{}
}
foreach ($name in @('d3d11.dll', 'd3dcompiler_47.dll', 'd3d10warp.dll')) {
    $path = Join-Path $env:WINDIR "System32/$name"
    $result.libraries[$name] = (Get-FileHash -Algorithm SHA256 -LiteralPath $path).Hash.ToLowerInvariant()
}
$result | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $target 'build.json') -Encoding utf8
$result | ConvertTo-Json -Depth 5
