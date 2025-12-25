use crate::api::{ApiClient, Client};
use crate::core::Session;

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

/// Create dialog state
#[derive(Debug, Clone, Default)]
pub struct CreateDialogState {
    pub name: String,
    pub prompt: String,
    pub repo_path: String,
    pub backend_zellij: bool, // true = Zellij, false = Docker
    pub skip_checks: bool,
    pub focus: CreateDialogFocus,
    pub button_create_focused: bool, // true = Create, false = Cancel
}

impl CreateDialogState {
    #[must_use]
    pub fn new() -> Self {
        Self {
            backend_zellij: true, // Default to Zellij
            ..Default::default()
        }
    }

    pub fn reset(&mut self) {
        *self = Self::new();
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
        };

        if let Some(client) = &mut self.client {
            let session = client.create_session(request).await?;
            self.status_message = Some(format!("Created session {}", session.name));
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
}

impl Default for App {
    fn default() -> Self {
        Self::new()
    }
}
