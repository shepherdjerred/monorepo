use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::RwLock;
use uuid::Uuid;

use crate::backends::{DockerBackend, ExecutionBackend, GitBackend, GitOperations, ZellijBackend};
use crate::store::Store;

use super::events::{Event, EventType};
use super::session::{BackendType, CheckStatus, ClaudeWorkingStatus, Session, SessionStatus};

// Import types for WebSocket event broadcasting
use crate::api::protocol::Event as WsEvent;
use crate::api::ws_events::broadcast_event;
use tokio::sync::broadcast;

/// Event broadcaster for WebSocket real-time updates
pub type EventBroadcaster = broadcast::Sender<WsEvent>;

/// Report of reconciliation between expected and actual state
#[derive(Debug, Default, Clone)]
pub struct ReconcileReport {
    /// Sessions with missing git worktrees
    pub missing_worktrees: Vec<Uuid>,

    /// Sessions with missing backend resources
    pub missing_backends: Vec<Uuid>,

    /// Orphaned backend resources (exist but no session)
    pub orphaned_backends: Vec<String>,
}

/// Manages session lifecycle and state
pub struct SessionManager {
    store: Arc<dyn Store>,
    git: Arc<dyn GitOperations>,
    zellij: Arc<dyn ExecutionBackend>,
    docker: Arc<dyn ExecutionBackend>,
    sessions: RwLock<Vec<Session>>,
    /// Optional proxy manager for per-session filtering
    proxy_manager: Option<Arc<crate::proxy::ProxyManager>>,
    /// Optional event broadcaster for real-time WebSocket updates
    event_broadcaster: Option<EventBroadcaster>,
}

impl SessionManager {
    /// Create a new session manager with dependency injection
    ///
    /// This constructor allows injecting custom implementations of the backends,
    /// which is useful for testing.
    ///
    /// # Errors
    ///
    /// Returns an error if the store cannot be read.
    pub async fn new(
        store: Arc<dyn Store>,
        git: Arc<dyn GitOperations>,
        zellij: Arc<dyn ExecutionBackend>,
        docker: Arc<dyn ExecutionBackend>,
    ) -> anyhow::Result<Self> {
        let sessions = store.list_sessions().await?;

        Ok(Self {
            store,
            git,
            zellij,
            docker,
            sessions: RwLock::new(sessions),
            proxy_manager: None,
            event_broadcaster: None,
        })
    }

    /// Create a new session manager with default backends
    ///
    /// This is a convenience constructor for production use that creates
    /// real Git, Zellij, and Docker backends.
    ///
    /// # Errors
    ///
    /// Returns an error if the store cannot be read.
    pub async fn with_defaults(store: Arc<dyn Store>) -> anyhow::Result<Self> {
        Self::new(
            store,
            Arc::new(GitBackend::new()),
            Arc::new(ZellijBackend::new()),
            Arc::new(DockerBackend::new()),
        )
        .await
    }

    /// Create a new session manager with a custom Docker backend
    ///
    /// This is useful for providing a DockerBackend configured with proxy support.
    ///
    /// # Errors
    ///
    /// Returns an error if the store cannot be read.
    pub async fn with_docker_backend(
        store: Arc<dyn Store>,
        docker: DockerBackend,
    ) -> anyhow::Result<Self> {
        Self::new(
            store,
            Arc::new(GitBackend::new()),
            Arc::new(ZellijBackend::new()),
            Arc::new(docker),
        )
        .await
    }

    /// Set the proxy manager for per-session filtering
    ///
    /// This should be called after construction to enable per-session proxy support.
    pub fn set_proxy_manager(&mut self, proxy_manager: Arc<crate::proxy::ProxyManager>) {
        self.proxy_manager = Some(proxy_manager);
    }

    /// Set the event broadcaster for real-time WebSocket updates
    ///
    /// This should be called after construction to enable real-time event broadcasting
    /// to WebSocket clients when session status changes occur.
    pub fn set_event_broadcaster(&mut self, broadcaster: EventBroadcaster) {
        self.event_broadcaster = Some(broadcaster);
    }

    /// List all sessions
    pub async fn list_sessions(&self) -> Vec<Session> {
        self.sessions.read().await.clone()
    }

    /// Get a session by ID or name
    pub async fn get_session(&self, id_or_name: &str) -> Option<Session> {
        let sessions = self.sessions.read().await;

        // Try to parse as UUID first
        if let Ok(uuid) = Uuid::parse_str(id_or_name) {
            return sessions.iter().find(|s| s.id == uuid).cloned();
        }

        // Otherwise search by name
        sessions.iter().find(|s| s.name == id_or_name).cloned()
    }

    /// Get recent repositories
    ///
    /// # Errors
    ///
    /// Returns an error if the store cannot be read.
    pub async fn get_recent_repos(&self) -> anyhow::Result<Vec<crate::store::RecentRepo>> {
        self.store.get_recent_repos().await
    }

    /// Create a new session
    ///
    /// # Errors
    ///
    /// Returns an error if the session cannot be created, the worktree cannot
    /// be set up, or the backend fails to start.
    ///
    /// Returns the created session and optionally a list of warnings (e.g., if
    /// the post-checkout hook failed but the worktree was created successfully).
    pub async fn create_session(
        &self,
        repo_path: String,
        initial_prompt: String,
        backend: BackendType,
        agent: super::session::AgentType,
        dangerous_skip_checks: bool,
        print_mode: bool,
        plan_mode: bool,
        access_mode: super::session::AccessMode,
        images: Vec<String>,
    ) -> anyhow::Result<(Session, Option<Vec<String>>)> {
        // Generate base name using AI (with fallback to "session")
        let base_name = crate::utils::generate_session_name_ai(&repo_path, &initial_prompt).await;

        // Generate unique session name with random suffix and retry logic
        const MAX_ATTEMPTS: usize = 3;
        let full_name = {
            let mut attempts = 0;
            loop {
                let candidate = crate::utils::random::generate_session_name(&base_name);
                let sessions = self.sessions.read().await;
                if !sessions.iter().any(|s| s.name == candidate) {
                    break candidate;
                }
                attempts += 1;
                if attempts >= MAX_ATTEMPTS {
                    anyhow::bail!(
                        "Failed to generate unique session name after {MAX_ATTEMPTS} attempts"
                    );
                }
            }
        };
        let worktree_path = crate::utils::paths::worktree_path(&full_name);

        // Create session object
        let mut session = Session::new(super::session::SessionConfig {
            name: full_name.clone(),
            repo_path: repo_path.clone().into(),
            worktree_path: worktree_path.clone(),
            branch_name: full_name.clone(),
            initial_prompt: initial_prompt.clone(),
            backend,
            agent,
            dangerous_skip_checks,
            access_mode,
        });

        // Record creation event
        let event = Event::new(
            session.id,
            EventType::SessionCreated {
                name: full_name.clone(),
                repo_path: repo_path.clone(),
                backend,
                initial_prompt: initial_prompt.clone(),
            },
        );
        self.store.record_event(&event).await?;

        // Create git worktree
        let repo_path_buf = PathBuf::from(&repo_path);
        let worktree_warning = self
            .git
            .create_worktree(&repo_path_buf, &worktree_path, &full_name)
            .await?;

        // Create per-session proxy for Docker backends BEFORE creating container
        let proxy_port = if backend == BackendType::Docker {
            if let Some(ref proxy_manager) = self.proxy_manager {
                match proxy_manager
                    .create_session_proxy(session.id, access_mode)
                    .await
                {
                    Ok(proxy_port) => {
                        session.set_proxy_port(proxy_port);
                        tracing::info!(
                            session_id = %session.id,
                            port = proxy_port,
                            "Created session proxy"
                        );
                        Some(proxy_port)
                    }
                    Err(e) => {
                        tracing::warn!(
                            session_id = %session.id,
                            error = %e,
                            "Failed to create session proxy, using global proxy"
                        );
                        None
                    }
                }
            } else {
                None
            }
        } else {
            None
        };

        // Prepend plan mode instruction if enabled
        let transformed_prompt = if plan_mode {
            format!(
                "Enter plan mode and create a plan before doing anything.\n\n{}",
                initial_prompt.trim()
            )
        } else {
            initial_prompt.clone()
        };

        // Create backend resource
        let create_options = crate::backends::CreateOptions {
            print_mode,
            plan_mode,
            session_proxy_port: proxy_port,
            images,
            dangerous_skip_checks,
        };
        let backend_id = match backend {
            BackendType::Zellij => {
                self.zellij
                    .create(
                        &full_name,
                        &worktree_path,
                        &transformed_prompt,
                        create_options,
                    )
                    .await?
            }
            BackendType::Docker => {
                self.docker
                    .create(
                        &full_name,
                        &worktree_path,
                        &transformed_prompt,
                        create_options,
                    )
                    .await?
            }
        };

        session.set_backend_id(backend_id.clone());
        session.set_status(SessionStatus::Running);

        // Record backend ID event
        let event = Event::new(session.id, EventType::BackendIdSet { backend_id });
        self.store.record_event(&event).await?;

        // Record status change event
        let event = Event::new(
            session.id,
            EventType::StatusChanged {
                old_status: SessionStatus::Creating,
                new_status: SessionStatus::Running,
            },
        );
        self.store.record_event(&event).await?;

        // Save session to store
        self.store.save_session(&session).await?;

        // Add to in-memory list
        self.sessions.write().await.push(session.clone());

        // Track this repo in recent repos
        if let Err(e) = self.store.add_recent_repo(repo_path_buf.clone()).await {
            tracing::warn!("Failed to add repo to recent list: {e}");
        }

        // Collect warnings
        let warnings = worktree_warning.map(|w| vec![w]);

        Ok((session, warnings))
    }

    /// Get the command to attach to a session
    ///
    /// # Errors
    ///
    /// Returns an error if the session is not found or has no backend ID.
    pub async fn get_attach_command(&self, id_or_name: &str) -> anyhow::Result<Vec<String>> {
        let session = self
            .get_session(id_or_name)
            .await
            .ok_or_else(|| anyhow::anyhow!("Session not found: {id_or_name}"))?;

        let backend_id = session
            .backend_id
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("Session has no backend ID"))?;

        match session.backend {
            BackendType::Zellij => Ok(self.zellij.attach_command(backend_id)),
            BackendType::Docker => Ok(self.docker.attach_command(backend_id)),
        }
    }

    /// Archive a session
    ///
    /// # Errors
    ///
    /// Returns an error if the session is not found or the store update fails.
    pub async fn archive_session(&self, id_or_name: &str) -> anyhow::Result<()> {
        let mut sessions = self.sessions.write().await;

        let session = sessions
            .iter_mut()
            .find(|s| s.name == id_or_name || s.id.to_string() == id_or_name)
            .ok_or_else(|| anyhow::anyhow!("Session not found: {id_or_name}"))?;

        let old_status = session.status;
        let session_id = session.id;
        session.set_status(SessionStatus::Archived);
        let session_clone = session.clone();
        drop(sessions);

        // Record event
        let event = Event::new(session_id, EventType::SessionArchived);
        self.store.record_event(&event).await?;

        let event = Event::new(
            session_id,
            EventType::StatusChanged {
                old_status,
                new_status: SessionStatus::Archived,
            },
        );
        self.store.record_event(&event).await?;

        // Update in store
        self.store.save_session(&session_clone).await?;

        Ok(())
    }

    /// Delete a session and its resources
    ///
    /// # Errors
    ///
    /// Returns an error if the session is not found or the store delete fails.
    pub async fn delete_session(&self, id_or_name: &str) -> anyhow::Result<()> {
        let session = self
            .get_session(id_or_name)
            .await
            .ok_or_else(|| anyhow::anyhow!("Session not found: {id_or_name}"))?;

        // Delete backend resources
        if let Some(ref backend_id) = session.backend_id {
            match session.backend {
                BackendType::Zellij => {
                    let _ = self.zellij.delete(backend_id).await;
                }
                BackendType::Docker => {
                    let _ = self.docker.delete(backend_id).await;
                }
            }
        }

        // Destroy per-session proxy if it exists
        if session.backend == BackendType::Docker {
            if let Some(ref proxy_manager) = self.proxy_manager {
                if let Err(e) = proxy_manager.destroy_session_proxy(session.id).await {
                    tracing::warn!(
                        session_id = %session.id,
                        error = %e,
                        "Failed to destroy session proxy"
                    );
                }
            }
        }

        // Delete git worktree
        let _ = self
            .git
            .delete_worktree(&session.repo_path, &session.worktree_path)
            .await;

        // Record deletion event
        let event = Event::new(session.id, EventType::SessionDeleted { reason: None });
        self.store.record_event(&event).await?;

        // Remove from store
        self.store.delete_session(session.id).await?;

        // Remove from in-memory list
        self.sessions.write().await.retain(|s| s.id != session.id);

        Ok(())
    }

    /// Reconcile expected state with reality
    ///
    /// # Errors
    ///
    /// Returns an error if backend existence checks fail.
    pub async fn reconcile(&self) -> anyhow::Result<ReconcileReport> {
        let sessions_snapshot = self.sessions.read().await.clone();
        let mut report = ReconcileReport::default();

        for session in &sessions_snapshot {
            // Check if worktree exists
            if !session.worktree_path.exists() {
                report.missing_worktrees.push(session.id);
            }

            // Check if backend resource exists
            if let Some(ref backend_id) = session.backend_id {
                let exists = match session.backend {
                    BackendType::Zellij => self.zellij.exists(backend_id).await?,
                    BackendType::Docker => self.docker.exists(backend_id).await?,
                };

                if !exists {
                    report.missing_backends.push(session.id);

                    // Clean up orphaned session proxy
                    if session.backend == BackendType::Docker {
                        if let Some(ref proxy_manager) = self.proxy_manager {
                            tracing::info!(
                                session_id = %session.id,
                                "Destroying proxy for session with missing container"
                            );
                            let _ = proxy_manager.destroy_session_proxy(session.id).await;
                        }
                    }
                } else {
                    // Container exists but session is archived/failed - clean up zombie
                    if matches!(
                        session.status,
                        SessionStatus::Archived | SessionStatus::Failed
                    ) {
                        tracing::warn!(
                            session_id = %session.id,
                            status = ?session.status,
                            "Found zombie container for non-active session, cleaning up"
                        );

                        match session.backend {
                            BackendType::Docker => {
                                let _ = self.docker.delete(backend_id).await;
                                if let Some(ref proxy_manager) = self.proxy_manager {
                                    let _ = proxy_manager.destroy_session_proxy(session.id).await;
                                }
                            }
                            BackendType::Zellij => {
                                let _ = self.zellij.delete(backend_id).await;
                            }
                        }
                    }

                    // Verify proxy exists for running Docker sessions
                    if session.backend == BackendType::Docker
                        && session.status == SessionStatus::Running
                    {
                        if let Some(ref proxy_manager) = self.proxy_manager {
                            if let Some(port) = session.proxy_port {
                                // Check if proxy is actually listening
                                if tokio::net::TcpStream::connect(format!("127.0.0.1:{}", port))
                                    .await
                                    .is_err()
                                {
                                    tracing::warn!(
                                        session_id = %session.id,
                                        port = port,
                                        "Session proxy not responding - attempting recreation"
                                    );
                                    // Attempt auto-recreation
                                    let _ = proxy_manager
                                        .restore_session_proxies(&[session.clone()])
                                        .await;
                                }
                            }
                        }
                    }
                }
            }
        }

        Ok(report)
    }

    /// Update the access mode for a session
    ///
    /// # Errors
    ///
    /// Returns an error if the session is not found or the store update fails.
    pub async fn update_access_mode(
        &self,
        id_or_name: &str,
        new_mode: super::session::AccessMode,
    ) -> anyhow::Result<()> {
        let mut sessions = self.sessions.write().await;
        let session = sessions
            .iter_mut()
            .find(|s| s.name == id_or_name || s.id.to_string() == id_or_name)
            .ok_or_else(|| anyhow::anyhow!("Session not found: {id_or_name}"))?;

        let session_id = session.id;
        let backend = session.backend;
        session.set_access_mode(new_mode);
        let session_clone = session.clone();
        drop(sessions);

        // Update runtime proxy if session has one
        if backend == BackendType::Docker {
            if let Some(ref proxy_manager) = self.proxy_manager {
                proxy_manager
                    .update_session_access_mode(session_id, new_mode)
                    .await?;
            }
        }

        // Update in store
        self.store.save_session(&session_clone).await?;

        tracing::info!(
            session_id = %session_id,
            mode = ?new_mode,
            "Updated session access mode"
        );

        Ok(())
    }

    /// Update Claude working status from hook message
    ///
    /// # Errors
    ///
    /// Returns an error if the session is not found or the store update fails.
    pub async fn update_claude_status(
        &self,
        session_id: Uuid,
        new_status: ClaudeWorkingStatus,
    ) -> anyhow::Result<()> {
        let mut sessions = self.sessions.write().await;
        let session = sessions
            .iter_mut()
            .find(|s| s.id == session_id)
            .ok_or_else(|| anyhow::anyhow!("Session not found: {}", session_id))?;

        let old_status = session.claude_status;

        // Only update if status changed
        if old_status == new_status {
            return Ok(());
        }

        session.set_claude_status(new_status);
        let session_clone = session.clone();
        drop(sessions);

        // Record event
        let event = Event::new(
            session_id,
            EventType::ClaudeStatusChanged {
                old_status,
                new_status,
            },
        );
        self.store.record_event(&event).await?;

        // Update in store
        self.store.save_session(&session_clone).await?;

        tracing::debug!(
            session_id = %session_id,
            old = ?old_status,
            new = ?new_status,
            "Updated Claude working status"
        );

        // Broadcast event to WebSocket clients if broadcaster available
        if let Some(ref broadcaster) = self.event_broadcaster {
            if let Some(session) = self.get_session(&session_id.to_string()).await {
                broadcast_event(broadcaster, WsEvent::SessionUpdated(session)).await;
            }
        }

        Ok(())
    }

    /// Update PR check status
    ///
    /// # Errors
    ///
    /// Returns an error if the session is not found or the store update fails.
    pub async fn update_pr_check_status(
        &self,
        session_id: Uuid,
        new_status: CheckStatus,
    ) -> anyhow::Result<()> {
        let mut sessions = self.sessions.write().await;
        let session = sessions
            .iter_mut()
            .find(|s| s.id == session_id)
            .ok_or_else(|| anyhow::anyhow!("Session not found: {}", session_id))?;

        let old_status = session.pr_check_status;
        session.set_check_status(new_status);
        let session_clone = session.clone();
        drop(sessions);

        // Record event
        let event = Event::new(
            session_id,
            EventType::CheckStatusChanged {
                old_status,
                new_status,
            },
        );
        self.store.record_event(&event).await?;

        // Update in store
        self.store.save_session(&session_clone).await?;

        tracing::debug!(
            session_id = %session_id,
            old = ?old_status,
            new = ?new_status,
            "Updated PR check status"
        );

        // Broadcast event to WebSocket clients if broadcaster available
        if let Some(ref broadcaster) = self.event_broadcaster {
            if let Some(session) = self.get_session(&session_id.to_string()).await {
                broadcast_event(broadcaster, WsEvent::SessionUpdated(session)).await;
            }
        }

        Ok(())
    }

    /// Send a prompt to a Claude session (for hotkey triggers)
    ///
    /// # Errors
    ///
    /// Returns an error if the session is not found, has no backend ID,
    /// or the command execution fails.
    pub async fn send_prompt_to_session(
        &self,
        id_or_name: &str,
        prompt: &str,
    ) -> anyhow::Result<()> {
        let session = self
            .get_session(id_or_name)
            .await
            .ok_or_else(|| anyhow::anyhow!("Session not found: {}", id_or_name))?;

        let backend_id = session
            .backend_id
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("Session has no backend ID"))?;

        match session.backend {
            BackendType::Docker => {
                // Send prompt via docker exec with stdin (avoids shell injection)
                let container_name = format!("clauderon-{}", backend_id);
                let mut child = tokio::process::Command::new("docker")
                    .args(["exec", "-i", &container_name, "claude"])
                    .stdin(std::process::Stdio::piped())
                    .stdout(std::process::Stdio::piped())
                    .stderr(std::process::Stdio::piped())
                    .spawn()?;

                // Write prompt to stdin
                if let Some(mut stdin) = child.stdin.take() {
                    use tokio::io::AsyncWriteExt;
                    stdin.write_all(prompt.as_bytes()).await?;
                    stdin.write_all(b"\n").await?;
                    drop(stdin); // Close stdin to signal end of input
                }

                let output = child.wait_with_output().await?;

                if !output.status.success() {
                    anyhow::bail!(
                        "Failed to send prompt: {}",
                        String::from_utf8_lossy(&output.stderr)
                    );
                }
            }
            BackendType::Zellij => {
                // Send prompt via zellij write
                let output = tokio::process::Command::new("zellij")
                    .args(["action", "write-chars", prompt, "-s", backend_id])
                    .output()
                    .await?;

                if !output.status.success() {
                    anyhow::bail!(
                        "Failed to send prompt: {}",
                        String::from_utf8_lossy(&output.stderr)
                    );
                }
            }
        }

        tracing::info!(
            session = %id_or_name,
            prompt_len = prompt.len(),
            "Sent prompt to session"
        );

        Ok(())
    }

    /// Get system status including credentials and proxies.
    ///
    /// # Errors
    ///
    /// Returns an error if the proxy manager is not available.
    pub async fn get_system_status(&self) -> anyhow::Result<crate::api::protocol::SystemStatus> {
        use crate::api::protocol::{CredentialStatus, ProxyStatus, SystemStatus};

        let mut credentials = Vec::new();
        let mut proxies = Vec::new();
        let mut active_session_proxies: u32 = 0;

        // Collect credential and proxy status if proxy manager is available
        if let Some(ref pm) = self.proxy_manager {
            let creds = pm.get_credentials();
            let secrets_dir = pm.secrets_dir();

            // Helper to create masked value (first 8 chars + "****..." + last 4 chars)
            let mask_credential = |value: &str| -> String {
                if value.len() <= 12 {
                    // Don't reveal any chars for short tokens to avoid leaking info
                    "****".to_string()
                } else {
                    format!("{}****...{}", &value[..8], &value[value.len() - 4..])
                }
            };

            // Helper to determine credential source
            let credential_source = |env_var: &str, file_name: &str| -> (Option<String>, bool) {
                if std::env::var(env_var).is_ok() {
                    (Some("environment".to_string()), true) // readonly
                } else {
                    let path = secrets_dir.join(file_name);
                    if path.exists() {
                        (Some("file".to_string()), false) // not readonly
                    } else {
                        (None, false)
                    }
                }
            };

            // GitHub
            let (source, readonly) = credential_source("GITHUB_TOKEN", "github_token");
            credentials.push(CredentialStatus {
                name: "GitHub".to_string(),
                service_id: "github".to_string(),
                available: creds.github_token.is_some(),
                source,
                readonly,
                masked_value: creds.github_token.as_ref().map(|v| mask_credential(v)),
            });

            // Anthropic
            let (source, readonly) =
                credential_source("CLAUDE_CODE_OAUTH_TOKEN", "anthropic_oauth_token");
            credentials.push(CredentialStatus {
                name: "Anthropic".to_string(),
                service_id: "anthropic".to_string(),
                available: creds.anthropic_oauth_token.is_some(),
                source,
                readonly,
                masked_value: creds
                    .anthropic_oauth_token
                    .as_ref()
                    .map(|v| mask_credential(v)),
            });

            // PagerDuty
            let (source, readonly) = credential_source("PAGERDUTY_TOKEN", "pagerduty_token");
            credentials.push(CredentialStatus {
                name: "PagerDuty".to_string(),
                service_id: "pagerduty".to_string(),
                available: creds.pagerduty_token.is_some(),
                source,
                readonly,
                masked_value: creds.pagerduty_token.as_ref().map(|v| mask_credential(v)),
            });

            // Sentry
            let (source, readonly) = credential_source("SENTRY_AUTH_TOKEN", "sentry_auth_token");
            credentials.push(CredentialStatus {
                name: "Sentry".to_string(),
                service_id: "sentry".to_string(),
                available: creds.sentry_auth_token.is_some(),
                source,
                readonly,
                masked_value: creds.sentry_auth_token.as_ref().map(|v| mask_credential(v)),
            });

            // Grafana
            let (source, readonly) = credential_source("GRAFANA_API_KEY", "grafana_api_key");
            credentials.push(CredentialStatus {
                name: "Grafana".to_string(),
                service_id: "grafana".to_string(),
                available: creds.grafana_api_key.is_some(),
                source,
                readonly,
                masked_value: creds.grafana_api_key.as_ref().map(|v| mask_credential(v)),
            });

            // npm
            let (source, readonly) = credential_source("NPM_TOKEN", "npm_token");
            credentials.push(CredentialStatus {
                name: "npm".to_string(),
                service_id: "npm".to_string(),
                available: creds.npm_token.is_some(),
                source,
                readonly,
                masked_value: creds.npm_token.as_ref().map(|v| mask_credential(v)),
            });

            // Docker
            let (source, readonly) = credential_source("DOCKER_TOKEN", "docker_token");
            credentials.push(CredentialStatus {
                name: "Docker".to_string(),
                service_id: "docker".to_string(),
                available: creds.docker_token.is_some(),
                source,
                readonly,
                masked_value: creds.docker_token.as_ref().map(|v| mask_credential(v)),
            });

            // Kubernetes
            let (source, readonly) = credential_source("K8S_TOKEN", "k8s_token");
            credentials.push(CredentialStatus {
                name: "Kubernetes".to_string(),
                service_id: "k8s".to_string(),
                available: creds.k8s_token.is_some(),
                source,
                readonly,
                masked_value: creds.k8s_token.as_ref().map(|v| mask_credential(v)),
            });

            // Talos
            let (source, readonly) = credential_source("TALOS_TOKEN", "talos_token");
            credentials.push(CredentialStatus {
                name: "Talos".to_string(),
                service_id: "talos".to_string(),
                available: creds.talos_token.is_some(),
                source,
                readonly,
                masked_value: creds.talos_token.as_ref().map(|v| mask_credential(v)),
            });

            // Collect proxy status
            proxies.push(ProxyStatus {
                name: "HTTP Auth Proxy".to_string(),
                port: pm.http_proxy_port(),
                active: true,
                proxy_type: "global".to_string(),
            });

            proxies.push(ProxyStatus {
                name: "Kubernetes Proxy".to_string(),
                port: pm.k8s_proxy_port(),
                active: pm.is_k8s_proxy_running(),
                proxy_type: "global".to_string(),
            });

            if pm.is_talos_configured() {
                proxies.push(ProxyStatus {
                    name: "Talos mTLS Gateway".to_string(),
                    port: pm.talos_gateway_port(),
                    active: true,
                    proxy_type: "global".to_string(),
                });
            }

            // Count session-specific proxies
            active_session_proxies = pm.active_session_proxy_count().await as u32;
        }

        Ok(SystemStatus {
            credentials,
            proxies,
            active_session_proxies,
        })
    }

    /// Update a credential value.
    ///
    /// Note: The updated credential will be available for newly created sessions.
    /// Existing proxy instances will continue using their current credentials until
    /// they are restarted.
    ///
    /// # Errors
    ///
    /// Returns an error if:
    /// - The proxy manager is not available
    /// - The credential is readonly (from environment variable)
    /// - The service ID is invalid
    /// - File I/O fails
    pub async fn update_credential(&self, service_id: &str, value: &str) -> anyhow::Result<()> {
        // Validate service_id format to prevent path traversal
        if !service_id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_')
        {
            anyhow::bail!("Invalid service ID format: must be alphanumeric or underscore");
        }

        // Validate we have a proxy manager
        let Some(ref pm) = self.proxy_manager else {
            anyhow::bail!("Proxy manager not available");
        };

        // Map service ID to file name
        let file_name = Self::credential_file_name(service_id)?;

        // Map service ID to environment variable name
        let env_var = Self::credential_env_var(service_id)?;

        // Check if credential is from environment (readonly)
        if std::env::var(env_var).is_ok() {
            anyhow::bail!(
                "Credential for {} is set via environment variable {} and cannot be updated via API",
                service_id,
                env_var
            );
        }

        // Ensure secrets directory exists with proper permissions
        let secrets_dir = pm.secrets_dir().clone();
        if !secrets_dir.exists() {
            std::fs::create_dir_all(&secrets_dir)?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                std::fs::set_permissions(&secrets_dir, std::fs::Permissions::from_mode(0o700))?;
            }
        }

        // Write credential to file
        let file_path = secrets_dir.join(file_name);
        let trimmed_value = value.trim();
        std::fs::write(&file_path, trimmed_value)?;

        // Set file permissions to 0600 (owner read/write only)
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&file_path, std::fs::Permissions::from_mode(0o600))?;
        }

        // Note: We don't reload credentials here because ProxyManager is behind Arc
        // and we don't have mutable access. The credential will be picked up by newly
        // created sessions/proxies. For a full reload, the proxy service would need to be restarted.

        tracing::info!(
            service_id = service_id,
            file_path = %file_path.display(),
            "Updated credential (will take effect for new sessions)"
        );

        Ok(())
    }

    /// Map service ID to credential file name.
    fn credential_file_name(service_id: &str) -> anyhow::Result<&'static str> {
        match service_id {
            "github" => Ok("github_token"),
            "anthropic" => Ok("anthropic_oauth_token"),
            "pagerduty" => Ok("pagerduty_token"),
            "sentry" => Ok("sentry_auth_token"),
            "grafana" => Ok("grafana_api_key"),
            "npm" => Ok("npm_token"),
            "docker" => Ok("docker_token"),
            "k8s" => Ok("k8s_token"),
            "talos" => Ok("talos_token"),
            _ => anyhow::bail!("Invalid service ID: {}", service_id),
        }
    }

    /// Map service ID to environment variable name.
    fn credential_env_var(service_id: &str) -> anyhow::Result<&'static str> {
        match service_id {
            "github" => Ok("GITHUB_TOKEN"),
            "anthropic" => Ok("CLAUDE_CODE_OAUTH_TOKEN"),
            "pagerduty" => Ok("PAGERDUTY_TOKEN"),
            "sentry" => Ok("SENTRY_AUTH_TOKEN"),
            "grafana" => Ok("GRAFANA_API_KEY"),
            "npm" => Ok("NPM_TOKEN"),
            "docker" => Ok("DOCKER_TOKEN"),
            "k8s" => Ok("K8S_TOKEN"),
            "talos" => Ok("TALOS_TOKEN"),
            _ => anyhow::bail!("Invalid service ID: {}", service_id),
        }
    }
}
