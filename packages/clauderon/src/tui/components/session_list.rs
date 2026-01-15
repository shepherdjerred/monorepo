use ratatui::{
    Frame,
    layout::{Constraint, Layout, Rect},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, List, ListItem, ListState, Paragraph},
};
use unicode_width::UnicodeWidthStr;

use crate::core::{CheckStatus, ClaudeWorkingStatus, Session, SessionStatus};
use crate::tui::app::App;

/// Number of spaces between columns
const COLUMN_PADDING: usize = 2;

/// Column width configuration with min/max constraints
#[derive(Copy, Clone)]
struct ColumnWidths {
    name: usize,
    repository: usize,
    status: usize,
    backend: usize,
    branch_pr: usize,
    prefix_width: usize,
    claude_indicator: usize,
    ci_indicator: usize,
    conflict_indicator: usize,
}

impl ColumnWidths {
    /// Column constraints (min, max)
    const NAME_RANGE: (usize, usize) = (15, 40);
    const REPO_RANGE: (usize, usize) = (12, 30);
    const STATUS_RANGE: (usize, usize) = (8, 15);
    const BACKEND_RANGE: (usize, usize) = (10, 15);
    const BRANCH_PR_RANGE: (usize, usize) = (10, 25);

    /// Fixed widths
    const PREFIX_WIDTH: usize = 4;
    const CLAUDE_WIDTH: usize = 2;
    const CI_WIDTH: usize = 2;
    const CONFLICT_WIDTH: usize = 2;

    /// Calculate optimal column widths from session data
    fn calculate(sessions: &[Session], available_width: u16) -> Self {
        let mut max_name = Self::NAME_RANGE.0;
        let mut max_repo = Self::REPO_RANGE.0;
        let mut max_status = Self::STATUS_RANGE.0;
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

            // Backend (using Debug format)
            let backend_text = format!("{:?}", session.backend);
            max_backend = max_backend
                .max(backend_text.width())
                .min(Self::BACKEND_RANGE.1);

            // Branch/PR
            let pr_text = session
                .pr_url
                .as_ref()
                .map_or_else(|| session.branch_name.clone(), |_| "PR".to_string());
            max_branch = max_branch.max(pr_text.width()).min(Self::BRANCH_PR_RANGE.1);
        }

        let mut widths = Self {
            name: max_name,
            repository: max_repo,
            status: max_status,
            backend: max_backend,
            branch_pr: max_branch,
            prefix_width: Self::PREFIX_WIDTH,
            claude_indicator: Self::CLAUDE_WIDTH,
            ci_indicator: Self::CI_WIDTH,
            conflict_indicator: Self::CONFLICT_WIDTH,
        };

        // Check if total fits, shrink if needed
        if widths.total_width() > available_width as usize {
            widths.fit_to_width(available_width);
        }

        widths
    }

    /// Get total required width
    fn total_width(&self) -> usize {
        // 4 gaps between the 5 main columns (name, repo, status, backend, branch)
        let padding_width = 4 * COLUMN_PADDING;

        self.prefix_width
            + self.name
            + self.repository
            + self.status
            + self.backend
            + self.branch_pr
            + self.claude_indicator
            + self.ci_indicator
            + self.conflict_indicator
            + padding_width
    }

    /// Shrink proportionally if total exceeds available width
    fn fit_to_width(&mut self, available_width: u16) {
        let padding_width = 4 * COLUMN_PADDING;
        let fixed_width = self.prefix_width
            + self.claude_indicator
            + self.ci_indicator
            + self.conflict_indicator
            + padding_width;
        let available_for_columns = (available_width as usize).saturating_sub(fixed_width);

        let total_current =
            self.name + self.repository + self.status + self.backend + self.branch_pr;

        if total_current <= available_for_columns {
            return; // Already fits
        }

        // Calculate shrink ratio
        let shrink_ratio = available_for_columns as f64 / total_current as f64;

        // Apply proportional shrinking, respecting minimums
        self.name = ((self.name as f64 * shrink_ratio) as usize).max(Self::NAME_RANGE.0);
        self.repository =
            ((self.repository as f64 * shrink_ratio) as usize).max(Self::REPO_RANGE.0);
        self.status = ((self.status as f64 * shrink_ratio) as usize).max(Self::STATUS_RANGE.0);
        self.backend = ((self.backend as f64 * shrink_ratio) as usize).max(Self::BACKEND_RANGE.0);
        self.branch_pr =
            ((self.branch_pr as f64 * shrink_ratio) as usize).max(Self::BRANCH_PR_RANGE.0);

        // If still doesn't fit after respecting minimums, force to minimums
        let new_total = self.name + self.repository + self.status + self.backend + self.branch_pr;
        if new_total > available_for_columns {
            self.name = Self::NAME_RANGE.0;
            self.repository = Self::REPO_RANGE.0;
            self.status = Self::STATUS_RANGE.0;
            self.backend = Self::BACKEND_RANGE.0;
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
        return text.to_string();
    }

    // Need to truncate
    const ELLIPSIS: &str = "…";
    const ELLIPSIS_WIDTH: usize = 1;

    if max_width <= ELLIPSIS_WIDTH {
        return ELLIPSIS.to_string();
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
        text.to_string()
    } else {
        format!("{}{}", text, " ".repeat(width - text_width))
    }
}

/// Render the session list
pub fn render(frame: &mut Frame, app: &App, area: Rect) {
    let block = Block::default()
        .title(" Clauderon - Sessions ")
        .title_bottom(" [n]ew  [d]elete  [a]rchive  [f]refresh  [?]help  [q]uit ")
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

    // Calculate optimal column widths based on actual data
    let widths = ColumnWidths::calculate(&app.sessions, inner_area.width);

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
            pad_to_width("Backend", widths.backend),
            Style::default().fg(Color::DarkGray),
        ),
        Span::raw("  "), // Column padding
        Span::styled(
            pad_to_width("Branch/PR", widths.branch_pr),
            Style::default().fg(Color::DarkGray),
        ),
        Span::styled("◎", Style::default().fg(Color::DarkGray)),
        Span::raw(" "),
        Span::styled("CI", Style::default().fg(Color::DarkGray)),
        Span::raw(" "),
        Span::styled("⚠", Style::default().fg(Color::DarkGray)),
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

            // Merge conflict indicator
            let conflict_indicator = if session.merge_conflict {
                Span::styled("⚠", Style::default().fg(Color::Red))
            } else {
                Span::raw(" ")
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
                format!("⚠ {}", session.name)
            } else {
                session.name.clone()
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

            let backend_truncated = truncate_with_ellipsis(&backend_text, widths.backend);
            let backend_padded = pad_to_width(&backend_truncated, widths.backend);

            let pr_truncated = truncate_with_ellipsis(&pr_text, widths.branch_pr);
            let pr_padded = pad_to_width(&pr_truncated, widths.branch_pr);

            spans.extend(vec![
                Span::styled(name_padded, name_style),
                Span::raw("  "), // Column padding
                Span::raw(repo_padded),
                Span::raw("  "), // Column padding
                Span::styled(status_padded, status_style),
                Span::raw("  "), // Column padding
                Span::raw(backend_padded),
                Span::raw("  "), // Column padding
                Span::raw(pr_padded),
                claude_indicator,
                Span::raw(" "),
                check_indicator,
                Span::raw(" "),
                conflict_indicator,
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
