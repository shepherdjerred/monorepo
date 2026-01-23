use ratatui::{
    Frame,
    layout::{Alignment, Constraint, Layout, Rect},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, Clear, Paragraph, Wrap},
};

use crate::core::session::{AvailableAction, ResourceState};
use crate::tui::app::App;

/// Render the recreate confirmation dialog
pub fn render(frame: &mut Frame, app: &App, area: Rect) {
    let Some(session) = app.get_recreate_session() else {
        return;
    };
    let Some(health) = app.get_recreate_session_health() else {
        return;
    };

    // Center the dialog
    let dialog_width = 65.min(area.width.saturating_sub(4));
    let base_height = if app.recreate_details_expanded {
        22
    } else {
        14
    };
    let dialog_height = base_height.min(area.height.saturating_sub(4));

    let dialog_area = centered_rect(dialog_width, dialog_height, area);

    // Clear the background
    frame.render_widget(Clear, dialog_area);

    let border_color = if health.data_safe {
        Color::Green
    } else {
        Color::Yellow
    };

    let block = Block::default()
        .title(" Session Actions ")
        .title_style(
            Style::default()
                .fg(border_color)
                .add_modifier(Modifier::BOLD),
        )
        .borders(Borders::ALL)
        .border_style(Style::default().fg(border_color));

    let inner = block.inner(dialog_area);
    frame.render_widget(block, dialog_area);

    // Layout
    let constraints = if app.recreate_details_expanded {
        vec![
            Constraint::Length(2), // Session info
            Constraint::Length(2), // Backend/Status
            Constraint::Length(3), // Description
            Constraint::Length(1), // Toggle details
            Constraint::Min(6),    // Details content
            Constraint::Length(2), // Buttons
        ]
    } else {
        vec![
            Constraint::Length(2), // Session info
            Constraint::Length(2), // Backend/Status
            Constraint::Length(3), // Description
            Constraint::Length(1), // Toggle details
            Constraint::Length(2), // Buttons
        ]
    };

    let chunks = Layout::vertical(constraints).split(inner);

    // Session info
    let session_info = Line::from(vec![
        Span::styled("Session: ", Style::default().fg(Color::DarkGray)),
        Span::styled(&session.name, Style::default().add_modifier(Modifier::BOLD)),
    ]);
    frame.render_widget(
        Paragraph::new(session_info).alignment(Alignment::Left),
        chunks[0],
    );

    // Backend and Status
    let status_text = get_state_display(&health.state);
    let status_color = get_state_color(&health.state);
    let backend_status = Line::from(vec![
        Span::styled("Backend: ", Style::default().fg(Color::DarkGray)),
        Span::styled(
            format!("{:?}", health.backend_type),
            Style::default().add_modifier(Modifier::BOLD),
        ),
        Span::raw("    "),
        Span::styled("Status: ", Style::default().fg(Color::DarkGray)),
        Span::styled(status_text, Style::default().fg(status_color)),
    ]);
    frame.render_widget(
        Paragraph::new(backend_status).alignment(Alignment::Left),
        chunks[1],
    );

    // Description
    let description = Paragraph::new(vec![Line::from(""), Line::from(health.description.clone())])
        .wrap(Wrap { trim: true })
        .style(Style::default());
    frame.render_widget(description, chunks[2]);

    // Toggle details
    let details_toggle = if app.recreate_details_expanded {
        Line::from(vec![
            Span::styled("[D]", Style::default().fg(Color::Cyan)),
            Span::raw(" Hide details"),
        ])
    } else {
        Line::from(vec![
            Span::styled("[D]", Style::default().fg(Color::Cyan)),
            Span::raw(" Show details"),
        ])
    };
    frame.render_widget(
        Paragraph::new(details_toggle).alignment(Alignment::Left),
        chunks[3],
    );

    // Details content (if expanded)
    if app.recreate_details_expanded && chunks.len() > 5 {
        let mut details_lines = vec![Line::from("")];

        // Data safety info
        if health.data_safe {
            details_lines.push(Line::from(vec![
                Span::styled("Data: ", Style::default().fg(Color::DarkGray)),
                Span::styled("Safe", Style::default().fg(Color::Green)),
                Span::raw(" - Your work will be preserved"),
            ]));
        } else {
            details_lines.push(Line::from(vec![
                Span::styled("Data: ", Style::default().fg(Color::DarkGray)),
                Span::styled("At Risk", Style::default().fg(Color::Red)),
                Span::raw(" - Some work may be lost"),
            ]));
        }

        // Technical details
        if !health.details.is_empty() {
            details_lines.push(Line::from(""));
            details_lines.push(Line::from(vec![Span::styled(
                "Technical Details:",
                Style::default()
                    .fg(Color::DarkGray)
                    .add_modifier(Modifier::BOLD),
            )]));
            for line in health.details.lines() {
                details_lines.push(Line::from(format!("  {line}")));
            }
        }

        let details_paragraph = Paragraph::new(details_lines)
            .wrap(Wrap { trim: true })
            .style(Style::default());
        frame.render_widget(details_paragraph, chunks[4]);
    }

    // Buttons - show available actions
    let button_chunk_idx = if app.recreate_details_expanded { 5 } else { 4 };
    let buttons = build_action_buttons(&health.available_actions);
    frame.render_widget(
        Paragraph::new(buttons).alignment(Alignment::Center),
        chunks[button_chunk_idx],
    );
}

/// Build the action buttons line based on available actions
fn build_action_buttons(actions: &[AvailableAction]) -> Line<'static> {
    let mut spans = Vec::new();

    for action in actions {
        if !spans.is_empty() {
            spans.push(Span::raw("   "));
        }

        match action {
            AvailableAction::Start => {
                spans.push(Span::styled(
                    "[S]",
                    Style::default()
                        .fg(Color::Green)
                        .add_modifier(Modifier::BOLD),
                ));
                spans.push(Span::raw(" Start"));
            }
            AvailableAction::Wake => {
                spans.push(Span::styled(
                    "[W]",
                    Style::default()
                        .fg(Color::Cyan)
                        .add_modifier(Modifier::BOLD),
                ));
                spans.push(Span::raw(" Wake"));
            }
            AvailableAction::Recreate => {
                spans.push(Span::styled(
                    "[R]",
                    Style::default()
                        .fg(Color::Yellow)
                        .add_modifier(Modifier::BOLD),
                ));
                spans.push(Span::raw(" Recreate"));
            }
            AvailableAction::RecreateFresh => {
                spans.push(Span::styled(
                    "[F]",
                    Style::default()
                        .fg(Color::Magenta)
                        .add_modifier(Modifier::BOLD),
                ));
                spans.push(Span::raw(" Recreate Fresh"));
            }
            AvailableAction::UpdateImage => {
                spans.push(Span::styled(
                    "[U]",
                    Style::default()
                        .fg(Color::Blue)
                        .add_modifier(Modifier::BOLD),
                ));
                spans.push(Span::raw(" Update Image"));
            }
            AvailableAction::Cleanup => {
                spans.push(Span::styled(
                    "[C]",
                    Style::default().fg(Color::Red).add_modifier(Modifier::BOLD),
                ));
                spans.push(Span::raw(" Cleanup"));
            }
        }
    }

    // Always add Esc to close
    if !spans.is_empty() {
        spans.push(Span::raw("   "));
    }
    spans.push(Span::styled(
        "[Esc]",
        Style::default()
            .fg(Color::DarkGray)
            .add_modifier(Modifier::BOLD),
    ));
    spans.push(Span::raw(" Cancel"));

    Line::from(spans)
}

/// Get display text for resource state
fn get_state_display(state: &ResourceState) -> &'static str {
    match state {
        ResourceState::Healthy => "OK",
        ResourceState::Stopped => "Stopped",
        ResourceState::Hibernated => "Hibernated",
        ResourceState::Pending => "Pending",
        ResourceState::Missing => "Missing",
        ResourceState::Error { .. } => "Error",
        ResourceState::CrashLoop => "Crash Loop",
        ResourceState::DeletedExternally => "Deleted Externally",
        ResourceState::DataLost { .. } => "Data Lost",
        ResourceState::WorktreeMissing => "Worktree Missing",
    }
}

/// Get color for resource state
fn get_state_color(state: &ResourceState) -> Color {
    match state {
        ResourceState::Healthy => Color::Green,
        ResourceState::Stopped | ResourceState::Hibernated | ResourceState::Pending => {
            Color::Yellow
        }
        ResourceState::Missing => Color::LightYellow,
        ResourceState::Error { .. }
        | ResourceState::CrashLoop
        | ResourceState::DeletedExternally
        | ResourceState::DataLost { .. }
        | ResourceState::WorktreeMissing => Color::Red,
    }
}

/// Helper function to create a centered rectangle
fn centered_rect(width: u16, height: u16, area: Rect) -> Rect {
    let x = area.x + (area.width.saturating_sub(width)) / 2;
    let y = area.y + (area.height.saturating_sub(height)) / 2;

    Rect::new(x, y, width, height)
}
