#Requires -Version 5.1
param(
  [Parameter(Mandatory = $true)]
  [string]$Service,
  [Parameter(Mandatory = $true)]
  [string]$Ref,
  [switch]$Paste
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Fail([string]$Message) {
  [Console]::Error.WriteLine($Message)
  exit 1
}

if ([Console]::IsInputRedirected) {
  Fail "Run this installer in an interactive terminal; do not pipe the secret."
}

if ($Service.Trim().Length -eq 0 -or $Ref.Trim().Length -eq 0) {
  Fail "Usage: enroll-workstation-secret.ps1 -Service <service> -Ref <op://vault/item/field> [-Paste]"
}

if ($Paste) {
  $secure = Read-Host -AsSecureString "Paste the secret value, then press Enter"
  $bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try {
    $value = [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  } finally {
    [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    $secure.Dispose()
  }
} else {
  $opCmd = Get-Command op -ErrorAction SilentlyContinue
  if ($null -eq $opCmd) {
    Fail "Could not find the 1Password CLI (op) on PATH."
  }
  $psi = [System.Diagnostics.ProcessStartInfo]::new()
  $psi.FileName = $opCmd.Source
  $psi.UseShellExecute = $false
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.Arguments = "read `"$($Ref.Replace('"', '\"'))`""
  try {
    $proc = [System.Diagnostics.Process]::Start($psi)
    $value = $proc.StandardOutput.ReadToEnd()
    $null = $proc.StandardError.ReadToEnd()
    $proc.WaitForExit()
  } catch {
    Fail "Could not run the 1Password CLI."
  }
  if ($proc.ExitCode -ne 0) {
    Fail "1Password could not read $Ref. Windows DPAPI store was not changed."
  }
}

if ($null -eq $value) {
  Fail "The value is missing or looks truncated. Windows DPAPI store was not changed."
}
$value = $value.Trim()
if ($value.Length -le 16) {
  Fail "The value is missing or looks truncated. Windows DPAPI store was not changed."
}

Add-Type -AssemblyName System.Security
$localAppData = if ($env:LOCALAPPDATA) { $env:LOCALAPPDATA } else { Join-Path $env:USERPROFILE "AppData\Local" }
$safeService = [Regex]::Replace($Service.Trim(), "[^A-Za-z0-9._-]", "_")
$safeUser = [Regex]::Replace($env:USERNAME, "[^A-Za-z0-9._-]", "_")
$targetDir = Join-Path $localAppData "toolkit\secrets\$safeService"
$targetFile = Join-Path $targetDir "$safeUser.dpapi"
$tempFile = "$targetFile.$([Guid]::NewGuid().ToString()).tmp"

New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
$plainBytes = [System.Text.Encoding]::UTF8.GetBytes($value)
$protected = [System.Security.Cryptography.ProtectedData]::Protect(
  $plainBytes,
  $null,
  [System.Security.Cryptography.DataProtectionScope]::CurrentUser
)
[Array]::Clear($plainBytes, 0, $plainBytes.Length)
$encoded = [Convert]::ToBase64String($protected)

[System.IO.File]::WriteAllText($tempFile, "$encoded`n", [System.Text.UTF8Encoding]::new($false))
Move-Item -Path $tempFile -Destination $targetFile -Force

[Console]::Error.WriteLine("Stored $Service in Windows DPAPI store ($targetFile).")
