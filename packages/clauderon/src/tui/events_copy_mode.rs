//! Copy mode event handling for terminal text selection

use crate::tui::app::App;
use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};

/// Number of lines to scroll per page in copy mode
const SCROLL_LINES_PER_PAGE: usize = 10;

/// Handle keyboard input in copy mode
pub(super) async fn handle_copy_mode_key(app: &mut App, key: KeyEvent) -> anyhow::Result<()> {
    // Get terminal bounds from the buffer first, before mutably borrowing copy_mode_state
    let (max_rows, max_cols) = app
        .attached_pty_session()
        .and_then(|pty_session| {
            let buffer = pty_session.terminal_buffer();
            buffer.try_lock().ok().map(|buf| {
                let screen = buf.screen();
                (screen.size().0, screen.size().1)
            })
        })
        .unwrap_or(app.terminal_size);

    #[expect(clippy::expect_used, reason = "copy mode handler is only called when copy_mode_state is Some")]
    let state = app.copy_mode_state.as_mut().expect("copy mode state");

    match key.code {
        // Exit copy mode
        KeyCode::Esc | KeyCode::Char('q') => {
            app.exit_copy_mode();
        }

        // Movement - Vi style with bounds checking
        KeyCode::Char('h') | KeyCode::Left => {
            state.cursor_col = state.cursor_col.saturating_sub(1);
            if state.visual_mode {
                state.selection_end = Some((state.cursor_row, state.cursor_col));
            }
        }
        KeyCode::Char('j') | KeyCode::Down => {
            state.cursor_row = state
                .cursor_row
                .saturating_add(1)
                .min(max_rows.saturating_sub(1));
            if state.visual_mode {
                state.selection_end = Some((state.cursor_row, state.cursor_col));
            }
        }
        KeyCode::Char('k') | KeyCode::Up => {
            state.cursor_row = state.cursor_row.saturating_sub(1);
            if state.visual_mode {
                state.selection_end = Some((state.cursor_row, state.cursor_col));
            }
        }
        KeyCode::Char('l') | KeyCode::Right => {
            state.cursor_col = state
                .cursor_col
                .saturating_add(1)
                .min(max_cols.saturating_sub(1));
            if state.visual_mode {
                state.selection_end = Some((state.cursor_row, state.cursor_col));
            }
        }

        // Page movement
        KeyCode::PageUp | KeyCode::Char('b') if key.modifiers.contains(KeyModifiers::CONTROL) => {
            // Scroll up one page
            if let Some(pty_session) = app.attached_pty_session() {
                let buffer = pty_session.terminal_buffer();
                if let Ok(mut buf) = buffer.try_lock() {
                    buf.scroll_up(SCROLL_LINES_PER_PAGE);
                }
            }
        }
        KeyCode::PageDown | KeyCode::Char('f') if key.modifiers.contains(KeyModifiers::CONTROL) => {
            // Scroll down one page
            if let Some(pty_session) = app.attached_pty_session() {
                let buffer = pty_session.terminal_buffer();
                if let Ok(mut buf) = buffer.try_lock() {
                    buf.scroll_down(SCROLL_LINES_PER_PAGE);
                }
            }
        }

        // Visual selection
        KeyCode::Char('v') => {
            if !state.visual_mode {
                // Enter visual mode
                state.visual_mode = true;
                state.selection_start = Some((state.cursor_row, state.cursor_col));
                state.selection_end = Some((state.cursor_row, state.cursor_col));
                app.status_message = Some("VISUAL - hjkl to select, y to yank".to_owned());
            } else {
                // Exit visual mode
                state.visual_mode = false;
                state.selection_start = None;
                state.selection_end = None;
                app.status_message = Some("Copy mode".to_owned());
            }
        }

        // Yank (copy) selection
        KeyCode::Char('y') => {
            if state.visual_mode {
                if let Err(e) = copy_selection_to_clipboard(app) {
                    app.status_message = Some(format!(
                        "Copy failed: {}. Press v to cancel selection or q to exit.",
                        e
                    ));
                    // Don't exit copy mode on error - user can retry or cancel
                } else {
                    app.status_message = Some("Yanked to clipboard".to_owned());
                    app.exit_copy_mode();
                }
            }
        }

        _ => {}
    }

    Ok(())
}

/// Copy the selected text to system clipboard
fn copy_selection_to_clipboard(app: &App) -> anyhow::Result<()> {
    use arboard::Clipboard;

    #[expect(clippy::expect_used, reason = "copy handler is only called when copy_mode_state is Some")]
    let state = app.copy_mode_state.as_ref().expect("copy mode state");

    if let (Some(start), Some(end)) = (state.selection_start, state.selection_end) {
        // Get text from terminal buffer
        if let Some(pty_session) = app.attached_pty_session() {
            let buffer = pty_session.terminal_buffer();
            if let Ok(buf) = buffer.try_lock() {
                let screen = buf.screen();

                // Extract text between start and end
                let text = extract_text_between(screen, start, end);

                // Copy to clipboard
                let mut clipboard = Clipboard::new()?;
                clipboard.set_text(text)?;
            }
        }
    }

    Ok(())
}

/// Extract text between two positions from the screen
fn extract_text_between(screen: &vt100::Screen, start: (u16, u16), end: (u16, u16)) -> String {
    // Normalize start/end (ensure start is before end)
    let (start, end) = if start.0 < end.0 || (start.0 == end.0 && start.1 <= end.1) {
        (start, end)
    } else {
        (end, start)
    };

    let mut text = String::new();
    let max_row = screen.size().0;
    let max_col = screen.size().1;

    // Clamp coordinates to screen bounds
    let start = (
        start.0.min(max_row.saturating_sub(1)),
        start.1.min(max_col.saturating_sub(1)),
    );
    let end = (
        end.0.min(max_row.saturating_sub(1)),
        end.1.min(max_col.saturating_sub(1)),
    );

    // Single line selection
    if start.0 == end.0 {
        for col in start.1..=end.1 {
            if let Some(cell) = screen.cell(start.0, col) {
                text.push_str(cell.contents());
            }
        }
        // Trim trailing whitespace for single line
        text = text.trim_end().to_owned();
    } else {
        // Multi-line selection
        // First line (from start.1 to end of line)
        let mut line = String::new();
        for col in start.1..max_col {
            if let Some(cell) = screen.cell(start.0, col) {
                line.push_str(cell.contents());
            }
        }
        text.push_str(line.trim_end());
        text.push('\n');

        // Middle lines (full lines) - with bounds check
        for row in (start.0 + 1)..end.0.min(max_row) {
            let mut line = String::new();
            for col in 0..max_col {
                if let Some(cell) = screen.cell(row, col) {
                    line.push_str(cell.contents());
                }
            }
            text.push_str(line.trim_end());
            text.push('\n');
        }

        // Last line (from 0 to end.1)
        let mut line = String::new();
        for col in 0..=end.1 {
            if let Some(cell) = screen.cell(end.0, col) {
                line.push_str(cell.contents());
            }
        }
        text.push_str(line.trim_end());
    }

    text
}
