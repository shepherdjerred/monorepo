use chrono::Utc;
use ratatui::{
    Frame,
    layout::{Alignment, Constraint, Layout, Rect},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, Clear, Paragraph, Wrap},
};

use crate::core::manager::MAX_RECONCILE_ATTEMPTS;
use crate::tui::app::App;

/// Render the reconcile error dialog
pub fn render(frame: &mut Frame, app: &App, area: Rect) {
    let Some(session) = app.reconcile_error_session() else {
        return;
    };

    // Center the dialog
    let dialog_width = 60.min(area.width.saturating_sub(4));
    let dialog_height = 14.min(area.height.saturating_sub(4));

    let dialog_area = centered_rect(dialog_width, dialog_height, area);

    // Clear the background
    frame.render_widget(Clear, dialog_area);

    let block = Block::default()
        .title(" Container Recreation Error ")
        .title_style(
            Style::default()
                .fg(Color::Yellow)
                .add_modifier(Modifier::BOLD),
        )
        .borders(Borders::ALL)
        .border_style(Style::default().fg(Color::Yellow));

    let inner = block.inner(dialog_area);
    frame.render_widget(block, dialog_area);

    // Split inner area for content
    let chunks = Layout::vertical([
        Constraint::Length(2), // Session info
        Constraint::Length(2), // Attempts info
        Constraint::Min(3),    // Error message
        Constraint::Length(2), // Buttons
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

    // Attempts info with time since last attempt
    let time_ago = session
        .last_reconcile_at
        .map(|t| {
            let duration = Utc::now().signed_duration_since(t);
            if duration.num_minutes() < 1 {
                format!("{} seconds ago", duration.num_seconds())
            } else if duration.num_hours() < 1 {
                format!("{} minutes ago", duration.num_minutes())
            } else {
                format!("{} hours ago", duration.num_hours())
            }
        })
        .unwrap_or_else(|| "unknown".to_string());

    let attempts_info = Line::from(vec![
        Span::styled("Attempts: ", Style::default().fg(Color::DarkGray)),
        Span::styled(
            format!("{}/{}", session.reconcile_attempts, MAX_RECONCILE_ATTEMPTS),
            Style::default()
                .fg(if session.reconcile_attempts >= MAX_RECONCILE_ATTEMPTS {
                    Color::Red
                } else {
                    Color::Yellow
                })
                .add_modifier(Modifier::BOLD),
        ),
        Span::raw("  "),
        Span::styled("Last attempt: ", Style::default().fg(Color::DarkGray)),
        Span::raw(time_ago),
    ]);
    frame.render_widget(
        Paragraph::new(attempts_info).alignment(Alignment::Left),
        chunks[1],
    );

    // Error message
    let error_label = Line::from(vec![Span::styled(
        "Error:",
        Style::default().fg(Color::Red).add_modifier(Modifier::BOLD),
    )]);

    let error_msg = session
        .last_reconcile_error
        .as_deref()
        .unwrap_or("Unknown error");

    let error_paragraph = Paragraph::new(vec![error_label, Line::from(Span::raw(error_msg))])
        .wrap(Wrap { trim: true })
        .style(Style::default());

    frame.render_widget(error_paragraph, chunks[2]);

    // Buttons
    let buttons = Line::from(vec![
        Span::styled(
            "[R]",
            Style::default()
                .fg(Color::Green)
                .add_modifier(Modifier::BOLD),
        ),
        Span::raw(" Retry   "),
        Span::styled(
            "[D]",
            Style::default().fg(Color::Red).add_modifier(Modifier::BOLD),
        ),
        Span::raw(" Delete Session   "),
        Span::styled(
            "[Esc]",
            Style::default()
                .fg(Color::DarkGray)
                .add_modifier(Modifier::BOLD),
        ),
        Span::raw(" Close"),
    ]);
    frame.render_widget(
        Paragraph::new(buttons).alignment(Alignment::Center),
        chunks[3],
    );
}

/// Helper function to create a centered rectangle
fn centered_rect(width: u16, height: u16, area: Rect) -> Rect {
    let x = area.x + (area.width.saturating_sub(width)) / 2;
    let y = area.y + (area.height.saturating_sub(height)) / 2;

    Rect::new(x, y, width, height)
}
