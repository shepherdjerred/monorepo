use ratatui::{
    Frame,
    layout::{Alignment, Constraint, Direction, Layout, Rect},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, List, ListItem, ListState, Paragraph},
};

use crate::tui::app::DirectoryPickerState;

/// Render the directory picker modal
pub fn render(frame: &mut Frame, state: &DirectoryPickerState, area: Rect) {
    if !state.is_active {
        return;
    }

    let block = Block::default()
        .title(" Select Directory ")
        .borders(Borders::ALL)
        .border_style(Style::default().fg(Color::Cyan));

    frame.render_widget(block, area);

    // Inner layout: current path, search bar, list, help
    let inner = Layout::default()
        .direction(Direction::Vertical)
        .margin(1)
        .constraints([
            Constraint::Length(1), // Current path
            Constraint::Length(1), // Search query
            Constraint::Min(5),    // Directory list
            Constraint::Length(1), // Help text
        ])
        .split(area);

    // Current path
    render_current_path(frame, state, inner[0]);

    // Search query
    render_search_query(frame, state, inner[1]);

    // Directory list
    render_directory_list(frame, state, inner[2]);

    // Help text
    render_help(frame, inner[3]);
}

fn render_current_path(frame: &mut Frame, state: &DirectoryPickerState, area: Rect) {
    let path_str = state.current_dir.to_string_lossy();
    let text = Line::from(vec![
        Span::styled("Path: ", Style::default().add_modifier(Modifier::BOLD)),
        Span::styled(path_str.as_ref(), Style::default().fg(Color::Yellow)),
    ]);

    let paragraph = Paragraph::new(text);
    frame.render_widget(paragraph, area);
}

fn render_search_query(frame: &mut Frame, state: &DirectoryPickerState, area: Rect) {
    let text = if state.search_query.is_empty() {
        Line::from(vec![
            Span::styled("Search: ", Style::default().add_modifier(Modifier::BOLD)),
            Span::styled(
                "(type to filter)",
                Style::default().fg(Color::DarkGray),
            ),
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

fn render_directory_list(frame: &mut Frame, state: &DirectoryPickerState, area: Rect) {
    // Show error if present
    if let Some(error) = &state.error {
        let error_text = Line::from(Span::styled(error, Style::default().fg(Color::Red)));
        let paragraph = Paragraph::new(error_text);
        frame.render_widget(paragraph, area);
        return;
    }

    // Show "no results" if filtered list is empty
    if state.filtered_entries.is_empty() {
        let empty_text = if state.search_query.is_empty() {
            "No directories found"
        } else {
            "No matches"
        };
        let paragraph = Paragraph::new(Line::from(Span::styled(
            empty_text,
            Style::default().fg(Color::DarkGray),
        )));
        frame.render_widget(paragraph, area);
        return;
    }

    // Render directory list
    let items: Vec<ListItem> = state
        .filtered_entries
        .iter()
        .map(|entry| {
            let icon = if entry.is_parent { "↰ " } else { "📁 " };

            let name_style = if entry.is_parent {
                Style::default().fg(Color::Yellow)
            } else {
                Style::default().fg(Color::White)
            };

            let line = Line::from(vec![
                Span::raw(icon),
                Span::styled(&entry.name, name_style),
            ]);

            ListItem::new(line)
        })
        .collect();

    let list = List::new(items)
        .highlight_style(
            Style::default()
                .bg(Color::DarkGray)
                .add_modifier(Modifier::BOLD),
        )
        .highlight_symbol("▶ ");

    let mut list_state = ListState::default();
    list_state.select(Some(state.selected_index));

    frame.render_stateful_widget(list, area, &mut list_state);
}

fn render_help(frame: &mut Frame, area: Rect) {
    let help_text = Line::from(vec![
        Span::styled("↑↓", Style::default().fg(Color::Cyan)),
        Span::raw(": navigate  "),
        Span::styled("Enter", Style::default().fg(Color::Cyan)),
        Span::raw(": open  "),
        Span::styled("Ctrl+Enter", Style::default().fg(Color::Cyan)),
        Span::raw(": select  "),
        Span::styled("Esc", Style::default().fg(Color::Cyan)),
        Span::raw(": close"),
    ]);

    let paragraph = Paragraph::new(help_text).alignment(Alignment::Center);
    frame.render_widget(paragraph, area);
}
