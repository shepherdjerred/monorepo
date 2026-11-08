//! Transactional fresh installations. Existing game directories are never replaced.

use crate::{
    Cancellation, Error, Progress, Result, Step, StepExt, archive,
    catalog::{Catalog, Game, GamePackage},
    download, launch, state,
};
use std::path::Path;

const HEADROOM: u64 = 2 * 1024 * 1024 * 1024;
pub fn library_folder(library: &Path) -> Result<std::path::PathBuf> {
    ensure_plain_directory(library)?;
    Ok(library.canonicalize()?)
}

pub struct InstallOutcome {
    pub cache_cleanup_pending: bool,
}

pub(crate) fn ensure_plain_directory(path: &Path) -> Result<()> {
    if !path.is_absolute() {
        return Err(Error::Invalid("Choose an absolute game folder path".into()));
    }
    // Refuse network locations and redirected folders for managed installs.
    #[cfg(windows)]
    let local = matches!(path.components().next(), Some(std::path::Component::Prefix(prefix))
        if matches!(prefix.kind(), std::path::Prefix::Disk(_) | std::path::Prefix::VerbatimDisk(_)));
    #[cfg(not(windows))]
    let local = !path.to_string_lossy().starts_with("\\\\");
    if !local {
        return Err(Error::Invalid("Choose a folder on a local drive".into()));
    }
    for ancestor in path.ancestors() {
        match std::fs::symlink_metadata(ancestor) {
            Ok(metadata) if crate::storage::redirected(&metadata) => {
                return Err(Error::Invalid(
                    "Choose a game folder without symbolic links or junctions".into(),
                ));
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.into()),
        }
    }
    std::fs::create_dir_all(path)?;
    Ok(())
}

#[cfg(all(test, windows))]
mod directory_tests {
    use super::*;

    #[test]
    fn canonical_local_directories_are_accepted() -> Result<()> {
        let root = crate::test_tempdir()?;
        ensure_plain_directory(root.path())?;
        let canonical = root.path().canonicalize()?;
        assert!(
            matches!(canonical.components().next(), Some(std::path::Component::Prefix(prefix))
            if matches!(prefix.kind(), std::path::Prefix::VerbatimDisk(_)))
        );
        let versions = canonical.join("versions");
        ensure_plain_directory(&versions)?;
        assert!(versions.is_dir());
        Ok(())
    }

    #[test]
    fn network_and_device_paths_are_rejected_before_access() {
        for value in [
            r"\\example.invalid\share\games",
            r"\\?\UNC\example.invalid\share\games",
            r"\\.\C:\games",
            r"\\?\GLOBALROOT\Device\HarddiskVolume1\games",
        ] {
            assert!(
                matches!(ensure_plain_directory(Path::new(value)), Err(Error::Invalid(message))
                if message == "Choose a folder on a local drive")
            );
        }
    }
}

pub fn available_bytes(library: &Path) -> Result<u64> {
    let existing = library
        .ancestors()
        .find(|p| p.exists())
        .ok_or_else(|| Error::Invalid("Game drive is unavailable".into()))?;
    Ok(fs2::available_space(existing)?)
}

pub fn required_bytes(package: &GamePackage) -> Result<u64> {
    package.archives.iter().try_fold(
        package.expanded_bytes.saturating_add(HEADROOM),
        |total, artifact| {
            total
                .checked_add(artifact.bytes)
                .ok_or_else(|| Error::Invalid("Install size overflow".into()))
        },
    )
}

pub(crate) fn check_space(library: &Path, package: &GamePackage) -> Result<()> {
    let required = required_bytes(package)?;
    let available = available_bytes(library)?;
    let mut cached = 0_u64;
    for artifact in &package.archives {
        let directory = library.join(".downloads").join(&artifact.sha256);
        let mut saved = 0;
        for name in [&artifact.file, &format!("{}.partial", artifact.file)] {
            if let Ok(metadata) = std::fs::symlink_metadata(directory.join(name)) {
                if !metadata.is_file() || metadata.file_type().is_symlink() {
                    return Err(Error::Invalid(
                        "Download cache contains an unexpected file type".into(),
                    ));
                }
                saved = saved.max(metadata.len().min(artifact.bytes));
            }
        }
        cached = cached.saturating_add(saved);
    }
    if available < required.saturating_sub(cached) {
        return Err(Error::Invalid(format!(
            "Not enough space: need {:.1} GB more; {:.1} GB available. Choose another drive or free some space.",
            required.saturating_sub(cached) as f64 / 1e9,
            available as f64 / 1e9
        )));
    }
    Ok(())
}

/// Install one complete game into a previously unused destination.
pub fn install(
    catalog: &Catalog,
    game: Game,
    library: &Path,
    data: &Path,
    cancel: &Cancellation,
    progress: &mut dyn FnMut(Progress),
) -> Result<InstallOutcome> {
    catalog.validate()?;
    ensure_plain_directory(library)?;
    ensure_plain_directory(data)?;
    let _lock = state::exclusive_lock(&library.join(".install.lock"))?;
    let destination = library.join(game.id());
    if destination.exists() {
        return Err(Error::Invalid("That game folder already exists. Choose a new library folder; existing installations will not be overwritten.".into()));
    }
    let package = catalog.package(game)?;
    check_space(library, package)?;
    let cache = library.join(".downloads");
    let client = download::client()?;
    let mut parts = Vec::new();
    for artifact in &package.archives {
        parts.push(download::fetch(
            &client, artifact, &cache, cancel, progress,
        )?);
    }
    if available_bytes(library)? < package.expanded_bytes.saturating_add(HEADROOM) {
        return Err(Error::Invalid("Free space changed during the download. Free more space and resume; the downloads are saved.".into()));
    }
    // A tempdir owns only its new random staging path. Failure never removes a user's game folder.
    let staging = tempfile::Builder::new()
        .prefix(".gb-stage-")
        .tempdir_in(library)?;
    archive::extract(
        &parts,
        staging.path(),
        package.expanded_bytes,
        Some(game.id()),
        cancel,
        progress,
    )?;
    let client_artifact = download::fetch(
        &client,
        client_artifact(catalog, game),
        &cache,
        cancel,
        progress,
    )?;
    finalize(
        catalog,
        game,
        InstallLocations { library, data },
        &staging,
        &client_artifact,
        cancel,
        progress,
    )?;
    let mut cache_cleanup_pending = false;
    for path in parts {
        // Only the exact verified archives in this install's owned cache are removed.
        // A cleanup failure must not turn a completed installation into a failed job.
        if std::fs::remove_file(path).is_err() {
            cache_cleanup_pending = true;
        }
    }
    progress(Progress {
        phase: "Installed",
        completed: 1,
        total: 1,
    });
    Ok(InstallOutcome {
        cache_cleanup_pending,
    })
}

/// Shared client downloads are keyed by their reviewed hash.
pub fn client_artifact(catalog: &Catalog, game: Game) -> &crate::catalog::Artifact {
    match game {
        Game::Iw4x => &catalog.iw4x_launcher,
        Game::T5 | Game::T6 => &catalog.plutonium,
        Game::T7 => &catalog.boiii,
    }
}

pub(crate) struct InstallLocations<'a> {
    pub library: &'a Path,
    pub data: &'a Path,
}

/// How long a client updater may keep working in the staged folder after its first
/// process exits (for example while a replacement of itself finishes an update).
const UPDATER_RELEASE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(600);
/// Unpacked size of the catalog's pinned IW4x launcher archive (v1.1.8-b.24).
///
/// Keep this pin until the MW2 archive ships `iw4mp.exe`: launchers from v1.1.8 on refuse
/// to run unless it sits next to them, and this archive has only `iw4x.exe`.
const IW4X_LAUNCHER_EXPANDED_BYTES: u64 = 42_111_097;

/// Finish a staged installation. The staging folder stays owned by the caller, so a
/// failure here keeps the unpacked game files for the next attempt.
pub(crate) fn finalize(
    catalog: &Catalog,
    game: Game,
    locations: InstallLocations<'_>,
    staging: &tempfile::TempDir,
    client_artifact: &Path,
    cancel: &Cancellation,
    progress: &mut dyn FnMut(Progress),
) -> Result<()> {
    let InstallLocations { library, data } = locations;
    let staged_game = staging.path().join(game.id());
    let package = catalog.package(game)?;
    let destination = library.join(game.id());
    let clients = data.join("Clients");
    std::fs::create_dir_all(&clients).step(Step::CreateClients, &clients)?;
    match game {
        Game::T5 | Game::T6 => {
            let target = clients.join("plutonium.exe");
            std::fs::copy(client_artifact, &target).step(Step::CopyClient, &target)?;
        }
        Game::Iw4x => {
            let unpacked = tempfile::Builder::new()
                .prefix(".gb-client-")
                .tempdir_in(library)
                .step(Step::UnpackClient, library)?;
            archive::extract(
                &[client_artifact.to_path_buf()],
                unpacked.path(),
                IW4X_LAUNCHER_EXPANDED_BYTES,
                None,
                cancel,
                progress,
            )
            .step(Step::UnpackClient, unpacked.path())?;
            let launcher = staged_game.join("iw4x-launcher.exe");
            std::fs::copy(unpacked.path().join("iw4x-launcher.exe"), &launcher)
                .step(Step::CopyClient, &launcher)?;
            progress(Progress {
                phase: "Updating IW4x",
                completed: 0,
                total: 0,
            });
            cancel.check()?;
            // The catalog pins a reviewed launcher. Without --no-self-update it replaces
            // itself with the newest upstream build (which rejects this game folder), exits,
            // and leaves the replacement running with the staged folder as its working
            // directory, so the folder cannot be moved (os error 32).
            //
            // --no-shortcuts and --no-connect-protocol: this folder is temporary. Without them
            // the launcher points desktop and menu shortcuts, the iw4x:// handler, and a
            // Steam library entry at it, closing and reopening Steam to do so; the reopened
            // Steam then holds the folder and Windows refuses to move it (os error 5). Play
            // runs the launcher from the final folder, which creates them with real paths.
            let mut updater = launch::spawn_logged(
                launch::command(&launcher, &staged_game).args([
                    "--skip-launch",
                    "--no-self-update",
                    "--no-shortcuts",
                    "--no-connect-protocol",
                ]),
                "iw4x-update",
            )
            .step(Step::SpawnUpdater, &launcher)?;
            launch::wait_success(&mut updater, cancel, "IW4x update")?;
        }
        Game::T7 => {
            let target = staged_game.join("boiii.exe");
            std::fs::copy(client_artifact, &target).step(Step::CopyClient, &target)?;
        }
    }
    for file in &package.required_files {
        if !staged_game.join(file).is_file() {
            tracing::warn!(game = game.id(), file, "required file missing after setup");
            return Err(Error::Invalid(format!(
                "{} is missing a required file after extraction ({file})",
                game.title()
            )));
        }
    }
    cancel.check()?;
    progress(Progress {
        phase: "Finishing installation",
        completed: 0,
        total: 0,
    });
    launch::wait_for_directory_release(&staged_game, cancel, UPDATER_RELEASE_TIMEOUT)?;
    crate::storage::restore_saves(library, game, &staged_game)
        .step(Step::RestoreSaves, &staged_game)?;
    let receipt = staged_game.join(".glitter-boys-install.json");
    state::write_json(
        &receipt,
        &state::Receipt {
            version: 1,
            catalog_version: catalog.version,
            game,
            prerequisites_complete: false,
        },
    )
    .step(Step::WriteReceipt, &receipt)?;
    // Atomic directory rename exposes readiness only after all preceding checks pass.
    if destination.exists() {
        return Err(Error::Invalid(
            "The destination appeared during installation. Existing files were preserved.".into(),
        ));
    }
    promote(&staged_game, &destination, cancel, PROMOTE_RETRY, progress)?;
    tracing::info!(game = game.id(), destination = %destination.display(), "game promoted");
    Ok(())
}

/// How long promotion keeps retrying while Windows reports the staged folder as briefly
/// held, typically by antivirus or the search indexer scanning freshly written files.
const PROMOTE_RETRY: std::time::Duration = std::time::Duration::from_secs(180);

/// Move a staged game into the library. A folder whose files another program has open
/// cannot be renamed (access denied or in use); retry while that is the failure, and on
/// giving up name the files still held so the cause is visible.
fn promote(
    staged: &Path,
    destination: &Path,
    cancel: &Cancellation,
    retry_for: std::time::Duration,
    progress: &mut dyn FnMut(Progress),
) -> Result<()> {
    let started = std::time::Instant::now();
    let mut delay = std::time::Duration::from_millis(100);
    let mut attempts = 0_u32;
    loop {
        attempts += 1;
        let error = match std::fs::rename(staged, destination) {
            Ok(()) => {
                if attempts > 1 {
                    tracing::info!(
                        attempts,
                        elapsed_ms = started.elapsed().as_millis() as u64,
                        "promotion succeeded after retrying"
                    );
                }
                return Ok(());
            }
            Err(error) => error,
        };
        if held_briefly(&error) && started.elapsed() < retry_for {
            if attempts == 1 {
                progress(Progress {
                    phase: "Waiting for a security scan",
                    completed: 0,
                    total: 0,
                });
            }
            tracing::info!(attempts, %error, retry_in_ms = delay.as_millis() as u64, "staged folder is held; retrying promotion");
            cancel.check()?;
            std::thread::sleep(delay);
            delay = (delay * 2).min(std::time::Duration::from_secs(5));
            continue;
        }
        let held = if held_briefly(&error) {
            held_files(staged, 5)
        } else {
            Vec::new()
        };
        tracing::warn!(attempts, %error, ?held, "promotion failed");
        return Err(Error::Step {
            step: Step::Promote,
            path: staged.to_path_buf(),
            source: error,
            held,
        });
    }
}

/// Access denied and sharing or lock violations: what Windows reports while another
/// program has a file in the folder open.
fn held_briefly(error: &std::io::Error) -> bool {
    error.kind() == std::io::ErrorKind::PermissionDenied
        || (cfg!(windows) && matches!(error.raw_os_error(), Some(32 | 33)))
}

/// Up to `limit` files under `root` that cannot be opened exclusively right now.
fn held_files(root: &Path, limit: usize) -> Vec<std::path::PathBuf> {
    let mut held = Vec::new();
    let mut pending = vec![root.to_path_buf()];
    let mut visited = 0_usize;
    while let Some(directory) = pending.pop() {
        let Ok(entries) = std::fs::read_dir(&directory) else {
            continue;
        };
        for entry in entries.flatten() {
            visited += 1;
            if held.len() >= limit || visited > 50_000 {
                return held;
            }
            let Ok(kind) = entry.file_type() else {
                continue;
            };
            if kind.is_dir() {
                pending.push(entry.path());
            } else if kind.is_file() && !opens_exclusively(&entry.path()) {
                held.push(entry.path());
            }
        }
    }
    held
}

#[cfg(windows)]
fn opens_exclusively(path: &Path) -> bool {
    use std::os::windows::fs::OpenOptionsExt;
    // No sharing: fails while any other handle to the file is open.
    std::fs::OpenOptions::new()
        .read(true)
        .share_mode(0)
        .open(path)
        .is_ok()
}
#[cfg(not(windows))]
fn opens_exclusively(_: &Path) -> bool {
    true
}

#[cfg(all(test, windows))]
mod promote_tests {
    use super::*;

    #[test]
    fn promotion_waits_out_a_briefly_held_file_and_names_one_that_stays_held() -> Result<()> {
        let root = crate::test_tempdir()?;
        let staged = root.path().join(".gb-stage-x").join("iw4x");
        std::fs::create_dir_all(staged.join("zone"))?;
        let file = staged.join("zone").join("patch.ff");
        std::fs::write(&file, b"data")?;
        // Held for the whole retry window: fails and names the file.
        let handle = std::fs::File::open(&file)?;
        let error = promote(
            &staged,
            &root.path().join("iw4x"),
            &Cancellation::default(),
            std::time::Duration::from_millis(300),
            &mut |_| {},
        );
        assert!(
            matches!(&error, Err(Error::Step { step: Step::Promote, held, .. }) if held == &vec![file.clone()]),
            "expected a promote failure naming the held file, got {error:?}"
        );
        assert!(error.is_err_and(|e| e.to_string().contains("held open by another program")));
        // Released shortly after: promotion retries and succeeds.
        let release = std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(400));
            drop(handle);
        });
        promote(
            &staged,
            &root.path().join("iw4x"),
            &Cancellation::default(),
            std::time::Duration::from_secs(10),
            &mut |_| {},
        )?;
        release
            .join()
            .map_err(|_| Error::Invalid("release thread panicked".into()))?;
        assert!(
            root.path()
                .join("iw4x")
                .join("zone")
                .join("patch.ff")
                .is_file()
        );
        Ok(())
    }
}

/// Recheck Windows components before every launch; receipts are not system evidence.
pub fn finish_prerequisites(game: Game, directory: &Path) -> Result<()> {
    let receipt_path = directory.join(".glitter-boys-install.json");
    let mut receipt: state::Receipt = serde_json::from_slice(&std::fs::read(&receipt_path)?)?;
    if receipt.version != 1 || receipt.game != game {
        return Err(Error::Invalid("Invalid game installation receipt".into()));
    }
    crate::prerequisites::ensure(game, directory)?;
    if !receipt.prerequisites_complete {
        receipt.prerequisites_complete = true;
        state::write_json(&receipt_path, &receipt)?;
    }
    Ok(())
}
