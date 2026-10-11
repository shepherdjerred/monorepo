//! Runtime-family and architecture-specific checks. Detection never executes game DLLs.
use crate::{Error, Result, catalog::Game};
use serde::Deserialize;
use std::path::Path;

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Architecture {
    X86,
    X64,
}
#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Family {
    Directx,
    Vc90,
    Vc100,
    Vc140,
}
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Requirement {
    pub games: Vec<Game>,
    pub id: String,
    pub architecture: Architecture,
    pub installer: String,
    pub files: Vec<String>,
    pub minimum: [u16; 4],
    pub family: Family,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Manifest {
    version: u32,
    requirements: Vec<Requirement>,
}
pub fn requirements(game: Game) -> Result<Vec<Requirement>> {
    let manifest: Manifest = serde_json::from_str(include_str!("../../../prerequisites.json"))?;
    if manifest.version != 1 {
        return Err(Error::Invalid("Unsupported prerequisite manifest".into()));
    }
    for requirement in &manifest.requirements {
        crate::archive::safe_relative_path(&requirement.installer)?;
        for file in &requirement.files {
            crate::archive::safe_relative_path(file)?;
        }
        if requirement.files.is_empty() {
            return Err(Error::Invalid("Empty prerequisite detection rule".into()));
        }
    }
    Ok(manifest
        .requirements
        .into_iter()
        .filter(|r| r.games.contains(&game))
        .collect())
}
/// Read-only detection for support and tests; never invokes an installer.
#[cfg(windows)]
pub fn inspect(game: Game) -> Result<Vec<(String, bool)>> {
    requirements(game)?
        .into_iter()
        .map(|r| windows::satisfied(&r).map(|ok| (r.id, ok)))
        .collect()
}

pub fn ensure(game: Game, directory: &Path) -> Result<()> {
    #[cfg(not(windows))]
    {
        let _ = (game, directory);
        Err(Error::Invalid("Runtime setup requires Windows".into()))
    }
    #[cfg(windows)]
    {
        for requirement in requirements(game)? {
            if windows::satisfied(&requirement)? {
                crate::diagnostics::record(
                    Some(game),
                    crate::diagnostics::Operation::Prerequisite,
                    crate::diagnostics::Outcome::Skipped,
                    None,
                    0,
                    0,
                );
                continue;
            }
            crate::diagnostics::record(
                Some(game),
                crate::diagnostics::Operation::Prerequisite,
                crate::diagnostics::Outcome::Started,
                None,
                0,
                0,
            );
            let path = directory.join(&requirement.installer);
            if !path.is_file() {
                return Err(Error::Invalid(format!(
                    "The {} installer is missing. Repair the game files.",
                    requirement.id
                )));
            }
            crate::windows_installer::verify_microsoft(&path)?;
            let args = if requirement.family == Family::Directx {
                "/silent"
            } else {
                "/passive /norestart"
            };
            match crate::windows_installer::run(&path, args)? {
                0 | 1638 => {}
                3010 | 1641 => {
                    return Err(Error::ActionRequired {
                        title: "Windows needs a restart",
                        next_step: "Restart Windows to finish setup, then open Glitter Boys and choose Play again.",
                    });
                }
                1602 => {
                    return Err(Error::ActionRequired {
                        title: "Setup was cancelled",
                        next_step: "Choose Try again when you are ready to finish setup.",
                    });
                }
                code => {
                    return Err(Error::Invalid(format!(
                        "{} setup returned {code}. Open diagnostics for support.",
                        requirement.id
                    )));
                }
            }
            if !windows::satisfied(&requirement)? {
                return Err(Error::Invalid(format!(
                    "{} is still missing or outdated after setup. Restart Windows and retry.",
                    requirement.id
                )));
            }
        }
        Ok(())
    }
}

#[cfg(windows)]
mod windows {
    use super::*;
    use std::path::PathBuf;
    use winsafe::{self as w, co};
    pub fn version(path: &Path) -> Result<Option<[u16; 4]>> {
        match std::fs::metadata(path) {
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(e) => return Err(e.into()),
            Ok(_) => {}
        }
        let name = path
            .to_str()
            .ok_or_else(|| Error::Invalid("Runtime path is not valid Unicode".into()))?;
        let data = w::HVERSIONINFO::GetFileVersionInfo(name)
            .map_err(|error| std::io::Error::from_raw_os_error(error.raw() as i32))?;
        let info = data
            .version_info()
            .map_err(|error| std::io::Error::from_raw_os_error(error.raw() as i32))?;
        Ok(Some(info.dwFileVersion()))
    }
    fn registered(architecture: Architecture) -> Result<bool> {
        let arch = if architecture == Architecture::X86 {
            "x86"
        } else {
            "x64"
        };
        let key = format!("SOFTWARE\\Microsoft\\VisualStudio\\14.0\\VC\\Runtimes\\{arch}");
        let result = w::HKEY::LOCAL_MACHINE.RegGetValue(
            Some(&key),
            Some("Installed"),
            co::RRF::RT_REG_DWORD | co::RRF::SUBKEY_WOW6432KEY,
        );
        match result {
            Ok(w::RegistryValue::Dword(value)) => Ok(value == 1),
            Ok(_) => Err(Error::Invalid(
                "Invalid Microsoft runtime registration".into(),
            )),
            Err(co::ERROR::FILE_NOT_FOUND | co::ERROR::PATH_NOT_FOUND) => Ok(false),
            Err(error) => Err(std::io::Error::from_raw_os_error(error.raw() as i32).into()),
        }
    }
    fn files_present(root: &Path, requirement: &Requirement) -> Result<bool> {
        for name in &requirement.files {
            if !version(&root.join(name))?.is_some_and(|v| v >= requirement.minimum) {
                return Ok(false);
            }
        }
        Ok(true)
    }
    pub fn satisfied(requirement: &Requirement) -> Result<bool> {
        let windows = PathBuf::from(
            std::env::var_os("SystemRoot")
                .ok_or_else(|| Error::Invalid("Windows system directory is unavailable".into()))?,
        );
        if requirement.family == Family::Vc90 {
            for entry in std::fs::read_dir(windows.join("WinSxS"))? {
                let entry = entry?;
                let name = entry.file_name().to_string_lossy().to_ascii_lowercase();
                let prefix = if requirement.architecture == Architecture::X86 {
                    "x86_microsoft.vc90.crt_"
                } else {
                    "amd64_microsoft.vc90.crt_"
                };
                if name.starts_with(prefix)
                    && entry.file_type()?.is_dir()
                    && files_present(&entry.path(), requirement)?
                {
                    return Ok(true);
                }
            }
            return Ok(false);
        }
        if requirement.family == Family::Vc140 && !registered(requirement.architecture)? {
            return Ok(false);
        }
        files_present(
            &windows.join(if requirement.architecture == Architecture::X86 {
                "SysWOW64"
            } else {
                "System32"
            }),
            requirement,
        )
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn runtime_families_and_architectures_are_explicit() -> Result<()> {
        for game in Game::ALL {
            assert!(!requirements(game)?.is_empty());
        }
        assert!(
            requirements(Game::T7)?
                .iter()
                .all(|r| r.architecture == Architecture::X64)
        );
        assert!(
            requirements(Game::T5)?
                .iter()
                .any(|r| r.family == Family::Vc90)
        );
        assert!(
            requirements(Game::T6)?
                .iter()
                .any(|r| r.family == Family::Vc100)
        );
        assert!(
            requirements(Game::Iw4x)?
                .iter()
                .all(|r| r.family == Family::Directx)
        );
        assert!([14, 40, 1, 0] > [14, 27, 29016, 0]);
        Ok(())
    }
}
