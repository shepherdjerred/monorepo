pub mod app;
pub mod components;
pub mod events;
pub mod ui;

pub use app::App;

use std::io::{self, stdout};
use std::time::Duration;

use crossterm::{
    event::{
        DisableBracketedPaste, EnableBracketedPaste, Event, KeyCode, KeyboardEnhancementFlags,
        PopKeyboardEnhancementFlags, PushKeyboardEnhancementFlags,
    },
    execute,
    terminal::{EnterAlternateScreen, LeaveAlternateScreen, disable_raw_mode, enable_raw_mode},
};
use ratatui::{Terminal, backend::CrosstermBackend};

use crate::core::BackendType;
use crate::tui::app::{AppMode, CreateProgress};

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
    execute!(
        stdout,
        EnterAlternateScreen,
        EnableBracketedPaste,
        PushKeyboardEnhancementFlags(
            KeyboardEnhancementFlags::DISAMBIGUATE_ESCAPE_CODES
                | KeyboardEnhancementFlags::REPORT_ALL_KEYS_AS_ESCAPE_CODES
        )
    )?;
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
    execute!(
        terminal.backend_mut(),
        PopKeyboardEnhancementFlags,
        DisableBracketedPaste,
        LeaveAlternateScreen
    )?;
    terminal.show_cursor()?;

    result
}

async fn run_main_loop(
    terminal: &mut Terminal<CrosstermBackend<io::Stdout>>,
    app: &mut App,
) -> anyhow::Result<()> {
    loop {
        // Increment spinner tick for animation
        app.tick();

        // Draw UI
        terminal.draw(|frame| ui::render(frame, app))?;

        // Poll for events with timeout
        if let Some(event) = events::poll_event(Duration::from_millis(100))? {
            // Handle paste events
            if let Event::Paste(pasted_text) = &event {
                events::handle_paste_event(app, pasted_text);
                continue;
            }

            // Handle key events
            let Event::Key(key) = event else {
                continue;
            };

            // Handle Enter in session list to attach
            if app.mode == AppMode::SessionList && key.code == KeyCode::Enter {
                // Get backend type before borrowing for attach command
                let backend_type = app.selected_session().map(|s| s.backend);

                if let Ok(Some(command)) = app.get_attach_command().await {
                    // Suspend TUI and run attach command
                    disable_raw_mode()?;
                    execute!(terminal.backend_mut(), LeaveAlternateScreen)?;

                    // Show detach hint before attaching
                    if let Some(backend) = backend_type {
                        let detach_hint = match backend {
                            BackendType::Zellij => "Ctrl+O, d",
                            BackendType::Docker => "Ctrl+P, Ctrl+Q",
                        };
                        println!("Attaching... Detach with {detach_hint}");
                    } else {
                        println!("Attaching...");
                    }

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

        // Poll for progress updates from background tasks (non-blocking)
        // Collect updates first to avoid borrow issues
        let mut updates = Vec::new();
        if let Some(ref mut rx) = app.progress_rx {
            while let Ok(progress) = rx.try_recv() {
                updates.push(progress);
            }
        }

        // Process collected updates
        for progress in updates {
            match progress {
                CreateProgress::Step { step, total, message } => {
                    app.progress_step = Some((step, total, message));
                }
                CreateProgress::Done { session_name } => {
                    app.loading_message = None;
                    app.progress_step = None;
                    app.progress_rx = None;
                    // Abort the task handle to ensure cleanup
                    if let Some(task) = app.create_task.take() {
                        task.abort();
                    }
                    app.status_message = Some(format!("Created session {session_name}"));
                    app.close_create_dialog();
                    let _ = app.refresh_sessions().await;
                }
                CreateProgress::Error { message } => {
                    app.loading_message = None;
                    app.progress_step = None;
                    app.progress_rx = None;
                    // Abort the task handle to ensure cleanup
                    if let Some(task) = app.create_task.take() {
                        task.abort();
                    }
                    app.status_message = Some(format!("Create failed: {message}"));
                }
            }
        }

        // Poll for deletion updates from background tasks (non-blocking)
        let mut delete_updates = Vec::new();
        if let Some(ref mut rx) = app.delete_progress_rx {
            while let Ok(progress) = rx.try_recv() {
                delete_updates.push(progress);
            }
        }

        // Process deletion updates
        for progress in delete_updates {
            match progress {
                app::DeleteProgress::Done { session_id } => {
                    app.deleting_session_id = None;
                    app.delete_progress_rx = None;
                    if let Some(task) = app.delete_task.take() {
                        task.abort();
                    }
                    app.status_message = Some(format!("Deleted session {session_id}"));
                    let _ = app.refresh_sessions().await;
                }
                app::DeleteProgress::Error { session_id, message } => {
                    app.deleting_session_id = None;
                    app.delete_progress_rx = None;
                    if let Some(task) = app.delete_task.take() {
                        task.abort();
                    }
                    app.status_message = Some(format!("Delete failed: {message}"));
                }
            }
        }

        if app.should_quit {
            break;
        }
    }

    Ok(())
}
