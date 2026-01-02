use ratatui::{
    Frame,
    layout::{Constraint, Direction, Layout, Rect},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, Clear, Paragraph, Wrap},
};

use crate::core::AccessMode;
use crate::tui::app::{App, CreateDialogFocus};

/// Render the create session dialog
pub fn render(frame: &mut Frame, app: &App, area: Rect) {
    let block = Block::default()
        .title(" New Session ")
        .borders(Borders::ALL)
        .border_style(Style::default().fg(Color::Green));

    frame.render_widget(block, area);

    // If loading, show loading message with spinner and progress
    if let Some(loading_msg) = &app.loading_message {
        render_loading(
            frame,
            loading_msg,
            app.progress_step.as_ref(),
            app.spinner_tick,
            area,
        );
        return;
    }

    let dialog = &app.create_dialog;

    // Calculate dynamic height for prompt field based on content
    let prompt_lines = dialog.prompt.lines().count().max(1);
    let prompt_height = prompt_lines.clamp(5, 15); // Min 5, max 15 lines

    // Inner area (with padding)
    let inner = Layout::default()
        .direction(Direction::Vertical)
        .margin(1)
        .constraints([
            Constraint::Length(3),                        // Name
            Constraint::Length(prompt_height as u16 + 2), // Prompt (dynamic + borders)
            Constraint::Length(3),                        // Repo path
            Constraint::Length(2),                        // Backend
            Constraint::Length(2),                        // Access mode
            Constraint::Length(2),                        // Skip checks
            Constraint::Length(2),                        // Plan mode
            Constraint::Length(1),                        // Spacer
            Constraint::Length(1),                        // Buttons
        ])
        .split(area);

    // Name field
    render_text_field(
        frame,
        "Name",
        &dialog.name,
        dialog.focus == CreateDialogFocus::Name,
        dialog.name_cursor,
        inner[0],
    );

    // Prompt field (multiline with scrolling)
    render_multiline_field(
        frame,
        "Prompt",
        &dialog.prompt,
        dialog.focus == CreateDialogFocus::Prompt,
        dialog.prompt_cursor_line,
        dialog.prompt_cursor_col,
        dialog.prompt_scroll_offset,
        prompt_height,
        inner[1],
    );

    // Repo path field (clickable to open directory picker)
    render_repo_path_field(
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

    // Access mode selection
    render_radio_field(
        frame,
        "Access Mode",
        &[
            ("Read-Only", dialog.access_mode == AccessMode::ReadOnly),
            ("Read-Write", dialog.access_mode == AccessMode::ReadWrite),
        ],
        dialog.focus == CreateDialogFocus::AccessMode,
        inner[4],
    );

    // Skip checks checkbox
    render_checkbox_field(
        frame,
        "Dangerously skip checks",
        dialog.skip_checks,
        dialog.focus == CreateDialogFocus::SkipChecks,
        inner[5],
    );

    // Plan mode checkbox
    render_checkbox_field(
        frame,
        "Start in plan mode",
        dialog.plan_mode,
        dialog.focus == CreateDialogFocus::PlanMode,
        inner[6],
    );

    // Buttons
    render_buttons(
        frame,
        dialog.focus == CreateDialogFocus::Buttons,
        dialog.button_create_focused,
        inner[8],
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

fn render_text_field(
    frame: &mut Frame,
    label: &str,
    value: &str,
    focused: bool,
    cursor_pos: usize,
    area: Rect,
) {
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
        // Split text at cursor position and insert cursor character
        use crate::tui::text_input::split_at_char_boundary;
        let (before, after) = split_at_char_boundary(value, cursor_pos);
        format!("{before}▏{after}")
    } else {
        value.to_string()
    };

    let paragraph = Paragraph::new(display_value).block(block);
    frame.render_widget(paragraph, area);
}

fn render_repo_path_field(frame: &mut Frame, label: &str, value: &str, focused: bool, area: Rect) {
    let style = if focused {
        Style::default().fg(Color::Yellow)
    } else {
        Style::default()
    };

    let block = Block::default()
        .title(format!(" {label} "))
        .borders(Borders::ALL)
        .border_style(style);

    let display_value = if value.is_empty() {
        if focused {
            "(Press Enter to browse)".to_string()
        } else {
            "(no directory)".to_string()
        }
    } else {
        value.to_string()
    };

    let value_style = if value.is_empty() {
        Style::default().fg(Color::DarkGray)
    } else {
        Style::default()
    };

    let paragraph = Paragraph::new(Span::styled(display_value, value_style)).block(block);
    frame.render_widget(paragraph, area);
}

fn render_multiline_field(
    frame: &mut Frame,
    label: &str,
    value: &str,
    focused: bool,
    cursor_line: usize,
    cursor_col: usize,
    scroll_offset: usize,
    visible_lines: usize,
    area: Rect,
) {
    let style = if focused {
        Style::default().fg(Color::Yellow)
    } else {
        Style::default()
    };

    // Calculate scroll indicators
    let lines: Vec<&str> = value.lines().collect();
    let total_lines = lines.len().max(1);
    let has_more_above = scroll_offset > 0;
    let has_more_below = scroll_offset + visible_lines < total_lines;

    // Build title with scroll indicators and help text
    let title = if focused {
        if has_more_above && has_more_below {
            format!(" {label} ↑ more above · ↓ more below · Ctrl+E: Edit in $EDITOR ")
        } else if has_more_above {
            format!(" {label} ↑ more above · Ctrl+E: Edit in $EDITOR ")
        } else if has_more_below {
            format!(" {label} ↓ more below · Ctrl+E: Edit in $EDITOR ")
        } else {
            format!(" {label} · Ctrl+E: Edit in $EDITOR ")
        }
    } else if has_more_above && has_more_below {
        format!(" {label} ↑ more above · ↓ more below ")
    } else if has_more_above {
        format!(" {label} ↑ more above ")
    } else if has_more_below {
        format!(" {label} ↓ more below ")
    } else {
        format!(" {label} ")
    };

    let block = Block::default()
        .title(title)
        .borders(Borders::ALL)
        .border_style(style);

    // Apply scrolling and insert cursor
    let visible_lines_vec: Vec<String> = lines
        .iter()
        .enumerate()
        .skip(scroll_offset)
        .take(visible_lines)
        .map(|(line_idx, line_str)| {
            // Insert cursor if this is the cursor line and we're focused
            if focused && line_idx == cursor_line {
                use crate::tui::text_input::split_at_char_col;
                let (before, after) = split_at_char_col(line_str, cursor_col);
                format!("{before}▏{after}")
            } else {
                line_str.to_string()
            }
        })
        .collect();

    let display_value = if visible_lines_vec.is_empty() && focused {
        // Empty prompt with cursor
        "▏".to_string()
    } else if visible_lines_vec.is_empty() {
        String::new()
    } else {
        visible_lines_vec.join("\n")
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

/// Spinner frames for loading animation
const SPINNER_FRAMES: &[&str] = &["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

fn render_loading(
    frame: &mut Frame,
    message: &str,
    progress: Option<&(u32, u32, String)>,
    tick: u64,
    area: Rect,
) {
    let inner = Layout::default()
        .direction(Direction::Vertical)
        .margin(1)
        .constraints([
            Constraint::Min(0),
            Constraint::Length(4), // Extra line for progress
            Constraint::Min(0),
        ])
        .split(area);

    // Get current spinner frame
    let spinner_idx = (tick / 2) as usize % SPINNER_FRAMES.len();
    let spinner = SPINNER_FRAMES[spinner_idx];

    // Build display message
    let display_msg = if let Some((step, total, step_msg)) = progress {
        format!("Step {step}/{total}: {step_msg}")
    } else {
        message.to_string()
    };

    let text = vec![
        Line::from(""),
        Line::from(vec![
            Span::styled(
                format!("{spinner} "),
                Style::default()
                    .fg(Color::Cyan)
                    .add_modifier(Modifier::BOLD),
            ),
            Span::styled(
                &display_msg,
                Style::default()
                    .fg(Color::Yellow)
                    .add_modifier(Modifier::BOLD),
            ),
        ]),
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
