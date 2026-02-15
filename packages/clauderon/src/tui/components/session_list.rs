use ratatui::{
    Frame,
    layout::{Constraint, Layout, Rect},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, List, ListItem, ListState, Paragraph},
};
use unicode_width::UnicodeWidthStr;

use super::SPINNER_FRAMES;
use crate::core::session::ResourceState;
use crate::core::{CheckStatus, ClaudeWorkingStatus, Session, SessionStatus, WorkflowStage};
use crate::tui::app::App;

/// Number of spaces between columns
const COLUMN_PADDING: usize = 2;

/// Column width configuration with min/max constraints
#[derive(Copy, Clone)]
struct ColumnWidths {
    name: usize,
    repository: usize,
    status: usize,
    stage: usize,
    backend: usize,
    health: usize,
    branch_pr: usize,
    prefix_width: usize,
    claude_indicator: usize,
    ci_indicator: usize,
    conflict_indicator: usize,
    copycreds_indicator: usize,
}

impl ColumnWidths {
    /// Column constraints (min, max)
    const NAME_RANGE: (usize, usize) = (15, 40);
    const REPO_RANGE: (usize, usize) = (12, 30);
    const STATUS_RANGE: (usize, usize) = (8, 15);
    const STAGE_RANGE: (usize, usize) = (6, 8);
    const BACKEND_RANGE: (usize, usize) = (10, 15);
    const HEALTH_RANGE: (usize, usize) = (8, 18); // "OK" to "Deleted Externally"
    const BRANCH_PR_RANGE: (usize, usize) = (10, 25);

    /// Fixed widths
    const PREFIX_WIDTH: usize = 4;
    const CLAUDE_WIDTH: usize = 2;
    const CI_WIDTH: usize = 2;
    const CONFLICT_WIDTH: usize = 2;
    const COPYCREDS_WIDTH: usize = 2;

    /// Calculate optimal column widths from session data
    fn calculate(sessions: &[Session], available_width: u16) -> Self {
        let mut max_name = Self::NAME_RANGE.0;
        let mut max_repo = Self::REPO_RANGE.0;
        let mut max_status = Self::STATUS_RANGE.0;
        let mut max_stage = Self::STAGE_RANGE.0;
        let mut max_backend = Self::BACKEND_RANGE.0;
        let mut max_branch = Self::BRANCH_PR_RANGE.0;

        // Scan all sessions to find max widths
        for session in sessions {
            // Name (account for reconcile error prefix "⚠ ")
            let has_reconcile_error =
                session.reconcile_attempts > 0 && session.last_reconcile_error.is_some();
            let name_width = if has_reconcile_error {
                "⚠ ".width() + session.name.width()
            } else {
                session.name.width()
            };
            max_name = max_name.max(name_width).min(Self::NAME_RANGE.1);

            // Repository (extract filename)
            let repo_name = session
                .repo_path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("unknown");
            max_repo = max_repo.max(repo_name.width()).min(Self::REPO_RANGE.1);

            // Status text
            let status_text = match session.status {
                SessionStatus::Creating => "Creating",
                SessionStatus::Deleting => "Deleting",
                SessionStatus::Running => "Running",
                SessionStatus::Idle => "Idle",
                SessionStatus::Completed => "Completed",
                SessionStatus::Failed => "Failed",
                SessionStatus::Archived => "Archived",
            };
            max_status = max_status
                .max(status_text.width())
                .min(Self::STATUS_RANGE.1);

            // Stage text
            let stage_text = match session.workflow_stage() {
                WorkflowStage::Planning => "Plan",
                WorkflowStage::Implementation => "Impl",
                WorkflowStage::Review => "Review",
                WorkflowStage::Blocked => "Blocked",
                WorkflowStage::ReadyToMerge => "Ready",
                WorkflowStage::Merged => "Merged",
            };
            max_stage = max_stage.max(stage_text.width()).min(Self::STAGE_RANGE.1);

            // Backend (using Debug format)
            let backend_text = format!("{:?}", session.backend);
            max_backend = max_backend
                .max(backend_text.width())
                .min(Self::BACKEND_RANGE.1);

            // Branch/PR
            let pr_text = session
                .pr_url
                .as_ref()
                .map_or_else(|| session.branch_name.clone(), |_| "PR".to_owned());
            max_branch = max_branch.max(pr_text.width()).min(Self::BRANCH_PR_RANGE.1);
        }

        // Health column uses a fixed minimum since we don't have health data during calculation
        // Longest text is "Worktree Missing" (16 chars)
        let health_width = Self::HEALTH_RANGE.0;

        let mut widths = Self {
            name: max_name,
            repository: max_repo,
            status: max_status,
            stage: max_stage,
            backend: max_backend,
            health: health_width,
            branch_pr: max_branch,
            prefix_width: Self::PREFIX_WIDTH,
            claude_indicator: Self::CLAUDE_WIDTH,
            ci_indicator: Self::CI_WIDTH,
            conflict_indicator: Self::CONFLICT_WIDTH,
            copycreds_indicator: Self::COPYCREDS_WIDTH,
        };

        // Check if total fits, shrink if needed
        if widths.total_width() > available_width as usize {
            widths.fit_to_width(available_width);
        }

        widths
    }

    /// Get total required width
    fn total_width(&self) -> usize {
        // 6 gaps between the 7 main columns (name, repo, status, stage, backend, health, branch)
        let padding_width = 6 * COLUMN_PADDING;

        self.prefix_width
            + self.name
            + self.repository
            + self.status
            + self.stage
            + self.backend
            + self.health
            + self.branch_pr
            + self.claude_indicator
            + self.ci_indicator
            + self.conflict_indicator
            + self.copycreds_indicator
            + padding_width
    }

    /// Shrink proportionally if total exceeds available width
    fn fit_to_width(&mut self, available_width: u16) {
        let padding_width = 5 * COLUMN_PADDING;
        let fixed_width = self.prefix_width
            + self.claude_indicator
            + self.ci_indicator
            + self.conflict_indicator
            + self.copycreds_indicator
            + padding_width;
        let available_for_columns = (available_width as usize).saturating_sub(fixed_width);

        let total_current = self.name
            + self.repository
            + self.status
            + self.stage
            + self.backend
            + self.health
            + self.branch_pr;

        if total_current <= available_for_columns {
            return; // Already fits
        }

        // Calculate shrink ratio
        #[expect(
            clippy::cast_precision_loss,
            reason = "column widths are small; precision loss is acceptable for proportional sizing"
        )]
        let shrink_ratio = available_for_columns as f64 / total_current as f64;

        // Apply proportional shrinking, respecting minimums
        #[expect(
            clippy::cast_possible_truncation,
            clippy::cast_sign_loss,
            clippy::cast_precision_loss,
            reason = "proportional column sizing; values are small and clamped"
        )]
        let name_shrunk = (self.name as f64 * shrink_ratio).max(0.0).round() as usize;
        self.name = name_shrunk.max(Self::NAME_RANGE.0);

        #[expect(
            clippy::cast_possible_truncation,
            clippy::cast_sign_loss,
            clippy::cast_precision_loss,
            reason = "proportional column sizing; values are small and clamped"
        )]
        let repo_shrunk = (self.repository as f64 * shrink_ratio).max(0.0).round() as usize;
        self.repository = repo_shrunk.max(Self::REPO_RANGE.0);

        #[expect(
            clippy::cast_possible_truncation,
            clippy::cast_sign_loss,
            clippy::cast_precision_loss,
            reason = "proportional column sizing; values are small and clamped"
        )]
        let status_shrunk = (self.status as f64 * shrink_ratio).max(0.0).round() as usize;
        self.status = status_shrunk.max(Self::STATUS_RANGE.0);

        #[expect(
            clippy::cast_possible_truncation,
            clippy::cast_sign_loss,
            clippy::cast_precision_loss,
            reason = "proportional column sizing; values are small and clamped"
        )]
        let stage_shrunk = (self.stage as f64 * shrink_ratio).max(0.0).round() as usize;
        self.stage = stage_shrunk.max(Self::STAGE_RANGE.0);

        #[expect(
            clippy::cast_possible_truncation,
            clippy::cast_sign_loss,
            clippy::cast_precision_loss,
            reason = "proportional column sizing; values are small and clamped"
        )]
        let backend_shrunk = (self.backend as f64 * shrink_ratio).max(0.0).round() as usize;
        self.backend = backend_shrunk.max(Self::BACKEND_RANGE.0);

        #[expect(
            clippy::cast_possible_truncation,
            clippy::cast_sign_loss,
            clippy::cast_precision_loss,
            reason = "proportional column sizing; values are small and clamped"
        )]
        let health_shrunk = (self.health as f64 * shrink_ratio).max(0.0).round() as usize;
        self.health = health_shrunk.max(Self::HEALTH_RANGE.0);

        #[expect(
            clippy::cast_possible_truncation,
            clippy::cast_sign_loss,
            clippy::cast_precision_loss,
            reason = "proportional column sizing; values are small and clamped"
        )]
        let branch_pr_shrunk = (self.branch_pr as f64 * shrink_ratio).max(0.0).round() as usize;
        self.branch_pr = branch_pr_shrunk.max(Self::BRANCH_PR_RANGE.0);

        // If still doesn't fit after respecting minimums, force to minimums
        let new_total = self.name
            + self.repository
            + self.status
            + self.stage
            + self.backend
            + self.health
            + self.branch_pr;
        if new_total > available_for_columns {
            self.name = Self::NAME_RANGE.0;
            self.repository = Self::REPO_RANGE.0;
            self.status = Self::STATUS_RANGE.0;
            self.stage = Self::STAGE_RANGE.0;
            self.backend = Self::BACKEND_RANGE.0;
            self.health = Self::HEALTH_RANGE.0;
            self.branch_pr = Self::BRANCH_PR_RANGE.0;
        }
    }
}

/// Truncate string to max width with ellipsis, Unicode-aware
fn truncate_with_ellipsis(text: &str, max_width: usize) -> String {
    use unicode_width::UnicodeWidthChar;

    // Handle edge case: zero width requested
    if max_width == 0 {
        return String::new();
    }

    let text_width = text.width();

    if text_width <= max_width {
        return text.to_owned();
    }

    // Need to truncate
    const ELLIPSIS: &str = "…";
    const ELLIPSIS_WIDTH: usize = 1;

    if max_width <= ELLIPSIS_WIDTH {
        return ELLIPSIS.to_owned();
    }

    let target_width = max_width - ELLIPSIS_WIDTH;
    let mut current_width = 0;
    let mut char_boundary = 0;

    for (idx, ch) in text.char_indices() {
        let char_width = ch.width().unwrap_or(0);
        if current_width + char_width > target_width {
            break;
        }
        current_width += char_width;
        char_boundary = idx + ch.len_utf8();
    }

    format!("{}{}", &text[..char_boundary], ELLIPSIS)
}

/// Pad string to width, Unicode-aware
fn pad_to_width(text: &str, width: usize) -> String {
    let text_width = text.width();
    if text_width >= width {
        text.to_owned()
    } else {
        format!("{}{}", text, " ".repeat(width - text_width))
    }
}

/// Get health text and color from ResourceState
fn health_display(state: &ResourceState) -> (&'static str, Color) {
    match state {
        ResourceState::Healthy => ("OK", Color::Green),
        ResourceState::Stopped => ("Stopped", Color::Yellow),
        ResourceState::Hibernated => ("Hibernated", Color::Cyan),
        ResourceState::Pending => ("Pending", Color::Yellow),
        ResourceState::Missing => ("Missing", Color::Red),
        ResourceState::Error { .. } => ("Error", Color::Red),
        ResourceState::CrashLoop => ("Crash Loop", Color::Red),
        ResourceState::DeletedExternally => ("Deleted Ext.", Color::Red),
        ResourceState::DataLost { .. } => ("Data Lost", Color::Magenta),
        ResourceState::WorktreeMissing => ("No Worktree", Color::Red),
    }
}

/// Render the session list
pub fn render(frame: &mut Frame<'_>, app: &App, area: Rect) {
    // Split area vertically: filter header (1 line) + session list
    let layout = Layout::vertical([Constraint::Length(1), Constraint::Min(0)]).split(area);
    let filter_area = layout[0];
    let list_area = layout[1];

    // Render filter header
    super::filter_header::render(frame, app, filter_area);

    let block = Block::default()
        .title(" Clauderon - Sessions ")
        .title_bottom(" [1-5]filter  [n]ew  [d]elete  [a]rchive  [f]refresh  [?]help  [q]uit ")
        .borders(Borders::ALL)
        .border_style(Style::default().fg(Color::Cyan));

    let filtered_sessions = app.get_filtered_sessions();

    if filtered_sessions.is_empty() {
        let empty_msg = Line::from(vec![
            Span::raw("No sessions in this filter. Press "),
            Span::styled("1-5", Style::default().fg(Color::Cyan)),
            Span::raw(" to change filter or "),
            Span::styled("n", Style::default().fg(Color::Green)),
            Span::raw(" to create one."),
        ]);
        let paragraph = Paragraph::new(empty_msg).block(block);
        frame.render_widget(paragraph, list_area);
        return;
    }

    // Render the block and get the inner area
    let inner_area = block.inner(list_area);
    frame.render_widget(block, list_area);

    // Split inner area into header and list
    let chunks = Layout::vertical([Constraint::Length(1), Constraint::Min(0)]).split(inner_area);
    let header_area = chunks[0];
    let table_area = chunks[1];

    // Calculate optimal column widths based on filtered sessions
    let sessions_slice: Vec<Session> = filtered_sessions.iter().map(|&s| s.clone()).collect();
    let widths = ColumnWidths::calculate(&sessions_slice, inner_area.width);

    // Render header row
    let header = Line::from(vec![
        Span::styled(" ".repeat(widths.prefix_width), Style::default()),
        Span::styled(
            pad_to_width("Name", widths.name),
            Style::default().fg(Color::DarkGray),
        ),
        Span::raw("  "), // Column padding
        Span::styled(
            pad_to_width("Repository", widths.repository),
            Style::default().fg(Color::DarkGray),
        ),
        Span::raw("  "), // Column padding
        Span::styled(
            pad_to_width("Status", widths.status),
            Style::default().fg(Color::DarkGray),
        ),
        Span::raw("  "), // Column padding
        Span::styled(
            pad_to_width("Stage", widths.stage),
            Style::default().fg(Color::DarkGray),
        ),
        Span::raw("  "), // Column padding
        Span::styled(
            pad_to_width("Backend", widths.backend),
            Style::default().fg(Color::DarkGray),
        ),
        Span::raw("  "), // Column padding
        Span::styled(
            pad_to_width("Health", widths.health),
            Style::default().fg(Color::DarkGray),
        ),
        Span::raw("  "), // Column padding
        Span::styled(
            pad_to_width("Branch/PR", widths.branch_pr),
            Style::default().fg(Color::DarkGray),
        ),
        Span::raw("  "), // Column padding
        Span::styled("◎", Style::default().fg(Color::DarkGray)),
        Span::raw(" "),
        Span::styled("CI", Style::default().fg(Color::DarkGray)),
        Span::raw(" "),
        Span::styled("⚠", Style::default().fg(Color::DarkGray)),
        Span::raw(" "),
        Span::styled("🔓", Style::default().fg(Color::DarkGray)), // Copy-creds indicator header
    ]);
    frame.render_widget(Paragraph::new(header), header_area);

    let items: Vec<ListItem<'_>> = filtered_sessions
        .iter()
        .map(|session| {
            let status_style = match session.status {
                SessionStatus::Creating | SessionStatus::Deleting => {
                    Style::default().fg(Color::Yellow)
                }
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
                    // Safe cast: SPINNER_FRAMES.len() is small, modulo result fits in usize
                    #[expect(
                        clippy::cast_possible_truncation,
                        reason = "SPINNER_FRAMES.len() is small; modulo result fits in usize"
                    )]
                    let spinner_idx = (app.spinner_tick % SPINNER_FRAMES.len() as u64) as usize;
                    let spinner = SPINNER_FRAMES[spinner_idx];
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

            // Merge conflict indicator
            let conflict_indicator = if session.merge_conflict {
                Span::styled("⚠", Style::default().fg(Color::Red))
            } else {
                Span::raw(" ")
            };

            // Copy-creds mode indicator (degraded status tracking)
            let copycreds_indicator = if session.dangerous_copy_creds {
                Span::styled("🔓", Style::default().fg(Color::Yellow))
            } else {
                Span::raw("  ")
            };

            let backend_text = format!("{:?}", session.backend);
            let _agent_text = match session.agent {
                crate::core::AgentType::ClaudeCode => "Claude",
                crate::core::AgentType::Codex => "Codex",
                crate::core::AgentType::Gemini => "Gemini",
            };
            let pr_text = session
                .pr_url
                .as_ref()
                .map_or_else(|| session.branch_name.clone(), |_| "PR".to_owned());

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
                // Safe cast: SPINNER_FRAMES.len() is small, modulo result fits in usize
                #[expect(
                    clippy::cast_possible_truncation,
                    reason = "SPINNER_FRAMES.len() is small; modulo result fits in usize"
                )]
                let spinner_idx = (app.spinner_tick % SPINNER_FRAMES.len() as u64) as usize;
                let spinner = SPINNER_FRAMES[spinner_idx];
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

            // Use title if available, otherwise fall back to name
            let display_name = session.title.as_ref().unwrap_or(&session.name);

            // Format session name with optional warning indicator
            let name_display = if has_reconcile_error {
                format!("⚠ {}", display_name)
            } else {
                display_name.clone()
            };

            let name_style = if has_reconcile_error {
                Style::default()
                    .fg(Color::Yellow)
                    .add_modifier(Modifier::BOLD)
            } else {
                Style::default().add_modifier(Modifier::BOLD)
            };

            // Truncate and pad each field
            let name_truncated = truncate_with_ellipsis(&name_display, widths.name);
            let name_padded = pad_to_width(&name_truncated, widths.name);

            let repo_truncated = truncate_with_ellipsis(repo_name, widths.repository);
            let repo_padded = pad_to_width(&repo_truncated, widths.repository);

            let status_truncated = truncate_with_ellipsis(status_text, widths.status);
            let status_padded = pad_to_width(&status_truncated, widths.status);

            // Workflow stage text and color
            let (stage_text, stage_color) = match session.workflow_stage() {
                WorkflowStage::Planning => ("Plan", Color::Blue),
                WorkflowStage::Implementation => ("Impl", Color::Cyan),
                WorkflowStage::Review => ("Review", Color::Yellow),
                WorkflowStage::Blocked => ("Blocked", Color::Red),
                WorkflowStage::ReadyToMerge => ("Ready", Color::Green),
                WorkflowStage::Merged => ("Merged", Color::DarkGray),
            };
            let stage_truncated = truncate_with_ellipsis(stage_text, widths.stage);
            let stage_padded = pad_to_width(&stage_truncated, widths.stage);

            let backend_truncated = truncate_with_ellipsis(&backend_text, widths.backend);
            let backend_padded = pad_to_width(&backend_truncated, widths.backend);

            // Health column - get from cached health data
            let (health_text, health_color) = app
                .get_session_health(session.id)
                .map_or(("--", Color::DarkGray), |report| {
                    health_display(&report.state)
                });
            let health_truncated = truncate_with_ellipsis(health_text, widths.health);
            let health_padded = pad_to_width(&health_truncated, widths.health);

            let pr_truncated = truncate_with_ellipsis(&pr_text, widths.branch_pr);
            let pr_padded = pad_to_width(&pr_truncated, widths.branch_pr);

            spans.extend(vec![
                Span::styled(name_padded, name_style),
                Span::raw("  "), // Column padding
                Span::raw(repo_padded),
                Span::raw("  "), // Column padding
                Span::styled(status_padded, status_style),
                Span::raw("  "), // Column padding
                Span::styled(stage_padded, Style::default().fg(stage_color)),
                Span::raw("  "), // Column padding
                Span::raw(backend_padded),
                Span::raw("  "), // Column padding
                Span::styled(health_padded, Style::default().fg(health_color)),
                Span::raw("  "), // Column padding
                Span::raw(pr_padded),
                Span::raw("  "), // Column padding
                claude_indicator,
                Span::raw(" "),
                check_indicator,
                Span::raw(" "),
                conflict_indicator,
                Span::raw(" "),
                copycreds_indicator,
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

    frame.render_stateful_widget(list, table_area, &mut state);
}
