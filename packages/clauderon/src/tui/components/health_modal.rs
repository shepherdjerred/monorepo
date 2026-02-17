//! Startup health modal component
//!
//! Shows a modal on startup when sessions have missing containers or other health issues.

use ratatui::{
    Frame,
    layout::{Alignment, Constraint, Layout, Rect},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, Clear, List, ListItem, Paragraph},
};

use crate::core::session::ResourceState;
use crate::tui::app::App;

/// Render the startup health modal
pub fn render(frame: &mut Frame<'_>, app: &App, area: Rect) {
    let sessions = app.sessions_needing_attention();
    if sessions.is_empty() {
        return;
    }

    // Calculate dialog size based on content
    let dialog_width = 60.min(area.width.saturating_sub(4));
    let session_count = sessions.len();
    // 4 lines for header/title + 2 for buttons + session count (capped at 8)
    #[expect(
        clippy::cast_possible_truncation,
        reason = "capped at 8, well within u16 range"
    )]
    let dialog_height = (6 + session_count.min(8) as u16).min(area.height.saturating_sub(4));

    let dialog_area = centered_rect(dialog_width, dialog_height, area);

    // Clear the background
    frame.render_widget(Clear, dialog_area);

    let block = Block::default()
        .title(" Sessions Need Attention ")
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
        Constraint::Length(2), // Description text
        Constraint::Min(3),    // Session list
        Constraint::Length(2), // Buttons
    ])
    .split(inner);

    // Description text
    let desc = if session_count == 1 {
        "1 session has a missing or unhealthy container:"
    } else {
        "Some sessions have missing or unhealthy containers:"
    };
    let description = Paragraph::new(desc)
        .style(Style::default().fg(Color::White))
        .alignment(Alignment::Left);
    frame.render_widget(description, chunks[0]);

    // Session list
    let items: Vec<ListItem<'_>> = sessions
        .iter()
        .take(8) // Cap at 8 to avoid overflow
        .map(|report| {
            let (state_text, state_color) = state_display(&report.state);
            ListItem::new(Line::from(vec![
                Span::styled("  ", Style::default()),
                Span::styled(
                    format!("{:<20}", truncate(&report.session_name, 20)),
                    Style::default().add_modifier(Modifier::BOLD),
                ),
                Span::styled(" - ", Style::default().fg(Color::DarkGray)),
                Span::styled(state_text, Style::default().fg(state_color)),
            ]))
        })
        .collect();

    let more_text = if session_count > 8 {
        format!("  ... and {} more", session_count - 8)
    } else {
        String::new()
    };

    let mut list_items = items;
    if !more_text.is_empty() {
        list_items.push(ListItem::new(Line::from(Span::styled(
            more_text,
            Style::default().fg(Color::DarkGray),
        ))));
    }

    let list = List::new(list_items);
    frame.render_widget(list, chunks[1]);

    // Buttons
    let buttons = Line::from(vec![
        Span::styled(
            "[Enter]",
            Style::default()
                .fg(Color::Green)
                .add_modifier(Modifier::BOLD),
        ),
        Span::raw(" View Sessions   "),
        Span::styled(
            "[Esc]",
            Style::default()
                .fg(Color::DarkGray)
                .add_modifier(Modifier::BOLD),
        ),
        Span::raw(" Dismiss"),
    ]);
    frame.render_widget(
        Paragraph::new(buttons).alignment(Alignment::Center),
        chunks[2],
    );
}

/// Get display text and color for a resource state
fn state_display(state: &ResourceState) -> (&'static str, Color) {
    match state {
        ResourceState::Healthy => ("OK", Color::Green),
        ResourceState::Stopped => ("Stopped", Color::Yellow),
        ResourceState::Hibernated => ("Hibernated", Color::Cyan),
        ResourceState::Pending => ("Pending", Color::Yellow),
        ResourceState::Missing => ("Missing", Color::Red),
        ResourceState::Error { .. } => ("Error", Color::Red),
        ResourceState::CrashLoop => ("Crash Loop", Color::Red),
        ResourceState::DeletedExternally => ("Deleted", Color::Red),
        ResourceState::DataLost { .. } => ("Data Lost", Color::Magenta),
        ResourceState::WorktreeMissing => ("No Worktree", Color::Red),
    }
}

/// Truncate a string to max length with ellipsis
fn truncate(s: &str, max_len: usize) -> String {
    if s.len() <= max_len {
        s.to_owned()
    } else {
        format!("{}...", &s[..max_len.saturating_sub(3)])
    }
}

/// Helper function to create a centered rectangle
fn centered_rect(width: u16, height: u16, area: Rect) -> Rect {
    let x = area.x + (area.width.saturating_sub(width)) / 2;
    let y = area.y + (area.height.saturating_sub(height)) / 2;

    Rect::new(x, y, width, height)
}
