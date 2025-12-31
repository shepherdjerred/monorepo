use crossterm::event::{Event, EventStream, KeyCode, KeyEvent, KeyModifiers};
use futures::StreamExt;
use tokio::sync::mpsc;

use crate::api::protocol::CreateSessionRequest;
use crate::api::Client;
use crate::core::{AgentType, BackendType};

use super::app::{App, AppMode, CreateDialogFocus, CreateProgress};

/// Create a new async event stream for terminal events.
#[must_use]
pub fn create_event_stream() -> EventStream {
    EventStream::new()
}

/// Read the next event from the stream asynchronously.
///
/// # Errors
///
/// Returns an error if reading from the event stream fails.
pub async fn next_event(stream: &mut EventStream) -> anyhow::Result<Option<Event>> {
    match stream.next().await {
        Some(Ok(event)) => Ok(Some(event)),
        Some(Err(e)) => Err(e.into()),
        None => Ok(None),
    }
}

/// Handle a paste event (when text is pasted from clipboard)
pub fn handle_paste_event(app: &mut App, text: &str) {
    // Only handle paste events in CreateDialog mode
    if app.mode != AppMode::CreateDialog {
        return;
    }

    // Don't handle paste if directory picker is active
    if app.create_dialog.directory_picker.is_active {
        return;
    }

    match app.create_dialog.focus {
        CreateDialogFocus::Name => {
            // For name field, replace all line endings with spaces
            app.create_dialog.name.push_str(
                &text
                    .replace("\r\n", " ")
                    .replace('\r', " ")
                    .replace('\n', " "),
            );
        }
        CreateDialogFocus::Prompt => {
            // For prompt field, normalize line endings to \n
            app.create_dialog
                .prompt
                .push_str(&text.replace("\r\n", "\n").replace('\r', "\n"));
            app.create_dialog.clamp_prompt_scroll();
        }
        // RepoPath doesn't accept typed/pasted input
        _ => {}
    }
}


/// Handle a key event based on the current app mode
///
/// # Errors
///
/// Returns an error if session operations fail during event handling.
pub async fn handle_key_event(app: &mut App, key: KeyEvent) -> anyhow::Result<()> {
    // Global quit with Ctrl+C
    if key.modifiers.contains(KeyModifiers::CONTROL) && key.code == KeyCode::Char('c') {
        app.quit();
        return Ok(());
    }

    match app.mode {
        AppMode::SessionList => handle_session_list_key(app, key).await?,
        AppMode::CreateDialog => handle_create_dialog_key(app, key).await?,
        AppMode::ConfirmDelete => handle_confirm_delete_key(app, key).await?,
        AppMode::Help => handle_help_key(app, key),
        AppMode::Attached => handle_attached_key(app, key).await?,
    }
    Ok(())
}

async fn handle_session_list_key(app: &mut App, key: KeyEvent) -> anyhow::Result<()> {
    match key.code {
        KeyCode::Char('q') => app.quit(),
        KeyCode::Char('?') => app.toggle_help(),
        KeyCode::Char('n') => app.open_create_dialog(),
        KeyCode::Char('d') => app.open_delete_confirm(),
        KeyCode::Char('a') => {
            if let Err(e) = app.archive_selected().await {
                app.status_message = Some(format!("Archive failed: {e}"));
            }
        }
        KeyCode::Char('r') => {
            if let Err(e) = app.reconcile().await {
                app.status_message = Some(format!("Reconcile failed: {e}"));
            }
        }
        KeyCode::Char('R') => {
            if let Err(e) = app.refresh_sessions().await {
                app.status_message = Some(format!("Refresh failed: {e}"));
            } else {
                app.status_message = Some("Refreshed session list".to_string());
            }
        }
        KeyCode::Up | KeyCode::Char('k') => app.select_previous(),
        KeyCode::Down | KeyCode::Char('j') => app.select_next(),
        // Note: Enter is handled specially by the main loop since it needs to suspend the TUI
        _ => {}
    }
    Ok(())
}

async fn handle_create_dialog_key(app: &mut App, key: KeyEvent) -> anyhow::Result<()> {
    // If directory picker is active, handle its events first
    if app.create_dialog.directory_picker.is_active {
        return handle_directory_picker_key(app, key).await;
    }

    match key.code {
        KeyCode::Esc => {
            app.close_create_dialog();
        }
        KeyCode::PageUp => {
            // Scroll prompt field up
            if app.create_dialog.focus == CreateDialogFocus::Prompt {
                app.create_dialog.scroll_prompt_up();
            }
        }
        KeyCode::PageDown => {
            // Scroll prompt field down (pass visible lines - we'll use a reasonable default)
            if app.create_dialog.focus == CreateDialogFocus::Prompt {
                app.create_dialog.scroll_prompt_down(10); // Assuming ~10 visible lines
            }
        }
        KeyCode::Tab => {
            // Cycle through fields
            app.create_dialog.focus = match app.create_dialog.focus {
                CreateDialogFocus::Name => CreateDialogFocus::Prompt,
                CreateDialogFocus::Prompt => CreateDialogFocus::RepoPath,
                CreateDialogFocus::RepoPath => CreateDialogFocus::Backend,
                CreateDialogFocus::Backend => CreateDialogFocus::SkipChecks,
                CreateDialogFocus::SkipChecks => CreateDialogFocus::PlanMode,
                CreateDialogFocus::PlanMode => CreateDialogFocus::Buttons,
                CreateDialogFocus::Buttons => CreateDialogFocus::Name,
            };
        }
        KeyCode::BackTab => {
            // Cycle backwards
            app.create_dialog.focus = match app.create_dialog.focus {
                CreateDialogFocus::Name => CreateDialogFocus::Buttons,
                CreateDialogFocus::Prompt => CreateDialogFocus::Name,
                CreateDialogFocus::RepoPath => CreateDialogFocus::Prompt,
                CreateDialogFocus::Backend => CreateDialogFocus::RepoPath,
                CreateDialogFocus::SkipChecks => CreateDialogFocus::Backend,
                CreateDialogFocus::PlanMode => CreateDialogFocus::SkipChecks,
                CreateDialogFocus::Buttons => CreateDialogFocus::PlanMode,
            };
        }
        KeyCode::Enter => match app.create_dialog.focus {
            CreateDialogFocus::Prompt => {
                // Insert newline in prompt field
                app.create_dialog.prompt.push('\n');
            }
            CreateDialogFocus::Buttons => {
                if app.create_dialog.button_create_focused {
                    // Prevent multiple concurrent creates
                    if app.create_task.is_some() {
                        return Ok(());
                    }

                    // Don't allow creation while deletion is in progress
                    if app.delete_task.is_some() {
                        app.status_message = Some("Cannot create while deleting a session".to_string());
                        return Ok(());
                    }

                    // Create channel for progress updates
                    let (tx, rx) = mpsc::channel(16);
                    app.progress_rx = Some(rx);

                    // Capture data for the background task
                    let request = CreateSessionRequest {
                        name: app.create_dialog.name.clone(),
                        repo_path: app.create_dialog.repo_path.clone(),
                        initial_prompt: app.create_dialog.prompt.clone(),
                        backend: if app.create_dialog.backend_zellij {
                            BackendType::Zellij
                        } else {
                            BackendType::Docker
                        },
                        agent: AgentType::ClaudeCode,
                        dangerous_skip_checks: app.create_dialog.skip_checks,
                        print_mode: false, // TUI always uses interactive mode
                        plan_mode: app.create_dialog.plan_mode,
                        images: app.create_dialog.images.clone(),
                    };

                    // Spawn background task
                    let task = tokio::spawn(async move {
                        // Connect to daemon
                        let mut client = match Client::connect().await {
                            Ok(c) => c,
                            Err(e) => {
                                let _ = tx
                                    .send(CreateProgress::Error {
                                        message: format!(
                                            "Failed to connect to multiplexer daemon: {e}"
                                        ),
                                    })
                                    .await;
                                return;
                            }
                        };

                        // Create progress callback
                        let tx_clone = tx.clone();
                        let on_progress =
                            Box::new(move |step: crate::api::protocol::ProgressStep| {
                                let tx = tx_clone.clone();
                                // Use try_send since we're in a sync callback
                                let _ = tx.try_send(CreateProgress::Step {
                                    step: step.step,
                                    total: step.total,
                                    message: step.message.clone(),
                                });
                            });

                        // Create session with progress
                        match client
                            .create_session_with_progress(request, Some(on_progress))
                            .await
                        {
                            Ok((session, _warnings)) => {
                                let _ = tx
                                    .send(CreateProgress::Done {
                                        session_name: session.name,
                                    })
                                    .await;
                            }
                            Err(e) => {
                                let _ = tx
                                    .send(CreateProgress::Error {
                                        message: e.to_string(),
                                    })
                                    .await;
                            }
                        }
                    });

                    app.create_task = Some(task);
                    app.loading_message = Some("Creating session...".to_string());
                } else {
                    app.close_create_dialog();
                }
            }
            CreateDialogFocus::RepoPath => {
                // Open directory picker when Enter is pressed on RepoPath
                let initial_path = if app.create_dialog.repo_path.is_empty() {
                    None
                } else {
                    Some(crate::utils::expand_tilde(&app.create_dialog.repo_path))
                };
                app.create_dialog.directory_picker.open(initial_path);
            }
            _ => {}
        },
        KeyCode::Up => {
            // Navigate to previous field
            app.create_dialog.focus = match app.create_dialog.focus {
                CreateDialogFocus::Name => CreateDialogFocus::Buttons,
                CreateDialogFocus::Prompt => CreateDialogFocus::Name,
                CreateDialogFocus::RepoPath => CreateDialogFocus::Prompt,
                CreateDialogFocus::Backend => CreateDialogFocus::RepoPath,
                CreateDialogFocus::SkipChecks => CreateDialogFocus::Backend,
                CreateDialogFocus::PlanMode => CreateDialogFocus::SkipChecks,
                CreateDialogFocus::Buttons => CreateDialogFocus::PlanMode,
            };
        }
        KeyCode::Down => {
            // Navigate to next field
            app.create_dialog.focus = match app.create_dialog.focus {
                CreateDialogFocus::Name => CreateDialogFocus::Prompt,
                CreateDialogFocus::Prompt => CreateDialogFocus::RepoPath,
                CreateDialogFocus::RepoPath => CreateDialogFocus::Backend,
                CreateDialogFocus::Backend => CreateDialogFocus::SkipChecks,
                CreateDialogFocus::SkipChecks => CreateDialogFocus::PlanMode,
                CreateDialogFocus::PlanMode => CreateDialogFocus::Buttons,
                CreateDialogFocus::Buttons => CreateDialogFocus::Name,
            };
        }
        KeyCode::Left | KeyCode::Right => match app.create_dialog.focus {
            CreateDialogFocus::Backend => {
                app.create_dialog.toggle_backend();
            }
            CreateDialogFocus::SkipChecks => {
                app.create_dialog.skip_checks = !app.create_dialog.skip_checks;
            }
            CreateDialogFocus::PlanMode => {
                app.create_dialog.plan_mode = !app.create_dialog.plan_mode;
            }
            CreateDialogFocus::Buttons => {
                app.create_dialog.button_create_focused = !app.create_dialog.button_create_focused;
            }
            _ => {}
        },
        KeyCode::Char(' ') => match app.create_dialog.focus {
            CreateDialogFocus::Backend => {
                app.create_dialog.toggle_backend();
            }
            CreateDialogFocus::SkipChecks => {
                app.create_dialog.skip_checks = !app.create_dialog.skip_checks;
            }
            CreateDialogFocus::PlanMode => {
                app.create_dialog.plan_mode = !app.create_dialog.plan_mode;
            }
            CreateDialogFocus::Name => app.create_dialog.name.push(' '),
            CreateDialogFocus::Prompt => app.create_dialog.prompt.push(' '),
            CreateDialogFocus::RepoPath => {
                // Open directory picker when space is pressed on RepoPath
                let initial_path = if app.create_dialog.repo_path.is_empty() {
                    None
                } else {
                    Some(crate::utils::expand_tilde(&app.create_dialog.repo_path))
                };
                app.create_dialog.directory_picker.open(initial_path);
            }
            _ => {}
        },
        KeyCode::Char(c) => match app.create_dialog.focus {
            CreateDialogFocus::Name => app.create_dialog.name.push(c),
            CreateDialogFocus::Prompt => app.create_dialog.prompt.push(c),
            // RepoPath no longer accepts typed input - use directory picker instead
            _ => {}
        },
        KeyCode::Backspace => match app.create_dialog.focus {
            CreateDialogFocus::Name => {
                app.create_dialog.name.pop();
            }
            CreateDialogFocus::Prompt => {
                app.create_dialog.prompt.pop();
                app.create_dialog.clamp_prompt_scroll();
            }
            CreateDialogFocus::RepoPath => {
                // Clear the repo path on backspace
                app.create_dialog.repo_path.clear();
            }
            _ => {}
        },
        _ => {}
    }
    Ok(())
}

async fn handle_directory_picker_key(app: &mut App, key: KeyEvent) -> anyhow::Result<()> {
    let picker = &mut app.create_dialog.directory_picker;

    match key.code {
        // Close picker
        KeyCode::Esc => {
            picker.close();
        }

        // Navigation
        KeyCode::Up | KeyCode::Char('k') => {
            picker.select_previous();
        }
        KeyCode::Down | KeyCode::Char('j') => {
            picker.select_next();
        }

        // Tab selects the highlighted directory and closes the picker
        KeyCode::Tab => {
            if let Some(entry) = picker.selected_entry() {
                let entry_path = entry.path.clone();
                if entry.is_parent {
                    // Select parent directory
                    app.create_dialog.repo_path = entry_path.to_string_lossy().to_string();
                } else if entry_path.is_dir() {
                    // Select the highlighted directory
                    app.create_dialog.repo_path = entry_path.to_string_lossy().to_string();
                }
                picker.close();
            }
        }

        // Select current directory (Ctrl+Enter)
        KeyCode::Enter if key.modifiers.contains(KeyModifiers::CONTROL) => {
            app.create_dialog.repo_path = picker.current_dir.to_string_lossy().to_string();
            picker.close();
        }

        // Enter directory or select
        KeyCode::Enter => {
            if let Some(entry) = picker.selected_entry() {
                let entry_path = entry.path.clone();
                let is_parent = entry.is_parent;

                if is_parent || entry_path.is_dir() {
                    // Navigate into directory
                    picker.current_dir = entry_path;
                    picker.search_query.clear();
                    picker.refresh_entries();
                }
            }
        }

        // Go to parent directory
        KeyCode::Backspace if picker.search_query.is_empty() => {
            picker.navigate_to_parent();
        }

        // Backspace removes search char
        KeyCode::Backspace => {
            picker.remove_search_char();
            picker.apply_filter();
        }

        // Type to search
        KeyCode::Char(c) => {
            picker.add_search_char(c);
            picker.apply_filter();
        }

        _ => {}
    }

    Ok(())
}

async fn handle_confirm_delete_key(app: &mut App, key: KeyEvent) -> anyhow::Result<()> {
    match key.code {
        KeyCode::Char('y' | 'Y') => {
            app.confirm_delete();
        }
        KeyCode::Char('n' | 'N') | KeyCode::Esc => {
            app.cancel_delete();
        }
        _ => {}
    }
    Ok(())
}

fn handle_help_key(app: &mut App, key: KeyEvent) {
    match key.code {
        KeyCode::Esc | KeyCode::Char('?' | 'q') => {
            app.toggle_help();
        }
        _ => {}
    }
}

/// Handle key events when attached to a session via PTY.
///
/// Most keys are encoded and sent to the PTY. Ctrl+] is the detach key
/// which uses a double-tap mechanism (single press waits 300ms for second,
/// double-tap sends the literal Ctrl+] character).
///
/// Session switching: Ctrl+Left/Right switches between Docker sessions.
/// Scrolling: Shift+PageUp/Down navigates scroll-back buffer.
async fn handle_attached_key(app: &mut App, key: KeyEvent) -> anyhow::Result<()> {
    use crate::tui::app::DetachState;
    use crate::tui::attached::encode_key;
    use std::time::Duration;

    const DETACH_TIMEOUT: Duration = Duration::from_millis(300);

    // Check for Ctrl+] (our detach key)
    if key.modifiers.contains(KeyModifiers::CONTROL) && key.code == KeyCode::Char(']') {
        match &app.detach_state {
            DetachState::Idle => {
                // First press - start waiting for second
                app.detach_state = DetachState::Pending {
                    since: std::time::Instant::now(),
                };
                // Don't send anything yet, wait for timeout or second press
                return Ok(());
            }
            DetachState::Pending { since } => {
                if since.elapsed() < DETACH_TIMEOUT {
                    // Double-tap detected - send literal Ctrl+]
                    app.detach_state = DetachState::Idle;
                    app.send_to_pty(vec![0x1d]).await?; // GS (Ctrl+])
                } else {
                    // Timeout expired - this should have been handled by main loop
                    // but if we get here, treat as detach
                    app.detach();
                }
                return Ok(());
            }
        }
    }

    // Session switching with Ctrl+Left/Right
    if key.modifiers.contains(KeyModifiers::CONTROL) {
        match key.code {
            KeyCode::Left => {
                if app.switch_to_previous_session().await? {
                    app.status_message = Some("Switched to previous session".to_string());
                }
                return Ok(());
            }
            KeyCode::Right => {
                if app.switch_to_next_session().await? {
                    app.status_message = Some("Switched to next session".to_string());
                }
                return Ok(());
            }
            _ => {}
        }
    }

    // Scrolling with Shift+PageUp/PageDown
    if key.modifiers.contains(KeyModifiers::SHIFT) {
        match key.code {
            KeyCode::PageUp => {
                if let Some(pty_session) = app.attached_pty_session() {
                    let buffer = pty_session.terminal_buffer();
                    let mut buf = buffer.lock().await;
                    buf.scroll_up(10);
                }
                return Ok(());
            }
            KeyCode::PageDown => {
                if let Some(pty_session) = app.attached_pty_session() {
                    let buffer = pty_session.terminal_buffer();
                    let mut buf = buffer.lock().await;
                    buf.scroll_down(10);
                }
                return Ok(());
            }
            _ => {}
        }
    }

    // If we were pending detach and got a different key, send Ctrl+] then this key
    if let DetachState::Pending { since } = &app.detach_state {
        if since.elapsed() >= DETACH_TIMEOUT {
            // Timeout - detach
            app.detach();
            return Ok(());
        }
        // Not a second Ctrl+], so send the first one as literal and continue
        app.send_to_pty(vec![0x1d]).await?;
        app.detach_state = DetachState::Idle;
    }

    // Reset scroll position on any regular input (auto-scroll to bottom)
    if let Some(pty_session) = app.attached_pty_session() {
        let buffer = pty_session.terminal_buffer();
        let mut buf = buffer.lock().await;
        buf.scroll_to_bottom();
    }

    // Encode the key and send to PTY
    let encoded = encode_key(&key);
    if !encoded.is_empty() {
        app.send_to_pty(encoded).await?;
    }

    Ok(())
}
