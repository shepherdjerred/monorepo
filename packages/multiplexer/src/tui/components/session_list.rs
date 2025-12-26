use ratatui::{
    Frame,
    layout::Rect,
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, List, ListItem, ListState},
};

use crate::core::{CheckStatus, SessionStatus};
use crate::tui::app::App;

/// Render the session list
pub fn render(frame: &mut Frame, app: &App, area: Rect) {
    let block = Block::default()
        .title(" Multiplexer - Sessions ")
        .title_bottom(" [n]ew  [d]elete  [a]rchive  [?]help  [q]uit ")
        .borders(Borders::ALL)
        .border_style(Style::default().fg(Color::Cyan));

    if app.sessions.is_empty() {
        let empty_msg = Line::from(vec![
            Span::raw("No sessions. Press "),
            Span::styled("n", Style::default().fg(Color::Green)),
            Span::raw(" to create one."),
        ]);
        let paragraph = ratatui::widgets::Paragraph::new(empty_msg).block(block);
        frame.render_widget(paragraph, area);
        return;
    }

    let items: Vec<ListItem> = app
        .sessions
        .iter()
        .map(|session| {
            let status_style = match session.status {
                SessionStatus::Creating => Style::default().fg(Color::Yellow),
                SessionStatus::Running => Style::default().fg(Color::Green),
                SessionStatus::Idle => Style::default().fg(Color::Blue),
                SessionStatus::Completed => Style::default().fg(Color::Cyan),
                SessionStatus::Failed => Style::default().fg(Color::Red),
                SessionStatus::Archived => Style::default().fg(Color::DarkGray),
            };

            let status_text = match session.status {
                SessionStatus::Creating => "Creating",
                SessionStatus::Running => "Running",
                SessionStatus::Idle => "Idle",
                SessionStatus::Completed => "Completed",
                SessionStatus::Failed => "Failed",
                SessionStatus::Archived => "Archived",
            };

            let check_indicator = match session.pr_check_status {
                Some(CheckStatus::Pending) => Span::styled("○", Style::default().fg(Color::Yellow)),
                Some(CheckStatus::Passing) => Span::styled("●", Style::default().fg(Color::Green)),
                Some(CheckStatus::Failing) => Span::styled("●", Style::default().fg(Color::Red)),
                Some(CheckStatus::Mergeable) => {
                    Span::styled("✓", Style::default().fg(Color::Green))
                }
                Some(CheckStatus::Merged) => Span::styled("✓", Style::default().fg(Color::Cyan)),
                None => Span::raw(" "),
            };

            let backend_text = format!("{:?}", session.backend);
            let pr_text = session
                .pr_url
                .as_ref()
                .map_or_else(|| session.branch_name.clone(), |_| "PR".to_string());

            let line = Line::from(vec![
                Span::styled(
                    format!("{:24}", session.name),
                    Style::default().add_modifier(Modifier::BOLD),
                ),
                Span::styled(format!("{status_text:12}"), status_style),
                Span::raw(format!("{backend_text:8}")),
                Span::raw(format!("{pr_text:12}")),
                check_indicator,
            ]);

            ListItem::new(line)
        })
        .collect();

    let list = List::new(items)
        .block(block)
        .highlight_style(
            Style::default()
                .bg(Color::DarkGray)
                .add_modifier(Modifier::BOLD),
        )
        .highlight_symbol("▶ ");

    let mut state = ListState::default();
    state.select(Some(app.selected_index));

    frame.render_stateful_widget(list, area, &mut state);
}
