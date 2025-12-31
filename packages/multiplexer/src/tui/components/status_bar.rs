use ratatui::{
    Frame,
    layout::Rect,
    style::{Color, Style},
    text::{Line, Span},
    widgets::Paragraph,
};

use crate::tui::app::{App, AppMode};

/// Render the status bar
pub fn render(frame: &mut Frame, app: &App, area: Rect) {
    let line = if app.mode == AppMode::Attached {
        render_attached_status(app)
    } else {
        render_normal_status(app)
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
                format!(" [scroll: {}]", buf.scroll_offset())
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
        Span::styled("Ctrl+]", Style::default().fg(Color::Cyan)),
        Span::raw(" detach "),
        Span::styled("Ctrl+←/→", Style::default().fg(Color::Cyan)),
        Span::raw(" switch "),
        Span::styled("Shift+PgUp/Dn", Style::default().fg(Color::Cyan)),
        Span::raw(" scroll"),
    ])
}

/// Render status bar for normal mode
fn render_normal_status(app: &App) -> Line<'static> {
    let status_text = app.status_message.clone().unwrap_or_else(|| {
        if app.is_connected() {
            format!("{} sessions", app.sessions.len())
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
