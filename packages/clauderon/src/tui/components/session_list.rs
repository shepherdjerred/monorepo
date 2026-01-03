use ratatui::{
    Frame,
    layout::{Constraint, Layout, Rect},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, List, ListItem, ListState, Paragraph},
};

use crate::core::{CheckStatus, ClaudeWorkingStatus, SessionStatus};
use crate::tui::app::App;

/// Render the session list
pub fn render(frame: &mut Frame, app: &App, area: Rect) {
    let block = Block::default()
        .title(" Clauderon - Sessions ")
        .title_bottom(" [n]ew  [d]elete  [a]rchive  [p]r  [f]ix-ci  [?]help  [q]uit ")
        .borders(Borders::ALL)
        .border_style(Style::default().fg(Color::Cyan));

    if app.sessions.is_empty() {
        let empty_msg = Line::from(vec![
            Span::raw("No sessions. Press "),
            Span::styled("n", Style::default().fg(Color::Green)),
            Span::raw(" to create one."),
        ]);
        let paragraph = Paragraph::new(empty_msg).block(block);
        frame.render_widget(paragraph, area);
        return;
    }

    // Render the block and get the inner area
    let inner_area = block.inner(area);
    frame.render_widget(block, area);

    // Split inner area into header and list
    let chunks = Layout::vertical([Constraint::Length(1), Constraint::Min(0)]).split(inner_area);
    let header_area = chunks[0];
    let list_area = chunks[1];

    // Render header row
    // Account for highlight symbol "▶ " (2 chars) + deletion spinner space (2 chars)
    let header = Line::from(vec![
        Span::styled("    ", Style::default()), // highlight symbol + spinner space
        Span::styled(
            format!("{:22}", "Name"),
            Style::default().fg(Color::DarkGray),
        ),
        Span::styled(
            format!("{:20}", "Repository"),
            Style::default().fg(Color::DarkGray),
        ),
        Span::styled(
            format!("{:12}", "Status"),
            Style::default().fg(Color::DarkGray),
        ),
        Span::styled(
            format!("{:8}", "Backend"),
            Style::default().fg(Color::DarkGray),
        ),
        Span::styled(
            format!("{:12}", "Branch/PR"),
            Style::default().fg(Color::DarkGray),
        ),
        Span::styled("◎ ", Style::default().fg(Color::DarkGray)), // Claude status header
        Span::styled("CI", Style::default().fg(Color::DarkGray)), // Check status header
    ]);
    frame.render_widget(Paragraph::new(header), header_area);

    let items: Vec<ListItem> = app
        .sessions
        .iter()
        .map(|session| {
            let status_style = match session.status {
                SessionStatus::Creating => Style::default().fg(Color::Yellow),
                SessionStatus::Deleting => Style::default().fg(Color::Yellow),
                SessionStatus::Running => Style::default().fg(Color::Green),
                SessionStatus::Idle => Style::default().fg(Color::Blue),
                SessionStatus::Completed => Style::default().fg(Color::Cyan),
                SessionStatus::Failed => Style::default().fg(Color::Red),
                SessionStatus::Archived => Style::default().fg(Color::DarkGray),
            };

            let status_text = match session.status {
                SessionStatus::Creating => "Creating",
                SessionStatus::Deleting => "Deleting",
                SessionStatus::Running => "Running",
                SessionStatus::Idle => "Idle",
                SessionStatus::Completed => "Completed",
                SessionStatus::Failed => "Failed",
                SessionStatus::Archived => "Archived",
            };

            // Claude working status indicator (animated for Working state)
            let claude_indicator = match session.claude_status {
                ClaudeWorkingStatus::Working => {
                    // Animate based on spinner tick
                    let spinner = match app.spinner_tick % 4 {
                        0 => "⠋",
                        1 => "⠙",
                        2 => "⠹",
                        _ => "⠸",
                    };
                    Span::styled(spinner, Style::default().fg(Color::Green))
                }
                ClaudeWorkingStatus::WaitingApproval => {
                    Span::styled("⏸", Style::default().fg(Color::Yellow))
                }
                ClaudeWorkingStatus::WaitingInput => {
                    Span::styled("⌨", Style::default().fg(Color::Cyan))
                }
                ClaudeWorkingStatus::Idle => {
                    Span::styled("○", Style::default().fg(Color::DarkGray))
                }
                ClaudeWorkingStatus::Unknown => Span::raw(" "),
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

            let repo_name = session
                .repo_path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("unknown");

            // Check if this session is being deleted
            let is_deleting = app
                .deleting_session_id
                .as_ref()
                .is_some_and(|id| id == &session.id.to_string());

            let mut spans = vec![];

            // Add deletion indicator if deleting
            if is_deleting {
                let spinner = match app.spinner_tick % 4 {
                    0 => "⠋",
                    1 => "⠙",
                    2 => "⠹",
                    _ => "⠸",
                };
                spans.push(Span::styled(
                    format!("{spinner} "),
                    Style::default().fg(Color::Yellow),
                ));
            } else {
                spans.push(Span::raw("  "));
            }

            // Check if session has reconcile errors (container recreation failed)
            let has_reconcile_error =
                session.reconcile_attempts > 0 && session.last_reconcile_error.is_some();

            // Format session name with optional warning indicator
            let name_display = if has_reconcile_error {
                format!("⚠ {:20}", session.name)
            } else {
                format!("{:22}", session.name)
            };

            let name_style = if has_reconcile_error {
                Style::default()
                    .fg(Color::Yellow)
                    .add_modifier(Modifier::BOLD)
            } else {
                Style::default().add_modifier(Modifier::BOLD)
            };

            spans.extend(vec![
                Span::styled(name_display, name_style),
                Span::raw(format!("{repo_name:20}")),
                Span::styled(format!("{status_text:12}"), status_style),
                Span::raw(format!("{backend_text:8}")),
                Span::raw(format!("{pr_text:12}")),
                claude_indicator,
                Span::raw(" "),
                check_indicator,
            ]);

            let line = Line::from(spans);

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

    let mut state = ListState::default();
    state.select(Some(app.selected_index));

    frame.render_stateful_widget(list, list_area, &mut state);
}
