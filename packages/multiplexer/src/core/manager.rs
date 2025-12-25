use std::sync::Arc;
use tokio::sync::RwLock;
use uuid::Uuid;

use crate::backends::{Backend, DockerBackend, GitBackend, ZellijBackend};
use crate::store::Store;

use super::events::{Event, EventType};
use super::session::{BackendType, Session, SessionStatus};

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
    git: GitBackend,
    zellij: ZellijBackend,
    docker: DockerBackend,
    sessions: RwLock<Vec<Session>>,
}

impl SessionManager {
    /// Create a new session manager
    pub async fn new(store: Arc<dyn Store>) -> anyhow::Result<Self> {
        let sessions = store.list_sessions().await?;

        Ok(Self {
            store,
            git: GitBackend::new(),
            zellij: ZellijBackend::new(),
            docker: DockerBackend::new(),
            sessions: RwLock::new(sessions),
        })
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

    /// Create a new session
    pub async fn create_session(
        &self,
        name: String,
        repo_path: String,
        initial_prompt: String,
        backend: BackendType,
        agent: super::session::AgentType,
        dangerous_skip_checks: bool,
    ) -> anyhow::Result<Session> {
        // Generate full name with random suffix
        let full_name = crate::utils::random::generate_session_name(&name);
        let worktree_path = crate::utils::paths::worktree_path(&full_name);

        // Create session object
        let mut session = Session::new(
            full_name.clone(),
            repo_path.clone().into(),
            worktree_path.clone(),
            full_name.clone(),
            initial_prompt.clone(),
            backend,
            agent,
            dangerous_skip_checks,
        );

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
        self.git
            .create_worktree(&repo_path.into(), &worktree_path, &full_name)
            .await?;

        // Create backend resource
        let backend_id = match backend {
            BackendType::Zellij => {
                self.zellij
                    .create_session(&full_name, &worktree_path, &initial_prompt)
                    .await?
            }
            BackendType::Docker => {
                self.docker
                    .create_container(&full_name, &worktree_path, &initial_prompt)
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

        Ok(session)
    }

    /// Get the command to attach to a session
    pub async fn get_attach_command(&self, id_or_name: &str) -> anyhow::Result<Vec<String>> {
        let session = self
            .get_session(id_or_name)
            .await
            .ok_or_else(|| anyhow::anyhow!("Session not found: {}", id_or_name))?;

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
    pub async fn archive_session(&self, id_or_name: &str) -> anyhow::Result<()> {
        let mut sessions = self.sessions.write().await;

        let session = sessions
            .iter_mut()
            .find(|s| s.name == id_or_name || s.id.to_string() == id_or_name)
            .ok_or_else(|| anyhow::anyhow!("Session not found: {}", id_or_name))?;

        let old_status = session.status;
        session.set_status(SessionStatus::Archived);

        // Record event
        let event = Event::new(session.id, EventType::SessionArchived);
        self.store.record_event(&event).await?;

        let event = Event::new(
            session.id,
            EventType::StatusChanged {
                old_status,
                new_status: SessionStatus::Archived,
            },
        );
        self.store.record_event(&event).await?;

        // Update in store
        self.store.save_session(session).await?;

        Ok(())
    }

    /// Delete a session and its resources
    pub async fn delete_session(&self, id_or_name: &str) -> anyhow::Result<()> {
        let session = self
            .get_session(id_or_name)
            .await
            .ok_or_else(|| anyhow::anyhow!("Session not found: {}", id_or_name))?;

        // Delete backend resources
        if let Some(ref backend_id) = session.backend_id {
            match session.backend {
                BackendType::Zellij => {
                    let _ = self.zellij.delete_session(backend_id).await;
                }
                BackendType::Docker => {
                    let _ = self.docker.delete_container(backend_id).await;
                }
            }
        }

        // Delete git worktree
        let _ = self.git.delete_worktree(&session.worktree_path).await;

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
    pub async fn reconcile(&self) -> anyhow::Result<ReconcileReport> {
        let sessions = self.sessions.read().await;
        let mut report = ReconcileReport::default();

        for session in sessions.iter() {
            // Check if worktree exists
            if !session.worktree_path.exists() {
                report.missing_worktrees.push(session.id);
            }

            // Check if backend resource exists
            if let Some(ref backend_id) = session.backend_id {
                let exists = match session.backend {
                    BackendType::Zellij => self.zellij.session_exists(backend_id).await?,
                    BackendType::Docker => self.docker.container_exists(backend_id).await?,
                };

                if !exists {
                    report.missing_backends.push(session.id);
                }
            }
        }

        Ok(report)
    }
}
