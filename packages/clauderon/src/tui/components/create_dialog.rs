use ratatui::{
    Frame,
    layout::{Constraint, Direction, Layout, Rect},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, Clear, Paragraph, Wrap},
};

use super::SPINNER_FRAMES;
use crate::backends::{ImagePullPolicy, KubernetesConfig, SpritesConfig};
use crate::core::{
    AccessMode, AgentType, BackendType,
    session::{ClaudeModel, CodexModel, GeminiModel, SessionModel},
};
use crate::tui::app::{App, CreateDialogFocus, CreateDialogState};

// Layout constants - single source of truth for field heights
const TEXT_FIELD_HEIGHT: u16 = 3;
const RADIO_FIELD_HEIGHT: u16 = 2;
const CHECKBOX_HEIGHT: u16 = 1;
const SPACER_HEIGHT: u16 = 1;
const BUTTON_HEIGHT: u16 = 1;
const OUTER_MARGIN: u16 = 2; // margin(1) adds 1 on each side = 2 total
const OUTER_BORDER: u16 = 2; // border on top and bottom

/// Check if a backend is available (configured) for use
fn is_backend_available(backend: BackendType) -> bool {
    match backend {
        BackendType::Sprites => SpritesConfig::load_or_default().is_connected_mode(),
        BackendType::Kubernetes => true, // Always available, use dangerous-copy-creds if no proxy
        BackendType::Zellij | BackendType::Docker => true,
        #[cfg(target_os = "macos")]
        BackendType::AppleContainer => true,
    }
}

/// Check if K8s proxy mode is configured
#[must_use]
pub fn is_k8s_proxy_configured() -> bool {
    KubernetesConfig::load_or_default().is_connected_mode()
}

/// Calculate layout for the create dialog.
/// Returns (total_height, constraints) for consistent sizing between ui.rs and render().
#[must_use]
#[allow(clippy::cast_possible_truncation)]
pub fn calculate_layout(dialog: &CreateDialogState) -> (u16, Vec<Constraint>) {
    // Dynamic prompt height: min 5 lines, max 15
    let prompt_lines = dialog.prompt.lines().count().max(1);
    let prompt_height = prompt_lines.clamp(5, 15) as u16 + 2; // +2 for borders

    // Dynamic images height: 0 if empty, otherwise show up to 3 images + borders
    let images_height = if dialog.images.is_empty() {
        0
    } else {
        dialog.images.len().min(3) as u16 + 2
    };

    // Check conditions for optional fields
    let is_k8s = dialog.backend == BackendType::Kubernetes;
    let show_copy_creds = is_k8s && !is_k8s_proxy_configured();

    // Check if auto-code feature is enabled
    let show_github_issue = dialog.feature_flags.enable_auto_code;

    // Build constraints dynamically
    let mut constraints = vec![
        Constraint::Length(prompt_height),     // Prompt (dynamic)
        Constraint::Length(images_height),     // Images (dynamic, 0 if none)
        Constraint::Length(TEXT_FIELD_HEIGHT), // Repo path
    ];

    // Add GitHub issue field (only if auto-code feature enabled)
    if show_github_issue {
        constraints.push(Constraint::Length(TEXT_FIELD_HEIGHT)); // GitHub issue
    }

    constraints.extend_from_slice(&[
        Constraint::Length(TEXT_FIELD_HEIGHT),  // Base branch
        Constraint::Length(SPACER_HEIGHT),      // Spacer
        Constraint::Length(RADIO_FIELD_HEIGHT), // Backend
        Constraint::Length(RADIO_FIELD_HEIGHT), // Agent
        Constraint::Length(RADIO_FIELD_HEIGHT), // Model
        Constraint::Length(SPACER_HEIGHT),      // Spacer
        Constraint::Length(RADIO_FIELD_HEIGHT), // Access mode
        Constraint::Length(CHECKBOX_HEIGHT),    // Skip checks
        Constraint::Length(CHECKBOX_HEIGHT),    // Plan mode
    ]);

    // Add dangerous copy creds checkbox (only for K8s without proxy)
    if show_copy_creds {
        constraints.push(Constraint::Length(CHECKBOX_HEIGHT));
    }

    // Add K8s-specific fields
    if is_k8s {
        constraints.push(Constraint::Length(TEXT_FIELD_HEIGHT)); // Container image
        constraints.push(Constraint::Length(RADIO_FIELD_HEIGHT)); // Pull policy
        constraints.push(Constraint::Length(TEXT_FIELD_HEIGHT)); // Storage class
    }

    // Footer
    constraints.push(Constraint::Length(SPACER_HEIGHT)); // Spacer
    constraints.push(Constraint::Length(BUTTON_HEIGHT)); // Buttons

    // Calculate total height from constraints
    let content_height: u16 = constraints
        .iter()
        .filter_map(|c| match c {
            Constraint::Length(h) => Some(*h),
            _ => None,
        })
        .sum();

    let total_height = content_height + OUTER_MARGIN + OUTER_BORDER;

    (total_height, constraints)
}

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

    // Get layout constraints from single source of truth
    let (_total_height, constraints) = calculate_layout(dialog);

    // Check conditions for layout indexing
    let is_k8s = dialog.backend == BackendType::Kubernetes;
    let show_copy_creds = is_k8s && !is_k8s_proxy_configured();
    let show_github_issue = dialog.feature_flags.enable_auto_code;

    // Calculate visible lines for prompt field (matches calculate_layout)
    let prompt_lines = dialog.prompt.lines().count().max(1);
    let prompt_height = prompt_lines.clamp(5, 15);

    // Apply layout
    let inner = Layout::default()
        .direction(Direction::Vertical)
        .margin(1)
        .constraints(constraints)
        .split(area);

    // Calculate indices dynamically based on which fields are present
    // This matches the order constraints are added in calculate_layout()
    let mut idx = 0;
    let prompt_idx = idx;
    idx += 1;
    let images_idx = idx;
    idx += 1;
    let repo_idx = idx;
    idx += 1;

    // GitHub issue field (only if auto-code feature enabled)
    let github_issue_idx = if show_github_issue {
        let i = idx;
        idx += 1;
        i
    } else {
        0 // Won't be used
    };

    let base_branch_idx = idx;
    idx += 1;
    idx += 1; // spacer
    let backend_idx = idx;
    idx += 1;
    let agent_idx = idx;
    idx += 1;
    let model_idx = idx;
    idx += 1;
    idx += 1; // spacer
    let access_idx = idx;
    idx += 1;
    let skip_checks_idx = idx;
    idx += 1;
    let plan_mode_idx = idx;
    idx += 1;

    // Conditional fields - only increment index if field is shown
    let dangerous_copy_creds_idx = if show_copy_creds {
        let i = idx;
        idx += 1;
        i
    } else {
        0 // Won't be used
    };

    let (container_image_idx, pull_policy_idx, storage_class_idx) = if is_k8s {
        let ci = idx;
        idx += 1;
        let pp = idx;
        idx += 1;
        let sc = idx;
        idx += 1;
        (ci, pp, sc)
    } else {
        (0, 0, 0) // Won't be used
    };

    idx += 1; // spacer
    let buttons_idx = idx;

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
        inner[prompt_idx],
    );

    // Images field (if any images attached)
    if !dialog.images.is_empty() {
        render_images_field(frame, &dialog.images, inner[images_idx]);
    }

    // Repo path field (clickable to open directory picker)
    render_repo_path_field(
        frame,
        "Repository",
        &dialog.repo_path,
        dialog.focus == CreateDialogFocus::RepoPath,
        inner[repo_idx],
    );

    // GitHub issue field (only if auto-code feature enabled)
    if show_github_issue {
        render_github_issue_field(
            frame,
            "GitHub Issue (optional, for auto-code)",
            dialog.selected_issue_number,
            &dialog.github_issue_picker.issues,
            dialog.focus == CreateDialogFocus::GitHubIssue,
            inner[github_issue_idx],
        );
    }

    // Base branch field (for clone-based backends)
    render_text_field(
        frame,
        "Base Branch (optional, empty = default)",
        &dialog.base_branch,
        dialog.focus == CreateDialogFocus::BaseBranch,
        inner[base_branch_idx],
    );

    // Backend selection - show unavailable backends grayed out
    let sprites_available = is_backend_available(BackendType::Sprites);

    let sprites_label = if sprites_available {
        "Sprites"
    } else {
        "Sprites (not configured)"
    };

    // Conditionally build backend options based on feature flags
    let mut backend_options: Vec<(&str, bool, bool)> = vec![
        ("Zellij", dialog.backend == BackendType::Zellij, true),
        ("Docker", dialog.backend == BackendType::Docker, true),
    ];

    if dialog.feature_flags.enable_kubernetes_backend {
        backend_options.push((
            "Kubernetes",
            dialog.backend == BackendType::Kubernetes,
            true, // Always available, use dangerous-copy-creds if no proxy
        ));
    }

    backend_options.push((
        sprites_label,
        dialog.backend == BackendType::Sprites,
        sprites_available,
    ));

    #[cfg(target_os = "macos")]
    backend_options.push((
        "Apple Container",
        dialog.backend == BackendType::AppleContainer,
        true,
    ));

    render_backend_field(
        frame,
        "Backend",
        &backend_options,
        dialog.focus == CreateDialogFocus::Backend,
        inner[backend_idx],
    );

    // Agent selection
    render_radio_field(
        frame,
        "Agent",
        &[
            ("Claude Code", dialog.agent == AgentType::ClaudeCode),
            ("Codex", dialog.agent == AgentType::Codex),
            ("Gemini", dialog.agent == AgentType::Gemini),
        ],
        dialog.focus == CreateDialogFocus::Agent,
        inner[agent_idx],
    );

    // Model selection (shows models compatible with selected agent)
    let model_options = match dialog.agent {
        AgentType::ClaudeCode => vec![
            ("Default", dialog.model.is_none()),
            (
                "Sonnet 4.5",
                matches!(
                    dialog.model,
                    Some(SessionModel::Claude(ClaudeModel::Sonnet4_5))
                ),
            ),
            (
                "Opus 4.5",
                matches!(
                    dialog.model,
                    Some(SessionModel::Claude(ClaudeModel::Opus4_5))
                ),
            ),
            (
                "Haiku 4.5",
                matches!(
                    dialog.model,
                    Some(SessionModel::Claude(ClaudeModel::Haiku4_5))
                ),
            ),
            (
                "Opus 4.1",
                matches!(
                    dialog.model,
                    Some(SessionModel::Claude(ClaudeModel::Opus4_1))
                ),
            ),
            (
                "Opus 4",
                matches!(dialog.model, Some(SessionModel::Claude(ClaudeModel::Opus4))),
            ),
            (
                "Sonnet 4",
                matches!(
                    dialog.model,
                    Some(SessionModel::Claude(ClaudeModel::Sonnet4))
                ),
            ),
        ],
        AgentType::Codex => vec![
            ("Default", dialog.model.is_none()),
            (
                "GPT-5.2-Codex",
                matches!(
                    dialog.model,
                    Some(SessionModel::Codex(CodexModel::Gpt5_2Codex))
                ),
            ),
            (
                "GPT-5.2",
                matches!(dialog.model, Some(SessionModel::Codex(CodexModel::Gpt5_2))),
            ),
            (
                "GPT-5.2 Instant",
                matches!(
                    dialog.model,
                    Some(SessionModel::Codex(CodexModel::Gpt5_2Instant))
                ),
            ),
            (
                "GPT-5.2 Thinking",
                matches!(
                    dialog.model,
                    Some(SessionModel::Codex(CodexModel::Gpt5_2Thinking))
                ),
            ),
            (
                "GPT-5.2 Pro",
                matches!(
                    dialog.model,
                    Some(SessionModel::Codex(CodexModel::Gpt5_2Pro))
                ),
            ),
            (
                "GPT-5.1",
                matches!(dialog.model, Some(SessionModel::Codex(CodexModel::Gpt5_1))),
            ),
            (
                "GPT-5.1 Instant",
                matches!(
                    dialog.model,
                    Some(SessionModel::Codex(CodexModel::Gpt5_1Instant))
                ),
            ),
            (
                "GPT-5.1 Thinking",
                matches!(
                    dialog.model,
                    Some(SessionModel::Codex(CodexModel::Gpt5_1Thinking))
                ),
            ),
            (
                "GPT-4.1",
                matches!(dialog.model, Some(SessionModel::Codex(CodexModel::Gpt4_1))),
            ),
            (
                "o3-mini",
                matches!(dialog.model, Some(SessionModel::Codex(CodexModel::O3Mini))),
            ),
        ],
        AgentType::Gemini => vec![
            ("Default", dialog.model.is_none()),
            (
                "3 Pro",
                matches!(
                    dialog.model,
                    Some(SessionModel::Gemini(GeminiModel::Gemini3Pro))
                ),
            ),
            (
                "3 Flash",
                matches!(
                    dialog.model,
                    Some(SessionModel::Gemini(GeminiModel::Gemini3Flash))
                ),
            ),
            (
                "2.5 Pro",
                matches!(
                    dialog.model,
                    Some(SessionModel::Gemini(GeminiModel::Gemini2_5Pro))
                ),
            ),
            (
                "2.0 Flash",
                matches!(
                    dialog.model,
                    Some(SessionModel::Gemini(GeminiModel::Gemini2_0Flash))
                ),
            ),
        ],
    };

    render_radio_field(
        frame,
        "Model",
        &model_options,
        dialog.focus == CreateDialogFocus::Model,
        inner[model_idx],
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
        inner[access_idx],
    );

    // Skip checks checkbox
    render_checkbox_field(
        frame,
        "Dangerously skip checks",
        dialog.skip_checks,
        dialog.focus == CreateDialogFocus::SkipChecks,
        inner[skip_checks_idx],
    );

    // Plan mode checkbox
    render_checkbox_field(
        frame,
        "Start in plan mode",
        dialog.plan_mode,
        dialog.focus == CreateDialogFocus::PlanMode,
        inner[plan_mode_idx],
    );

    // Dangerous copy creds checkbox (only show for K8s when proxy not configured)
    if show_copy_creds {
        render_checkbox_field(
            frame,
            "Copy credentials to container (dangerous, no proxy)",
            dialog.dangerous_copy_creds,
            dialog.focus == CreateDialogFocus::DangerousCopyCreds,
            inner[dangerous_copy_creds_idx],
        );
    }

    // K8s-specific options (only show when K8s backend is selected)
    if is_k8s {
        // Container image text field
        render_text_field(
            frame,
            "Container Image (optional)",
            &dialog.container_image,
            dialog.focus == CreateDialogFocus::ContainerImage,
            inner[container_image_idx],
        );

        // Pull policy radio buttons
        render_radio_field(
            frame,
            "Pull Policy",
            &[
                (
                    "IfNotPresent",
                    dialog.pull_policy == ImagePullPolicy::IfNotPresent,
                ),
                ("Always", dialog.pull_policy == ImagePullPolicy::Always),
                ("Never", dialog.pull_policy == ImagePullPolicy::Never),
            ],
            dialog.focus == CreateDialogFocus::PullPolicy,
            inner[pull_policy_idx],
        );

        // Storage class text field
        render_text_field(
            frame,
            "Storage Class (optional)",
            &dialog.storage_class,
            dialog.focus == CreateDialogFocus::StorageClass,
            inner[storage_class_idx],
        );
    }

    // Buttons
    render_buttons(
        frame,
        dialog.focus == CreateDialogFocus::Buttons,
        dialog.button_create_focused,
        inner[buttons_idx],
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

    // Render GitHub issue picker modal if active
    if app.create_dialog.github_issue_picker.is_active {
        use super::issue_picker;

        // Create centered modal within the create dialog
        let picker_area = centered_rect_in_area(80, 70, area);

        // Clear the area and render picker
        frame.render_widget(Clear, picker_area);
        issue_picker::render(frame, &app.create_dialog.github_issue_picker, picker_area);
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

    // Show cursor when focused
    let display_value = if focused {
        format!("{value}▏")
    } else if value.is_empty() {
        "(not set)".to_string()
    } else {
        value.to_string()
    };

    let value_style = if value.is_empty() && !focused {
        Style::default().fg(Color::DarkGray)
    } else {
        Style::default()
    };

    let paragraph = Paragraph::new(Span::styled(display_value, value_style)).block(block);
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

fn render_images_field(frame: &mut Frame, images: &[String], area: Rect) {
    let block = Block::default()
        .title(" 📎 Attached Images (Ctrl+Backspace to remove last) ")
        .borders(Borders::ALL)
        .border_style(Style::default().fg(Color::Blue));

    // Create list of image file names
    let image_lines: Vec<Line> = images
        .iter()
        .enumerate()
        .map(|(i, path)| {
            let filename = std::path::Path::new(path)
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or(path);
            Line::from(vec![
                Span::styled(
                    format!("  [{}] ", i + 1),
                    Style::default()
                        .fg(Color::Blue)
                        .add_modifier(Modifier::BOLD),
                ),
                Span::raw(filename),
            ])
        })
        .collect();

    let paragraph = Paragraph::new(image_lines).block(block);
    frame.render_widget(paragraph, area);
}

fn render_github_issue_field(
    frame: &mut Frame,
    label: &str,
    selected_issue_number: Option<u32>,
    issues: &[crate::github::GitHubIssue],
    focused: bool,
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

    let display_value = if let Some(number) = selected_issue_number {
        // Find the issue title from the issues list
        issues
            .iter()
            .find(|i| i.number == number)
            .map(|i| format!("#{} - {}", i.number, i.title))
            .unwrap_or_else(|| format!("#{}", number))
    } else if focused {
        "(Press Enter to select)".to_string()
    } else {
        "(no issue)".to_string()
    };

    let value_style = if selected_issue_number.is_none() {
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

/// Render backend selection field with availability status
/// Options format: (label, selected, available)
fn render_backend_field(
    frame: &mut Frame,
    label: &str,
    options: &[(&str, bool, bool)],
    focused: bool,
    area: Rect,
) {
    let base_style = if focused {
        Style::default().fg(Color::Yellow)
    } else {
        Style::default()
    };

    let spans: Vec<Span> = options
        .iter()
        .enumerate()
        .flat_map(|(i, (name, selected, available))| {
            let indicator = if *selected { "(•)" } else { "( )" };

            // Use gray color for unavailable backends
            let option_style = if *available {
                base_style
            } else {
                Style::default().fg(Color::DarkGray)
            };

            let mut result = vec![
                Span::styled(indicator, option_style),
                Span::raw(" "),
                Span::styled(*name, option_style),
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
