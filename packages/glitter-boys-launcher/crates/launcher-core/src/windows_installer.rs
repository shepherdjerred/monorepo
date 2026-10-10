//! The small FFI boundary for Windows' normal signed-installer elevation prompt.

use crate::{Error, Result};
use std::{os::windows::ffi::OsStrExt, path::Path};
use windows_sys::Win32::{
    Foundation::{CloseHandle, WAIT_OBJECT_0},
    System::Threading::{GetExitCodeProcess, INFINITE, WaitForSingleObject},
    UI::{
        Shell::{SEE_MASK_NOASYNC, SEE_MASK_NOCLOSEPROCESS, SHELLEXECUTEINFOW, ShellExecuteExW},
        WindowsAndMessaging::SW_SHOWNORMAL,
    },
};

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
        "$s=Get-AuthenticodeSignature -LiteralPath '{}'; if ($s.Status -eq 'Valid' -and $s.SignerCertificate.Subject -eq '{}') {{ exit 0 }} else {{ exit 1 }}",
        path.to_string_lossy().replace('\'', "''"),
        publisher.replace('\'', "''")
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
        return Err(Error::Invalid(
            "Launcher update publisher could not be verified".into(),
        ));
    }
    Ok(())
}

// SAFETY: Windows requires raw FFI for ShellExecuteExW. All input buffers remain
// alive until it returns. Only its returned process handle is waited/closed, once.
#[allow(
    unsafe_code,
    reason = "Isolated Windows FFI for the normal UAC installer flow"
)]
pub fn run(path: &Path, parameters: &str) -> Result<u32> {
    let file: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
    let verb: Vec<u16> = "runas".encode_utf16().chain(Some(0)).collect();
    let arguments: Vec<u16> = parameters.encode_utf16().chain(Some(0)).collect();
    let mut info: SHELLEXECUTEINFOW = unsafe { std::mem::zeroed() };
    info.cbSize = std::mem::size_of::<SHELLEXECUTEINFOW>() as u32;
    info.fMask = SEE_MASK_NOCLOSEPROCESS | SEE_MASK_NOASYNC;
    info.lpFile = file.as_ptr();
    info.lpVerb = verb.as_ptr();
    info.lpParameters = arguments.as_ptr();
    info.nShow = SW_SHOWNORMAL;
    if unsafe { ShellExecuteExW(&mut info) } == 0 {
        return Err(std::io::Error::last_os_error().into());
    }
    if info.hProcess.is_null() {
        return Err(Error::Invalid(
            "Windows did not return a component installer process".into(),
        ));
    }
    let result = if unsafe { WaitForSingleObject(info.hProcess, INFINITE) } == WAIT_OBJECT_0 {
        let mut exit_code = 0;
        if unsafe { GetExitCodeProcess(info.hProcess, &mut exit_code) } == 0 {
            Err(std::io::Error::last_os_error().into())
        } else {
            Ok(exit_code)
        }
    } else {
        Err(std::io::Error::last_os_error().into())
    };
    unsafe {
        CloseHandle(info.hProcess);
    }
    result
}
