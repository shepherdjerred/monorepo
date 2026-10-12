//! Read-only checks of installed Windows runtimes. Never elevates or installs.
fn main() -> glitter_boys_core::Result<()> {
    #[cfg(windows)]
    for game in glitter_boys_core::catalog::Game::ALL {
        for (component, present) in glitter_boys_core::prerequisites::inspect(game)? {
            println!(
                "{}: {component}: {}",
                game.id(),
                if present {
                    "already installed"
                } else {
                    "missing or outdated"
                }
            );
        }
    }
    Ok(())
}
