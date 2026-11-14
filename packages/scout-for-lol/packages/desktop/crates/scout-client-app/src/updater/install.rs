//! Running a verified installer.

use std::path::Path;

/// Starts a verified installer. The updater decides when; this only runs it.
pub trait Installer: Send + Sync {
    /// Start `installer` and return without waiting for it, because the
    /// installer replaces this process's executable. With `restart` the
    /// installer starts the new version when it finishes.
    ///
    /// # Errors
    ///
    /// Any failure to start the installer process.
    fn install(&self, installer: &Path, restart: bool) -> std::io::Result<()>;
}

/// The command-line flags of a `cargo-packager` NSIS installer: `/P` runs it
/// passively (progress only, no questions), `/NS` leaves the shortcuts alone,
/// and `/R` starts the installed app afterwards.
#[cfg(any(windows, test))]
#[must_use]
pub fn nsis_arguments(restart: bool) -> Vec<&'static str> {
    let mut arguments = vec!["/P", "/NS"];
    if restart {
        arguments.push("/R");
    }
    arguments
}

/// Runs the NSIS installer `cargo packager` built, detached from this process
/// so it outlives the supervisor that started it.
#[cfg(windows)]
#[derive(Debug, Clone, Copy, Default)]
pub struct NsisInstaller;

#[cfg(windows)]
impl Installer for NsisInstaller {
    fn install(&self, installer: &Path, restart: bool) -> std::io::Result<()> {
        use std::os::windows::process::CommandExt as _;

        const DETACHED_PROCESS: u32 = 0x0000_0008;
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
        std::process::Command::new(installer)
            .args(nsis_arguments(restart))
            .creation_flags(DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP)
            .spawn()
            .map(drop)
    }
}

#[cfg(test)]
mod tests {
    use super::nsis_arguments;

    #[test]
    fn a_quit_install_never_starts_the_app_again() {
        assert_eq!(nsis_arguments(false), ["/P", "/NS"]);
    }

    #[test]
    fn an_idle_install_restarts_the_app() {
        assert_eq!(nsis_arguments(true), ["/P", "/NS", "/R"]);
    }
}
