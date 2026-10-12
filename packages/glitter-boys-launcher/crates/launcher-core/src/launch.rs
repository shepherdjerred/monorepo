//! Fixed client launch adapters. Authentication stays inside official Plutonium.

use crate::{
    Cancellation, Error, Result,
    catalog::{Game, Mode},
};
use std::{
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    time::{Duration, Instant},
};
#[cfg(windows)]
mod windows;

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

const PLUTONIUM_PROCESSES: &[&str] = &[
    "plutonium-launcher-win32.exe",
    "plutonium.exe",
    "plutonium-bootstrapper-win32.exe",
];

fn game_processes(game: Game) -> &'static [&'static str] {
    match game {
        Game::Iw4x => &["iw4x.exe", "iw4x-launcher.exe"],
        Game::T5 | Game::T6 => PLUTONIUM_PROCESSES,
        Game::T7 => &["boiii.exe", "BlackOps3.exe"],
    }
}

pub fn game_running(game: Game) -> bool {
    process_running(game_processes(game))
}

fn wait_for_game(
    cancel: &Cancellation,
    timeout: Duration,
    mut started: impl FnMut() -> Result<bool>,
) -> Result<()> {
    let deadline = Instant::now() + timeout;
    loop {
        cancel.check()?;
        if started()? {
            return Ok(());
        }
        if Instant::now() >= deadline {
            return Err(Error::ActionRequired {
                title: "Your game hasn't opened yet",
                next_step: "Check the game launcher for a sign-in, update, or error. Finish there, then try Play again if needed.",
            });
        }
        std::thread::sleep(Duration::from_millis(250));
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
    if process_running(PLUTONIUM_PROCESSES) {
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
    let mut child = match game {
        Game::T5 | Game::T6 => {
            configure_plutonium(game, &directory)?;
            let updater = clients.join("plutonium.exe");
            let mut child = command(&updater, clients).arg("-update-only").spawn()?;
            wait_success(&mut child, cancel, "Plutonium update")?;
            let root = plutonium_directory()?;
            command(&root.join("bin/plutonium-launcher-win32.exe"), &root)
                .arg(plutonium_link(game, mode)?)
                .spawn()?
        }
        Game::Iw4x => {
            if mode != Mode::Multiplayer {
                return Err(Error::Invalid("MW2 uses Multiplayer".into()));
            }
            command(&directory.join("iw4x-launcher.exe"), &directory).spawn()?
        }
        Game::T7 => {
            // BOIII's normal -launch path still performs its updater and game compatibility checks.
            command(&directory.join("boiii.exe"), &directory)
                .arg("-launch")
                .spawn()?
        }
    };
    wait_for_game(cancel, Duration::from_secs(300), || {
        #[cfg(windows)]
        if windows::game_window_open(game)? {
            return Ok(true);
        }
        if let Some(status) = child.try_wait()?
            && !status.success()
        {
            return Err(Error::ActionRequired {
                title: "Your game couldn't start",
                next_step: "Check the game launcher for an error, then try Play again.",
            });
        }
        // A successful launcher exit can hand off to another process. Keep waiting
        // for its game window instead of treating that handoff as a finished launch.
        Ok(false)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn both_plutonium_games_guard_the_updater_launcher_and_game() {
        for game in [Game::T5, Game::T6] {
            for process in [
                "plutonium.exe",
                "plutonium-launcher-win32.exe",
                "plutonium-bootstrapper-win32.exe",
            ] {
                assert!(game_processes(game).contains(&process));
            }
        }
    }
    #[test]
    fn launch_waits_for_a_game_and_reports_timeout_or_cancellation() -> Result<()> {
        let mut probes = 0;
        wait_for_game(&Cancellation::default(), Duration::from_secs(2), || {
            probes += 1;
            Ok(probes == 2)
        })?;
        assert_eq!(probes, 2);
        assert!(matches!(
            wait_for_game(&Cancellation::default(), Duration::ZERO, || Ok(false)),
            Err(Error::ActionRequired { .. })
        ));
        let cancel = Cancellation::default();
        cancel.pause();
        assert!(matches!(
            wait_for_game(&cancel, Duration::from_secs(2), || Ok(true)),
            Err(Error::Paused)
        ));
        Ok(())
    }
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
