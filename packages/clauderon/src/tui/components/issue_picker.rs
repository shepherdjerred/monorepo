use ratatui::{
    Frame,
    layout::{Alignment, Constraint, Direction, Layout, Rect},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, List, ListItem, ListState, Paragraph, Wrap},
};

use crate::tui::app::GitHubIssuePickerState;

/// Render the GitHub issue picker modal
pub fn render(frame: &mut Frame, state: &GitHubIssuePickerState, area: Rect) {
    if !state.is_active {
        return;
    }

    let block = Block::default()
        .title(" Select GitHub Issue ")
        .borders(Borders::ALL)
        .border_style(Style::default().fg(Color::Cyan));

    frame.render_widget(block, area);

    // Inner layout: search bar, list, help
    let inner = Layout::default()
        .direction(Direction::Vertical)
        .margin(1)
        .constraints([
            Constraint::Length(1), // Search query
            Constraint::Min(5),    // Issue list
            Constraint::Length(1), // Help text
        ])
        .split(area);

    // Search query
    render_search_query(frame, state, inner[0]);

    // Issue list
    render_issue_list(frame, state, inner[1]);

    // Help text
    render_help(frame, inner[2]);
}

fn render_search_query(frame: &mut Frame, state: &GitHubIssuePickerState, area: Rect) {
    let text = if state.loading {
        Line::from(vec![
            Span::styled(
                "Loading issues... ",
                Style::default().add_modifier(Modifier::BOLD),
            ),
            Span::styled("⏳", Style::default().fg(Color::Yellow)),
        ])
    } else if state.search_query.is_empty() {
        Line::from(vec![
            Span::styled("Search: ", Style::default().add_modifier(Modifier::BOLD)),
            Span::styled("(type to filter)", Style::default().fg(Color::DarkGray)),
        ])
    } else {
        Line::from(vec![
            Span::styled("Search: ", Style::default().add_modifier(Modifier::BOLD)),
            Span::styled(&state.search_query, Style::default().fg(Color::Green)),
            Span::styled("▏", Style::default().fg(Color::Green)),
        ])
    };

    let paragraph = Paragraph::new(text);
    frame.render_widget(paragraph, area);
}

fn render_issue_list(frame: &mut Frame, state: &GitHubIssuePickerState, area: Rect) {
    // Show error if present
    if let Some(error) = &state.error {
        let error_text = Line::from(Span::styled(error, Style::default().fg(Color::Red)));
        let paragraph = Paragraph::new(error_text);
        frame.render_widget(paragraph, area);
        return;
    }

    // Show loading indicator
    if state.loading {
        let loading_text = Line::from(Span::styled(
            "Fetching GitHub issues...",
            Style::default()
                .fg(Color::Yellow)
                .add_modifier(Modifier::ITALIC),
        ));
        let paragraph = Paragraph::new(loading_text);
        frame.render_widget(paragraph, area);
        return;
    }

    // Show "no results" if filtered list is empty
    if state.filtered_issues.is_empty() {
        let empty_text = if state.search_query.is_empty() {
            "No open issues found"
        } else {
            "No matching issues"
        };
        let paragraph = Paragraph::new(Line::from(Span::styled(
            empty_text,
            Style::default().fg(Color::DarkGray),
        )));
        frame.render_widget(paragraph, area);
        return;
    }

    // Create list items for issues
    let items: Vec<ListItem> = state
        .filtered_issues
        .iter()
        .enumerate()
        .map(|(idx, issue)| {
            let is_selected = idx == state.selected_index;

            // Format: #123 - Issue title [label1, label2]
            let mut spans = vec![
                Span::styled(
                    format!("#{} ", issue.number),
                    Style::default()
                        .fg(Color::Cyan)
                        .add_modifier(Modifier::BOLD),
                ),
                Span::raw("- "),
                Span::styled(
                    &issue.title,
                    Style::default().fg(if is_selected {
                        Color::Yellow
                    } else {
                        Color::White
                    }),
                ),
            ];

            // Add labels if present
            if !issue.labels.is_empty() {
                let labels_str = format!(" [{}]", issue.labels.join(", "));
                spans.push(Span::styled(
                    labels_str,
                    Style::default().fg(Color::Magenta),
                ));
            }

            let line = Line::from(spans);

            if is_selected {
                ListItem::new(line).style(
                    Style::default()
                        .bg(Color::DarkGray)
                        .add_modifier(Modifier::BOLD),
                )
            } else {
                ListItem::new(line)
            }
        })
        .collect();

    let list = List::new(items).block(
        Block::default()
            .borders(Borders::NONE)
            .style(Style::default()),
    );

    let mut list_state = ListState::default();
    list_state.select(Some(state.selected_index));

    frame.render_stateful_widget(list, area, &mut list_state);
}

fn render_help(frame: &mut Frame, area: Rect) {
    let help_text = Line::from(vec![
        Span::styled("↑↓", Style::default().fg(Color::Cyan)),
        Span::raw(" Navigate | "),
        Span::styled("Enter", Style::default().fg(Color::Cyan)),
        Span::raw(" Select | "),
        Span::styled("Esc", Style::default().fg(Color::Cyan)),
        Span::raw(" Close | "),
        Span::styled("Type", Style::default().fg(Color::Cyan)),
        Span::raw(" to filter"),
    ]);

    let paragraph = Paragraph::new(help_text).alignment(Alignment::Center);
    frame.render_widget(paragraph, area);
}
