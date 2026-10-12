param([Parameter(Mandatory = $true)][string]$Path)
$ErrorActionPreference = 'Stop'
$profile = Get-Content -LiteralPath (Join-Path $PSScriptRoot '../release-profile.json') -Raw | ConvertFrom-Json
if (!$profile.publisher) { throw 'A signed release profile is required' }
$sdkRoot = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits/10/bin'
$signTool = Get-ChildItem -LiteralPath $sdkRoot -Directory | Sort-Object Name -Descending |
    ForEach-Object { Join-Path $_.FullName 'x64/signtool.exe' } | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (!$signTool) { throw 'Install the Windows SDK signing tools' }
$client = Join-Path $env:LOCALAPPDATA 'Microsoft/ArtifactSigning/Microsoft.ArtifactSigning.Client.1.0.146/bin/x64/Azure.CodeSigning.Dlib.dll'
if (!(Test-Path -LiteralPath $client)) { throw 'Install Microsoft.ArtifactSigning.Client 1.0.146 in LocalAppData/Microsoft/ArtifactSigning' }
$signature = Get-AuthenticodeSignature -LiteralPath $client
if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'O=Microsoft Corporation') { throw 'Artifact Signing client is not a verified Microsoft binary' }
$azure = Get-Command az.cmd -ErrorAction SilentlyContinue
if (!$azure) { throw 'Install Azure CLI and sign in with az login' }
$env:PATH = (Split-Path -Parent $azure.Source) + ';' + $env:PATH
& $signTool sign /fd SHA256 /tr 'http://timestamp.acs.microsoft.com' /td SHA256 /dlib $client /dmdf (Join-Path $PSScriptRoot 'artifact-signing.json') $Path
if ($LASTEXITCODE -ne 0) { throw "Artifact signing failed ($LASTEXITCODE)" }
& $signTool verify /pa /all $Path
if ($LASTEXITCODE -ne 0) { throw 'Windows signature verification failed' }
& (Join-Path $PSScriptRoot 'verify-signature.ps1') -Path $Path -Publisher $profile.publisher
