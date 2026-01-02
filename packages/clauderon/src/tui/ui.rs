use ratatui::{
    Frame,
    layout::{Constraint, Direction, Layout, Rect},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, Clear, List, ListItem, Paragraph, Wrap},
};

use super::app::{App, AppMode};
use super::components::{create_dialog, session_list, status_bar};
use crate::core::BackendType;

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
            render_help(frame, app, dialog_area);
        }
        AppMode::SessionList | AppMode::Attached | AppMode::CopyMode => {}
    }
}

fn render_main_content(frame: &mut Frame, app: &App, area: Rect) {
    if let Some(error) = &app.connection_error {
        render_connection_error(frame, error, area);
    } else if app.mode == AppMode::Attached || app.mode == AppMode::CopyMode {
        render_attached_terminal(frame, app, area);
    } else {
        session_list::render(frame, app, area);
    }
}

/// Render the attached terminal view.
fn render_attached_terminal(frame: &mut Frame, app: &App, area: Rect) {
    use super::attached::TerminalWidget;

    if let Some(pty_session) = app.attached_pty_session() {
        let buffer = pty_session.terminal_buffer();
        if let Ok(buf) = buffer.try_lock() {
            // Render the terminal content using the widget
            frame.render_widget(TerminalWidget::new(&buf), area);

            // Render scroll indicator if not at bottom
            if !buf.is_at_bottom() {
                let scroll_offset = buf.get_scroll_offset();
                let indicator_text = format!(" ↑ Scrolled {} lines ", scroll_offset);
                let indicator_width = indicator_text.len() as u16;

                // Position in top-right corner
                if area.width > indicator_width && area.height > 0 {
                    let indicator_area = Rect {
                        x: area.x + area.width.saturating_sub(indicator_width),
                        y: area.y,
                        width: indicator_width,
                        height: 1,
                    };

                    let indicator = Paragraph::new(indicator_text).style(
                        Style::default()
                            .bg(Color::Yellow)
                            .fg(Color::Black)
                            .add_modifier(Modifier::BOLD),
                    );

                    frame.render_widget(indicator, indicator_area);
                }
            }

            return;
        }
    }

    // Fallback if we can't access the buffer
    let block = Block::default()
        .title(" Attached - Press Ctrl+Q to detach ")
        .borders(Borders::ALL)
        .border_style(Style::default().fg(Color::Green));

    let text = if app.attached_session_id.is_some() {
        vec![
            Line::from(""),
            Line::from(Span::styled(
                "Loading terminal...",
                Style::default().fg(Color::Yellow),
            )),
        ]
    } else {
        vec![
            Line::from(""),
            Line::from(Span::styled(
                "No session attached",
                Style::default().fg(Color::Red),
            )),
        ]
    };

    let paragraph = Paragraph::new(text).block(block);
    frame.render_widget(paragraph, area);
}

fn render_connection_error(frame: &mut Frame, error: &str, area: Rect) {
    let block = Block::default()
        .title(" Clauderon ")
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
            "  clauderon daemon",
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

fn render_help(frame: &mut Frame, app: &App, area: Rect) {
    let block = Block::default()
        .title(" Help ")
        .borders(Borders::ALL)
        .border_style(Style::default().fg(Color::Cyan));

    // Build "While Attached" section based on selected session's backend
    let attached_hints = app.selected_session().map_or_else(
        || {
            // No session selected - show Docker PTY options
            vec![
                ("Ctrl+Q", "Detach (single tap)"),
                ("Ctrl+Q x2", "Send literal Ctrl+Q"),
                ("Ctrl+P/N", "Switch session (Prev/Next)"),
                ("Alt+←/→", "Switch session"),
                ("PgUp/Dn", "Scroll history (10 lines)"),
                ("Shift+↑/↓", "Scroll history (1 line)"),
                ("Mouse wheel", "Scroll history"),
            ]
        },
        |session| match session.backend {
            BackendType::Zellij => vec![("Ctrl+O, d", "Detach from session")],
            BackendType::Docker => vec![
                ("Ctrl+Q", "Detach (single tap)"),
                ("Ctrl+Q x2", "Send literal Ctrl+Q"),
                ("Ctrl+P/N", "Switch session (Prev/Next)"),
                ("Alt+←/→", "Switch session"),
                ("Ctrl+[", "Enter copy mode"),
                ("PgUp/Dn", "Scroll history (10 lines)"),
                ("Shift+↑/↓", "Scroll history (1 line)"),
                ("Mouse wheel", "Scroll history"),
                ("?", "Show help"),
            ],
        },
    );

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
        ("While Attached", attached_hints),
        (
            "Copy Mode",
            vec![
                ("h/j/k/l", "Move cursor (vi-style)"),
                ("Arrow keys", "Move cursor"),
                ("v", "Start/cancel visual selection"),
                ("y", "Yank (copy) selection to clipboard"),
                ("PgUp/PgDn", "Scroll page up/down"),
                ("q or Esc", "Exit copy mode"),
                ("?", "Show help"),
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
