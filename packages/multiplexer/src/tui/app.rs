use std::collections::HashMap;
use std::path::PathBuf;
use std::time::Instant;

use nucleo_matcher::Utf32String;
use tokio::sync::mpsc;
use tokio::task::JoinHandle;
use uuid::Uuid;

use crate::api::{ApiClient, Client};
use crate::core::Session;
use crate::tui::attached::PtySession;

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

/// Progress update from background session deletion task
#[derive(Debug, Clone)]
pub enum DeleteProgress {
    /// Deletion completed successfully
    Done { session_id: String },
    /// Deletion failed
    Error { session_id: String, message: String },
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
}

/// State for the detach key detection (Ctrl+] double-tap)
#[derive(Debug, Clone)]
pub enum DetachState {
    /// Not waiting for second key press
    Idle,
    /// First Ctrl+] pressed, waiting for second or timeout
    Pending { since: Instant },
}

impl Default for DetachState {
    fn default() -> Self {
        Self::Idle
    }
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
    /// Whether this is the parent directory (..)
    pub is_parent: bool,
}

/// Directory picker state
#[derive(Debug, Clone)]
pub struct DirectoryPickerState {
    /// Current directory being browsed
    pub current_dir: PathBuf,
    /// All directory entries in current directory
    pub all_entries: Vec<DirEntry>,
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
    pub plan_mode: bool,
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
            filtered_entries: Vec::new(),
            search_query: String::new(),
            selected_index: 0,
            is_active: false,
            error: None,
            matcher: nucleo_matcher::Matcher::new(nucleo_matcher::Config::DEFAULT),
        }
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
            self.filtered_entries = self.all_entries.clone();
        } else {
            // Score and filter entries
            // Convert search query to Utf32String once
            let needle = Utf32String::from(self.search_query.as_str());

            let mut scored: Vec<(DirEntry, u16)> = self
                .all_entries
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
            plan_mode: true, // Default to plan mode ON
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

    /// Detach key state for double-tap detection
    pub detach_state: DetachState,

    /// Terminal dimensions for PTY resize
    pub terminal_size: (u16, u16),
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
            delete_task: None,
            delete_progress_rx: None,
            deleting_session_id: None,
            spinner_tick: 0,
            // PTY session management
            pty_sessions: HashMap::new(),
            attached_session_id: None,
            detach_state: DetachState::Idle,
            terminal_size: (24, 80), // Default size, updated on resize
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

            // Spawn background task
            let task = tokio::spawn(async move {
                // Connect to daemon
                let mut client = match Client::connect().await {
                    Ok(c) => c,
                    Err(e) => {
                        let _ = tx
                            .send(DeleteProgress::Error {
                                session_id: id.clone(),
                                message: format!("Failed to connect to daemon: {e}"),
                            })
                            .await;
                        return;
                    }
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
                                message: e.to_string(),
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
            plan_mode: self.create_dialog.plan_mode,
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
            self.detach_state = DetachState::Idle;
            return Ok(());
        }

        // Create new PTY session
        let (rows, cols) = self.terminal_size;
        let pty_session =
            PtySession::spawn_docker_attach(session_id, container_id, rows, cols).await?;

        self.pty_sessions.insert(session_id, pty_session);
        self.attached_session_id = Some(session_id);
        self.mode = AppMode::Attached;
        self.detach_state = DetachState::Idle;

        Ok(())
    }

    /// Detach from the current session (but keep PTY alive).
    pub fn detach(&mut self) {
        self.attached_session_id = None;
        self.mode = AppMode::SessionList;
        self.detach_state = DetachState::Idle;
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
        use crate::core::BackendType;

        // Get list of Docker sessions (only those support PTY)
        let docker_sessions: Vec<_> = self
            .sessions
            .iter()
            .filter(|s| s.backend == BackendType::Docker && s.backend_id.is_some())
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

        // Update selected index in session list to match
        if let Some(idx) = self.sessions.iter().position(|s| s.id == session_id) {
            self.selected_index = idx;
        }

        self.attached_session_id = Some(session_id);
        self.detach_state = DetachState::Idle;
        Ok(true)
    }

    /// Switch to the previous Docker session while attached.
    /// Returns true if switched, false if no previous session.
    pub async fn switch_to_previous_session(&mut self) -> anyhow::Result<bool> {
        use crate::core::BackendType;

        // Get list of Docker sessions (only those support PTY)
        let docker_sessions: Vec<_> = self
            .sessions
            .iter()
            .filter(|s| s.backend == BackendType::Docker && s.backend_id.is_some())
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

        // Update selected index in session list to match
        if let Some(idx) = self.sessions.iter().position(|s| s.id == session_id) {
            self.selected_index = idx;
        }

        self.attached_session_id = Some(session_id);
        self.detach_state = DetachState::Idle;
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
