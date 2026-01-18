use crossterm::event::{Event, EventStream, KeyCode, KeyEvent, KeyModifiers};
use futures::StreamExt;
use tokio::sync::mpsc;

use crate::api::Client;
use crate::api::protocol::CreateSessionRequest;
use crate::core::{AgentType, BackendType};

use super::app::{App, AppMode, CreateDialogFocus, CreateProgress};
use super::events_copy_mode::handle_copy_mode_key;

/// Number of lines to scroll with PageUp/PageDown
const SCROLL_LINES_PER_PAGE: usize = 10;

/// Number of lines to scroll with Shift+Arrow keys
const SCROLL_LINES_PER_ARROW: usize = 1;

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

// Mouse event handling has been disabled to allow normal terminal text selection.
// Mouse capture was preventing users from selecting and copying text with their mouse.
// Keyboard scrolling alternatives (PgUp/PgDn, Shift+Up/Down) are still available.
//
// /// Handle a mouse event
// ///
// /// # Errors
// ///
// /// Returns an error if scrolling operations fail.
// pub async fn handle_mouse_event(app: &mut App, mouse: MouseEvent) -> anyhow::Result<()> {
//     // Only handle mouse events when attached
//     if app.mode != AppMode::Attached {
//         return Ok(());
//     }
//
//     match mouse.kind {
//         MouseEventKind::ScrollUp => {
//             if let Some(pty_session) = app.attached_pty_session() {
//                 let buffer = pty_session.terminal_buffer();
//                 // Lock acquisition is safe here as this is the only place we hold the lock
//                 // and operations are synchronous. If the lock were to fail, it would indicate
//                 // a critical issue with the buffer, so we log and continue gracefully.
//                 match buffer.try_lock() {
//                     Ok(mut buf) => {
//                         buf.scroll_up(SCROLL_LINES_PER_WHEEL_TICK);
//                     }
//                     Err(_) => {
//                         tracing::warn!("Failed to acquire terminal buffer lock for scroll up");
//                     }
//                 }
//             }
//         }
//         MouseEventKind::ScrollDown => {
//             if let Some(pty_session) = app.attached_pty_session() {
//                 let buffer = pty_session.terminal_buffer();
//                 match buffer.try_lock() {
//                     Ok(mut buf) => {
//                         buf.scroll_down(SCROLL_LINES_PER_WHEEL_TICK);
//                     }
//                     Err(_) => {
//                         tracing::warn!("Failed to acquire terminal buffer lock for scroll down");
//                     }
//                 }
//             }
//         }
//         _ => {
//             // Ignore other mouse events (clicks, moves, etc.) for now
//         }
//     }
//
//     Ok(())
// }

/// Handle a paste event (when text is pasted from clipboard)
///
/// # Errors
///
/// Returns an error if sending to PTY fails.
pub async fn handle_paste_event(app: &mut App, text: &str) -> anyhow::Result<()> {
    match app.mode {
        AppMode::Attached => {
            // In Attached mode, send pasted text directly to the PTY
            let pasted_bytes = text.as_bytes().to_vec();
            app.send_to_pty(pasted_bytes).await?;
        }
        AppMode::CreateDialog => {
            // Don't handle paste if directory picker is active
            if app.create_dialog.directory_picker.is_active {
                return Ok(());
            }

            match app.create_dialog.focus {
                CreateDialogFocus::Prompt => {
                    // Check if pasted text is an image file path (drag-and-drop support)
                    let trimmed = text.trim();
                    if is_image_path(trimmed) {
                        app.create_dialog.images.push(trimmed.to_string());
                        app.status_message = Some(format!("Image attached: {}", trimmed));
                        return Ok(());
                    }

                    // Handle multiple lines (e.g., multiple files pasted)
                    let lines: Vec<&str> = text.lines().collect();
                    if lines.len() > 1 {
                        let mut added_images = 0;
                        for line in lines {
                            let line = line.trim();
                            if is_image_path(line) {
                                app.create_dialog.images.push(line.to_string());
                                added_images += 1;
                            }
                        }
                        if added_images > 0 {
                            app.status_message = Some(format!("Added {} image(s)", added_images));
                            return Ok(());
                        }
                    }

                    // For prompt field, normalize line endings to \n
                    let normalized_text = text.replace("\r\n", "\n").replace('\r', "\n");

                    // Insert each character at cursor position
                    for ch in normalized_text.chars() {
                        if ch == '\n' {
                            (
                                app.create_dialog.prompt_cursor_line,
                                app.create_dialog.prompt_cursor_col,
                            ) = super::text_input::insert_newline_at_cursor(
                                &mut app.create_dialog.prompt,
                                app.create_dialog.prompt_cursor_line,
                                app.create_dialog.prompt_cursor_col,
                            );
                        } else {
                            (
                                app.create_dialog.prompt_cursor_line,
                                app.create_dialog.prompt_cursor_col,
                            ) = super::text_input::insert_char_at_cursor_multiline(
                                &mut app.create_dialog.prompt,
                                app.create_dialog.prompt_cursor_line,
                                app.create_dialog.prompt_cursor_col,
                                ch,
                            );
                        }
                    }
                    app.create_dialog.ensure_cursor_visible();
                }
                // RepoPath doesn't accept typed/pasted input
                _ => {}
            }
        }
        AppMode::CopyMode
        | AppMode::SessionList
        | AppMode::ConfirmDelete
        | AppMode::Help
        | AppMode::Locked
        | AppMode::Scroll
        | AppMode::ReconcileError => {
            // Ignore paste events in these modes
        }
    }

    Ok(())
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
        AppMode::ConfirmDelete => handle_confirm_delete_key(app, key),
        AppMode::Help => handle_help_key(app, key),
        AppMode::Attached => handle_attached_key(app, key).await?,
        AppMode::CopyMode => handle_copy_mode_key(app, key).await?,
        AppMode::Locked => handle_locked_key(app, key).await?,
        AppMode::Scroll => handle_scroll_mode_key(app, key),
        AppMode::ReconcileError => handle_reconcile_error_key(app, key).await?,
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
        KeyCode::Char('u') => {
            if let Err(e) = app.unarchive_selected().await {
                app.status_message = Some(format!("Unarchive failed: {e}"));
            }
        }
        KeyCode::Char('f') => {
            if let Err(e) = app.refresh_selected().await {
                app.status_message = Some(format!("Refresh failed: {e}"));
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
        // Filter switching with number keys
        KeyCode::Char('1') => app.set_filter(crate::tui::app::SessionFilter::All),
        KeyCode::Char('2') => app.set_filter(crate::tui::app::SessionFilter::Running),
        KeyCode::Char('3') => app.set_filter(crate::tui::app::SessionFilter::Idle),
        KeyCode::Char('4') => app.set_filter(crate::tui::app::SessionFilter::Completed),
        KeyCode::Char('5') => app.set_filter(crate::tui::app::SessionFilter::Archived),
        KeyCode::Tab => app.cycle_filter_next(),
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
        handle_directory_picker_key(app, key);
        return Ok(());
    }

    // Handle Ctrl+E for opening external editor when Prompt is focused
    if key.modifiers.contains(KeyModifiers::CONTROL)
        && key.code == KeyCode::Char('e')
        && app.create_dialog.focus == CreateDialogFocus::Prompt
    {
        app.launch_editor = true;
        return Ok(());
    }

    // Handle Ctrl+Backspace to remove last attached image
    if key.modifiers.contains(KeyModifiers::CONTROL)
        && key.code == KeyCode::Backspace
        && !app.create_dialog.images.is_empty()
    {
        let last_idx = app.create_dialog.images.len() - 1;
        app.create_dialog.remove_image(last_idx);
        app.status_message = Some("Image removed".to_string());
        return Ok(());
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
            // Scroll prompt field down
            if app.create_dialog.focus == CreateDialogFocus::Prompt {
                let visible_lines = app.create_dialog.prompt_visible_lines();
                app.create_dialog.scroll_prompt_down(visible_lines);
            }
        }
        KeyCode::Home => match app.create_dialog.focus {
            CreateDialogFocus::Prompt => {
                (
                    app.create_dialog.prompt_cursor_line,
                    app.create_dialog.prompt_cursor_col,
                ) = super::text_input::move_cursor_to_line_start(
                    app.create_dialog.prompt_cursor_line,
                );
            }
            _ => {}
        },
        KeyCode::End => match app.create_dialog.focus {
            CreateDialogFocus::Prompt => {
                (
                    app.create_dialog.prompt_cursor_line,
                    app.create_dialog.prompt_cursor_col,
                ) = super::text_input::move_cursor_to_line_end(
                    &app.create_dialog.prompt,
                    app.create_dialog.prompt_cursor_line,
                );
            }
            _ => {}
        },
        KeyCode::Tab => {
            // Cycle through fields
            app.create_dialog.focus = match app.create_dialog.focus {
                CreateDialogFocus::Prompt => CreateDialogFocus::RepoPath,
                CreateDialogFocus::RepoPath => CreateDialogFocus::Backend,
                CreateDialogFocus::Backend => CreateDialogFocus::Agent,
                CreateDialogFocus::Agent => CreateDialogFocus::AccessMode,
                CreateDialogFocus::AccessMode => CreateDialogFocus::SkipChecks,
                CreateDialogFocus::SkipChecks => CreateDialogFocus::PlanMode,
                CreateDialogFocus::PlanMode => CreateDialogFocus::Buttons,
                CreateDialogFocus::Buttons => CreateDialogFocus::Prompt,
            };
        }
        KeyCode::BackTab => {
            // Cycle backwards
            app.create_dialog.focus = match app.create_dialog.focus {
                CreateDialogFocus::Prompt => CreateDialogFocus::Buttons,
                CreateDialogFocus::RepoPath => CreateDialogFocus::Prompt,
                CreateDialogFocus::Backend => CreateDialogFocus::RepoPath,
                CreateDialogFocus::Agent => CreateDialogFocus::Backend,
                CreateDialogFocus::AccessMode => CreateDialogFocus::Agent,
                CreateDialogFocus::SkipChecks => CreateDialogFocus::AccessMode,
                CreateDialogFocus::PlanMode => CreateDialogFocus::SkipChecks,
                CreateDialogFocus::Buttons => CreateDialogFocus::PlanMode,
            };
        }
        KeyCode::Enter => match app.create_dialog.focus {
            CreateDialogFocus::Prompt => {
                // Insert newline at cursor position
                (
                    app.create_dialog.prompt_cursor_line,
                    app.create_dialog.prompt_cursor_col,
                ) = super::text_input::insert_newline_at_cursor(
                    &mut app.create_dialog.prompt,
                    app.create_dialog.prompt_cursor_line,
                    app.create_dialog.prompt_cursor_col,
                );
                app.create_dialog.ensure_cursor_visible();
            }
            CreateDialogFocus::Buttons => {
                if app.create_dialog.button_create_focused {
                    // Prevent multiple concurrent creates
                    if app.create_task.is_some() {
                        return Ok(());
                    }

                    // Don't allow creation while deletion is in progress
                    if app.delete_task.is_some() {
                        app.status_message =
                            Some("Cannot create while deleting a session".to_string());
                        return Ok(());
                    }

                    // Create channel for progress updates
                    let (tx, rx) = mpsc::channel(16);
                    app.progress_rx = Some(rx);

                    // Capture data for the background task
                    let request = CreateSessionRequest {
                        repo_path: app.create_dialog.repo_path.clone(),
                        repositories: None, // TUI doesn't support multi-repo yet
                        initial_prompt: app.create_dialog.prompt.clone(),
                        backend: app.create_dialog.backend,
                        agent: app.create_dialog.agent,
                        dangerous_skip_checks: app.create_dialog.skip_checks,
                        print_mode: false, // TUI always uses interactive mode
                        plan_mode: app.create_dialog.plan_mode,
                        access_mode: app.create_dialog.access_mode,
                        images: app.create_dialog.images.clone(),
                        container_image: None,
                        pull_policy: None,
                        cpu_limit: None,
                        memory_limit: None,
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
                                            "Failed to connect to clauderon daemon: {e}"
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
                                    message: step.message,
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
                // Load recent repos and open directory picker when Enter is pressed on RepoPath
                app.load_recent_repos().await;
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
            // Special handling for Prompt field - move cursor up, or navigate to previous field if at top
            if app.create_dialog.focus == CreateDialogFocus::Prompt {
                if app.create_dialog.prompt_cursor_line == 0 {
                    // At top of prompt, navigate to previous field (wrap to Buttons)
                    app.create_dialog.focus = CreateDialogFocus::Buttons;
                } else {
                    // Move cursor up within prompt
                    (
                        app.create_dialog.prompt_cursor_line,
                        app.create_dialog.prompt_cursor_col,
                    ) = super::text_input::move_cursor_up_multiline(
                        &app.create_dialog.prompt,
                        app.create_dialog.prompt_cursor_line,
                        app.create_dialog.prompt_cursor_col,
                    );
                    app.create_dialog.ensure_cursor_visible();
                }
            } else {
                // Navigate to previous field
                app.create_dialog.focus = match app.create_dialog.focus {
                    CreateDialogFocus::Prompt => CreateDialogFocus::Buttons,
                    CreateDialogFocus::RepoPath => CreateDialogFocus::Prompt,
                    CreateDialogFocus::Backend => CreateDialogFocus::RepoPath,
                    CreateDialogFocus::Agent => CreateDialogFocus::Backend,
                    CreateDialogFocus::AccessMode => CreateDialogFocus::Agent,
                    CreateDialogFocus::SkipChecks => CreateDialogFocus::AccessMode,
                    CreateDialogFocus::PlanMode => CreateDialogFocus::SkipChecks,
                    CreateDialogFocus::Buttons => CreateDialogFocus::PlanMode,
                };
            }
        }
        KeyCode::Down => {
            // Special handling for Prompt field - move cursor down, or navigate to next field if at bottom
            if app.create_dialog.focus == CreateDialogFocus::Prompt {
                let total_lines = app.create_dialog.prompt.lines().count().max(1);
                if app.create_dialog.prompt_cursor_line >= total_lines - 1 {
                    // At bottom of prompt, navigate to next field
                    app.create_dialog.focus = CreateDialogFocus::RepoPath;
                } else {
                    // Move cursor down within prompt
                    (
                        app.create_dialog.prompt_cursor_line,
                        app.create_dialog.prompt_cursor_col,
                    ) = super::text_input::move_cursor_down_multiline(
                        &app.create_dialog.prompt,
                        app.create_dialog.prompt_cursor_line,
                        app.create_dialog.prompt_cursor_col,
                    );
                    app.create_dialog.ensure_cursor_visible();
                }
            } else {
                // Navigate to next field
                app.create_dialog.focus = match app.create_dialog.focus {
                    CreateDialogFocus::Prompt => CreateDialogFocus::RepoPath,
                    CreateDialogFocus::RepoPath => CreateDialogFocus::Backend,
                    CreateDialogFocus::Backend => CreateDialogFocus::Agent,
                    CreateDialogFocus::Agent => CreateDialogFocus::AccessMode,
                    CreateDialogFocus::AccessMode => CreateDialogFocus::SkipChecks,
                    CreateDialogFocus::SkipChecks => CreateDialogFocus::PlanMode,
                    CreateDialogFocus::PlanMode => CreateDialogFocus::Buttons,
                    CreateDialogFocus::Buttons => CreateDialogFocus::Prompt,
                };
            }
        }
        KeyCode::Left | KeyCode::Right => match app.create_dialog.focus {
            CreateDialogFocus::Prompt => {
                (
                    app.create_dialog.prompt_cursor_line,
                    app.create_dialog.prompt_cursor_col,
                ) = if key.code == KeyCode::Left {
                    super::text_input::move_cursor_left_multiline(
                        &app.create_dialog.prompt,
                        app.create_dialog.prompt_cursor_line,
                        app.create_dialog.prompt_cursor_col,
                    )
                } else {
                    super::text_input::move_cursor_right_multiline(
                        &app.create_dialog.prompt,
                        app.create_dialog.prompt_cursor_line,
                        app.create_dialog.prompt_cursor_col,
                    )
                };
                app.create_dialog.ensure_cursor_visible();
            }
            CreateDialogFocus::Backend => {
                if key.code == KeyCode::Left {
                    app.create_dialog.toggle_backend_reverse();
                } else {
                    app.create_dialog.toggle_backend();
                }
            }
            CreateDialogFocus::Agent => {
                if key.code == KeyCode::Left {
                    app.create_dialog.toggle_agent_reverse();
                } else {
                    app.create_dialog.toggle_agent();
                }
            }
            CreateDialogFocus::AccessMode => {
                app.create_dialog.toggle_access_mode();
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
            CreateDialogFocus::RepoPath => {}
        },
        KeyCode::Char(' ') => match app.create_dialog.focus {
            CreateDialogFocus::Backend => {
                app.create_dialog.toggle_backend();
            }
            CreateDialogFocus::Agent => {
                app.create_dialog.toggle_agent();
            }
            CreateDialogFocus::AccessMode => {
                app.create_dialog.toggle_access_mode();
            }
            CreateDialogFocus::SkipChecks => {
                app.create_dialog.skip_checks = !app.create_dialog.skip_checks;
            }
            CreateDialogFocus::PlanMode => {
                app.create_dialog.plan_mode = !app.create_dialog.plan_mode;
            }
            CreateDialogFocus::Prompt => {
                (
                    app.create_dialog.prompt_cursor_line,
                    app.create_dialog.prompt_cursor_col,
                ) = super::text_input::insert_char_at_cursor_multiline(
                    &mut app.create_dialog.prompt,
                    app.create_dialog.prompt_cursor_line,
                    app.create_dialog.prompt_cursor_col,
                    ' ',
                );
                app.create_dialog.ensure_cursor_visible();
            }
            CreateDialogFocus::RepoPath => {
                // Load recent repos and open directory picker when space is pressed on RepoPath
                app.load_recent_repos().await;
                let initial_path = if app.create_dialog.repo_path.is_empty() {
                    None
                } else {
                    Some(crate::utils::expand_tilde(&app.create_dialog.repo_path))
                };
                app.create_dialog.directory_picker.open(initial_path);
            }
            CreateDialogFocus::Buttons => {}
        },
        KeyCode::Char(c) => match app.create_dialog.focus {
            CreateDialogFocus::Prompt => {
                (
                    app.create_dialog.prompt_cursor_line,
                    app.create_dialog.prompt_cursor_col,
                ) = super::text_input::insert_char_at_cursor_multiline(
                    &mut app.create_dialog.prompt,
                    app.create_dialog.prompt_cursor_line,
                    app.create_dialog.prompt_cursor_col,
                    c,
                );
                app.create_dialog.ensure_cursor_visible();
            }
            // RepoPath no longer accepts typed input - use directory picker instead
            _ => {}
        },
        KeyCode::Backspace => match app.create_dialog.focus {
            CreateDialogFocus::Prompt => {
                (
                    app.create_dialog.prompt_cursor_line,
                    app.create_dialog.prompt_cursor_col,
                ) = super::text_input::delete_char_before_cursor_multiline(
                    &mut app.create_dialog.prompt,
                    app.create_dialog.prompt_cursor_line,
                    app.create_dialog.prompt_cursor_col,
                );
                app.create_dialog.ensure_cursor_visible();
            }
            CreateDialogFocus::RepoPath => {
                // Clear the repo path on backspace
                app.create_dialog.repo_path.clear();
            }
            _ => {}
        },
        KeyCode::Delete => match app.create_dialog.focus {
            CreateDialogFocus::Prompt => {
                (
                    app.create_dialog.prompt_cursor_line,
                    app.create_dialog.prompt_cursor_col,
                ) = super::text_input::delete_char_at_cursor_multiline(
                    &mut app.create_dialog.prompt,
                    app.create_dialog.prompt_cursor_line,
                    app.create_dialog.prompt_cursor_col,
                );
                app.create_dialog.ensure_cursor_visible();
            }
            _ => {}
        },
        _ => {}
    }
    Ok(())
}

fn handle_directory_picker_key(app: &mut App, key: KeyEvent) {
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
}

fn handle_confirm_delete_key(app: &mut App, key: KeyEvent) {
    match key.code {
        KeyCode::Char('y' | 'Y') => {
            app.confirm_delete();
        }
        KeyCode::Char('n' | 'N') | KeyCode::Esc => {
            app.cancel_delete();
        }
        _ => {}
    }
}

fn handle_help_key(app: &mut App, key: KeyEvent) {
    match key.code {
        KeyCode::Esc | KeyCode::Char('?' | 'q') => {
            app.toggle_help();
        }
        _ => {}
    }
}

/// Handle key events in the reconcile error dialog.
///
/// Keys:
/// - R: Retry container recreation
/// - D: Delete the session
/// - Esc/q: Close the dialog
async fn handle_reconcile_error_key(app: &mut App, key: KeyEvent) -> anyhow::Result<()> {
    match key.code {
        KeyCode::Esc | KeyCode::Char('q') => {
            app.close_reconcile_error();
        }
        KeyCode::Char('R' | 'r') => {
            // Retry reconciliation for this session
            app.status_message = Some("Retrying container recreation...".to_string());
            app.close_reconcile_error();
            if let Err(e) = app.reconcile().await {
                app.status_message = Some(format!("Retry failed: {e}"));
            }
        }
        KeyCode::Char('D' | 'd') => {
            // Delete the session
            if let Some(session_id) = app.reconcile_error_session_id {
                app.pending_delete = Some(session_id.to_string());
                app.reconcile_error_session_id = None;
                app.mode = AppMode::ConfirmDelete;
            }
        }
        _ => {}
    }
    Ok(())
}

/// Handle key events when attached to a session via PTY.
///
/// Most keys are encoded and sent to the PTY. Special keys:
/// - Ctrl+Q: Detach instantly
/// - Ctrl+L: Toggle locked mode (forwards all keys to app)
/// - Ctrl+S: Enter scroll mode
/// - Ctrl+P/N: Switch between Docker sessions
async fn handle_attached_key(app: &mut App, key: KeyEvent) -> anyhow::Result<()> {
    use crate::tui::attached::encode_key;

    // Log key events for debugging (only in debug builds)
    #[cfg(debug_assertions)]
    tracing::debug!(
        "Key event: {:?} with modifiers {:?}",
        key.code,
        key.modifiers
    );

    // Ctrl+Q: instant detach (no double-tap delay)
    if key.modifiers.contains(KeyModifiers::CONTROL) {
        if key.code == KeyCode::Char('q') {
            app.detach();
            return Ok(());
        }
    }

    // Copy mode hotkey has been disabled to allow ESC to forward to applications.
    // Users can use mouse selection (select + CMD+C) to copy text instead.
    // Keyboard-only copy mode could be re-enabled with a different hotkey if needed.
    //
    // // Enter copy mode with Ctrl+[ (like tmux)
    // if key.modifiers.contains(KeyModifiers::CONTROL) {
    //     if let KeyCode::Char('[') = key.code {
    //         app.enter_copy_mode();
    //         return Ok(());
    //     }
    // }

    // Toggle locked mode with Ctrl+L
    if key.modifiers.contains(KeyModifiers::CONTROL) {
        if key.code == KeyCode::Char('l') {
            app.toggle_locked_mode();
            return Ok(());
        }
    }

    // Enter scroll mode with Ctrl+S
    if key.modifiers.contains(KeyModifiers::CONTROL) {
        if key.code == KeyCode::Char('s') {
            app.enter_scroll_mode();
            return Ok(());
        }
    }

    // Session switching with Ctrl+P/Ctrl+N
    // Note: Ctrl+Left/Right and Alt+Left/Right removed to avoid conflicts with applications
    if key.modifiers.contains(KeyModifiers::CONTROL) {
        match key.code {
            KeyCode::Char('p') => {
                if app.switch_to_previous_session().await? {
                    app.status_message = Some("Switched to previous session".to_string());
                }
                return Ok(());
            }
            KeyCode::Char('n') => {
                if app.switch_to_next_session().await? {
                    app.status_message = Some("Switched to next session".to_string());
                }
                return Ok(());
            }
            _ => {}
        }
    }

    // Scrolling is now mode-based (Ctrl+S enters Scroll mode).
    // PageUp/PageDown and Shift+Up/Down now forward to applications (less, vim, etc.)
    // when in Attached mode. Use Ctrl+S to enter Scroll mode for buffer scrolling.

    // Encode the key and send to PTY
    let encoded = encode_key(&key);
    if !encoded.is_empty() {
        // Reset scroll position when sending input to PTY (auto-scroll to bottom)
        // This ensures scrollback isn't disrupted when reviewing history with scroll keys
        if let Some(pty_session) = app.attached_pty_session() {
            let buffer = pty_session.terminal_buffer();
            if let Ok(mut buf) = buffer.try_lock() {
                buf.scroll_to_bottom();
            }
            // Silently ignore lock failures for scroll-to-bottom as it's non-critical
        }
        app.send_to_pty(encoded).await?;
    }

    Ok(())
}

/// Handle key events when in Locked mode.
///
/// In Locked mode, all keys are forwarded to the application except Ctrl+L which unlocks.
/// This provides an "escape hatch" when clauderon keybindings conflict with applications.
async fn handle_locked_key(app: &mut App, key: KeyEvent) -> anyhow::Result<()> {
    use crate::tui::attached::encode_key;

    // Ctrl+L: unlock and return to Attached mode
    if key.modifiers.contains(KeyModifiers::CONTROL) {
        if key.code == KeyCode::Char('l') {
            app.exit_locked_mode();
            return Ok(());
        }
    }

    // ALL other keys forward to PTY
    let encoded = encode_key(&key);
    if !encoded.is_empty() {
        app.send_to_pty(encoded).await?;
    }

    Ok(())
}

/// Handle key events when in Scroll mode.
///
/// In Scroll mode, arrow keys and page keys scroll the terminal buffer.
/// ESC, q, or Ctrl+S exits scroll mode.
fn handle_scroll_mode_key(app: &mut App, key: KeyEvent) {
    match key.code {
        KeyCode::Esc | KeyCode::Char('q') => {
            app.exit_scroll_mode();
        }
        KeyCode::Char('s') if key.modifiers.contains(KeyModifiers::CONTROL) => {
            app.exit_scroll_mode();
        }
        KeyCode::PageUp | KeyCode::Char('b') if key.modifiers.contains(KeyModifiers::CONTROL) => {
            if let Some(pty_session) = app.attached_pty_session() {
                let buffer = pty_session.terminal_buffer();
                if let Ok(mut buf) = buffer.try_lock() {
                    buf.scroll_up(SCROLL_LINES_PER_PAGE);
                }
            }
        }
        KeyCode::PageDown | KeyCode::Char('f') if key.modifiers.contains(KeyModifiers::CONTROL) => {
            if let Some(pty_session) = app.attached_pty_session() {
                let buffer = pty_session.terminal_buffer();
                if let Ok(mut buf) = buffer.try_lock() {
                    buf.scroll_down(SCROLL_LINES_PER_PAGE);
                }
            }
        }
        KeyCode::Up | KeyCode::Char('k') => {
            if let Some(pty_session) = app.attached_pty_session() {
                let buffer = pty_session.terminal_buffer();
                if let Ok(mut buf) = buffer.try_lock() {
                    buf.scroll_up(SCROLL_LINES_PER_ARROW);
                }
            }
        }
        KeyCode::Down | KeyCode::Char('j') => {
            if let Some(pty_session) = app.attached_pty_session() {
                let buffer = pty_session.terminal_buffer();
                if let Ok(mut buf) = buffer.try_lock() {
                    buf.scroll_down(SCROLL_LINES_PER_ARROW);
                }
            }
        }
        _ => {}
    }
}

/// Check if a pasted text string is an image file path
///
/// This enables drag-and-drop support in terminals that convert drops to paste events.
fn is_image_path(text: &str) -> bool {
    let path = std::path::Path::new(text);

    // Must exist as a file
    if !path.is_file() {
        return false;
    }

    // Check extension
    path.extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| {
            matches!(
                ext.to_lowercase().as_str(),
                "jpg" | "jpeg" | "png" | "gif" | "webp"
            )
        })
}
