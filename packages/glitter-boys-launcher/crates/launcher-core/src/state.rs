//! Typed local preferences and receipts. Plutonium credentials never enter these files.

use crate::{
    Error, Result,
    catalog::{Catalog, Game},
};
use serde::{Deserialize, Serialize};
use std::{
    fs::File,
    io::Write,
    path::{Path, PathBuf},
};

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Settings {
    pub version: u32,
    pub library: PathBuf,
    pub queue: Vec<Game>,
}

pub fn data_directory() -> Result<PathBuf> {
    directories::BaseDirs::new()
        .map(|dirs| dirs.data_local_dir().join("GlitterBoys"))
        .ok_or_else(|| {
            Error::Invalid("Windows local application data directory is unavailable".into())
        })
}

impl Settings {
    pub fn load(data: &Path) -> Result<Self> {
        match std::fs::read(data.join("settings.json")) {
            Ok(bytes) => {
                let settings: Self = serde_json::from_slice(&bytes)?;
                if settings.version != 1 || !settings.library.is_absolute() {
                    return Err(Error::Invalid("Unsupported launcher settings".into()));
                }
                Ok(settings)
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Self {
                version: 1,
                library: data.join("Games"),
                queue: Vec::new(),
            }),
            Err(error) => Err(error.into()),
        }
    }
    pub fn save(&self, data: &Path) -> Result<()> {
        write_json(&data.join("settings.json"), self)
    }

    /// Recover a crash after directory promotion but before the queue was saved.
    pub fn reconcile_queue(&mut self, catalog: &Catalog) -> Result<()> {
        // Cleanup mutates the game library, so serialize it with installation
        // and uninstall operations even when another profile uses this library.
        let _lock = if self.queue.is_empty() || !self.library.try_exists()? {
            None
        } else {
            crate::install::ensure_plain_directory(&self.library)?;
            Some(exclusive_lock(&self.library.join(".install.lock"))?)
        };
        let mut pending = Vec::new();
        for game in &self.queue {
            if installed(&self.library, *game, catalog)? {
                // Promotion proves restore_saves completed. Finish duplicate cleanup
                // before dropping the durable queue entry, including after a crash.
                crate::storage::saves_restored(&self.library, *game)?;
            } else if !pending.contains(game) {
                pending.push(*game);
            }
        }
        self.queue = pending;
        Ok(())
    }
}

pub fn write_json(path: &Path, value: &impl Serialize) -> Result<()> {
    let parent = path
        .parent()
        .ok_or_else(|| Error::Invalid("State file has no parent directory".into()))?;
    std::fs::create_dir_all(parent)?;
    let mut temporary = tempfile::NamedTempFile::new_in(parent)?;
    serde_json::to_writer_pretty(&mut temporary, value)?;
    temporary.write_all(b"\n")?;
    temporary.as_file().sync_all()?;
    temporary
        .persist(path)
        .map_err(|error| Error::Io(error.error))?;
    Ok(())
}

/// Keep a handle open for the lifetime of an app instance or installation.
pub fn exclusive_lock(path: &Path) -> Result<File> {
    let file = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(path)?;
    file.try_lock().map_err(|_| {
        Error::Invalid(
            "Another Glitter Boys operation is already running. Close the other instance first."
                .into(),
        )
    })?;
    Ok(file)
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Receipt {
    pub version: u32,
    pub catalog_version: u32,
    pub game: Game,
    pub prerequisites_complete: bool,
}

/// A bounded local history of launcher events, with no account data or raw client output.
#[derive(Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Diagnostics {
    events: Vec<String>,
}

impl Diagnostics {
    pub fn load(data: &Path) -> Result<Self> {
        match std::fs::read(data.join("diagnostics.json")) {
            Ok(bytes) => Ok(serde_json::from_slice(&bytes)?),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Self::default()),
            Err(error) => Err(error.into()),
        }
    }
    pub fn record(&mut self, data: &Path, event: String) -> Result<()> {
        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|_| Error::Invalid("Windows clock is invalid".into()))?
            .as_secs();
        self.events.push(format!("{timestamp}: {event}"));
        if self.events.len() > 200 {
            self.events.drain(..self.events.len() - 200);
        }
        write_json(&data.join("diagnostics.json"), self)
    }
    pub fn export(&self) -> String {
        format!(
            "Glitter Boys {}\nEvent times are Unix seconds.\n{}\n",
            env!("CARGO_PKG_VERSION"),
            self.events.join("\n")
        )
    }
}

pub fn installed(library: &Path, game: Game, catalog: &Catalog) -> Result<bool> {
    let directory = library.join(game.id());
    let bytes = match std::fs::read(directory.join(".glitter-boys-install.json")) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(error) => return Err(error.into()),
    };
    let receipt: Receipt = serde_json::from_slice(&bytes)?;
    if receipt.version != 1 || receipt.game != game || receipt.catalog_version != catalog.version {
        return Err(Error::Invalid(
            "Game installation receipt does not match the catalog".into(),
        ));
    }
    for path in &catalog.package(game)?.required_files {
        if !directory.join(path).is_file() {
            return Err(Error::Invalid(format!(
                "{} is missing required game files",
                game.title()
            )));
        }
    }
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn invalid_saved_settings_are_not_silently_replaced() -> Result<()> {
        let temp = tempfile::tempdir()?;
        std::fs::write(temp.path().join("settings.json"), b"{broken")?;
        assert!(Settings::load(temp.path()).is_err());
        Ok(())
    }
    #[test]
    fn settings_round_trip_and_lock_prevents_second_writer() -> Result<()> {
        let temp = tempfile::tempdir()?;
        let mut settings = Settings::load(temp.path())?;
        settings.queue = vec![Game::T5, Game::T6];
        settings.save(temp.path())?;
        assert_eq!(Settings::load(temp.path())?.queue, settings.queue);
        let path = temp.path().join("lock");
        let lock = exclusive_lock(&path)?;
        assert!(exclusive_lock(&path).is_err());
        drop(lock);
        assert!(exclusive_lock(&path).is_ok());
        Ok(())
    }

    #[test]
    fn restart_drops_completed_jobs_but_keeps_unfinished_games() -> Result<()> {
        let temp = tempfile::tempdir()?;
        let catalog = Catalog::bundled()?;
        let mut settings = Settings::load(temp.path())?;
        settings.queue = vec![Game::T5, Game::T6, Game::T6];
        let directory = settings.library.join(Game::T5.id());
        for file in &catalog.package(Game::T5)?.required_files {
            let path = directory.join(file);
            std::fs::create_dir_all(
                path.parent()
                    .ok_or_else(|| Error::Invalid("Missing parent".into()))?,
            )?;
            std::fs::write(path, b"fixture")?;
        }
        write_json(
            &directory.join(".glitter-boys-install.json"),
            &Receipt {
                version: 1,
                catalog_version: catalog.version,
                game: Game::T5,
                prerequisites_complete: false,
            },
        )?;
        let other_operation = exclusive_lock(&settings.library.join(".install.lock"))?;
        assert!(settings.reconcile_queue(&catalog).is_err());
        assert_eq!(settings.queue, vec![Game::T5, Game::T6, Game::T6]);
        drop(other_operation);
        settings.reconcile_queue(&catalog)?;
        assert_eq!(settings.queue, vec![Game::T6]);
        // A damaged receipt is surfaced, not silently treated as a fresh install.
        std::fs::write(directory.join(".glitter-boys-install.json"), b"broken")?;
        settings.queue = vec![Game::T5];
        assert!(settings.reconcile_queue(&catalog).is_err());
        Ok(())
    }

    #[test]
    fn restart_finishes_save_cleanup_before_dropping_a_promoted_install() -> Result<()> {
        let data = tempfile::tempdir()?;
        let catalog = Catalog::bundled()?;
        let game = Game::T7;
        let mut settings = Settings::load(data.path())?;
        settings.queue = vec![game, Game::T6];
        settings.save(data.path())?;
        let staged = settings.library.join(".gb-stage-fixture").join(game.id());
        for required in &catalog.package(game)?.required_files {
            let path = staged.join(required);
            std::fs::create_dir_all(
                path.parent()
                    .ok_or_else(|| Error::Invalid("Missing fixture parent".into()))?,
            )?;
            std::fs::write(path, b"fixture")?;
        }
        let saves = settings.library.join(".saves").join(game.id());
        std::fs::create_dir_all(saves.join("boiii_players"))?;
        std::fs::write(saves.join("boiii_players/config.cfg"), b"saved settings")?;
        crate::storage::restore_saves(&settings.library, game, &staged)?;
        write_json(
            &staged.join(".glitter-boys-install.json"),
            &Receipt {
                version: 1,
                catalog_version: catalog.version,
                game,
                prerequisites_complete: false,
            },
        )?;
        let installed = settings.library.join(game.id());
        std::fs::rename(staged, &installed)?;
        // Simulate termination immediately after promotion, before scheduler cleanup.
        assert!(saves.is_dir());
        let mut restarted = Settings::load(data.path())?;
        restarted.reconcile_queue(&catalog)?;
        restarted.save(data.path())?;
        assert_eq!(restarted.queue, vec![Game::T6]);
        assert!(!saves.exists());
        assert_eq!(
            std::fs::read(installed.join("boiii_players/config.cfg"))?,
            b"saved settings"
        );
        restarted.reconcile_queue(&catalog)?;
        // The next keep-saves uninstall can use the save destinations again.
        crate::storage::uninstall(&catalog, &restarted.library, game, true)?;
        assert_eq!(
            std::fs::read(saves.join("boiii_players/config.cfg"))?,
            b"saved settings"
        );
        Ok(())
    }
}
