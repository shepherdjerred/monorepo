use std::time::Duration;

use crossterm::event::{self, Event, KeyCode, KeyEvent, KeyModifiers};

use super::app::{App, AppMode, CreateDialogFocus};

/// Poll for events with a timeout
///
/// # Errors
///
/// Returns an error if event polling fails.
pub fn poll_event(timeout: Duration) -> anyhow::Result<Option<Event>> {
    if event::poll(timeout)? {
        Ok(Some(event::read()?))
    } else {
        Ok(None)
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
    match key.code {
        KeyCode::Esc => {
            app.close_create_dialog();
        }
        KeyCode::Tab => {
            // Cycle through fields
            app.create_dialog.focus = match app.create_dialog.focus {
                CreateDialogFocus::Name => CreateDialogFocus::Prompt,
                CreateDialogFocus::Prompt => CreateDialogFocus::RepoPath,
                CreateDialogFocus::RepoPath => CreateDialogFocus::Backend,
                CreateDialogFocus::Backend => CreateDialogFocus::SkipChecks,
                CreateDialogFocus::SkipChecks => CreateDialogFocus::Buttons,
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
                CreateDialogFocus::Buttons => CreateDialogFocus::SkipChecks,
            };
        }
        KeyCode::Enter => {
            if app.create_dialog.focus == CreateDialogFocus::Buttons {
                if app.create_dialog.button_create_focused {
                    if let Err(e) = app.create_session_from_dialog().await {
                        app.status_message = Some(format!("Create failed: {e}"));
                    }
                } else {
                    app.close_create_dialog();
                }
            }
        }
        KeyCode::Left | KeyCode::Right => match app.create_dialog.focus {
            CreateDialogFocus::Backend => {
                app.create_dialog.backend_zellij = !app.create_dialog.backend_zellij;
            }
            CreateDialogFocus::SkipChecks => {
                app.create_dialog.skip_checks = !app.create_dialog.skip_checks;
            }
            CreateDialogFocus::Buttons => {
                app.create_dialog.button_create_focused = !app.create_dialog.button_create_focused;
            }
            _ => {}
        },
        KeyCode::Char(' ') => match app.create_dialog.focus {
            CreateDialogFocus::Backend => {
                app.create_dialog.backend_zellij = !app.create_dialog.backend_zellij;
            }
            CreateDialogFocus::SkipChecks => {
                app.create_dialog.skip_checks = !app.create_dialog.skip_checks;
            }
            _ => {}
        },
        KeyCode::Char(c) => match app.create_dialog.focus {
            CreateDialogFocus::Name => app.create_dialog.name.push(c),
            CreateDialogFocus::Prompt => app.create_dialog.prompt.push(c),
            CreateDialogFocus::RepoPath => app.create_dialog.repo_path.push(c),
            _ => {}
        },
        KeyCode::Backspace => match app.create_dialog.focus {
            CreateDialogFocus::Name => {
                app.create_dialog.name.pop();
            }
            CreateDialogFocus::Prompt => {
                app.create_dialog.prompt.pop();
            }
            CreateDialogFocus::RepoPath => {
                app.create_dialog.repo_path.pop();
            }
            _ => {}
        },
        _ => {}
    }
    Ok(())
}

async fn handle_confirm_delete_key(app: &mut App, key: KeyEvent) -> anyhow::Result<()> {
    match key.code {
        KeyCode::Char('y' | 'Y') => {
            if let Err(e) = app.confirm_delete().await {
                app.status_message = Some(format!("Delete failed: {e}"));
                app.cancel_delete();
            }
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
