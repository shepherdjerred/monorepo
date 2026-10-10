//! Fixed client launch adapters. Authentication stays inside official Plutonium.

use crate::{
    Cancellation, Error, Result,
    catalog::{Game, Mode},
};
use std::{
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    time::Duration,
};

pub fn plutonium_link(game: Game, mode: Mode) -> Result<&'static str> {
    match (game, mode) {
        (Game::T5, Mode::Multiplayer) => Ok("plutonium://play/t5mp"),
        (Game::T5, Mode::Zombies) => Ok("plutonium://play/t5sp"),
        (Game::T6, Mode::Multiplayer) => Ok("plutonium://play/t6mp"),
        (Game::T6, Mode::Zombies) => Ok("plutonium://play/t6zm"),
        _ => Err(Error::Invalid("This game does not use Plutonium".into())),
    }
}

pub fn plutonium_directory() -> Result<PathBuf> {
    directories::BaseDirs::new()
        .map(|dirs| dirs.data_local_dir().join("Plutonium"))
        .ok_or_else(|| {
            Error::Invalid("Windows local application data directory is unavailable".into())
        })
}

fn process_running(names: &[&str]) -> bool {
    let system = sysinfo::System::new_with_specifics(
        sysinfo::RefreshKind::nothing().with_processes(sysinfo::ProcessRefreshKind::nothing()),
    );
    system.processes().values().any(|process| {
        names
            .iter()
            .any(|name| process.name().eq_ignore_ascii_case(name))
    })
}

pub fn game_running(game: Game) -> bool {
    match game {
        Game::Iw4x => process_running(&["iw4x.exe", "iw4x-launcher.exe"]),
        Game::T5 | Game::T6 => process_running(&["plutonium-bootstrapper-win32.exe"]),
        Game::T7 => process_running(&["boiii.exe", "BlackOps3.exe"]),
    }
}

/// Update only the selected game's path, preserving every unrelated field.
/// Never derive Debug, log, or return the contents of Plutonium's config.
pub fn configure_plutonium(game: Game, game_path: &Path) -> Result<()> {
    let key = match game {
        Game::T5 => "t5Path",
        Game::T6 => "t6Path",
        _ => return Err(Error::Invalid("Not a Plutonium game".into())),
    };
    let root = plutonium_directory()?;
    std::fs::create_dir_all(&root)?;
    let config_path = root.join("config.json");
    let mut config: serde_json::Map<String, serde_json::Value> = match std::fs::read(&config_path) {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(|_| {
            Error::Invalid(
                "Plutonium settings could not be read. Open Plutonium to repair its settings."
                    .into(),
            )
        })?,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => serde_json::Map::new(),
        Err(error) => return Err(error.into()),
    };
    let path = game_path
        .to_str()
        .ok_or_else(|| Error::Invalid("Game folder name is not valid Unicode".into()))?;
    if config.get(key).and_then(serde_json::Value::as_str) == Some(path) {
        return Ok(());
    }
    if process_running(&[
        "plutonium-launcher-win32.exe",
        "plutonium.exe",
        "plutonium-bootstrapper-win32.exe",
    ]) {
        return Err(Error::ActionRequired {
            title: "Close Plutonium to finish setup",
            next_step: "Close Plutonium and its games, then choose Try again. Your game folder only needs to be set up once.",
        });
    }
    config.insert(key.to_owned(), serde_json::Value::String(path.to_owned()));
    crate::state::write_json(&config_path, &config)
}

pub fn command(executable: &Path, directory: &Path) -> Command {
    let mut command = Command::new(executable);
    command
        .current_dir(directory)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW: suppress helper consoles, not game windows.
    }
    command
}

pub fn wait_success(child: &mut Child, cancel: &Cancellation, label: &str) -> Result<()> {
    loop {
        // Updaters own their transaction; wait for them rather than killing a partial update.
        if let Some(status) = child.try_wait()? {
            if !status.success() {
                return Err(Error::Invalid(format!(
                    "{label} did not finish successfully. Try again or open the advanced guide."
                )));
            }
            cancel.check()?;
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(100));
    }
}

pub fn play(
    game: Game,
    mode: Mode,
    library: &Path,
    clients: &Path,
    cancel: &Cancellation,
) -> Result<()> {
    if !cfg!(windows) {
        return Err(Error::Invalid(
            "The launcher supports Windows x64. macOS has a separate setup guide.".into(),
        ));
    }
    if game_running(game) {
        return Err(Error::ActionRequired {
            title: "Your game launcher is already open",
            next_step: "Switch to its window, or close it and choose Try again.",
        });
    }
    let directory = library.join(game.id());
    crate::install::finish_prerequisites(game, &directory)?;
    match game {
        Game::T5 | Game::T6 => {
            configure_plutonium(game, &directory)?;
            let updater = clients.join("plutonium.exe");
            let mut child = command(&updater, clients).arg("-update-only").spawn()?;
            wait_success(&mut child, cancel, "Plutonium update")?;
            let root = plutonium_directory()?;
            command(&root.join("bin/plutonium-launcher-win32.exe"), &root)
                .arg(plutonium_link(game, mode)?)
                .spawn()?;
        }
        Game::Iw4x => {
            if mode != Mode::Multiplayer {
                return Err(Error::Invalid("MW2 uses Multiplayer".into()));
            }
            command(&directory.join("iw4x-launcher.exe"), &directory).spawn()?;
        }
        Game::T7 => {
            // BOIII's normal -launch path still performs its updater and game compatibility checks.
            command(&directory.join("boiii.exe"), &directory)
                .arg("-launch")
                .spawn()?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn maps_all_supported_modes_without_a_token_or_lan_bypass() -> Result<()> {
        assert_eq!(
            plutonium_link(Game::T5, Mode::Multiplayer)?,
            "plutonium://play/t5mp"
        );
        assert_eq!(
            plutonium_link(Game::T5, Mode::Zombies)?,
            "plutonium://play/t5sp"
        );
        assert_eq!(
            plutonium_link(Game::T6, Mode::Multiplayer)?,
            "plutonium://play/t6mp"
        );
        assert_eq!(
            plutonium_link(Game::T6, Mode::Zombies)?,
            "plutonium://play/t6zm"
        );
        assert!(plutonium_link(Game::Iw4x, Mode::Multiplayer).is_err());
        assert!(plutonium_link(Game::T7, Mode::Zombies).is_err());
        Ok(())
    }
}
