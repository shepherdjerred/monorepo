$ErrorActionPreference = 'Stop'

$principal = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'TaskNotes development signing must be provisioned from an elevated PowerShell terminal.'
}

$friendlyName = 'TaskNotes Development MSIX'
$subject = 'CN=TaskNotes Development'
$certificate = Get-ChildItem -Path Cert:\CurrentUser\My |
  Where-Object { $_.FriendlyName -eq $friendlyName -and $_.Subject -eq $subject -and $_.NotAfter -gt (Get-Date).AddDays(30) } |
  Sort-Object NotAfter -Descending |
  Select-Object -First 1

if ($null -eq $certificate) {
  $certificate = New-SelfSignedCertificate `
    -Type Custom `
    -Subject $subject `
    -FriendlyName $friendlyName `
    -KeyAlgorithm RSA `
    -KeyLength 2048 `
    -HashAlgorithm SHA256 `
    -KeyUsage DigitalSignature `
    -CertStoreLocation Cert:\CurrentUser\My `
    -TextExtension @('2.5.29.37={text}1.3.6.1.5.5.7.3.3')
}

$temporaryCertificate = Join-Path ([System.IO.Path]::GetTempPath()) "tasknotes-$($certificate.Thumbprint).cer"
try {
  Export-Certificate -Cert $certificate -FilePath $temporaryCertificate -Force | Out-Null
  Import-Certificate -FilePath $temporaryCertificate -CertStoreLocation Cert:\LocalMachine\TrustedPeople | Out-Null
}
finally {
  if (Test-Path -LiteralPath $temporaryCertificate) {
    Remove-Item -LiteralPath $temporaryCertificate
  }
}

$propsPath = Join-Path $PSScriptRoot '..\Directory.Build.local.props'
$contents = @"
<Project>
  <PropertyGroup>
    <PackageCertificateThumbprint>$($certificate.Thumbprint)</PackageCertificateThumbprint>
  </PropertyGroup>
</Project>
"@
[System.IO.File]::WriteAllText([System.IO.Path]::GetFullPath($propsPath), $contents, [System.Text.UTF8Encoding]::new($false))
Write-Host "TaskNotes development signing is ready. The thumbprint is stored only in ignored Directory.Build.local.props."
