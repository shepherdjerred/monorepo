// Allow missing documentation for TUI implementation details
#![allow(
    clippy::missing_errors_doc,
    clippy::missing_panics_doc,
    reason = "TUI implementation details do not need public API documentation"
)]

/// Application state, modes, and dialog models.
pub mod app;
/// PTY session attachment and terminal rendering.
pub mod attached;
/// Reusable UI components (dialogs, lists, status bar).
pub mod components;
/// Keyboard and terminal event handling.
pub mod events;
mod events_copy_mode;
/// Multi-line text input widget.
pub mod text_input;
/// UI rendering functions for each application mode.
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
use futures::StreamExt;
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
        let _ = app.refresh_health().await;
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
    // Create async event stream
    let mut event_stream = events::create_event_stream();

    // Tick interval for animations
    let mut tick_interval = tokio::time::interval(Duration::from_millis(80));

    // NOTE: Background auto-reconcile has been disabled.
    // The new unified recreate system uses explicit user-triggered recreate instead.
    // See Phase 2 of the unified recreate system plan.
    // TODO: Add startup health check modal when TUI modals are implemented (Phase 5)

    // Set initial terminal size
    let size = terminal.size()?;
    app.terminal_size = (size.height, size.width);

    loop {
        // Draw UI
        terminal.draw(|frame| ui::render(frame, app))?;

        // Use tokio::select! to handle multiple event sources
        tokio::select! {
            // Handle terminal events
            event_result = event_stream.next() => {
                let Some(event_result) = event_result else {
                    // Stream ended
                    break;
                };

                let event = event_result?;

                // Handle resize events
                if let Event::Resize(cols, rows) = event {
                    app.set_terminal_size(rows, cols).await;
                    continue;
                }

                // Handle paste events
                if let Event::Paste(pasted_text) = &event {
                    events::handle_paste_event(app, pasted_text).await?;
                    continue;
                }

                // Handle key events
                let Event::Key(key) = event else {
                    continue;
                };

                // Handle Enter in session list to attach
                if app.mode == AppMode::SessionList && key.code == KeyCode::Enter {
                    // Check if session has a reconcile error - show dialog instead of attaching
                    if app.try_show_selected_reconcile_error() {
                        continue;
                    }

                    // Get backend type before borrowing for attach command
                    let backend_type = app.selected_session().map(|s| s.backend);

                    match backend_type {
                        Some(BackendType::Docker) => {
                            // Use PTY-based attachment for Docker
                            match app.attach_selected_session().await {
                                Ok(()) => {
                                    app.status_message = Some("Attached - Press Ctrl+Q to detach, Ctrl+Left/Right to switch sessions".to_owned());
                                }
                                Err(e) => {
                                    app.status_message = Some(format!("Attach failed: {e}"));
                                }
                            }
                            continue;
                        }
                        Some(BackendType::Zellij) => {
                            // Use external command for Zellij (legacy behavior)
                            if let Ok(Some(command)) = app.get_attach_command().await {
                                // Suspend TUI and run attach command
                                disable_raw_mode()?;
                                execute!(terminal.backend_mut(), LeaveAlternateScreen)?;

                                tracing::info!("Attaching... Detach with Ctrl+O, d");

                                // Execute attach command
                                let status = std::process::Command::new(&command[0])
                                    .args(&command[1..])
                                    .status();

                                // Restore TUI
                                enable_raw_mode()?;
                                execute!(terminal.backend_mut(), EnterAlternateScreen)?;
                                terminal.clear()?;

                                // Recreate event stream after restoring terminal
                                event_stream = events::create_event_stream();

                                if let Err(e) = status {
                                    app.status_message = Some(format!("Attach failed: {e}"));
                                }

                                // Refresh sessions after returning
                                let _ = app.refresh_sessions().await;
                                continue;
                            }
                        }
                        Some(BackendType::Kubernetes) => {
                            // Use PTY-based attachment for Kubernetes
                            match app.attach_selected_session().await {
                                Ok(()) => {
                                    app.status_message = Some("Attached - Press Ctrl+Q to detach, Ctrl+Left/Right to switch sessions".to_owned());
                                }
                                Err(e) => {
                                    app.status_message = Some(format!("Attach failed: {e}"));
                                }
                            }
                            continue;
                        }
                        Some(BackendType::Sprites) => {
                            // Use PTY-based attachment for Sprites
                            match app.attach_selected_session().await {
                                Ok(()) => {
                                    app.status_message = Some("Attached - Press Ctrl+Q to detach, Ctrl+Left/Right to switch sessions".to_owned());
                                }
                                Err(e) => {
                                    app.status_message = Some(format!("Attach failed: {e}"));
                                }
                            }
                            continue;
                        }
                        #[cfg(target_os = "macos")]
                        Some(BackendType::AppleContainer) => {
                            // Use PTY-based attachment for Apple Container
                            match app.attach_selected_session().await {
                                Ok(()) => {
                                    app.status_message = Some("Attached - Press Ctrl+Q to detach, Ctrl+Left/Right to switch sessions".to_owned());
                                }
                                Err(e) => {
                                    app.status_message = Some(format!("Attach failed: {e}"));
                                }
                            }
                            continue;
                        }
                        #[cfg(target_os = "macos")]
                        _ => {}
                        #[cfg(not(target_os = "macos"))]
                        None => {
                            // No session selected
                        }
                    }
                }

                events::handle_key_event(app, key).await?;

                // Check if we should launch external editor
                if app.launch_editor {
                    app.launch_editor = false;

                    // Get editor command
                    let editor_cmd = crate::utils::editor::get_editor();

                    // Validate editor command doesn't contain dangerous shell metacharacters
                    let dangerous_chars = ['&', '|', ';', '<', '>', '`', '$', '(', ')'];
                    if editor_cmd.chars().any(|c| dangerous_chars.contains(&c)) {
                        app.status_message = Some(format!(
                            "Editor command contains unsafe characters: {editor_cmd}. Please use a wrapper script."
                        ));
                        continue;
                    }

                    // Create temp file with current prompt content
                    match crate::utils::editor::create_temp_file(&app.create_dialog.prompt) {
                        Ok(temp_path) => {
                            // Suspend TUI
                            disable_raw_mode()?;
                            execute!(terminal.backend_mut(), LeaveAlternateScreen, crossterm::event::PopKeyboardEnhancementFlags)?;

                            // Launch editor
                            let result = if cfg!(target_os = "windows") {
                                std::process::Command::new(&editor_cmd)
                                    .arg(&temp_path)
                                    .status()
                            } else {
                                // Split command by whitespace (safe after validation above)
                                // Note: If editor path contains spaces, user should set EDITOR to a wrapper script
                                let parts: Vec<&str> = editor_cmd.split_whitespace().collect();
                                if parts.is_empty() {
                                    Err(std::io::Error::new(std::io::ErrorKind::NotFound, "Empty editor command"))
                                } else {
                                    std::process::Command::new(parts[0])
                                        .args(&parts[1..])
                                        .arg(&temp_path)
                                        .status()
                                }
                            };

                            // Restore TUI
                            execute!(terminal.backend_mut(), EnterAlternateScreen, crossterm::event::PushKeyboardEnhancementFlags(
                                crossterm::event::KeyboardEnhancementFlags::DISAMBIGUATE_ESCAPE_CODES
                            ))?;
                            enable_raw_mode()?;
                            terminal.clear()?;

                            // Recreate event stream
                            event_stream = events::create_event_stream();

                            // Read back edited content if editor exited successfully
                            match result {
                                Ok(status) if status.success() => {
                                    match crate::utils::editor::read_file_content(&temp_path) {
                                        Ok(content) => {
                                            // Update prompt with edited content
                                            app.create_dialog.prompt = content;

                                            // Reset cursor to end of content
                                            let lines = app.create_dialog.prompt.lines().count().max(1);
                                            app.create_dialog.prompt_cursor_line = lines.saturating_sub(1);
                                            let last_line_len = app.create_dialog.prompt
                                                .lines()
                                                .last()
                                                .map_or(0, |l| l.chars().count());
                                            app.create_dialog.prompt_cursor_col = last_line_len;
                                            app.create_dialog.ensure_cursor_visible();

                                            app.status_message = Some("Prompt updated from editor".to_owned());
                                        }
                                        Err(e) => {
                                            app.status_message = Some(format!("Failed to read edited file: {e}"));
                                        }
                                    }
                                }
                                Ok(_) => {
                                    app.status_message = Some("Editor exited without saving".to_owned());
                                }
                                Err(e) => {
                                    app.status_message = Some(format!("Failed to launch editor: {e}"));
                                }
                            }

                            // Clean up temp file
                            crate::utils::editor::cleanup_temp_file(&temp_path);
                        }
                        Err(e) => {
                            app.status_message = Some(format!("Failed to create temp file: {e}"));
                        }
                    }
                }
            }

            // Handle tick for animations
            _ = tick_interval.tick() => {
                app.tick();
            }

            // NOTE: Background auto-reconcile has been removed.
            // Users now explicitly trigger recreate via the health check system.
        }

        // Poll for PTY events when attached (non-blocking)
        // Collect events first to avoid borrow issues
        let mut pty_events = Vec::new();
        if app.mode == AppMode::Attached {
            if let Some(pty_session) = app.attached_pty_session_mut() {
                while let Some(event) = pty_session.try_recv_event() {
                    pty_events.push(event);
                }
            }
        }

        // Process collected PTY events
        for event in pty_events {
            match event {
                attached::PtyEvent::Output => {
                    // Terminal buffer is already updated, just redraw
                }
                attached::PtyEvent::Exited(code) => {
                    app.status_message = Some(format!("Session exited with code {code}"));
                    app.detach();
                }
                attached::PtyEvent::Error(msg) => {
                    app.status_message = Some(format!("PTY error: {msg}"));
                    app.detach();
                }
            }
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
                CreateProgress::Step {
                    step,
                    total,
                    message,
                } => {
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
                    let _ = app.refresh_health().await;
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
                    // Task is already complete - just take the handle to clean up
                    app.delete_task.take();
                    app.status_message = Some(format!("Deleted session {session_id}"));
                    let _ = app.refresh_sessions().await;
                    let _ = app.refresh_health().await;
                }
                app::DeleteProgress::Error {
                    session_id: _,
                    message,
                } => {
                    app.deleting_session_id = None;
                    app.delete_progress_rx = None;
                    // Task is already complete - just take the handle to clean up
                    app.delete_task.take();
                    app.status_message = Some(format!("Delete failed: {message}"));
                }
            }
        }

        if app.should_quit {
            // Shutdown all PTY sessions before quitting
            app.shutdown_all_pty_sessions().await;
            break;
        }
    }

    // Cleanup: Abort any in-flight background tasks before exiting
    // Note: The daemon will still complete the actual operations (create/delete),
    // we're just stopping the TUI's monitoring tasks
    if let Some(task) = app.create_task.take() {
        task.abort();
    }
    if let Some(task) = app.delete_task.take() {
        task.abort();
    }

    Ok(())
}
