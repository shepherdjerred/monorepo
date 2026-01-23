use ratatui::{
    Frame,
    layout::{Constraint, Direction, Layout, Rect},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, Clear, List, ListItem, Paragraph, Wrap},
};

use super::app::{App, AppMode};
use super::components::{
    create_dialog, health_modal, reconcile_error_dialog, recreate_blocked_dialog,
    recreate_confirm_dialog, session_list, status_bar,
};
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
            // Calculate required height based on prompt content
            let prompt_lines = app.create_dialog.prompt.lines().count().max(1);
            let prompt_height = prompt_lines.clamp(5, usize::MAX); // Min 5 lines, no max
            let images_height = if app.create_dialog.images.is_empty() {
                0
            } else {
                app.create_dialog.images.len().min(3) + 2 // Show up to 3 images, +2 for borders
            };

            // Calculate total required height:
            // - Prompt field: prompt_height + 2 (borders)
            // - Images field: images_height
            // - Repo path: 3
            // - Backend: 2
            // - Agent: 2
            // - Access mode: 2
            // - Skip checks: 2
            // - Plan mode: 2
            // - Spacer: 1
            // - Buttons: 1
            // - Outer margins: 2
            // - Outer border: 2
            // Safe cast: terminal UI dimensions are always within u16 range
            #[allow(clippy::cast_possible_truncation)]
            let required_height =
                (prompt_height + 2 + images_height + 3 + 2 + 2 + 2 + 2 + 2 + 1 + 1 + 2 + 2) as u16;

            let dialog_area = centered_rect_with_height(60, required_height, frame.area());
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
        AppMode::ReconcileError => {
            reconcile_error_dialog::render(frame, app, frame.area());
        }
        AppMode::SignalMenu => {
            let dialog_area = centered_rect(60, 70, frame.area());
            frame.render_widget(Clear, dialog_area);
            render_signal_menu(frame, app, dialog_area);
        }
        AppMode::StartupHealthModal => {
            health_modal::render(frame, app, frame.area());
        }
        AppMode::RecreateConfirm => {
            recreate_confirm_dialog::render(frame, app, frame.area());
        }
        AppMode::RecreateBlocked => {
            recreate_blocked_dialog::render(frame, app, frame.area());
        }
        AppMode::SessionList
        | AppMode::Attached
        | AppMode::CopyMode
        | AppMode::Locked
        | AppMode::Scroll => {}
    }
}

fn render_main_content(frame: &mut Frame, app: &App, area: Rect) {
    if let Some(error) = &app.connection_error {
        render_connection_error(frame, error, area);
    } else if app.mode == AppMode::Attached
        || app.mode == AppMode::CopyMode
        || app.mode == AppMode::Locked
        || app.mode == AppMode::Scroll
    {
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
                let indicator_text = format!(" ↑ Scrolled {scroll_offset} lines ");
                let indicator_width = u16::try_from(indicator_text.len()).unwrap_or(u16::MAX);

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
                ("Ctrl+Q", "Detach"),
                ("Ctrl+P/N", "Switch session (Prev/Next)"),
                ("Ctrl+S", "Enter scroll mode"),
                ("Ctrl+L", "Toggle locked mode"),
                ("?", "Show help"),
            ]
        },
        |session| {
            let container_hints = vec![
                ("Ctrl+Q", "Detach"),
                ("Ctrl+P/N", "Switch session (Prev/Next)"),
                ("Ctrl+C", "Send SIGINT to container"),
                ("Ctrl+Z", "Send SIGTSTP to container (suspend)"),
                ("Ctrl+\\", "Send SIGQUIT to container"),
                ("Ctrl+M", "Open signal menu"),
                ("Ctrl+S", "Enter scroll mode"),
                ("Ctrl+L", "Toggle locked mode"),
                ("?", "Show help"),
            ];

            match session.backend {
                BackendType::Zellij => vec![("Ctrl+O, d", "Detach from session")],
                BackendType::Docker | BackendType::Kubernetes | BackendType::Sprites => {
                    container_hints
                }
                #[cfg(target_os = "macos")]
                BackendType::AppleContainer => container_hints,
            }
        },
    );

    let help_items = vec![
        (
            "Session List",
            vec![
                ("↑/k", "Move up"),
                ("↓/j", "Move down"),
                ("Enter", "Attach to session"),
                ("1-5", "Switch filter view"),
                ("Tab", "Cycle through filters"),
                ("n", "New session"),
                ("d", "Delete session"),
                ("a", "Archive session"),
                ("u", "Unarchive session"),
                ("f", "Refresh session (Docker only)"),
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
            "Locked Mode",
            vec![
                ("Ctrl+L", "Unlock and return to attached"),
                ("All keys", "Forwarded to application"),
            ],
        ),
        (
            "Scroll Mode",
            vec![
                ("↑/↓ or j/k", "Scroll one line"),
                ("PgUp/PgDn", "Scroll one page"),
                ("Ctrl+b/f", "Scroll one page (vi-style)"),
                ("Esc/q", "Exit scroll mode"),
                ("Ctrl+S", "Exit scroll mode"),
            ],
        ),
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

/// Render the signal menu dialog.
fn render_signal_menu(frame: &mut Frame, app: &App, area: Rect) {
    let Some(menu) = &app.signal_menu else {
        return;
    };

    let block = Block::default()
        .title(" Send Signal (↑/↓ to select, Enter to send, Esc to cancel) ")
        .borders(Borders::ALL)
        .border_style(Style::default().fg(Color::Yellow));

    let items: Vec<ListItem> = menu
        .signals
        .iter()
        .enumerate()
        .map(|(i, signal)| {
            let is_selected = i == menu.selected_index;
            let style = if is_selected {
                Style::default()
                    .bg(Color::Blue)
                    .fg(Color::White)
                    .add_modifier(Modifier::BOLD)
            } else {
                Style::default().fg(Color::White)
            };

            let lines = vec![
                Line::from(vec![Span::styled(
                    format!("  {:<25}", signal.display_name()),
                    style,
                )]),
                Line::from(vec![Span::styled(
                    format!("    {}", signal.description()),
                    if is_selected {
                        style
                    } else {
                        Style::default().fg(Color::Gray)
                    },
                )]),
            ];

            ListItem::new(lines).style(style)
        })
        .collect();

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

/// Create a centered rectangle with percentage width and specific height
fn centered_rect_with_height(percent_x: u16, height: u16, area: Rect) -> Rect {
    // Clamp height to available area
    let actual_height = height.min(area.height.saturating_sub(2));
    let vertical_margin = area.height.saturating_sub(actual_height) / 2;

    let popup_layout = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(vertical_margin),
            Constraint::Length(actual_height),
            Constraint::Length(vertical_margin),
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
