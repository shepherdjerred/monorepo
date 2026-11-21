#Requires -Version 5.1
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$Service = "monorepo-homelab-1password-service-account"

function Fail([string]$Message) {
  [Console]::Error.WriteLine($Message)
  exit 1
}

if ([Console]::IsInputRedirected) {
  Fail "Run this installer in an interactive terminal; do not pipe the token."
}

$secure = Read-Host -AsSecureString "Paste the full 1Password service account token, then press Enter"
$bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
  $token = [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
} finally {
  [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  $secure.Dispose()
}

if ($null -eq $token) {
  Fail "The token is missing or incomplete. Windows DPAPI store was not changed."
}
$token = $token.Trim()
if (-not $token.StartsWith("ops_") -or $token.Length -le 128) {
  Fail "The token is missing or incomplete. Windows DPAPI store was not changed."
}

$opCmd = Get-Command op -ErrorAction SilentlyContinue
if ($null -eq $opCmd) {
  Fail "Could not find the 1Password CLI (op) on PATH."
}

$psi = [System.Diagnostics.ProcessStartInfo]::new()
$psi.FileName = $opCmd.Source
$psi.Arguments = "whoami"
$psi.UseShellExecute = $false
$psi.RedirectStandardInput = $true
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true
$psi.Environment["OP_SERVICE_ACCOUNT_TOKEN"] = $token
[void]$psi.Environment.Remove("OP_ACCOUNT")
[void]$psi.Environment.Remove("OP_CONNECT_TOKEN")

try {
  $proc = [System.Diagnostics.Process]::Start($psi)
  $proc.StandardInput.Close()
  $null = $proc.StandardOutput.ReadToEnd()
  $null = $proc.StandardError.ReadToEnd()
  $proc.WaitForExit()
} catch {
  Fail "Could not validate the service account with 1Password CLI."
}

if ($proc.ExitCode -ne 0) {
  Fail "1Password rejected the service account token. Windows DPAPI store was not changed."
}

Add-Type -AssemblyName System.Security
$localAppData = if ($env:LOCALAPPDATA) { $env:LOCALAPPDATA } else { Join-Path $env:USERPROFILE "AppData\Local" }
$safeUser = [Regex]::Replace($env:USERNAME, "[^A-Za-z0-9._-]", "_")
$targetDir = Join-Path $localAppData "toolkit\secrets\$Service"
$targetFile = Join-Path $targetDir "$safeUser.dpapi"
$tempFile = "$targetFile.$([Guid]::NewGuid().ToString()).tmp"

New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
$plainBytes = [System.Text.Encoding]::UTF8.GetBytes($token)
$protected = [System.Security.Cryptography.ProtectedData]::Protect(
  $plainBytes,
  $null,
  [System.Security.Cryptography.DataProtectionScope]::CurrentUser
)
[Array]::Clear($plainBytes, 0, $plainBytes.Length)
$encoded = [Convert]::ToBase64String($protected)

[System.IO.File]::WriteAllText($tempFile, "$encoded`n", [System.Text.UTF8Encoding]::new($false))
Move-Item -Path $tempFile -Destination $targetFile -Force

[Console]::Error.WriteLine("Service account validated and saved in Windows DPAPI store ($targetFile).")
