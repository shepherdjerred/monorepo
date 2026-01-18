use std::collections::HashMap;
use std::path::PathBuf;

use nucleo_matcher::Utf32String;
use tokio::sync::mpsc;
use tokio::task::JoinHandle;
use uuid::Uuid;

use crate::api::console_protocol::SignalType;
use crate::api::{ApiClient, Client};
use crate::core::session::SessionModel;
use crate::core::{AccessMode, AgentType, BackendType, Session, SessionStatus};
use crate::tui::attached::PtySession;

/// Progress update from background session creation task
#[derive(Debug, Clone)]
pub enum CreateProgress {
    /// Progress step update
    Step {
        step: u32,
        total: u32,
        message: String,
    },
    /// Session creation completed successfully
    Done { session_name: String },
    /// Session creation failed
    Error { message: String },
}

/// Progress update from background session deletion task
#[derive(Debug, Clone)]
pub enum DeleteProgress {
    /// Deletion completed successfully
    Done { session_id: String },
    /// Deletion failed
    Error { session_id: String, message: String },
}

/// Session filter for displaying different subsets of sessions
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum SessionFilter {
    /// All non-archived sessions (default view)
    #[default]
    All,
    /// Only sessions with Running status
    Running,
    /// Only sessions with Idle status
    Idle,
    /// Only sessions with Completed status
    Completed,
    /// Only archived sessions
    Archived,
}

impl SessionFilter {
    /// Cycle to the next filter in sequence
    #[must_use]
    pub fn cycle_next(self) -> Self {
        match self {
            Self::All => Self::Running,
            Self::Running => Self::Idle,
            Self::Idle => Self::Completed,
            Self::Completed => Self::Archived,
            Self::Archived => Self::All,
        }
    }

    /// Get the display name for this filter
    #[must_use]
    pub fn display_name(self) -> &'static str {
        match self {
            Self::All => "All",
            Self::Running => "Running",
            Self::Idle => "Idle",
            Self::Completed => "Completed",
            Self::Archived => "Archived",
        }
    }
}

/// The current view/mode of the application
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum AppMode {
    #[default]
    SessionList,
    CreateDialog,
    ConfirmDelete,
    Help,
    /// Attached to a session via PTY
    Attached,
    /// Copy mode - navigate and select text from terminal buffer
    CopyMode,
    /// Locked mode - forward all keys to application except unlock key
    Locked,
    /// Scroll mode - scroll terminal buffer
    Scroll,
    /// Showing reconcile error details for a session
    ReconcileError,
    /// Signal menu dialog
    SignalMenu,
}

/// Copy mode state for text selection and navigation
#[derive(Debug, Clone)]
pub struct CopyModeState {
    /// Cursor position in terminal buffer
    pub cursor_row: u16,
    pub cursor_col: u16,

    /// Selection start position (when 'v' pressed)
    pub selection_start: Option<(u16, u16)>,

    /// Selection end position (follows cursor)
    pub selection_end: Option<(u16, u16)>,

    /// Whether in visual selection mode
    pub visual_mode: bool,
}

impl CopyModeState {
    /// Create new copy mode state with cursor at bottom-left
    #[must_use]
    pub fn new(rows: u16, _cols: u16) -> Self {
        Self {
            cursor_row: rows.saturating_sub(1),
            cursor_col: 0,
            selection_start: None,
            selection_end: None,
            visual_mode: false,
        }
    }

    /// Create new copy mode state with cursor at specific position
    #[must_use]
    pub fn new_with_cursor(row: u16, col: u16) -> Self {
        Self {
            cursor_row: row,
            cursor_col: col,
            selection_start: None,
            selection_end: None,
            visual_mode: false,
        }
    }
}

/// Signal menu dialog state
#[derive(Debug, Clone)]
pub struct SignalMenuState {
    /// Currently selected signal index
    pub selected_index: usize,

    /// Available signals to send
    pub signals: Vec<SignalType>,
}

impl Default for SignalMenuState {
    fn default() -> Self {
        Self::new()
    }
}

impl SignalMenuState {
    /// Create new signal menu state
    /// Note: Only signals with control character equivalents are included (SIGINT, SIGTSTP, SIGQUIT).
    /// Other signals like SIGTERM, SIGKILL, etc. are not yet supported for PTY-based forwarding.
    #[must_use]
    pub fn new() -> Self {
        Self {
            selected_index: 0,
            signals: vec![SignalType::Sigint, SignalType::Sigtstp, SignalType::Sigquit],
        }
    }

    /// Select next signal in list
    pub fn select_next(&mut self) {
        if self.selected_index < self.signals.len().saturating_sub(1) {
            self.selected_index = self.selected_index.saturating_add(1);
        }
    }

    /// Select previous signal in list
    pub fn select_previous(&mut self) {
        self.selected_index = self.selected_index.saturating_sub(1);
    }

    /// Get currently selected signal
    #[must_use]
    pub fn selected_signal(&self) -> SignalType {
        self.signals[self.selected_index]
    }
}

/// Result of sending a signal
#[derive(Debug, Clone)]
pub enum SignalResult {
    /// Signal sent successfully
    Success(SignalType),
    /// Signal send failed
    Error { signal: SignalType, message: String },
}

/// Input focus for create dialog
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum CreateDialogFocus {
    #[default]
    Prompt,
    RepoPath,
    Backend,
    Agent,
    Model,
    AccessMode,
    SkipChecks,
    PlanMode,
    Buttons,
}

/// A directory entry for the picker
#[derive(Debug, Clone)]
pub struct DirEntry {
    /// Entry name (directory name only, not full path)
    pub name: String,
    /// Full path to the entry
    pub path: PathBuf,
    /// Subdirectory component (for recent repos with subdirectories)
    pub subdirectory: PathBuf,
    /// Whether this is the parent directory (..)
    pub is_parent: bool,
    /// Whether this is from recent repos list
    pub is_recent: bool,
}

/// Directory picker state
#[derive(Debug, Clone)]
pub struct DirectoryPickerState {
    /// Current directory being browsed
    pub current_dir: PathBuf,
    /// All directory entries in current directory
    pub all_entries: Vec<DirEntry>,
    /// Recent repositories
    pub recent_repos: Vec<DirEntry>,
    /// Filtered entries based on search query
    pub filtered_entries: Vec<DirEntry>,
    /// Current search query
    pub search_query: String,
    /// Selected index in filtered list
    pub selected_index: usize,
    /// Whether picker is currently active
    pub is_active: bool,
    /// Error message if directory read failed
    pub error: Option<String>,
    /// Fuzzy matcher instance
    matcher: nucleo_matcher::Matcher,
}

/// Create dialog state
#[derive(Debug, Clone)]
pub struct CreateDialogState {
    pub prompt: String,
    pub repo_path: String,
    pub backend: BackendType,
    pub agent: AgentType,
    pub model: Option<SessionModel>,
    pub skip_checks: bool,
    pub plan_mode: bool,
    pub access_mode: AccessMode,

    /// Image file paths to attach to the prompt.
    ///
    /// Note: Currently there is no UI for selecting/attaching images in the TUI.
    /// Images can only be provided via the API. A file picker UI will be added
    /// in a future update to allow interactive image selection.
    pub images: Vec<String>,

    /// Cursor position in prompt field (line and column)
    pub prompt_cursor_line: usize,
    pub prompt_cursor_col: usize,
    pub prompt_scroll_offset: usize,
    pub focus: CreateDialogFocus,
    pub button_create_focused: bool, // true = Create, false = Cancel
    pub directory_picker: DirectoryPickerState,
    /// Feature flags (for conditional backend availability)
    pub feature_flags: std::sync::Arc<crate::feature_flags::FeatureFlags>,
}

impl DirectoryPickerState {
    /// Create a new directory picker state
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Load recent repositories from structured data with timestamps
    pub fn load_recent_repos(&mut self, repo_dtos: Vec<crate::api::protocol::RecentRepoDto>) {
        self.recent_repos = repo_dtos
            .into_iter()
            .filter_map(|dto| {
                let path = PathBuf::from(&dto.repo_path);
                // Note: The store already filters non-existent paths, but we double-check here
                if !path.exists() {
                    return None;
                }
                let repo_name = path.file_name().map_or_else(
                    || dto.repo_path.clone(),
                    |n| n.to_string_lossy().to_string(),
                );

                // Store subdirectory component
                let subdirectory = PathBuf::from(&dto.subdirectory);

                // Include subdirectory in the display name if present
                let name = if dto.subdirectory.is_empty() {
                    repo_name
                } else {
                    format!("{} → {}", repo_name, dto.subdirectory)
                };

                Some(DirEntry {
                    name,
                    path,
                    subdirectory,
                    is_parent: false,
                    is_recent: true,
                })
            })
            .collect();
    }

    /// Open the directory picker with an optional initial path
    pub fn open(&mut self, initial_path: Option<PathBuf>) {
        self.is_active = true;

        if let Some(path) = initial_path {
            if path.exists() && path.is_dir() {
                self.current_dir = path;
            }
        } else {
            // Default to current working directory
            self.current_dir = std::env::current_dir().unwrap_or_default();
        }

        self.search_query.clear();
        self.selected_index = 0;
        self.error = None;
        self.refresh_entries();
    }

    /// Close the directory picker
    pub fn close(&mut self) {
        self.is_active = false;
        self.search_query.clear();
        self.error = None;
    }

    /// Refresh directory entries from current directory
    pub fn refresh_entries(&mut self) {
        self.error = None;
        self.all_entries.clear();

        // Add parent directory entry if not at root
        if let Some(parent) = self.current_dir.parent() {
            self.all_entries.push(DirEntry {
                name: "..".to_string(),
                path: parent.to_path_buf(),
                subdirectory: PathBuf::new(),
                is_parent: true,
                is_recent: false,
            });
        }

        // Read directories
        match crate::utils::read_directories(&self.current_dir) {
            Ok(dirs) => {
                for dir in dirs {
                    if let Some(name) = dir.file_name() {
                        self.all_entries.push(DirEntry {
                            name: name.to_string_lossy().to_string(),
                            path: dir,
                            subdirectory: PathBuf::new(),
                            is_parent: false,
                            is_recent: false,
                        });
                    }
                }
            }
            Err(e) => {
                self.error = Some(format!("Cannot read directory: {e}"));
            }
        }

        self.apply_filter();
    }

    /// Apply fuzzy filter to entries based on search query
    pub fn apply_filter(&mut self) {
        if self.search_query.is_empty() {
            // When no search query, show recent repos first, then current directory entries
            self.filtered_entries = self.recent_repos.clone();
            self.filtered_entries.extend(self.all_entries.clone());
        } else {
            // Score and filter entries
            // Convert search query to Utf32String once
            let needle = Utf32String::from(self.search_query.as_str());

            // Combine recent repos and current directory entries for searching
            // Clone to avoid potential issues with concurrent modifications
            let all_searchable: Vec<DirEntry> = {
                let mut combined =
                    Vec::with_capacity(self.recent_repos.len() + self.all_entries.len());
                combined.extend(self.recent_repos.iter().cloned());
                combined.extend(self.all_entries.iter().cloned());
                combined
            };

            let mut scored: Vec<(DirEntry, u16)> = all_searchable
                .iter()
                .filter_map(|entry| {
                    // Never filter out parent directory
                    if entry.is_parent {
                        return Some((entry.clone(), u16::MAX));
                    }

                    // Convert entry name to Utf32String and use nucleo-matcher for fuzzy matching
                    let haystack = Utf32String::from(entry.name.as_str());
                    self.matcher
                        .fuzzy_match(haystack.slice(..), needle.slice(..))
                        .map(|score| (entry.clone(), score))
                })
                .collect();

            // Sort by score (descending)
            scored.sort_by(|a, b| b.1.cmp(&a.1));

            self.filtered_entries = scored.into_iter().map(|(entry, _)| entry).collect();
        }

        // Clamp selected index
        if !self.filtered_entries.is_empty() && self.selected_index >= self.filtered_entries.len() {
            self.selected_index = self.filtered_entries.len() - 1;
        }
    }

    /// Navigate to the next entry in the list
    pub fn select_next(&mut self) {
        if !self.filtered_entries.is_empty()
            && self.selected_index < self.filtered_entries.len() - 1
        {
            self.selected_index += 1;
        }
    }

    /// Navigate to the previous entry in the list
    pub fn select_previous(&mut self) {
        if self.selected_index > 0 {
            self.selected_index -= 1;
        }
    }

    /// Add a character to the search query
    pub fn add_search_char(&mut self, c: char) {
        self.search_query.push(c);
    }

    /// Remove the last character from the search query
    pub fn remove_search_char(&mut self) {
        self.search_query.pop();
    }

    /// Clear the search query
    pub fn clear_search(&mut self) {
        self.search_query.clear();
    }

    /// Navigate to parent directory
    pub fn navigate_to_parent(&mut self) {
        if let Some(parent) = self.current_dir.parent() {
            self.current_dir = parent.to_path_buf();
            self.search_query.clear();
            self.refresh_entries();
        }
    }

    /// Get the currently selected entry
    #[must_use]
    pub fn selected_entry(&self) -> Option<&DirEntry> {
        self.filtered_entries.get(self.selected_index)
    }
}

impl Default for DirectoryPickerState {
    fn default() -> Self {
        Self {
            current_dir: std::env::current_dir().unwrap_or_default(),
            all_entries: Vec::new(),
            recent_repos: Vec::new(),
            filtered_entries: Vec::new(),
            search_query: String::new(),
            selected_index: 0,
            is_active: false,
            error: None,
            matcher: nucleo_matcher::Matcher::new(nucleo_matcher::Config::DEFAULT),
        }
    }
}

impl CreateDialogState {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    pub fn reset(&mut self) {
        *self = Self::new();
    }

    /// Cycle through backends: Zellij → Docker → Kubernetes → Sprites → [AppleContainer] → Zellij, auto-adjusting skip_checks
    pub fn toggle_backend(&mut self) {
        self.backend = match self.backend {
            BackendType::Zellij => BackendType::Docker,
            BackendType::Docker => {
                // Skip Kubernetes if feature flag is disabled
                if self.feature_flags.enable_kubernetes_backend {
                    BackendType::Kubernetes
                } else {
                    BackendType::Sprites
                }
            }
            BackendType::Kubernetes => BackendType::Sprites,
            #[cfg(target_os = "macos")]
            BackendType::Sprites => BackendType::AppleContainer,
            #[cfg(target_os = "macos")]
            BackendType::AppleContainer => BackendType::Zellij,
            #[cfg(not(target_os = "macos"))]
            BackendType::Sprites => BackendType::Zellij,
        };

        // Auto-toggle skip_checks based on backend:
        // Docker, Kubernetes, Sprites, and AppleContainer benefit from skipping checks (isolated environments)
        // Zellij runs locally so checks are more important
        #[cfg(target_os = "macos")]
        {
            self.skip_checks = matches!(
                self.backend,
                BackendType::Docker
                    | BackendType::Kubernetes
                    | BackendType::Sprites
                    | BackendType::AppleContainer
            );
        }
        #[cfg(not(target_os = "macos"))]
        {
            self.skip_checks = matches!(
                self.backend,
                BackendType::Docker | BackendType::Kubernetes | BackendType::Sprites
            );
        }
    }

    /// Cycle through backends in reverse: Zellij → [AppleContainer] → Sprites → Kubernetes → Docker → Zellij
    pub fn toggle_backend_reverse(&mut self) {
        self.backend = match self.backend {
            #[cfg(target_os = "macos")]
            BackendType::Zellij => BackendType::AppleContainer,
            #[cfg(target_os = "macos")]
            BackendType::AppleContainer => BackendType::Sprites,
            #[cfg(not(target_os = "macos"))]
            BackendType::Zellij => BackendType::Sprites,
            BackendType::Sprites => {
                // Skip Kubernetes if feature flag is disabled
                if self.feature_flags.enable_kubernetes_backend {
                    BackendType::Kubernetes
                } else {
                    BackendType::Docker
                }
            }
            BackendType::Kubernetes => BackendType::Docker,
            BackendType::Docker => BackendType::Zellij,
        };

        // Auto-toggle skip_checks based on backend (same logic as forward toggle)
        #[cfg(target_os = "macos")]
        let is_container_backend = matches!(
            self.backend,
            BackendType::Docker
                | BackendType::Kubernetes
                | BackendType::Sprites
                | BackendType::AppleContainer
        );
        #[cfg(not(target_os = "macos"))]
        let is_container_backend = matches!(
            self.backend,
            BackendType::Docker | BackendType::Kubernetes | BackendType::Sprites
        );
        self.skip_checks = is_container_backend;
    }

    /// Toggle between ReadOnly and ReadWrite access modes
    pub fn toggle_access_mode(&mut self) {
        self.access_mode = match self.access_mode {
            AccessMode::ReadOnly => AccessMode::ReadWrite,
            AccessMode::ReadWrite => AccessMode::ReadOnly,
        };
    }

    /// Toggle through available models for the current agent
    pub fn toggle_model(&mut self) {
        use crate::core::session::{ClaudeModel, CodexModel, GeminiModel};

        self.model = match self.agent {
            AgentType::ClaudeCode => match &self.model {
                Some(SessionModel::Claude(ClaudeModel::Sonnet4_5)) => {
                    Some(SessionModel::Claude(ClaudeModel::Opus4_5))
                }
                Some(SessionModel::Claude(ClaudeModel::Opus4_5)) => {
                    Some(SessionModel::Claude(ClaudeModel::Haiku4_5))
                }
                Some(SessionModel::Claude(ClaudeModel::Haiku4_5)) => {
                    Some(SessionModel::Claude(ClaudeModel::Opus4_1))
                }
                Some(SessionModel::Claude(ClaudeModel::Opus4_1)) => {
                    Some(SessionModel::Claude(ClaudeModel::Opus4))
                }
                Some(SessionModel::Claude(ClaudeModel::Opus4)) => {
                    Some(SessionModel::Claude(ClaudeModel::Sonnet4))
                }
                Some(SessionModel::Claude(ClaudeModel::Sonnet4)) => None,
                None | _ => Some(SessionModel::Claude(ClaudeModel::Sonnet4_5)),
            },
            AgentType::Codex => match &self.model {
                Some(SessionModel::Codex(CodexModel::Gpt5_2Codex)) => {
                    Some(SessionModel::Codex(CodexModel::Gpt5_2))
                }
                Some(SessionModel::Codex(CodexModel::Gpt5_2)) => {
                    Some(SessionModel::Codex(CodexModel::Gpt5_2Instant))
                }
                Some(SessionModel::Codex(CodexModel::Gpt5_2Instant)) => {
                    Some(SessionModel::Codex(CodexModel::Gpt5_2Thinking))
                }
                Some(SessionModel::Codex(CodexModel::Gpt5_2Thinking)) => {
                    Some(SessionModel::Codex(CodexModel::Gpt5_2Pro))
                }
                Some(SessionModel::Codex(CodexModel::Gpt5_2Pro)) => {
                    Some(SessionModel::Codex(CodexModel::Gpt5_1))
                }
                Some(SessionModel::Codex(CodexModel::Gpt5_1)) => {
                    Some(SessionModel::Codex(CodexModel::Gpt5_1Instant))
                }
                Some(SessionModel::Codex(CodexModel::Gpt5_1Instant)) => {
                    Some(SessionModel::Codex(CodexModel::Gpt5_1Thinking))
                }
                Some(SessionModel::Codex(CodexModel::Gpt5_1Thinking)) => {
                    Some(SessionModel::Codex(CodexModel::Gpt4_1))
                }
                Some(SessionModel::Codex(CodexModel::Gpt4_1)) => {
                    Some(SessionModel::Codex(CodexModel::O3Mini))
                }
                Some(SessionModel::Codex(CodexModel::O3Mini)) => None,
                None | _ => Some(SessionModel::Codex(CodexModel::Gpt5_2Codex)),
            },
            AgentType::Gemini => match &self.model {
                Some(SessionModel::Gemini(GeminiModel::Gemini3Pro)) => {
                    Some(SessionModel::Gemini(GeminiModel::Gemini3Flash))
                }
                Some(SessionModel::Gemini(GeminiModel::Gemini3Flash)) => {
                    Some(SessionModel::Gemini(GeminiModel::Gemini2_5Pro))
                }
                Some(SessionModel::Gemini(GeminiModel::Gemini2_5Pro)) => {
                    Some(SessionModel::Gemini(GeminiModel::Gemini2_0Flash))
                }
                Some(SessionModel::Gemini(GeminiModel::Gemini2_0Flash)) => None,
                None | _ => Some(SessionModel::Gemini(GeminiModel::Gemini3Pro)),
            },
        };
    }

    /// Cycle through agents: ClaudeCode -> Codex -> Gemini -> ClaudeCode
    pub fn toggle_agent(&mut self) {
        self.agent = match self.agent {
            AgentType::ClaudeCode => AgentType::Codex,
            AgentType::Codex => AgentType::Gemini,
            AgentType::Gemini => AgentType::ClaudeCode,
        };
    }

    /// Cycle through agents in reverse: ClaudeCode -> Gemini -> Codex -> ClaudeCode
    pub fn toggle_agent_reverse(&mut self) {
        self.agent = match self.agent {
            AgentType::ClaudeCode => AgentType::Gemini,
            AgentType::Gemini => AgentType::Codex,
            AgentType::Codex => AgentType::ClaudeCode,
        };
    }

    /// Scroll the prompt field up
    pub fn scroll_prompt_up(&mut self) {
        if self.prompt_scroll_offset > 0 {
            self.prompt_scroll_offset -= 1;
        }
    }

    /// Scroll the prompt field down
    pub fn scroll_prompt_down(&mut self, visible_lines: usize) {
        // Calculate total lines in the prompt
        let total_lines = self.prompt.lines().count().max(1);

        // Only scroll if there are more lines than visible
        if total_lines > visible_lines {
            let max_offset = total_lines.saturating_sub(visible_lines);
            if self.prompt_scroll_offset < max_offset {
                self.prompt_scroll_offset += 1;
            }
        }
    }

    /// Clamp scroll offset to valid range when prompt content changes
    pub fn clamp_prompt_scroll(&mut self) {
        let total_lines = self.prompt.lines().count().max(1);
        // Assume ~10 visible lines (matches events.rs)
        let visible_lines = 10;

        if total_lines <= visible_lines {
            // All content fits, reset scroll
            self.prompt_scroll_offset = 0;
        } else {
            // Clamp to valid range
            let max_offset = total_lines.saturating_sub(visible_lines);
            if self.prompt_scroll_offset > max_offset {
                self.prompt_scroll_offset = max_offset;
            }
        }
    }

    /// Calculate the number of visible lines in the prompt field
    ///
    /// This matches the logic in create_dialog.rs rendering to ensure scroll
    /// calculations stay in sync with the actual displayed height.
    #[must_use]
    pub fn prompt_visible_lines(&self) -> usize {
        let prompt_lines = self.prompt.lines().count().max(1);
        prompt_lines.clamp(5, 15) // Min 5, max 15 lines
    }

    /// Ensure the cursor is visible in the prompt field by adjusting scroll offset
    pub fn ensure_cursor_visible(&mut self) {
        let visible_lines = self.prompt_visible_lines();
        let cursor_line = self.prompt_cursor_line;

        // If cursor is above the visible area, scroll up
        if cursor_line < self.prompt_scroll_offset {
            self.prompt_scroll_offset = cursor_line;
        }

        // If cursor is below the visible area, scroll down
        if cursor_line >= self.prompt_scroll_offset + visible_lines {
            self.prompt_scroll_offset = cursor_line.saturating_sub(visible_lines - 1);
        }

        // Clamp scroll to valid range
        self.clamp_prompt_scroll();
    }

    /// Remove an image from the attached images list
    pub fn remove_image(&mut self, index: usize) {
        if index < self.images.len() {
            self.images.remove(index);
        }
    }
}

impl Default for CreateDialogState {
    fn default() -> Self {
        Self {
            prompt: String::new(),
            repo_path: String::new(),
            backend: BackendType::Zellij, // Default to Zellij
            agent: AgentType::ClaudeCode,
            model: None, // Default to CLI default
            skip_checks: false,
            plan_mode: true,                    // Default to plan mode ON
            access_mode: AccessMode::default(), // ReadOnly by default (secure)
            images: Vec::new(),
            prompt_cursor_line: 0,
            prompt_cursor_col: 0,
            prompt_scroll_offset: 0,
            focus: CreateDialogFocus::default(),
            button_create_focused: false,
            directory_picker: DirectoryPickerState::new(),
            feature_flags: std::sync::Arc::new(crate::feature_flags::FeatureFlags::default()),
        }
    }
}

/// Main application state
pub struct App {
    /// Current mode/view
    pub mode: AppMode,

    /// All sessions
    pub sessions: Vec<Session>,

    /// Currently selected session index (indexes into filtered session list)
    pub selected_index: usize,

    /// Current session filter
    pub session_filter: SessionFilter,

    /// Create dialog state
    pub create_dialog: CreateDialogState,

    /// Session pending deletion (for confirm dialog)
    pub pending_delete: Option<String>,

    /// Status message to display
    pub status_message: Option<String>,

    /// Whether the app should quit
    pub should_quit: bool,

    /// API client (boxed trait for dependency injection)
    client: Option<Box<dyn ApiClient>>,

    /// Error message if client connection failed
    pub connection_error: Option<String>,

    /// Loading message to display during long operations
    pub loading_message: Option<String>,

    /// Current progress step during session creation
    pub progress_step: Option<(u32, u32, String)>, // (step, total, message)

    /// Channel receiver for progress updates from background tasks
    pub progress_rx: Option<mpsc::Receiver<CreateProgress>>,

    /// Handle to the background create task (for potential cancellation)
    pub create_task: Option<JoinHandle<()>>,

    /// Background task for session deletion
    pub delete_task: Option<JoinHandle<()>>,

    /// Receiver for deletion progress updates
    pub delete_progress_rx: Option<mpsc::Receiver<DeleteProgress>>,

    /// ID of session being deleted (for showing loading state)
    pub deleting_session_id: Option<String>,

    /// Tick counter for spinner animation
    pub spinner_tick: u64,

    // === PTY Session Management ===
    /// All active PTY sessions (persist when detached)
    pub pty_sessions: HashMap<Uuid, PtySession>,

    /// Currently attached session ID (if in Attached mode)
    pub attached_session_id: Option<Uuid>,

    /// Terminal dimensions for PTY resize
    pub terminal_size: (u16, u16),

    /// Flag to trigger launching external editor for prompt field
    pub launch_editor: bool,

    /// Copy mode state (when in CopyMode)
    pub copy_mode_state: Option<CopyModeState>,

    /// Session ID for reconcile error dialog (when in ReconcileError mode)
    pub reconcile_error_session_id: Option<Uuid>,

    /// Signal menu dialog state (None = closed)
    pub signal_menu: Option<SignalMenuState>,

    /// Last signal send result for status display
    pub last_signal_result: Option<SignalResult>,
}

impl App {
    /// Create a new App instance
    #[must_use]
    pub fn new() -> Self {
        Self {
            mode: AppMode::SessionList,
            sessions: Vec::new(),
            selected_index: 0,
            session_filter: SessionFilter::All,
            create_dialog: CreateDialogState::new(),
            pending_delete: None,
            status_message: None,
            should_quit: false,
            client: None,
            connection_error: None,
            loading_message: None,
            progress_step: None,
            progress_rx: None,
            create_task: None,
            delete_task: None,
            delete_progress_rx: None,
            deleting_session_id: None,
            spinner_tick: 0,
            // PTY session management
            pty_sessions: HashMap::new(),
            attached_session_id: None,
            terminal_size: (24, 80), // Default size, updated on resize
            launch_editor: false,
            copy_mode_state: None,
            reconcile_error_session_id: None,
            signal_menu: None,
            last_signal_result: None,
        }
    }

    /// Connect to the daemon
    ///
    /// # Errors
    ///
    /// Returns an error if the daemon connection fails.
    pub async fn connect(&mut self) -> anyhow::Result<()> {
        match Client::connect().await {
            Ok(client) => {
                self.client = Some(Box::new(client));
                self.connection_error = None;
                Ok(())
            }
            Err(e) => {
                self.connection_error = Some(e.to_string());
                Err(e)
            }
        }
    }

    /// Set a custom API client (for testing)
    pub fn set_client(&mut self, client: Box<dyn ApiClient>) {
        self.client = Some(client);
        self.connection_error = None;
    }

    /// Check if connected to daemon
    #[must_use]
    pub const fn is_connected(&self) -> bool {
        self.client.is_some()
    }

    /// Refresh the session list from the daemon
    ///
    /// # Errors
    ///
    /// Returns an error if fetching sessions from daemon fails.
    pub async fn refresh_sessions(&mut self) -> anyhow::Result<()> {
        if let Some(client) = &mut self.client {
            self.sessions = client.list_sessions().await?;
            // Clamp selected index to filtered list bounds
            let filtered_count = self.get_filtered_sessions().len();
            if filtered_count > 0 && self.selected_index >= filtered_count {
                self.selected_index = filtered_count - 1;
            } else if filtered_count == 0 {
                self.selected_index = 0;
            }
        }
        Ok(())
    }

    /// Get the currently selected session
    #[must_use]
    pub fn selected_session(&self) -> Option<&Session> {
        let filtered = self.get_filtered_sessions();
        filtered.get(self.selected_index).copied()
    }

    /// Get filtered sessions based on the active filter
    #[must_use]
    pub fn get_filtered_sessions(&self) -> Vec<&Session> {
        match self.session_filter {
            SessionFilter::All => self
                .sessions
                .iter()
                .filter(|s| s.status != SessionStatus::Archived)
                .collect(),
            SessionFilter::Running => self
                .sessions
                .iter()
                .filter(|s| s.status == SessionStatus::Running)
                .collect(),
            SessionFilter::Idle => self
                .sessions
                .iter()
                .filter(|s| s.status == SessionStatus::Idle)
                .collect(),
            SessionFilter::Completed => self
                .sessions
                .iter()
                .filter(|s| s.status == SessionStatus::Completed)
                .collect(),
            SessionFilter::Archived => self
                .sessions
                .iter()
                .filter(|s| s.status == SessionStatus::Archived)
                .collect(),
        }
    }

    /// Get count of sessions for a specific filter
    #[must_use]
    pub fn get_filter_count(&self, filter: SessionFilter) -> usize {
        match filter {
            SessionFilter::All => self
                .sessions
                .iter()
                .filter(|s| s.status != SessionStatus::Archived)
                .count(),
            SessionFilter::Running => self
                .sessions
                .iter()
                .filter(|s| s.status == SessionStatus::Running)
                .count(),
            SessionFilter::Idle => self
                .sessions
                .iter()
                .filter(|s| s.status == SessionStatus::Idle)
                .count(),
            SessionFilter::Completed => self
                .sessions
                .iter()
                .filter(|s| s.status == SessionStatus::Completed)
                .count(),
            SessionFilter::Archived => self
                .sessions
                .iter()
                .filter(|s| s.status == SessionStatus::Archived)
                .count(),
        }
    }

    /// Set the active filter and clamp selection to valid range
    pub fn set_filter(&mut self, filter: SessionFilter) {
        self.session_filter = filter;
        let filtered_count = self.get_filtered_sessions().len();
        if filtered_count == 0 {
            self.selected_index = 0;
        } else if self.selected_index >= filtered_count {
            self.selected_index = filtered_count - 1;
        }
    }

    /// Cycle to the next filter
    pub fn cycle_filter_next(&mut self) {
        let next_filter = self.session_filter.cycle_next();
        self.set_filter(next_filter);
    }

    /// Move selection up
    pub fn select_previous(&mut self) {
        if self.selected_index > 0 {
            self.selected_index -= 1;
        }
    }

    /// Move selection down
    pub fn select_next(&mut self) {
        let filtered_count = self.get_filtered_sessions().len();
        if filtered_count > 0 && self.selected_index < filtered_count - 1 {
            self.selected_index += 1;
        }
    }

    /// Open the create dialog
    pub fn open_create_dialog(&mut self) {
        self.create_dialog.reset();
        self.mode = AppMode::CreateDialog;
    }

    /// Close the create dialog
    pub const fn close_create_dialog(&mut self) {
        self.mode = AppMode::SessionList;
    }

    /// Open delete confirmation
    pub fn open_delete_confirm(&mut self) {
        if let Some(session) = self.selected_session() {
            self.pending_delete = Some(session.id.to_string());
            self.mode = AppMode::ConfirmDelete;
        }
    }

    /// Cancel delete
    pub fn cancel_delete(&mut self) {
        self.pending_delete = None;
        self.mode = AppMode::SessionList;
    }

    /// Delete the pending session
    ///
    /// Spawns a background task to perform the deletion asynchronously to keep
    /// the TUI responsive. This follows the same pattern as session creation.
    ///
    /// # Behavior
    ///
    /// - Spawns a tokio task that connects to the daemon and performs deletion
    /// - Sets `deleting_session_id` to show spinner indicator in UI
    /// - Progress updates are sent via `delete_progress_rx` channel
    /// - Main event loop polls the channel and handles completion/errors
    /// - Blocks deletion if a create operation is in progress
    ///
    /// # State Changes
    ///
    /// - Sets `delete_task` to Some(JoinHandle) while deletion is in progress
    /// - Sets `delete_progress_rx` to receive progress updates
    /// - Sets `deleting_session_id` to show which session is being deleted
    /// - Returns to `SessionList` mode immediately (non-blocking)
    pub fn confirm_delete(&mut self) {
        if let Some(id) = self.pending_delete.take() {
            // Prevent multiple concurrent deletes
            if self.delete_task.is_some() {
                return;
            }

            // Don't allow deletion while creation is in progress
            if self.create_task.is_some() {
                self.status_message = Some("Cannot delete while creating a session".to_string());
                return;
            }

            // Create channel for deletion updates
            let (tx, rx) = mpsc::channel(4);
            self.delete_progress_rx = Some(rx);
            self.deleting_session_id = Some(id.clone());

            // Take the stored client if available (for testing with mock clients)
            // If not available, we'll connect to daemon in the task
            let injected_client = self.client.take();

            // Spawn background task
            let task = tokio::spawn(async move {
                // Use injected client or connect to daemon
                let mut client: Box<dyn ApiClient> = match injected_client {
                    Some(c) => c,
                    None => match Client::connect().await {
                        Ok(c) => Box::new(c),
                        Err(e) => {
                            let _ = tx
                                .send(DeleteProgress::Error {
                                    session_id: id.clone(),
                                    message: format!("Failed to connect to daemon: {e}"),
                                })
                                .await;
                            return;
                        }
                    },
                };

                // Perform deletion
                match client.delete_session(&id).await {
                    Ok(()) => {
                        let _ = tx
                            .send(DeleteProgress::Done {
                                session_id: id.clone(),
                            })
                            .await;
                    }
                    Err(e) => {
                        let _ = tx
                            .send(DeleteProgress::Error {
                                session_id: id.clone(),
                                message: format!("[DELETE_ERROR] {e}"),
                            })
                            .await;
                    }
                }
            });

            self.delete_task = Some(task);
        }
        self.mode = AppMode::SessionList;
    }

    /// Archive the selected session
    ///
    /// # Errors
    ///
    /// Returns an error if archiving fails.
    pub async fn archive_selected(&mut self) -> anyhow::Result<()> {
        if let Some(session) = self.selected_session() {
            let id = session.id.to_string();
            if let Some(client) = &mut self.client {
                client.archive_session(&id).await?;
                self.status_message = Some(format!("Archived session {id}"));
                self.refresh_sessions().await?;
            }
        }
        Ok(())
    }

    /// Unarchive the selected session
    ///
    /// # Errors
    ///
    /// Returns an error if unarchiving fails.
    pub async fn unarchive_selected(&mut self) -> anyhow::Result<()> {
        if let Some(session) = self.selected_session() {
            let id = session.id.to_string();
            if let Some(client) = &mut self.client {
                client.unarchive_session(&id).await?;
                self.status_message = Some(format!("Unarchived session {id}"));
                self.refresh_sessions().await?;
            }
        }
        Ok(())
    }

    /// Refresh the selected session (pull latest image and recreate container)
    ///
    /// # Errors
    ///
    /// Returns an error if the refresh fails.
    pub async fn refresh_selected(&mut self) -> anyhow::Result<()> {
        if let Some(session) = self.selected_session() {
            // Only allow for Docker sessions
            if session.backend != crate::core::session::BackendType::Docker {
                self.status_message = Some("Refresh only works with Docker sessions".to_string());
                return Ok(());
            }

            let id = session.id.to_string();
            let name = session.name.clone();

            if let Some(client) = &mut self.client {
                self.status_message = Some(format!("Refreshing session {name}..."));
                match client.refresh_session(&id).await {
                    Ok(()) => {
                        self.status_message =
                            Some(format!("Successfully refreshed session {name}"));
                        self.refresh_sessions().await?;
                    }
                    Err(e) => {
                        self.status_message = Some(format!("Refresh failed: {e}"));
                    }
                }
            }
        }
        Ok(())
    }

    /// Get the attach command for the selected session
    ///
    /// # Errors
    ///
    /// Returns an error if getting the attach command fails.
    pub async fn get_attach_command(&mut self) -> anyhow::Result<Option<Vec<String>>> {
        if let Some(session) = self.selected_session() {
            let id = session.id.to_string();
            if let Some(client) = &mut self.client {
                let command = client.attach_session(&id).await?;
                return Ok(Some(command));
            }
        }
        Ok(None)
    }

    /// Create a new session from the dialog
    ///
    /// # Errors
    ///
    /// Returns an error if session creation fails.
    pub async fn create_session_from_dialog(&mut self) -> anyhow::Result<()> {
        use crate::api::protocol::CreateSessionRequest;
        use crate::core::{AgentType, BackendType};

        let request = CreateSessionRequest {
            repo_path: self.create_dialog.repo_path.clone(),
            repositories: None, // TUI doesn't support multi-repo yet
            initial_prompt: self.create_dialog.prompt.clone(),
            backend: self.create_dialog.backend,
            agent: self.create_dialog.agent,
            model: self.create_dialog.model.clone(), // Use selected model from dialog
            dangerous_skip_checks: self.create_dialog.skip_checks,
            print_mode: false, // TUI always uses interactive mode
            plan_mode: self.create_dialog.plan_mode,
            access_mode: self.create_dialog.access_mode,
            images: self.create_dialog.images.clone(),
            container_image: None, // TODO: Add TUI fields for container customization
            pull_policy: None,
            cpu_limit: None,
            memory_limit: None,
            storage_class: None, // TUI doesn't support storage class selection yet
        };

        if let Some(client) = &mut self.client {
            let (session, warnings) = client.create_session(request).await?;
            self.loading_message = None;
            self.progress_step = None;

            // Build status message, including any warnings
            let mut status = format!("Created session {name}", name = session.name);
            if let Some(warns) = warnings {
                use std::fmt::Write;
                for warn in warns {
                    let _ = write!(status, " (Warning: {warn})");
                }
            }
            self.status_message = Some(status);

            self.refresh_sessions().await?;
        }

        self.close_create_dialog();
        Ok(())
    }

    /// Trigger reconciliation
    ///
    /// # Errors
    ///
    /// Returns an error if reconciliation fails.
    pub async fn reconcile(&mut self) -> anyhow::Result<()> {
        if let Some(client) = &mut self.client {
            let report = client.reconcile().await?;

            // Build a detailed status message
            let mut parts = Vec::new();

            if !report.recreated.is_empty() {
                parts.push(format!("✓ {} recreated", report.recreated.len()));
            }
            if !report.recreation_failed.is_empty() {
                parts.push(format!("✗ {} failed", report.recreation_failed.len()));
            }
            if !report.gave_up.is_empty() {
                parts.push(format!("⚠ {} gave up", report.gave_up.len()));
            }
            if !report.missing_worktrees.is_empty() {
                parts.push(format!(
                    "{} missing worktrees",
                    report.missing_worktrees.len()
                ));
            }
            if !report.missing_backends.is_empty() {
                parts.push(format!(
                    "{} missing backends",
                    report.missing_backends.len()
                ));
            }
            if !report.orphaned_backends.is_empty() {
                parts.push(format!("{} orphaned", report.orphaned_backends.len()));
            }

            let msg = if parts.is_empty() {
                "All sessions healthy".to_string()
            } else {
                format!("Reconciled: {}", parts.join(", "))
            };
            self.status_message = Some(msg);

            // Refresh sessions to get updated state
            self.refresh_sessions().await?;
        }
        Ok(())
    }

    /// Load recent repositories into the directory picker
    pub async fn load_recent_repos(&mut self) {
        if let Some(client) = &mut self.client {
            match client.get_recent_repos().await {
                Ok(repos) => {
                    self.create_dialog.directory_picker.load_recent_repos(repos);
                }
                Err(e) => {
                    tracing::warn!("Failed to load recent repos: {e}");
                    // Show a subtle status message to inform the user
                    self.status_message = Some(format!("Note: Recent repos unavailable ({e})"));
                }
            }
        }
    }

    /// Toggle help view
    pub fn toggle_help(&mut self) {
        if self.mode == AppMode::Help {
            self.mode = AppMode::SessionList;
        } else {
            self.mode = AppMode::Help;
        }
    }

    /// Show reconcile error dialog for a session
    pub fn show_reconcile_error(&mut self, session_id: Uuid) {
        self.reconcile_error_session_id = Some(session_id);
        self.mode = AppMode::ReconcileError;
    }

    /// Close reconcile error dialog
    pub fn close_reconcile_error(&mut self) {
        self.reconcile_error_session_id = None;
        self.mode = AppMode::SessionList;
    }

    /// Check if the selected session has a reconcile error and show the dialog if so
    ///
    /// Returns true if the dialog was shown, false otherwise
    pub fn try_show_selected_reconcile_error(&mut self) -> bool {
        if let Some(session) = self.selected_session() {
            if session.reconcile_attempts > 0 && session.last_reconcile_error.is_some() {
                let session_id = session.id;
                self.show_reconcile_error(session_id);
                return true;
            }
        }
        false
    }

    /// Get the session for the current reconcile error dialog
    #[must_use]
    pub fn reconcile_error_session(&self) -> Option<&Session> {
        self.reconcile_error_session_id
            .and_then(|id| self.sessions.iter().find(|s| s.id == id))
    }

    /// Request quit
    pub const fn quit(&mut self) {
        self.should_quit = true;
    }

    /// Increment spinner tick for animation
    pub fn tick(&mut self) {
        self.spinner_tick = self.spinner_tick.wrapping_add(1);
    }

    // === PTY Session Methods ===

    /// Attach to the selected session via PTY.
    ///
    /// Creates a new PTY session if one doesn't exist, or reattaches to an existing one.
    ///
    /// # Errors
    ///
    /// Returns an error if the session cannot be attached.
    pub async fn attach_selected_session(&mut self) -> anyhow::Result<()> {
        let session = self
            .selected_session()
            .ok_or_else(|| anyhow::anyhow!("No session selected"))?;

        // Only Docker sessions support PTY attachment for now
        if session.backend != crate::core::BackendType::Docker {
            return Err(anyhow::anyhow!(
                "PTY attachment only supported for Docker sessions"
            ));
        }

        let session_id = session.id;
        let container_id = session
            .backend_id
            .clone()
            .ok_or_else(|| anyhow::anyhow!("Session has no backend ID"))?;

        // Check if we already have a PTY session for this
        if self.pty_sessions.contains_key(&session_id) {
            // Already have a PTY session, just switch to it
            self.attached_session_id = Some(session_id);
            self.mode = AppMode::Attached;
            return Ok(());
        }

        // Create new PTY session
        let (rows, cols) = self.terminal_size;
        let pty_session =
            PtySession::spawn_docker_attach(session_id, container_id, rows, cols).await?;

        self.pty_sessions.insert(session_id, pty_session);
        self.attached_session_id = Some(session_id);
        self.mode = AppMode::Attached;

        Ok(())
    }

    /// Detach from the current session (but keep PTY alive).
    pub fn detach(&mut self) {
        self.attached_session_id = None;
        self.mode = AppMode::SessionList;
    }

    /// Enter copy mode from attached state
    pub fn enter_copy_mode(&mut self) {
        if self.mode == AppMode::Attached {
            // Try to get the actual cursor position from the terminal
            // Extract cursor position first to avoid borrow issues
            let cursor_pos = self.attached_pty_session().and_then(|pty_session| {
                let buffer = pty_session.terminal_buffer();
                buffer
                    .try_lock()
                    .ok()
                    .map(|buf| buf.screen().cursor_position())
            });

            if let Some((row, col)) = cursor_pos {
                self.copy_mode_state = Some(CopyModeState::new_with_cursor(row, col));
            } else {
                // Fallback to bottom-left if we can't get cursor position
                let (rows, cols) = self.terminal_size;
                self.copy_mode_state = Some(CopyModeState::new(rows, cols));
            }

            self.mode = AppMode::CopyMode;
            self.status_message = Some(
                "Copy mode | hjkl: move | v: select | y: yank | ?: help | q: exit".to_string(),
            );
        }
    }

    /// Exit copy mode back to attached state
    pub fn exit_copy_mode(&mut self) {
        if self.mode == AppMode::CopyMode {
            self.copy_mode_state = None;
            self.mode = AppMode::Attached;
            self.status_message = None;
        }
    }

    /// Enter locked mode (disables all keybindings except unlock)
    pub fn enter_locked_mode(&mut self) {
        if self.mode == AppMode::Attached {
            self.mode = AppMode::Locked;
            self.status_message = Some("🔒 LOCKED - Ctrl+L to unlock".to_string());
        }
    }

    /// Exit locked mode back to attached
    pub fn exit_locked_mode(&mut self) {
        if self.mode == AppMode::Locked {
            self.mode = AppMode::Attached;
            self.status_message = None;
        }
    }

    /// Toggle locked mode
    pub fn toggle_locked_mode(&mut self) {
        match self.mode {
            AppMode::Attached => self.enter_locked_mode(),
            AppMode::Locked => self.exit_locked_mode(),
            _ => {}
        }
    }

    /// Enter scroll mode from attached state
    pub fn enter_scroll_mode(&mut self) {
        if self.mode == AppMode::Attached {
            self.mode = AppMode::Scroll;
            self.status_message =
                Some("📜 SCROLL MODE - arrows/PgUp/PgDn to scroll, ESC to exit".to_string());
        }
    }

    /// Exit scroll mode back to attached
    pub fn exit_scroll_mode(&mut self) {
        if self.mode == AppMode::Scroll {
            self.mode = AppMode::Attached;
            self.status_message = None;
        }
    }

    /// Get the currently attached PTY session.
    #[must_use]
    pub fn attached_pty_session(&self) -> Option<&PtySession> {
        self.attached_session_id
            .and_then(|id| self.pty_sessions.get(&id))
    }

    /// Get the currently attached PTY session mutably.
    pub fn attached_pty_session_mut(&mut self) -> Option<&mut PtySession> {
        self.attached_session_id
            .and_then(|id| self.pty_sessions.get_mut(&id))
    }

    /// Open the signal menu dialog.
    pub fn open_signal_menu(&mut self) {
        self.signal_menu = Some(SignalMenuState::new());
        self.mode = AppMode::SignalMenu;
    }

    /// Close the signal menu dialog.
    pub fn close_signal_menu(&mut self) {
        self.signal_menu = None;
        self.mode = AppMode::Attached;
    }

    /// Send a signal to the attached PTY session.
    ///
    /// # Errors
    ///
    /// Returns an error if no PTY session is attached or signal sending fails.
    #[tracing::instrument(skip(self), fields(signal = ?signal))]
    pub async fn send_signal(&mut self, signal: SignalType) -> anyhow::Result<()> {
        if let Some(pty_session) = self.attached_pty_session() {
            match pty_session.send_signal(signal).await {
                Ok(()) => {
                    self.last_signal_result = Some(SignalResult::Success(signal));
                    self.status_message =
                        Some(format!("Sent {} to container", signal.display_name()));
                    tracing::info!(
                        signal = ?signal,
                        "Signal sent successfully"
                    );
                    Ok(())
                }
                Err(e) => {
                    let error_msg = e.to_string();
                    self.last_signal_result = Some(SignalResult::Error {
                        signal,
                        message: error_msg.clone(),
                    });
                    self.status_message = Some(format!("Failed to send signal: {error_msg}"));
                    tracing::error!(
                        signal = ?signal,
                        error = %e,
                        "Failed to send signal"
                    );
                    Err(e)
                }
            }
        } else {
            anyhow::bail!("No active PTY session")
        }
    }

    /// Update terminal size and resize any attached PTY.
    pub async fn set_terminal_size(&mut self, rows: u16, cols: u16) {
        self.terminal_size = (rows, cols);

        // Resize the currently attached PTY if any
        if let Some(pty_session) = self.attached_pty_session() {
            pty_session.resize(rows, cols).await;
        }
    }

    /// Send input to the attached PTY.
    ///
    /// # Errors
    ///
    /// Returns an error if there's no attached session or writing fails.
    pub async fn send_to_pty(&mut self, data: Vec<u8>) -> anyhow::Result<()> {
        let session = self
            .attached_pty_session()
            .ok_or_else(|| anyhow::anyhow!("No attached session"))?;
        session.write(data).await
    }

    /// Check if currently attached to a session.
    #[must_use]
    pub const fn is_attached(&self) -> bool {
        self.attached_session_id.is_some() && matches!(self.mode, AppMode::Attached)
    }

    /// Switch to the next Docker session while attached.
    /// Returns true if switched, false if no next session.
    pub async fn switch_to_next_session(&mut self) -> anyhow::Result<bool> {
        use crate::core::{BackendType, SessionStatus};

        // Get list of Docker sessions (only those support PTY)
        let docker_sessions: Vec<_> = self
            .sessions
            .iter()
            .filter(|s| {
                s.backend == BackendType::Docker
                    && s.backend_id.is_some()
                    && s.status != SessionStatus::Archived
            })
            .collect();

        if docker_sessions.len() <= 1 {
            return Ok(false);
        }

        // Find current session's index
        let current_idx = docker_sessions
            .iter()
            .position(|s| Some(s.id) == self.attached_session_id);

        let next_idx = match current_idx {
            Some(idx) => (idx + 1) % docker_sessions.len(),
            None => 0,
        };

        let next_session = docker_sessions[next_idx];
        let session_id = next_session.id;
        let container_id = next_session.backend_id.clone().unwrap();

        // Create PTY session if needed
        if !self.pty_sessions.contains_key(&session_id) {
            let (rows, cols) = self.terminal_size;
            let pty_session =
                PtySession::spawn_docker_attach(session_id, container_id, rows, cols).await?;
            self.pty_sessions.insert(session_id, pty_session);
        }

        // Update selected index in session list to match (search in filtered list)
        let filtered_sessions = self.get_filtered_sessions();
        if let Some(idx) = filtered_sessions.iter().position(|s| s.id == session_id) {
            self.selected_index = idx;
        }

        self.attached_session_id = Some(session_id);
        Ok(true)
    }

    /// Switch to the previous Docker session while attached.
    /// Returns true if switched, false if no previous session.
    pub async fn switch_to_previous_session(&mut self) -> anyhow::Result<bool> {
        use crate::core::{BackendType, SessionStatus};

        // Get list of Docker sessions (only those support PTY)
        let docker_sessions: Vec<_> = self
            .sessions
            .iter()
            .filter(|s| {
                s.backend == BackendType::Docker
                    && s.backend_id.is_some()
                    && s.status != SessionStatus::Archived
            })
            .collect();

        if docker_sessions.len() <= 1 {
            return Ok(false);
        }

        // Find current session's index
        let current_idx = docker_sessions
            .iter()
            .position(|s| Some(s.id) == self.attached_session_id);

        let prev_idx = match current_idx {
            Some(0) => docker_sessions.len() - 1,
            Some(idx) => idx - 1,
            None => 0,
        };

        let prev_session = docker_sessions[prev_idx];
        let session_id = prev_session.id;
        let container_id = prev_session.backend_id.clone().unwrap();

        // Create PTY session if needed
        if !self.pty_sessions.contains_key(&session_id) {
            let (rows, cols) = self.terminal_size;
            let pty_session =
                PtySession::spawn_docker_attach(session_id, container_id, rows, cols).await?;
            self.pty_sessions.insert(session_id, pty_session);
        }

        // Update selected index in session list to match (search in filtered list)
        let filtered_sessions = self.get_filtered_sessions();
        if let Some(idx) = filtered_sessions.iter().position(|s| s.id == session_id) {
            self.selected_index = idx;
        }

        self.attached_session_id = Some(session_id);
        Ok(true)
    }

    /// Shutdown all PTY sessions gracefully.
    pub async fn shutdown_all_pty_sessions(&mut self) {
        for (_, mut session) in self.pty_sessions.drain() {
            session.shutdown().await;
        }
        self.attached_session_id = None;
    }
}

impl Default for App {
    fn default() -> Self {
        Self::new()
    }
}
