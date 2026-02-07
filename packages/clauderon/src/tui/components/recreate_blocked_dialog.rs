use ratatui::{
    Frame,
    layout::{Alignment, Constraint, Layout, Rect},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, Clear, Paragraph, Wrap},
};

use crate::tui::app::App;

/// Render the blocked recreate dialog
///
/// This dialog is shown when a session cannot be safely recreated
/// (e.g., Sprites with auto_destroy=true where data would be lost)
pub fn render(frame: &mut Frame, app: &App, area: Rect) {
    let Some(session) = app.get_recreate_session() else {
        return;
    };
    let Some(health) = app.get_recreate_session_health() else {
        return;
    };

    // Center the dialog
    let dialog_width = 60.min(area.width.saturating_sub(4));
    let dialog_height = 16.min(area.height.saturating_sub(4));

    let dialog_area = centered_rect(dialog_width, dialog_height, area);

    // Clear the background
    frame.render_widget(Clear, dialog_area);

    let block = Block::default()
        .title(" Cannot Recreate ")
        .title_style(Style::default().fg(Color::Red).add_modifier(Modifier::BOLD))
        .borders(Borders::ALL)
        .border_style(Style::default().fg(Color::Red));

    let inner = block.inner(dialog_area);
    frame.render_widget(block, dialog_area);

    // Layout
    let chunks = Layout::vertical([
        Constraint::Length(2), // Session info
        Constraint::Length(2), // Backend info
        Constraint::Length(1), // Spacer
        Constraint::Min(5),    // Warning message
        Constraint::Length(1), // Spacer
        Constraint::Length(2), // OK button
    ])
    .split(inner);

    // Session info
    let session_info = Line::from(vec![
        Span::styled("Session: ", Style::default().fg(Color::DarkGray)),
        Span::styled(&session.name, Style::default().add_modifier(Modifier::BOLD)),
    ]);
    frame.render_widget(
        Paragraph::new(session_info).alignment(Alignment::Left),
        chunks[0],
    );

    // Backend info
    let backend_info = Line::from(vec![
        Span::styled("Backend: ", Style::default().fg(Color::DarkGray)),
        Span::styled(
            format!("{:?}", health.backend_type),
            Style::default().add_modifier(Modifier::BOLD),
        ),
    ]);
    frame.render_widget(
        Paragraph::new(backend_info).alignment(Alignment::Left),
        chunks[1],
    );

    // Warning message
    let warning_lines = vec![
        Line::from(vec![Span::styled(
            "This session cannot be recreated.",
            Style::default().fg(Color::Red).add_modifier(Modifier::BOLD),
        )]),
        Line::from(""),
        Line::from("Uncommitted work and Claude conversation"),
        Line::from("history would be permanently lost."),
        Line::from(""),
        Line::from(vec![Span::styled(
            "To continue working:",
            Style::default().add_modifier(Modifier::BOLD),
        )]),
        Line::from("1. Push your changes to git"),
        Line::from("2. Create a new session"),
    ];

    let warning_paragraph = Paragraph::new(warning_lines)
        .wrap(Wrap { trim: true })
        .style(Style::default());
    frame.render_widget(warning_paragraph, chunks[3]);

    // OK button
    let ok_button = Line::from(vec![
        Span::styled(
            "[Enter/Esc]",
            Style::default()
                .fg(Color::DarkGray)
                .add_modifier(Modifier::BOLD),
        ),
        Span::raw(" OK"),
    ]);
    frame.render_widget(
        Paragraph::new(ok_button).alignment(Alignment::Center),
        chunks[5],
    );
}

/// Helper function to create a centered rectangle
fn centered_rect(width: u16, height: u16, area: Rect) -> Rect {
    let x = area.x + (area.width.saturating_sub(width)) / 2;
    let y = area.y + (area.height.saturating_sub(height)) / 2;

    Rect::new(x, y, width, height)
}
