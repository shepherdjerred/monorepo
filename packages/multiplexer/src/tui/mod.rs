pub mod app;
pub mod components;
pub mod events;
pub mod ui;

pub use app::App;

use std::io::{self, stdout};
use std::time::Duration;

use crossterm::{
    event::{Event, KeyCode},
    execute,
    terminal::{EnterAlternateScreen, LeaveAlternateScreen, disable_raw_mode, enable_raw_mode},
};
use ratatui::{Terminal, backend::CrosstermBackend};

use crate::tui::app::AppMode;

/// Run the TUI application
///
/// # Errors
///
/// Returns an error if terminal initialization fails or if there's an error
/// during the main event loop.
pub async fn run() -> anyhow::Result<()> {
    // Setup terminal
    enable_raw_mode()?;
    let mut stdout = stdout();
    execute!(stdout, EnterAlternateScreen)?;
    let backend = CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend)?;

    // Create app and connect
    let mut app = App::new();
    let _ = app.connect().await; // Connection errors are displayed in the UI
    if app.is_connected() {
        let _ = app.refresh_sessions().await;
    }

    // Main loop
    let result = run_main_loop(&mut terminal, &mut app).await;

    // Restore terminal
    disable_raw_mode()?;
    execute!(terminal.backend_mut(), LeaveAlternateScreen)?;
    terminal.show_cursor()?;

    result
}

async fn run_main_loop(
    terminal: &mut Terminal<CrosstermBackend<io::Stdout>>,
    app: &mut App,
) -> anyhow::Result<()> {
    loop {
        // Draw UI
        terminal.draw(|frame| ui::render(frame, app))?;

        // Poll for events with timeout
        if let Some(Event::Key(key)) = events::poll_event(Duration::from_millis(100))? {
            // Handle Enter in session list to attach
            if app.mode == AppMode::SessionList && key.code == KeyCode::Enter {
                if let Ok(Some(command)) = app.get_attach_command().await {
                    // Suspend TUI and run attach command
                    disable_raw_mode()?;
                    execute!(terminal.backend_mut(), LeaveAlternateScreen)?;

                    // Execute attach command
                    let status = std::process::Command::new(&command[0])
                        .args(&command[1..])
                        .status();

                    // Restore TUI
                    enable_raw_mode()?;
                    execute!(terminal.backend_mut(), EnterAlternateScreen)?;
                    terminal.clear()?;

                    if let Err(e) = status {
                        app.status_message = Some(format!("Attach failed: {e}"));
                    }

                    // Refresh sessions after returning
                    let _ = app.refresh_sessions().await;
                    continue;
                }
            }

            events::handle_key_event(app, key).await?;
        }
        // Other events like Resize are handled automatically on next render

        if app.should_quit {
            break;
        }
    }

    Ok(())
}
