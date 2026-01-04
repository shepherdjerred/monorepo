use ratatui::{
    Frame,
    layout::Rect,
    style::{Color, Style},
    text::{Line, Span},
    widgets::Paragraph,
};

use crate::tui::app::{App, AppMode};

// Platform-specific scrolling key hints
#[cfg(target_os = "macos")]
const SCROLL_KEYS_SHORT: &str = "Fn+Opt+↑/↓";
#[cfg(not(target_os = "macos"))]
const SCROLL_KEYS_SHORT: &str = "PgUp/Dn";

#[cfg(target_os = "macos")]
const SCROLL_TO_BOTTOM: &str = "Fn+Opt+↓";
#[cfg(not(target_os = "macos"))]
const SCROLL_TO_BOTTOM: &str = "PgDn";

/// Render the status bar
pub fn render(frame: &mut Frame, app: &App, area: Rect) {
    let line = match app.mode {
        AppMode::Attached => render_attached_status(app),
        AppMode::CopyMode => render_copy_mode_status(app),
        AppMode::Locked => render_locked_status(app),
        AppMode::Scroll => render_scroll_status(app),
        _ => render_normal_status(app),
    };

    let paragraph = Paragraph::new(line).style(Style::default().bg(Color::DarkGray));
    frame.render_widget(paragraph, area);
}

/// Render status bar for attached mode
fn render_attached_status(app: &App) -> Line<'static> {
    let session_name = app
        .attached_session_id
        .and_then(|id| app.sessions.iter().find(|s| s.id == id))
        .map(|s| s.name.clone())
        .unwrap_or_else(|| "Unknown".to_string());

    // Check scroll position
    let scroll_indicator = if let Some(pty_session) = app.attached_pty_session() {
        let buffer = pty_session.terminal_buffer();
        if let Ok(buf) = buffer.try_lock() {
            if !buf.is_at_bottom() {
                format!(" [SCROLLED - Ctrl+S then {SCROLL_TO_BOTTOM} to bottom]")
            } else {
                String::new()
            }
        } else {
            String::new()
        }
    } else {
        String::new()
    };

    Line::from(vec![
        Span::raw(" "),
        Span::styled("●", Style::default().fg(Color::Green)),
        Span::raw(" "),
        Span::styled("ATTACHED", Style::default().fg(Color::Green)),
        Span::raw(" "),
        Span::raw(session_name),
        Span::styled(scroll_indicator, Style::default().fg(Color::Yellow)),
        Span::raw(" │ "),
        Span::styled("Ctrl+Q", Style::default().fg(Color::Cyan)),
        Span::raw(" detach │ "),
        Span::styled("Ctrl+P/N", Style::default().fg(Color::Cyan)),
        Span::raw(" switch │ "),
        Span::styled("Ctrl+S", Style::default().fg(Color::Cyan)),
        Span::raw(" scroll │ "),
        Span::styled("Ctrl+L", Style::default().fg(Color::Cyan)),
        Span::raw(" lock │ "),
        Span::styled("?", Style::default().fg(Color::Cyan)),
        Span::raw(" help"),
    ])
}

/// Render status bar for copy mode
fn render_copy_mode_status(app: &App) -> Line<'static> {
    let is_visual = app
        .copy_mode_state
        .as_ref()
        .map(|s| s.visual_mode)
        .unwrap_or(false);

    if is_visual {
        Line::from(vec![
            Span::raw(" "),
            Span::styled("●", Style::default().fg(Color::Yellow)),
            Span::raw(" "),
            Span::styled("VISUAL", Style::default().fg(Color::Yellow)),
            Span::raw(" │ "),
            Span::styled("hjkl", Style::default().fg(Color::Cyan)),
            Span::raw(" move │ "),
            Span::styled("y", Style::default().fg(Color::Cyan)),
            Span::raw(" yank │ "),
            Span::styled("v", Style::default().fg(Color::Cyan)),
            Span::raw(" cancel │ "),
            Span::styled("q/Esc", Style::default().fg(Color::Cyan)),
            Span::raw(" exit"),
        ])
    } else {
        Line::from(vec![
            Span::raw(" "),
            Span::styled("●", Style::default().fg(Color::Magenta)),
            Span::raw(" "),
            Span::styled("COPY MODE", Style::default().fg(Color::Magenta)),
            Span::raw(" │ "),
            Span::styled("hjkl", Style::default().fg(Color::Cyan)),
            Span::raw(" move │ "),
            Span::styled("v", Style::default().fg(Color::Cyan)),
            Span::raw(" select │ "),
            Span::styled(SCROLL_KEYS_SHORT, Style::default().fg(Color::Cyan)),
            Span::raw(" scroll │ "),
            Span::styled("q/Esc", Style::default().fg(Color::Cyan)),
            Span::raw(" exit │ "),
            Span::styled("?", Style::default().fg(Color::Cyan)),
            Span::raw(" help"),
        ])
    }
}

/// Render status bar for locked mode
fn render_locked_status(_app: &App) -> Line<'static> {
    Line::from(vec![
        Span::raw(" "),
        Span::styled("🔒", Style::default().fg(Color::Red)),
        Span::raw(" "),
        Span::styled("LOCKED", Style::default().fg(Color::Red)),
        Span::raw(" - All keys forwarded to application │ "),
        Span::styled("Ctrl+L", Style::default().fg(Color::Cyan)),
        Span::raw(" to unlock"),
    ])
}

/// Render status bar for scroll mode
fn render_scroll_status(_app: &App) -> Line<'static> {
    Line::from(vec![
        Span::raw(" "),
        Span::styled("📜", Style::default().fg(Color::Cyan)),
        Span::raw(" "),
        Span::styled("SCROLL MODE", Style::default().fg(Color::Cyan)),
        Span::raw(" │ "),
        Span::styled("↑/↓", Style::default().fg(Color::Yellow)),
        Span::raw(" or "),
        Span::styled("j/k", Style::default().fg(Color::Yellow)),
        Span::raw(" line │ "),
        Span::styled(SCROLL_KEYS_SHORT, Style::default().fg(Color::Yellow)),
        Span::raw(" or "),
        Span::styled("Ctrl+b/f", Style::default().fg(Color::Yellow)),
        Span::raw(" page │ "),
        Span::styled("ESC/q", Style::default().fg(Color::Cyan)),
        Span::raw(" exit"),
    ])
}

/// Render status bar for normal mode
fn render_normal_status(app: &App) -> Line<'static> {
    let status_text = app.status_message.clone().unwrap_or_else(|| {
        if app.is_connected() {
            format!("{count} sessions", count = app.sessions.len())
        } else {
            "Disconnected".to_string()
        }
    });

    let connection_indicator = if app.is_connected() {
        Span::styled("●", Style::default().fg(Color::Green))
    } else {
        Span::styled("●", Style::default().fg(Color::Red))
    };

    Line::from(vec![
        Span::raw(" "),
        connection_indicator,
        Span::raw(" "),
        Span::raw(status_text),
    ])
}
