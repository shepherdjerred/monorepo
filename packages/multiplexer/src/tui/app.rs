use crate::api::{ApiClient, Client};
use crate::core::Session;
use nucleo_matcher::Utf32String;
use std::path::PathBuf;
use tokio::sync::mpsc;
use tokio::task::JoinHandle;

/// Progress update from background session creation task
#[derive(Debug, Clone)]
pub enum CreateProgress {
    /// Progress step update
    Step { step: u32, total: u32, message: String },
    /// Session creation completed successfully
    Done { session_name: String },
    /// Session creation failed
    Error { message: String },
}

/// The current view/mode of the application
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum AppMode {
    #[default]
    SessionList,
    CreateDialog,
    ConfirmDelete,
    Help,
}

/// Input focus for create dialog
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum CreateDialogFocus {
    #[default]
    Name,
    Prompt,
    RepoPath,
    Backend,
    SkipChecks,
    Buttons,
}

/// A directory entry for the picker
#[derive(Debug, Clone)]
pub struct DirEntry {
    /// Entry name (directory name only, not full path)
    pub name: String,
    /// Full path to the entry
    pub path: PathBuf,
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
    pub name: String,
    pub prompt: String,
    pub repo_path: String,
    pub backend_zellij: bool, // true = Zellij, false = Docker
    pub skip_checks: bool,
    pub focus: CreateDialogFocus,
    pub button_create_focused: bool, // true = Create, false = Cancel
    pub directory_picker: DirectoryPickerState,
}

impl DirectoryPickerState {
    /// Create a new directory picker state
    #[must_use]
    pub fn new() -> Self {
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

    /// Load recent repositories from a list of paths
    pub fn load_recent_repos(&mut self, repo_paths: Vec<String>) {
        self.recent_repos = repo_paths
            .into_iter()
            .filter_map(|path_str| {
                let path = PathBuf::from(&path_str);
                if !path.exists() {
                    return None;
                }
                let name = path
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or(path_str);
                Some(DirEntry {
                    name,
                    path,
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
                let mut combined = Vec::with_capacity(self.recent_repos.len() + self.all_entries.len());
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
        if !self.filtered_entries.is_empty() && self.selected_index >= self.filtered_entries.len()
        {
            self.selected_index = self.filtered_entries.len() - 1;
        }
    }

    /// Navigate to the next entry in the list
    pub fn select_next(&mut self) {
        if !self.filtered_entries.is_empty() && self.selected_index < self.filtered_entries.len() - 1
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

impl CreateDialogState {
    #[must_use]
    pub fn new() -> Self {
        Self {
            name: String::new(),
            prompt: String::new(),
            repo_path: String::new(),
            backend_zellij: true, // Default to Zellij
            skip_checks: false,
            focus: CreateDialogFocus::default(),
            button_create_focused: false,
            directory_picker: DirectoryPickerState::new(),
        }
    }

    pub fn reset(&mut self) {
        *self = Self::new();
    }

    /// Toggle between Zellij and Docker backends, auto-adjusting skip_checks
    pub fn toggle_backend(&mut self) {
        let was_zellij = self.backend_zellij;
        self.backend_zellij = !was_zellij;

        // Auto-toggle skip_checks based on backend:
        // Docker benefits from skipping checks (isolated environment)
        // Zellij runs locally so checks are more important
        self.skip_checks = !self.backend_zellij;
    }
}

/// Main application state
pub struct App {
    /// Current mode/view
    pub mode: AppMode,

    /// All sessions
    pub sessions: Vec<Session>,

    /// Currently selected session index
    pub selected_index: usize,

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

    /// Tick counter for spinner animation
    pub spinner_tick: u64,
}

impl App {
    /// Create a new App instance
    #[must_use]
    pub fn new() -> Self {
        Self {
            mode: AppMode::SessionList,
            sessions: Vec::new(),
            selected_index: 0,
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
            spinner_tick: 0,
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
            // Clamp selected index
            if !self.sessions.is_empty() && self.selected_index >= self.sessions.len() {
                self.selected_index = self.sessions.len() - 1;
            }
        }
        Ok(())
    }

    /// Get the currently selected session
    #[must_use]
    pub fn selected_session(&self) -> Option<&Session> {
        self.sessions.get(self.selected_index)
    }

    /// Move selection up
    pub const fn select_previous(&mut self) {
        if self.selected_index > 0 {
            self.selected_index -= 1;
        }
    }

    /// Move selection down
    pub fn select_next(&mut self) {
        if !self.sessions.is_empty() && self.selected_index < self.sessions.len() - 1 {
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
    /// # Errors
    ///
    /// Returns an error if deletion fails.
    pub async fn confirm_delete(&mut self) -> anyhow::Result<()> {
        if let Some(id) = self.pending_delete.take() {
            if let Some(client) = &mut self.client {
                client.delete_session(&id).await?;
                self.status_message = Some(format!("Deleted session {id}"));
                self.refresh_sessions().await?;
            }
        }
        self.mode = AppMode::SessionList;
        Ok(())
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
            name: self.create_dialog.name.clone(),
            repo_path: self.create_dialog.repo_path.clone(),
            initial_prompt: self.create_dialog.prompt.clone(),
            backend: if self.create_dialog.backend_zellij {
                BackendType::Zellij
            } else {
                BackendType::Docker
            },
            agent: AgentType::ClaudeCode,
            dangerous_skip_checks: self.create_dialog.skip_checks,
            print_mode: false, // TUI always uses interactive mode
        };

        if let Some(client) = &mut self.client {
            let (session, warnings) = client.create_session(request).await?;
            self.loading_message = None;
            self.progress_step = None;

            // Build status message, including any warnings
            let mut status = format!("Created session {}", session.name);
            if let Some(warns) = warnings {
                for warn in warns {
                    status.push_str(&format!(" (Warning: {})", warn));
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
            let msg = format!(
                "Reconciled: {} missing worktrees, {} missing backends, {} orphaned backends",
                report.missing_worktrees.len(),
                report.missing_backends.len(),
                report.orphaned_backends.len()
            );
            self.status_message = Some(msg);
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

    /// Request quit
    pub const fn quit(&mut self) {
        self.should_quit = true;
    }

    /// Increment spinner tick for animation
    pub fn tick(&mut self) {
        self.spinner_tick = self.spinner_tick.wrapping_add(1);
    }
}

impl Default for App {
    fn default() -> Self {
        Self::new()
    }
}
