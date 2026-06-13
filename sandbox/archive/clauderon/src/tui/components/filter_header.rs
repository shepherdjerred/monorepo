use ratatui::{
    Frame,
    layout::Rect,
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::Paragraph,
};

use crate::tui::app::{App, SessionFilter};

/// Render the filter header showing available filters with counts
pub fn render(frame: &mut Frame<'_>, app: &App, area: Rect) {
    let filters = [
        SessionFilter::All,
        SessionFilter::Running,
        SessionFilter::Idle,
        SessionFilter::Completed,
        SessionFilter::Archived,
    ];

    let mut spans = Vec::new();

    for (idx, filter) in filters.iter().enumerate() {
        let count = app.get_filter_count(*filter);
        let filter_name = filter.display_name();
        let is_active = *filter == app.session_filter;

        // Add separator between filters
        if idx > 0 {
            spans.push(Span::raw(" | "));
        }

        // Number prefix
        let number = format!("[{}] ", idx + 1);
        spans.push(Span::styled(number, Style::default().fg(Color::DarkGray)));

        // Filter name and count
        let text = format!("{filter_name} ({count})");
        let style = if is_active {
            Style::default()
                .fg(Color::Black)
                .bg(Color::White)
                .add_modifier(Modifier::BOLD)
        } else {
            Style::default().fg(Color::White)
        };
        spans.push(Span::styled(text, style));
    }

    let line = Line::from(spans);
    let paragraph = Paragraph::new(line).style(Style::default().bg(Color::Black));
    frame.render_widget(paragraph, area);
}
