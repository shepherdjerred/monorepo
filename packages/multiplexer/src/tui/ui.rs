use ratatui::{
    Frame,
    layout::{Constraint, Direction, Layout, Rect},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, Clear, List, ListItem, Paragraph, Wrap},
};

use super::app::{App, AppMode};
use super::components::{create_dialog, session_list, status_bar};

/// Render the entire UI
pub fn render(frame: &mut Frame, app: &App) {
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Min(0),    // Main content
            Constraint::Length(1), // Status bar
        ])
        .split(frame.area());

    // Render main content
    render_main_content(frame, app, chunks[0]);

    // Render status bar
    status_bar::render(frame, app, chunks[1]);

    // Render modal dialogs on top
    match app.mode {
        AppMode::CreateDialog => {
            let dialog_area = centered_rect(60, 70, frame.area());
            frame.render_widget(Clear, dialog_area);
            create_dialog::render(frame, app, dialog_area);
        }
        AppMode::ConfirmDelete => {
            let dialog_area = centered_rect(40, 20, frame.area());
            frame.render_widget(Clear, dialog_area);
            render_confirm_delete(frame, app, dialog_area);
        }
        AppMode::Help => {
            let dialog_area = centered_rect(60, 60, frame.area());
            frame.render_widget(Clear, dialog_area);
            render_help(frame, dialog_area);
        }
        AppMode::SessionList => {}
    }
}

fn render_main_content(frame: &mut Frame, app: &App, area: Rect) {
    if let Some(error) = &app.connection_error {
        render_connection_error(frame, error, area);
    } else {
        session_list::render(frame, app, area);
    }
}

fn render_connection_error(frame: &mut Frame, error: &str, area: Rect) {
    let block = Block::default()
        .title(" Multiplexer ")
        .borders(Borders::ALL)
        .border_style(Style::default().fg(Color::Red));

    let text = vec![
        Line::from(""),
        Line::from(Span::styled(
            "Failed to connect to daemon",
            Style::default().fg(Color::Red).add_modifier(Modifier::BOLD),
        )),
        Line::from(""),
        Line::from(error.to_string()),
        Line::from(""),
        Line::from("Make sure the daemon is running:"),
        Line::from(Span::styled(
            "  mux daemon",
            Style::default().fg(Color::Yellow),
        )),
    ];

    let paragraph = Paragraph::new(text).block(block).wrap(Wrap { trim: true });

    frame.render_widget(paragraph, area);
}

fn render_confirm_delete(frame: &mut Frame, app: &App, area: Rect) {
    let block = Block::default()
        .title(" Confirm Delete ")
        .borders(Borders::ALL)
        .border_style(Style::default().fg(Color::Red));

    let session_id = app.pending_delete.as_deref().unwrap_or("unknown");
    let text = vec![
        Line::from(""),
        Line::from(format!("Delete session '{session_id}'?")),
        Line::from(""),
        Line::from("This will remove the worktree and stop the backend."),
        Line::from(""),
        Line::from(vec![
            Span::styled("[Y]", Style::default().fg(Color::Green)),
            Span::raw("es  "),
            Span::styled("[N]", Style::default().fg(Color::Red)),
            Span::raw("o"),
        ]),
    ];

    let paragraph = Paragraph::new(text).block(block).wrap(Wrap { trim: true });

    frame.render_widget(paragraph, area);
}

fn render_help(frame: &mut Frame, area: Rect) {
    let block = Block::default()
        .title(" Help ")
        .borders(Borders::ALL)
        .border_style(Style::default().fg(Color::Cyan));

    let help_items = vec![
        (
            "Session List",
            vec![
                ("↑/k", "Move up"),
                ("↓/j", "Move down"),
                ("Enter", "Attach to session"),
                ("n", "New session"),
                ("d", "Delete session"),
                ("a", "Archive session"),
                ("r", "Reconcile state"),
                ("R", "Refresh list"),
                ("?", "Toggle help"),
                ("q", "Quit"),
            ],
        ),
        (
            "Create Dialog",
            vec![
                ("Tab", "Next field"),
                ("Shift+Tab", "Previous field"),
                ("←/→/Space", "Toggle options"),
                ("Enter", "Submit (on buttons)"),
                ("Esc", "Cancel"),
            ],
        ),
        (
            "While Attached",
            vec![
                ("Ctrl+O, d", "Detach (Zellij)"),
                ("Ctrl+P, Ctrl+Q", "Detach (Docker)"),
            ],
        ),
    ];

    let mut items = Vec::new();
    for (section, keys) in help_items {
        items.push(ListItem::new(Line::from(Span::styled(
            section,
            Style::default()
                .fg(Color::Yellow)
                .add_modifier(Modifier::BOLD),
        ))));
        for (key, desc) in keys {
            items.push(ListItem::new(Line::from(vec![
                Span::styled(format!("  {key:12}"), Style::default().fg(Color::Green)),
                Span::raw(desc),
            ])));
        }
        items.push(ListItem::new(Line::from("")));
    }

    let list = List::new(items).block(block);
    frame.render_widget(list, area);
}

/// Create a centered rectangle with percentage width and height
fn centered_rect(percent_x: u16, percent_y: u16, area: Rect) -> Rect {
    let popup_layout = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Percentage((100 - percent_y) / 2),
            Constraint::Percentage(percent_y),
            Constraint::Percentage((100 - percent_y) / 2),
        ])
        .split(area);

    Layout::default()
        .direction(Direction::Horizontal)
        .constraints([
            Constraint::Percentage((100 - percent_x) / 2),
            Constraint::Percentage(percent_x),
            Constraint::Percentage((100 - percent_x) / 2),
        ])
        .split(popup_layout[1])[1]
}
