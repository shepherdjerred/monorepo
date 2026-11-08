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
fn ensure_plutonium_closed() -> Result<()> {
    if process_running(PLUTONIUM_PROCESSES) {
        return Err(Error::ActionRequired {
            title: "Close Plutonium to finish setup",
            next_step: "Close Plutonium and its games, then choose Try again. Your game folder only needs to be set up once.",
        });
    }
    Ok(())
}

pub fn configure_plutonium(game: Game, game_path: &Path) -> Result<()> {
    ensure_plutonium_closed()?;
    write_plutonium_game_path(&plutonium_directory()?, game, game_path)
}

fn write_plutonium_game_path(root: &Path, game: Game, game_path: &Path) -> Result<()> {
    let key = match game {
        Game::T5 => "t5Path",
        Game::T6 => "t6Path",
        _ => return Err(Error::Invalid("Not a Plutonium game".into())),
    };
    let config_path = root.join("config.json");
    std::fs::create_dir_all(root)?;
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

/// Spawn a client process with its stdout and stderr written to a local process log.
///
/// A file handle (not a pipe) receives the output, so waiting without reading can never
/// block the child. Plutonium processes must not use this: their output can carry account
/// details, so they keep the null handles from [`command`].
pub fn spawn_logged(command: &mut Command, label: &'static str) -> Result<Child> {
    let log = match crate::diagnostics::process_log(label) {
        Some(Ok((path, file))) => {
            command
                .stdout(Stdio::from(file.try_clone()?))
                .stderr(Stdio::from(file));
            Some(path)
        }
        Some(Err(error)) => {
            tracing::warn!(label, %error, "process log unavailable");
            None
        }
        None => None,
    };
    let child = command.spawn()?;
    tracing::info!(
        label,
        pid = child.id(),
        program = %command.get_program().to_string_lossy(),
        args = ?command.get_args().collect::<Vec<_>>(),
        cwd = ?command.get_current_dir(),
        log = ?log,
        "process started"
    );
    Ok(child)
}

pub fn wait_success(child: &mut Child, cancel: &Cancellation, label: &str) -> Result<()> {
    let started = Instant::now();
    loop {
        // Updaters own their transaction; wait for them rather than killing a partial update.
        if let Some(status) = child.try_wait()? {
            tracing::info!(
                label,
                pid = child.id(),
                code = ?status.code(),
                elapsed_ms = started.elapsed().as_millis() as u64,
                "process exited"
            );
            if !status.success() {
                let code = status
                    .code()
                    .map(|code| format!(" (exit code {code})"))
                    .unwrap_or_default();
                return Err(Error::Invalid(format!(
                    "{label} did not finish successfully{code}. Try again or save a support bundle from Help."
                )));
            }
            cancel.check()?;
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(100));
    }
}

/// Processes whose executable or working directory is inside `directory`.
fn processes_using(directory: &Path) -> Vec<(u32, String)> {
    let system = sysinfo::System::new_with_specifics(
        sysinfo::RefreshKind::nothing().with_processes(
            sysinfo::ProcessRefreshKind::nothing()
                .with_exe(sysinfo::UpdateKind::Always)
                .with_cwd(sysinfo::UpdateKind::Always),
        ),
    );
    // Process paths come back as plain `C:\...\` while library paths may be verbatim
    // (`\\?\C:\...`); compare normalized, case-insensitive text.
    fn normalize(path: &Path) -> String {
        let text = path.to_string_lossy().replace('/', "\\");
        let text = text.strip_prefix(r"\\?\").unwrap_or(&text);
        text.trim_end_matches('\\').to_lowercase()
    }
    let directory = normalize(directory);
    let inside = |path: Option<&Path>| {
        path.is_some_and(|path| {
            let path = normalize(path);
            path == directory
                || path
                    .strip_prefix(&directory)
                    .is_some_and(|rest| rest.starts_with('\\'))
        })
    };
    system
        .processes()
        .iter()
        .filter(|(pid, process)| {
            pid.as_u32() != std::process::id() && (inside(process.exe()) || inside(process.cwd()))
        })
        .map(|(pid, process)| (pid.as_u32(), process.name().to_string_lossy().into_owned()))
        .collect()
}

/// Wait until no process is running from, or working inside, `directory`.
///
/// Client updaters can exit after starting a replacement of themselves; Windows refuses to
/// move a folder that is another process's working directory. Readiness is observed, not
/// assumed from the first process exiting.
pub fn wait_for_directory_release(
    directory: &Path,
    cancel: &Cancellation,
    timeout: Duration,
) -> Result<()> {
    let deadline = Instant::now() + timeout;
    let mut reported = false;
    loop {
        cancel.check()?;
        let holders = processes_using(directory);
        if holders.is_empty() {
            if reported {
                tracing::info!(directory = %directory.display(), "folder released");
            }
            return Ok(());
        }
        if !reported {
            tracing::info!(directory = %directory.display(), ?holders, "waiting for processes to leave folder");
            reported = true;
        }
        if Instant::now() >= deadline {
            tracing::warn!(directory = %directory.display(), ?holders, "processes still using folder");
            return Err(Error::ActionRequired {
                title: "A game updater is still running",
                next_step: "Close any MW2 or IW4x windows, then choose Try again in Get help.",
            });
        }
        std::thread::sleep(Duration::from_millis(250));
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
            ensure_plutonium_closed()?;
            let updater = clients.join("plutonium.exe");
            // Plutonium output can include account details, so only its exit status is logged.
            let mut child = command(&updater, clients).arg("-update-only").spawn()?;
            tracing::info!(pid = child.id(), "Plutonium update started");
            wait_success(&mut child, cancel, "Plutonium update")?;
            // The first-run updater can initialize or rewrite config.json. Set the
            // extracted game path after it exits so Plutonium sees it on first open.
            configure_plutonium(game, &directory)?;
            let root = plutonium_directory()?;
            command(&root.join("bin/plutonium-launcher-win32.exe"), &root)
                .arg(plutonium_link(game, mode)?)
                .spawn()?
        }
        Game::Iw4x => {
            if mode != Mode::Multiplayer {
                return Err(Error::Invalid("MW2 uses Multiplayer".into()));
            }
            // Stay on the catalog's pinned launcher: newer upstream launchers reject this
            // game folder (see install::IW4X_LAUNCHER_EXPANDED_BYTES). Game files still update.
            spawn_logged(
                command(&directory.join("iw4x-launcher.exe"), &directory).arg("--no-self-update"),
                "iw4x-play",
            )?
        }
        Game::T7 => {
            // BOIII's normal -launch path still performs its updater and game compatibility checks.
            spawn_logged(
                command(&directory.join("boiii.exe"), &directory).arg("-launch"),
                "boiii-play",
            )?
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
    /// Reproduces the IW4x self-update handoff: a process keeps the staged folder as its
    /// working directory after the process we waited on has exited.
    #[cfg(windows)]
    #[test]
    fn promotion_waits_for_processes_working_in_the_staged_folder() -> Result<()> {
        let root = crate::test_tempdir()?;
        let staged = root.path().join("iw4x");
        std::fs::create_dir(&staged)?;
        let windows = std::env::var_os("SystemRoot")
            .ok_or_else(|| Error::Invalid("SystemRoot unset".into()))?;
        let mut holder = Command::new(Path::new(&windows).join("System32/ping.exe"))
            .args(["-n", "4", "127.0.0.1"])
            .current_dir(&staged)
            .stdout(Stdio::null())
            .spawn()?;
        let deadline = Instant::now() + Duration::from_secs(5);
        while processes_using(&staged).is_empty() && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(20));
        }
        let held = std::fs::rename(&staged, root.path().join("moved"));
        assert_eq!(
            held.err().and_then(|e| e.raw_os_error()),
            Some(32),
            "Windows refuses to move another process's working directory"
        );
        assert!(matches!(
            wait_for_directory_release(
                &staged,
                &Cancellation::default(),
                Duration::from_millis(300)
            ),
            Err(Error::ActionRequired { .. })
        ));
        let started = Instant::now();
        wait_for_directory_release(&staged, &Cancellation::default(), Duration::from_secs(30))?;
        assert!(holder.try_wait()?.is_some());
        assert!(started.elapsed() < Duration::from_secs(10));
        std::fs::rename(&staged, root.path().join("moved"))?;
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

    #[test]
    fn plutonium_game_path_is_set_without_replacing_other_settings() -> Result<()> {
        let root = tempfile::tempdir()?;
        std::fs::write(
            root.path().join("config.json"),
            br#"{"username":"player","t5Path":"old-t5","t6Path":"old-t6"}"#,
        )?;

        write_plutonium_game_path(root.path(), Game::T6, Path::new("C:/Games/t6"))?;

        let config: serde_json::Value =
            serde_json::from_slice(&std::fs::read(root.path().join("config.json"))?)?;
        assert_eq!(config["username"], "player");
        assert_eq!(config["t5Path"], "old-t5");
        assert_eq!(config["t6Path"], "C:/Games/t6");
        Ok(())
    }
}
