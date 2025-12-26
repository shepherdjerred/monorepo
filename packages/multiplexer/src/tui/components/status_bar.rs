use ratatui::{
    Frame,
    layout::Rect,
    style::{Color, Style},
    text::{Line, Span},
    widgets::Paragraph,
};

use crate::tui::app::App;

/// Render the status bar
pub fn render(frame: &mut Frame, app: &App, area: Rect) {
    let status_text = app.status_message.as_ref().map_or_else(
        || {
            if app.is_connected() {
                format!("{} sessions", app.sessions.len())
            } else {
                "Disconnected".to_string()
            }
        },
        Clone::clone,
    );

    let connection_indicator = if app.is_connected() {
        Span::styled("●", Style::default().fg(Color::Green))
    } else {
        Span::styled("●", Style::default().fg(Color::Red))
    };

    let line = Line::from(vec![
        Span::raw(" "),
        connection_indicator,
        Span::raw(" "),
        Span::raw(status_text),
    ]);

    let paragraph = Paragraph::new(line).style(Style::default().bg(Color::DarkGray));

    frame.render_widget(paragraph, area);
}
