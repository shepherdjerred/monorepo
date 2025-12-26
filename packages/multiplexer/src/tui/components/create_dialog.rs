use ratatui::{
    Frame,
    layout::{Constraint, Direction, Layout, Rect},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, Clear, Paragraph, Wrap},
};

use crate::tui::app::{App, CreateDialogFocus};

/// Render the create session dialog
pub fn render(frame: &mut Frame, app: &App, area: Rect) {
    let block = Block::default()
        .title(" New Session ")
        .borders(Borders::ALL)
        .border_style(Style::default().fg(Color::Green));

    frame.render_widget(block, area);

    // If loading, show loading message
    if let Some(loading_msg) = &app.loading_message {
        render_loading(frame, loading_msg, area);
        return;
    }

    // Inner area (with padding)
    let inner = Layout::default()
        .direction(Direction::Vertical)
        .margin(1)
        .constraints([
            Constraint::Length(3), // Name
            Constraint::Length(5), // Prompt
            Constraint::Length(3), // Repo path
            Constraint::Length(2), // Backend
            Constraint::Length(2), // Skip checks
            Constraint::Length(1), // Spacer
            Constraint::Length(1), // Buttons
        ])
        .split(area);

    let dialog = &app.create_dialog;

    // Name field
    render_text_field(
        frame,
        "Name",
        &dialog.name,
        dialog.focus == CreateDialogFocus::Name,
        inner[0],
    );

    // Prompt field (multiline)
    render_multiline_field(
        frame,
        "Prompt",
        &dialog.prompt,
        dialog.focus == CreateDialogFocus::Prompt,
        inner[1],
    );

    // Repo path field
    render_text_field(
        frame,
        "Repository",
        &dialog.repo_path,
        dialog.focus == CreateDialogFocus::RepoPath,
        inner[2],
    );

    // Backend selection
    render_radio_field(
        frame,
        "Backend",
        &[
            ("Zellij", dialog.backend_zellij),
            ("Docker", !dialog.backend_zellij),
        ],
        dialog.focus == CreateDialogFocus::Backend,
        inner[3],
    );

    // Skip checks checkbox
    render_checkbox_field(
        frame,
        "Dangerously skip checks",
        dialog.skip_checks,
        dialog.focus == CreateDialogFocus::SkipChecks,
        inner[4],
    );

    // Buttons
    render_buttons(
        frame,
        dialog.focus == CreateDialogFocus::Buttons,
        dialog.button_create_focused,
        inner[6],
    );

    // Render directory picker overlay if active
    if app.create_dialog.directory_picker.is_active {
        use super::directory_picker;

        // Create centered modal within the create dialog
        let picker_area = centered_rect_in_area(80, 70, area);

        // Clear the area and render picker
        frame.render_widget(Clear, picker_area);
        directory_picker::render(frame, &app.create_dialog.directory_picker, picker_area);
    }
}

fn render_text_field(frame: &mut Frame, label: &str, value: &str, focused: bool, area: Rect) {
    let style = if focused {
        Style::default().fg(Color::Yellow)
    } else {
        Style::default()
    };

    let block = Block::default()
        .title(format!(" {label} "))
        .borders(Borders::ALL)
        .border_style(style);

    let display_value = if focused {
        format!("{value}▏")
    } else {
        value.to_string()
    };

    let paragraph = Paragraph::new(display_value).block(block);
    frame.render_widget(paragraph, area);
}

fn render_multiline_field(frame: &mut Frame, label: &str, value: &str, focused: bool, area: Rect) {
    let style = if focused {
        Style::default().fg(Color::Yellow)
    } else {
        Style::default()
    };

    let block = Block::default()
        .title(format!(" {label} "))
        .borders(Borders::ALL)
        .border_style(style);

    let display_value = if focused {
        format!("{value}▏")
    } else {
        value.to_string()
    };

    let paragraph = Paragraph::new(display_value)
        .block(block)
        .wrap(Wrap { trim: false });
    frame.render_widget(paragraph, area);
}

fn render_radio_field(
    frame: &mut Frame,
    label: &str,
    options: &[(&str, bool)],
    focused: bool,
    area: Rect,
) {
    let style = if focused {
        Style::default().fg(Color::Yellow)
    } else {
        Style::default()
    };

    let spans: Vec<Span> = options
        .iter()
        .enumerate()
        .flat_map(|(i, (name, selected))| {
            let indicator = if *selected { "(•)" } else { "( )" };
            let mut result = vec![
                Span::styled(indicator, style),
                Span::raw(" "),
                Span::raw(*name),
            ];
            if i < options.len() - 1 {
                result.push(Span::raw("   "));
            }
            result
        })
        .collect();

    let line = Line::from(
        vec![Span::styled(
            format!("{label}: "),
            Style::default().add_modifier(Modifier::BOLD),
        )]
        .into_iter()
        .chain(spans)
        .collect::<Vec<_>>(),
    );

    let paragraph = Paragraph::new(line);
    frame.render_widget(paragraph, area);
}

fn render_checkbox_field(frame: &mut Frame, label: &str, checked: bool, focused: bool, area: Rect) {
    let style = if focused {
        Style::default().fg(Color::Yellow)
    } else {
        Style::default()
    };

    let checkbox = if checked { "[x]" } else { "[ ]" };

    let line = Line::from(vec![
        Span::styled(checkbox, style),
        Span::raw(" "),
        Span::raw(label),
    ]);

    let paragraph = Paragraph::new(line);
    frame.render_widget(paragraph, area);
}

fn render_buttons(frame: &mut Frame, focused: bool, create_focused: bool, area: Rect) {
    let cancel_style = if focused && !create_focused {
        Style::default()
            .fg(Color::Black)
            .bg(Color::White)
            .add_modifier(Modifier::BOLD)
    } else {
        Style::default().fg(Color::Gray)
    };

    let create_style = if focused && create_focused {
        Style::default()
            .fg(Color::Black)
            .bg(Color::Green)
            .add_modifier(Modifier::BOLD)
    } else {
        Style::default().fg(Color::Green)
    };

    let line = Line::from(vec![
        Span::raw("                    "),
        Span::styled(" Cancel ", cancel_style),
        Span::raw("  "),
        Span::styled(" Create ", create_style),
    ]);

    let paragraph = Paragraph::new(line);
    frame.render_widget(paragraph, area);
}

fn render_loading(frame: &mut Frame, message: &str, area: Rect) {
    let inner = Layout::default()
        .direction(Direction::Vertical)
        .margin(1)
        .constraints([
            Constraint::Min(0),
            Constraint::Length(3),
            Constraint::Min(0),
        ])
        .split(area);

    let text = vec![
        Line::from(""),
        Line::from(Span::styled(
            message,
            Style::default()
                .fg(Color::Yellow)
                .add_modifier(Modifier::BOLD),
        )),
        Line::from(""),
    ];

    let paragraph = Paragraph::new(text).wrap(Wrap { trim: true });
    frame.render_widget(paragraph, inner[1]);
}

/// Helper to create centered rect within a given area
fn centered_rect_in_area(percent_x: u16, percent_y: u16, area: Rect) -> Rect {
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
