$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSVersion.Major -lt 7) { throw 'PowerShell 7 is required' }
$metadata = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'artifact-signing.json') -Raw | ConvertFrom-Json
$sdkRoot = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits/10/bin'
$signTool = Get-ChildItem -LiteralPath $sdkRoot -Directory | Sort-Object Name -Descending |
    ForEach-Object { Join-Path $_.FullName 'x64/signtool.exe' } | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (!$signTool) { throw 'Install the Windows SDK signing tools' }
$client = Join-Path $env:LOCALAPPDATA 'Microsoft/ArtifactSigning/Microsoft.ArtifactSigning.Client.1.0.146/bin/x64/Azure.CodeSigning.Dlib.dll'
$signature = Get-AuthenticodeSignature -LiteralPath $client
if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'O=Microsoft Corporation') { throw 'Install the verified Microsoft Artifact Signing Client 1.0.146' }
Get-Command az.cmd -ErrorAction Stop | Out-Null
$azureState = & az.cmd account show --query state -o tsv 2>$null
if ($LASTEXITCODE -ne 0 -or $azureState -ne 'Enabled') { throw 'Run az login and select the paid signing subscription' }
$accountId = & az.cmd resource list --resource-type Microsoft.CodeSigning/codeSigningAccounts --query "[?name=='$($metadata.CodeSigningAccountName)'].id | [0]" -o tsv
if ($LASTEXITCODE -ne 0 -or !$accountId) { throw 'The selected subscription cannot read the configured signing account' }
$certificate = & az.cmd rest --method GET --url "https://management.azure.com$accountId/certificateProfiles/$($metadata.CertificateProfileName)?api-version=2024-09-30-preview" --query properties -o json | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or $certificate.status -ne 'Active' -or $certificate.profileType -ne 'PublicTrust') { throw 'The configured Public Trust certificate profile must be Active' }
Write-Output 'Windows tools, Azure login, and Public Trust certificate profile verified.'
