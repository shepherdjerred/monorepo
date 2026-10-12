//! Windows' normal signed-installer elevation prompt.

use crate::{Error, Result};
use std::{os::windows::process::CommandExt, path::Path};

/// Windows verifies the full Authenticode chain before we offer an elevation prompt.
pub fn verify_microsoft(path: &Path) -> Result<()> {
    use std::os::windows::process::CommandExt;
    let script = format!(
        "$s=Get-AuthenticodeSignature -LiteralPath '{}'; if ($s.Status -eq 'Valid' -and $s.SignerCertificate.Subject -match '(^|,\\s*)CN=Microsoft Corporation(,|$)') {{ exit 0 }} else {{ exit 1 }}",
        path.to_string_lossy().replace('\'', "''")
    );
    let windows = std::env::var_os("SystemRoot")
        .ok_or_else(|| Error::Invalid("Windows system directory is unavailable".into()))?;
    let status = std::process::Command::new(
        Path::new(&windows).join("System32/WindowsPowerShell/v1.0/powershell.exe"),
    )
    .args(["-NoProfile", "-NonInteractive", "-Command", &script])
    .creation_flags(0x0800_0000)
    .stdin(std::process::Stdio::null())
    .stdout(std::process::Stdio::null())
    .stderr(std::process::Stdio::null())
    .status()?;
    if !status.success() {
        return Err(Error::Invalid("The component installer does not have a valid Microsoft signature. Restore the official installer before retrying.".into()));
    }
    Ok(())
}

pub fn verify_publisher(path: &Path, publisher: &str) -> Result<()> {
    use std::os::windows::process::CommandExt;
    let script = format!(
        "$s=Get-AuthenticodeSignature -LiteralPath '{}'; if ($s.Status -eq 'Valid' -and $s.SignerCertificate.Subject -ceq '{}' -and $null -ne $s.TimeStamperCertificate) {{ exit 0 }} else {{ exit 1 }}",
        path.to_string_lossy().replace('\'', "''"),
        publisher.replace('\'', "''")
    );
    let windows = std::env::var_os("SystemRoot")
        .ok_or_else(|| Error::Invalid("Windows system directory is unavailable".into()))?;
    let status = std::process::Command::new(
        Path::new(&windows).join("System32/WindowsPowerShell/v1.0/powershell.exe"),
    )
    .args(["-NoProfile", "-NonInteractive", "-Command", &script])
    .env_remove("PSModulePath")
    .creation_flags(0x0800_0000)
    .stdin(std::process::Stdio::null())
    .stdout(std::process::Stdio::null())
    .stderr(std::process::Stdio::null())
    .status()?;
    if !status.success() {
        return Err(Error::Invalid(
            "Launcher update publisher could not be verified".into(),
        ));
    }
    Ok(())
}

pub fn run(path: &Path, parameters: &str) -> Result<u32> {
    let windows = std::env::var_os("SystemRoot")
        .ok_or_else(|| Error::Invalid("Windows system directory is unavailable".into()))?;
    let script = elevation_script(path, parameters);
    let output = std::process::Command::new(
        Path::new(&windows).join("System32/WindowsPowerShell/v1.0/powershell.exe"),
    )
    .args(["-NoProfile", "-NonInteractive", "-Command", &script])
    .env_remove("PSModulePath")
    .creation_flags(0x0800_0000)
    .stdin(std::process::Stdio::null())
    .output()?;
    if !output.status.success() {
        return Err(Error::Invalid(format!(
            "Windows could not start component setup: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        )));
    }
    String::from_utf8_lossy(&output.stdout)
        .trim()
        .parse()
        .map_err(|_| {
            Error::Invalid("Windows did not return a component installer exit code".into())
        })
}
fn elevation_script(path: &Path, parameters: &str) -> String {
    format!(
        "$ErrorActionPreference='Stop'; try {{ $p=Start-Process -FilePath '{}' -ArgumentList '{}' -Verb RunAs -Wait -PassThru; [Console]::WriteLine($p.ExitCode) }} catch {{ if ($_.Exception.NativeErrorCode -eq 1223) {{ [Console]::WriteLine(1602) }} else {{ [Console]::Error.WriteLine($_.Exception.Message); exit 1 }} }}",
        path.to_string_lossy().replace('\'', "''"),
        parameters.replace('\'', "''")
    )
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn elevation_quotes_paths_and_waits_for_the_installer_exit_code() {
        let script = elevation_script(Path::new("C:/a'b/setup.exe"), "/passive /norestart");
        assert!(script.contains("-FilePath 'C:/a''b/setup.exe'"));
        assert!(script.contains("-ArgumentList '/passive /norestart'"));
        assert!(script.contains("-Verb RunAs -Wait -PassThru"));
        assert!(script.contains("[Console]::WriteLine($p.ExitCode)"));
        assert!(script.contains("NativeErrorCode -eq 1223"));
    }
}
