//! Transactional fresh installations. Existing game directories are never replaced.

use crate::{
    Cancellation, Error, Progress, Result, archive,
    catalog::{Catalog, Game, GamePackage},
    download, launch, state,
};
use std::path::Path;

const HEADROOM: u64 = 2 * 1024 * 1024 * 1024;

pub struct InstallOutcome {
    pub cache_cleanup_pending: bool,
}

pub(crate) fn ensure_plain_directory(path: &Path) -> Result<()> {
    if !path.is_absolute() {
        return Err(Error::Invalid("Choose an absolute game folder path".into()));
    }
    // Refuse network locations and redirected folders for managed installs.
    if path.to_string_lossy().starts_with("\\\\") {
        return Err(Error::Invalid("Choose a folder on a local drive".into()));
    }
    for ancestor in path.ancestors() {
        match std::fs::symlink_metadata(ancestor) {
            Ok(metadata) if metadata.file_type().is_symlink() => {
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
        staging,
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

pub(crate) fn finalize(
    catalog: &Catalog,
    game: Game,
    locations: InstallLocations<'_>,
    staging: tempfile::TempDir,
    client_artifact: &Path,
    cancel: &Cancellation,
    progress: &mut dyn FnMut(Progress),
) -> Result<()> {
    let InstallLocations { library, data } = locations;
    let staged_game = staging.path().join(game.id());
    let package = catalog.package(game)?;
    let destination = library.join(game.id());
    let clients = data.join("Clients");
    std::fs::create_dir_all(&clients)?;
    match game {
        Game::T5 | Game::T6 => {
            let updater = client_artifact;
            std::fs::copy(updater, clients.join("plutonium.exe"))?;
        }
        Game::Iw4x => {
            let launcher = client_artifact.to_path_buf();
            let unpacked = tempfile::Builder::new()
                .prefix(".gb-client-")
                .tempdir_in(library)?;
            archive::extract(
                &[launcher],
                unpacked.path(),
                42_111_097,
                None,
                cancel,
                progress,
            )?;
            std::fs::copy(
                unpacked.path().join("iw4x-launcher.exe"),
                staged_game.join("iw4x-launcher.exe"),
            )?;
            progress(Progress {
                phase: "Updating IW4x",
                completed: 0,
                total: 0,
            });
            let mut updater = launch::command(&staged_game.join("iw4x-launcher.exe"), &staged_game)
                .arg("--skip-launch")
                .spawn()?;
            launch::wait_success(&mut updater, cancel, "IW4x update")?;
        }
        Game::T7 => {
            let launcher = client_artifact;
            std::fs::copy(launcher, staged_game.join("boiii.exe"))?;
        }
    }
    for file in &package.required_files {
        if !staged_game.join(file).is_file() {
            return Err(Error::Invalid(format!(
                "{} is missing a required file after extraction",
                game.title()
            )));
        }
    }
    cancel.check()?;
    state::write_json(
        &staged_game.join(".glitter-boys-install.json"),
        &state::Receipt {
            version: 1,
            catalog_version: catalog.version,
            game,
            prerequisites_complete: false,
        },
    )?;
    // Atomic directory rename exposes readiness only after all preceding checks pass.
    if destination.exists() {
        return Err(Error::Invalid(
            "The destination appeared during installation. Existing files were preserved.".into(),
        ));
    }
    std::fs::rename(&staged_game, &destination)?;
    Ok(())
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
