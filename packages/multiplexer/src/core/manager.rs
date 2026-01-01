use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::RwLock;
use uuid::Uuid;

use crate::backends::{DockerBackend, ExecutionBackend, GitBackend, GitOperations, ZellijBackend};
use crate::store::Store;

use super::events::{Event, EventType};
use super::session::{BackendType, CheckStatus, ClaudeWorkingStatus, Session, SessionStatus};

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
        name: String,
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
        // Generate unique session name with retry logic
        const MAX_ATTEMPTS: usize = 3;
        let full_name = {
            let mut attempts = 0;
            loop {
                let candidate = crate::utils::random::generate_session_name(&name);
                let sessions = self.sessions.read().await;
                if !sessions.iter().any(|s| s.name == candidate) {
                    break candidate;
                }
                attempts += 1;
                if attempts >= MAX_ATTEMPTS {
                    anyhow::bail!("Failed to generate unique session name after {MAX_ATTEMPTS} attempts");
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
                match proxy_manager.create_session_proxy(session.id, access_mode).await {
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

        // Create backend resource
        let create_options = crate::backends::CreateOptions {
            print_mode,
            plan_mode,
            session_proxy_port: proxy_port,
            images,
        };
        let backend_id = match backend {
            BackendType::Zellij => {
                self.zellij
                    .create(&full_name, &worktree_path, &initial_prompt, create_options)
                    .await?
            }
            BackendType::Docker => {
                self.docker
                    .create(&full_name, &worktree_path, &initial_prompt, create_options)
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
        let _ = self.git.delete_worktree(&session.repo_path, &session.worktree_path).await;

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
                let container_name = format!("mux-{}", backend_id);
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
}
