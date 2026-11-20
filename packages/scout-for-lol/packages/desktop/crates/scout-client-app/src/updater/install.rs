//! Running a verified installer.

use std::path::Path;

/// Installs a verified update artifact. The updater decides when; this only
/// installs.
pub trait Installer: Send + Sync {
    /// Install `artifact`. With `restart` the new version starts once this
    /// process has ended.
    ///
    /// On Windows this starts the NSIS installer and returns without waiting,
    /// because the installer replaces this process's executable. On macOS the
    /// app bundle is replaced in place before this returns; the running
    /// process keeps its open files until it exits.
    ///
    /// # Errors
    ///
    /// Any failure to start the installer or to replace the bundle. A failed
    /// macOS replacement leaves the running version where it was.
    fn install(&self, artifact: &Path, restart: bool) -> std::io::Result<()>;
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

/// Replaces the running `.app` bundle with the one in the verified archive,
/// in place, so the Dock, Finder and the start-at-login registration keep
/// pointing at the same path.
#[cfg(target_os = "macos")]
#[derive(Debug, Clone, Copy, Default)]
pub struct AppBundleInstaller;

#[cfg(target_os = "macos")]
impl Installer for AppBundleInstaller {
    fn install(&self, archive: &Path, restart: bool) -> std::io::Result<()> {
        let executable = std::env::current_exe()?.canonicalize()?;
        let bundle = app_bundle::bundle_of(&executable).ok_or_else(|| {
            std::io::Error::other("Scout Desktop is not running from an app bundle")
        })?;
        app_bundle::replace_bundle(archive, &bundle)?;
        if restart {
            app_bundle::relaunch_after_exit(&bundle)?;
        }
        Ok(())
    }
}

/// Unpacking an app archive and swapping it for the running bundle. Pure file
/// work, so it is tested on every platform; only [`AppBundleInstaller`] runs
/// it for real.
#[cfg(any(target_os = "macos", test))]
pub mod app_bundle {
    use std::ffi::{OsStr, OsString};
    use std::fs::{self, File};
    use std::io::{self, BufReader};
    use std::path::{Component, Path, PathBuf};

    fn invalid(message: &'static str) -> io::Error {
        io::Error::new(io::ErrorKind::InvalidData, message)
    }

    /// The `.app` bundle an executable at `<bundle>.app/Contents/MacOS/<binary>`
    /// runs from. `None` for a development build in `target/`.
    #[must_use]
    pub fn bundle_of(executable: &Path) -> Option<PathBuf> {
        let macos = executable.parent()?;
        let contents = macos.parent()?;
        let bundle = contents.parent()?;
        (macos.file_name()? == "MacOS"
            && contents.file_name()? == "Contents"
            && bundle.extension()? == "app")
            .then(|| bundle.to_path_buf())
    }

    /// Unpack `archive`, a gzipped tar holding exactly one `<Name>.app`
    /// directory, into `into` and return the bundle's path.
    ///
    /// The archive's signature was verified before this runs; the checks here
    /// make a broken publication fail before the running bundle is touched.
    ///
    /// # Errors
    ///
    /// Reading or unpacking fails, or the archive is not one app bundle.
    pub fn unpack_app(archive: &Path, into: &Path) -> io::Result<PathBuf> {
        fs::create_dir_all(into)?;
        let decoder = flate2::read::GzDecoder::new(BufReader::new(File::open(archive)?));
        let mut tar = tar::Archive::new(decoder);
        tar.set_preserve_permissions(true);
        tar.set_preserve_mtime(true);
        tar.set_overwrite(false);
        let mut top: Option<OsString> = None;
        for entry in tar.entries()? {
            let mut entry = entry?;
            let path = entry.path()?.into_owned();
            let mut components = path.components();
            let Some(Component::Normal(first)) = components.next() else {
                return Err(invalid("an archive entry is outside the app bundle"));
            };
            if Path::new(first).extension() != Some(OsStr::new("app")) {
                return Err(invalid("the archive does not hold an app bundle"));
            }
            if !components.all(|component| matches!(component, Component::Normal(_))) {
                return Err(invalid("an archive entry is outside the app bundle"));
            }
            match &top {
                None => top = Some(first.to_owned()),
                Some(name) if name == first => {}
                Some(_) => return Err(invalid("the archive holds more than one app bundle")),
            }
            let kind = entry.header().entry_type();
            if !(kind.is_file() || kind.is_dir() || kind.is_symlink()) {
                return Err(invalid("the archive holds an entry that is not a file"));
            }
            if !entry.unpack_in(into)? {
                return Err(invalid("an archive entry is outside the app bundle"));
            }
        }
        let bundle = into.join(top.ok_or_else(|| invalid("the archive is empty"))?);
        let contents = bundle.join("Contents");
        if !contents.join("Info.plist").is_file() || !contents.join("MacOS").is_dir() {
            return Err(invalid(
                "the archived app bundle has no Info.plist or executable",
            ));
        }
        Ok(bundle)
    }

    /// Replace `bundle` with the app bundle in `archive`.
    ///
    /// The new bundle is unpacked into a hidden directory beside `bundle`, so
    /// both renames stay on one volume, then swapped in. If the second rename
    /// fails the running version is put back. The scratch directory is
    /// removed afterwards whenever `bundle` exists again.
    ///
    /// # Errors
    ///
    /// Unpacking or either rename fails (a read-only volume such as the
    /// mounted DMG, an app translocated by Gatekeeper, or a folder the user
    /// cannot write).
    pub fn replace_bundle(archive: &Path, bundle: &Path) -> io::Result<()> {
        let parent = bundle
            .parent()
            .ok_or_else(|| invalid("the app bundle has no parent directory"))?;
        let name = bundle
            .file_name()
            .ok_or_else(|| invalid("the app bundle has no name"))?;
        let mut scratch_name = OsString::from(".");
        scratch_name.push(name);
        scratch_name.push(".scout-update");
        let scratch = parent.join(scratch_name);
        // Left by an interrupted update; the running bundle is in place, so
        // nothing in it is needed.
        if scratch.exists() {
            fs::remove_dir_all(&scratch)?;
        }
        fs::create_dir(&scratch)?;
        let outcome = swap(archive, bundle, &scratch);
        if bundle.is_dir()
            && let Err(error) = fs::remove_dir_all(&scratch)
        {
            tracing::warn!(%error, "could not remove the update scratch directory");
        }
        outcome
    }

    fn swap(archive: &Path, bundle: &Path, scratch: &Path) -> io::Result<()> {
        let fresh = unpack_app(archive, &scratch.join("new"))?;
        let previous = scratch.join("previous.app");
        fs::rename(bundle, &previous)?;
        if let Err(error) = fs::rename(&fresh, bundle) {
            return match fs::rename(&previous, bundle) {
                Ok(()) => Err(error),
                Err(restore) => Err(io::Error::other(format!(
                    "{error}; restoring the running version from {} also failed: {restore}",
                    previous.display()
                ))),
            };
        }
        Ok(())
    }

    /// Waits for this process to end, then opens `bundle`. `/bin/sh` polls
    /// the process ID rather than sleeping a fixed time; the new version
    /// cannot start earlier because the supervisor holds the single-instance
    /// lock until it exits. The helper's output goes nowhere (see
    /// [`relaunch_after_exit`]), so `kill`'s complaint about the ended process
    /// needs no redirect.
    #[cfg(target_os = "macos")]
    const RELAUNCH_SCRIPT: &str =
        r#"while kill -0 "$1"; do sleep 0.2; done; exec /usr/bin/open "$2""#;

    /// Start the detached relaunch helper for `bundle`.
    ///
    /// # Errors
    ///
    /// `/bin/sh` could not be started.
    #[cfg(target_os = "macos")]
    pub fn relaunch_after_exit(bundle: &Path) -> io::Result<()> {
        use std::os::unix::process::CommandExt as _;
        use std::process::{Command, Stdio};

        Command::new("/bin/sh")
            .args(["-c", RELAUNCH_SCRIPT, "scout-relaunch"])
            .arg(std::process::id().to_string())
            .arg(bundle)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            // Its own process group, so it is not signalled with the app.
            .process_group(0)
            .spawn()
            .map(drop)
    }
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::{Path, PathBuf};

    use flate2::Compression;
    use flate2::write::GzEncoder;

    use super::app_bundle::{bundle_of, replace_bundle, unpack_app};
    use super::nsis_arguments;

    type TestResult = Result<(), Box<dyn std::error::Error>>;

    #[test]
    fn a_quit_install_never_starts_the_app_again() {
        assert_eq!(nsis_arguments(false), ["/P", "/NS"]);
    }

    #[test]
    fn an_idle_install_restarts_the_app() {
        assert_eq!(nsis_arguments(true), ["/P", "/NS", "/R"]);
    }

    fn scratch() -> Result<PathBuf, std::io::Error> {
        let directory =
            std::env::temp_dir().join(format!("scout-install-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&directory)?;
        Ok(directory)
    }

    /// Write a fake bundle: `Contents/Info.plist` and an executable binary.
    fn bundle(at: &Path, version: &str) -> Result<(), std::io::Error> {
        fs::create_dir_all(at.join("Contents/MacOS"))?;
        fs::create_dir_all(at.join("Contents/Resources/voice-models"))?;
        fs::write(at.join("Contents/Info.plist"), version)?;
        fs::write(
            at.join("Contents/Resources/voice-models/model.onnx"),
            version,
        )?;
        let binary = at.join("Contents/MacOS/scout-client");
        fs::write(&binary, version)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt as _;
            fs::set_permissions(&binary, fs::Permissions::from_mode(0o755))?;
        }
        Ok(())
    }

    /// Archive `source` as `<name>/...`, the layout the release script writes.
    fn archive(source: &Path, name: &str, into: &Path) -> Result<PathBuf, std::io::Error> {
        let path = into.join("update.app.tar.gz");
        let mut builder = tar::Builder::new(GzEncoder::new(
            fs::File::create(&path)?,
            Compression::default(),
        ));
        builder.append_dir_all(name, source)?;
        builder.into_inner()?.finish()?;
        Ok(path)
    }

    /// An archive with one raw entry name, which `tar::Builder` would refuse.
    fn raw_archive(entry: &[u8], into: &Path) -> Result<PathBuf, std::io::Error> {
        let path = into.join("raw.app.tar.gz");
        let mut builder = tar::Builder::new(GzEncoder::new(
            fs::File::create(&path)?,
            Compression::default(),
        ));
        let mut header = tar::Header::new_old();
        header.as_old_mut().name[..entry.len()].copy_from_slice(entry);
        header.set_size(1);
        header.set_mode(0o644);
        header.set_entry_type(tar::EntryType::Regular);
        header.set_cksum();
        builder.append(&header, &b"x"[..])?;
        builder.into_inner()?.finish()?;
        Ok(path)
    }

    #[test]
    fn a_packaged_executable_names_its_bundle_and_a_development_one_does_not() {
        assert_eq!(
            bundle_of(Path::new(
                "/Applications/Scout Desktop.app/Contents/MacOS/scout-client"
            )),
            Some(PathBuf::from("/Applications/Scout Desktop.app"))
        );
        assert_eq!(
            bundle_of(Path::new("/repo/desktop/target/release/scout-client")),
            None
        );
        assert_eq!(
            bundle_of(Path::new("/Applications/Scout/Contents/MacOS/scout-client")),
            None
        );
    }

    #[test]
    fn the_bundle_is_replaced_in_place_and_nothing_is_left_behind() -> TestResult {
        let root = scratch()?;
        let applications = root.join("Applications");
        let installed = applications.join("Scout Desktop.app");
        bundle(&installed, "0.1.0")?;
        let release = root.join("release/Scout Desktop.app");
        bundle(&release, "0.2.0")?;
        let archive = archive(&release, "Scout Desktop.app", &root)?;

        replace_bundle(&archive, &installed)?;

        assert_eq!(
            fs::read_to_string(installed.join("Contents/Info.plist"))?,
            "0.2.0"
        );
        assert_eq!(
            fs::read_to_string(installed.join("Contents/Resources/voice-models/model.onnx"))?,
            "0.2.0"
        );
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt as _;
            let mode = fs::metadata(installed.join("Contents/MacOS/scout-client"))?
                .permissions()
                .mode();
            assert_eq!(mode & 0o111, 0o111, "the binary stays executable");
        }
        let left: Vec<_> = fs::read_dir(&applications)?
            .map(|entry| entry.map(|entry| entry.file_name()))
            .collect::<Result<_, _>>()?;
        assert_eq!(left, ["Scout Desktop.app"]);
        Ok(())
    }

    #[test]
    fn a_renamed_install_is_replaced_under_its_own_name() -> TestResult {
        let root = scratch()?;
        let installed = root.join("Scout.app");
        bundle(&installed, "0.1.0")?;
        let release = root.join("release/Scout Desktop.app");
        bundle(&release, "0.2.0")?;
        let archive = archive(&release, "Scout Desktop.app", &root)?;
        replace_bundle(&archive, &installed)?;
        assert_eq!(
            fs::read_to_string(installed.join("Contents/Info.plist"))?,
            "0.2.0"
        );
        assert!(!root.join("Scout Desktop.app").exists());
        Ok(())
    }

    #[test]
    fn a_broken_archive_leaves_the_running_version_untouched() -> TestResult {
        let root = scratch()?;
        let installed = root.join("Applications/Scout Desktop.app");
        bundle(&installed, "0.1.0")?;

        // No Info.plist.
        let incomplete = root.join("incomplete/Scout Desktop.app");
        fs::create_dir_all(incomplete.join("Contents/MacOS"))?;
        let no_plist = archive(&incomplete, "Scout Desktop.app", &root)?;
        // Not an app bundle.
        let folder = root.join("folder");
        bundle(&folder, "0.2.0")?;
        let not_an_app = archive(&folder, "Scout Desktop", &root.join("folder"))?;
        // Escapes the bundle.
        let traversal = raw_archive(b"../evil", &root)?;
        let nested_traversal = raw_archive(b"Scout Desktop.app/../../evil", &root)?;
        let absolute = raw_archive(b"/tmp/evil.app/x", &root)?;

        for (name, archive) in [
            ("no Info.plist", no_plist),
            ("not an app", not_an_app),
            ("path traversal", traversal),
            ("nested path traversal", nested_traversal),
            ("absolute path", absolute),
        ] {
            assert!(
                replace_bundle(&archive, &installed).is_err(),
                "{name} must be refused"
            );
            assert_eq!(
                fs::read_to_string(installed.join("Contents/Info.plist"))?,
                "0.1.0",
                "{name}"
            );
        }
        assert!(!root.join("evil").exists());
        Ok(())
    }

    #[test]
    fn an_archive_with_two_bundles_is_refused() -> TestResult {
        let root = scratch()?;
        let one = root.join("one");
        bundle(&one, "0.2.0")?;
        let path = root.join("two.app.tar.gz");
        let mut builder = tar::Builder::new(GzEncoder::new(
            fs::File::create(&path)?,
            Compression::default(),
        ));
        builder.append_dir_all("A.app", &one)?;
        builder.append_dir_all("B.app", &one)?;
        builder.into_inner()?.finish()?;
        assert!(unpack_app(&path, &root.join("out")).is_err());
        Ok(())
    }
}
