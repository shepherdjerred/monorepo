//! Observe the game's own visible window, excluding launcher and console windows.
use super::*;
use winsafe as w;

fn game_class(game: Game, class: &str) -> bool {
    let class = class.to_ascii_lowercase();
    match game {
        Game::Iw4x => matches!(class.as_str(), "iw4" | "iw4 mp"),
        Game::T5 | Game::T6 | Game::T7 => class == "codblackops",
    }
}

pub(super) fn game_window_open(game: Game) -> Result<bool> {
    let names: &[&str] = match game {
        Game::Iw4x => &["iw4x.exe"],
        Game::T5 | Game::T6 => &["plutonium-bootstrapper-win32.exe"],
        Game::T7 => &["boiii.exe", "BlackOps3.exe"],
    };
    let system = sysinfo::System::new_with_specifics(
        sysinfo::RefreshKind::nothing().with_processes(sysinfo::ProcessRefreshKind::nothing()),
    );
    let pids: Vec<u32> = system
        .processes()
        .iter()
        .filter_map(|(pid, process)| {
            names
                .iter()
                .any(|name| process.name().eq_ignore_ascii_case(name))
                .then_some(pid.as_u32())
        })
        .collect();
    if pids.is_empty() {
        return Ok(false);
    }
    let mut found = false;
    w::EnumWindows(|window| {
        let (_, pid) = window.GetWindowThreadProcessId();
        if window.IsWindowVisible() && pids.contains(&pid) {
            // A window may disappear during enumeration; continue observing other windows.
            if let Ok(class) = window.GetClassName() {
                found |= game_class(game, &class);
            }
        }
        true
    })
    .map_err(|error| std::io::Error::from_raw_os_error(error.raw() as i32))?;
    Ok(found)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn game_windows_exclude_launchers_and_consoles() {
        assert!(game_class(Game::Iw4x, "IW4"));
        assert!(!game_class(Game::Iw4x, "IW4 WinConsole"));
        assert!(game_class(Game::T5, "CoDBlackOps"));
        assert!(game_class(Game::T6, "CoDBlackOps"));
        assert!(game_class(Game::T7, "CoDBlackOps"));
        assert!(!game_class(Game::T7, "CoD Black Ops III Console"));
        assert!(!game_class(Game::T7, "BOIII Launcher"));
    }
}
