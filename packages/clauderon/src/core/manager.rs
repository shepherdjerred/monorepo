use anyhow::Context;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::{RwLock, Semaphore};
use tracing::instrument;
use uuid::Uuid;

use crate::backends::{
    DockerBackend, ExecutionBackend, GitBackend, GitOperations, ImageConfig, ImagePullPolicy,
    KubernetesBackend, ResourceLimits, ZellijBackend,
};
use crate::core::console_manager::ConsoleManager;
use crate::store::Store;

use super::events::{Event, EventType};
use super::session::{BackendType, CheckStatus, ClaudeWorkingStatus, Session, SessionStatus};

// Import types for WebSocket event broadcasting
use crate::api::protocol::Event as WsEvent;
use crate::api::ws_events::broadcast_event;
use tokio::sync::broadcast;

/// Event broadcaster for WebSocket real-time updates
pub type EventBroadcaster = broadcast::Sender<WsEvent>;

/// Maximum number of container recreation attempts before giving up
pub const MAX_RECONCILE_ATTEMPTS: u32 = 3;

/// Report of reconciliation between expected and actual state
#[derive(Debug, Default, Clone)]
pub struct ReconcileReport {
    /// Sessions with missing git worktrees
    pub missing_worktrees: Vec<Uuid>,

    /// Sessions with missing backend resources
    pub missing_backends: Vec<Uuid>,

    /// Orphaned backend resources (exist but no session)
    pub orphaned_backends: Vec<String>,

    /// Sessions that were successfully recreated
    pub recreated: Vec<Uuid>,

    /// Sessions that failed to be recreated
    pub recreation_failed: Vec<Uuid>,

    /// Sessions that exceeded max reconcile attempts
    pub gave_up: Vec<Uuid>,
}

/// Manages session lifecycle and state
pub struct SessionManager {
    store: Arc<dyn Store>,
    git: Arc<dyn GitOperations>,
    zellij: Arc<dyn ExecutionBackend>,
    docker: Arc<dyn ExecutionBackend>,
    kubernetes: Arc<dyn ExecutionBackend>,
    sessions: RwLock<Vec<Session>>,
    /// Optional proxy manager for per-session filtering
    proxy_manager: Option<Arc<crate::proxy::ProxyManager>>,
    /// Optional event broadcaster for real-time WebSocket updates
    event_broadcaster: Option<EventBroadcaster>,
    /// HTTP server port for hook communication
    http_port: RwLock<Option<u16>>,
    /// Console manager for WebSocket-based PTY access
    console_manager: Arc<ConsoleManager>,
    /// Semaphore to limit concurrent creations (max 3)
    creation_semaphore: Arc<Semaphore>,
    /// Semaphore to limit concurrent deletions (max 3)
    deletion_semaphore: Arc<Semaphore>,
    /// Maximum total sessions allowed
    max_sessions: usize,
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
        kubernetes: Arc<dyn ExecutionBackend>,
    ) -> anyhow::Result<Self> {
        let sessions = store.list_sessions().await?;

        Ok(Self {
            store,
            git,
            zellij,
            docker,
            kubernetes,
            sessions: RwLock::new(sessions),
            proxy_manager: None,
            event_broadcaster: None,
            http_port: RwLock::new(None),
            console_manager: Arc::new(ConsoleManager::new()),
            creation_semaphore: Arc::new(Semaphore::new(3)),
            deletion_semaphore: Arc::new(Semaphore::new(3)),
            max_sessions: 15,
        })
    }

    /// Create a new session manager with default backends
    ///
    /// This is a convenience constructor for production use that creates
    /// real Git, Zellij, Docker, and Kubernetes backends.
    ///
    /// # Errors
    ///
    /// Returns an error if the store cannot be read or Kubernetes client fails.
    pub async fn with_defaults(store: Arc<dyn Store>) -> anyhow::Result<Self> {
        let kubernetes_backend =
            KubernetesBackend::new(crate::backends::KubernetesConfig::load_or_default()).await?;

        Self::new(
            store,
            Arc::new(GitBackend::new()),
            Arc::new(ZellijBackend::new()),
            Arc::new(DockerBackend::new()),
            Arc::new(kubernetes_backend),
        )
        .await
    }

    /// Create a new session manager with a custom Docker backend
    ///
    /// This is useful for providing a DockerBackend configured with proxy support.
    ///
    /// # Errors
    ///
    /// Returns an error if the store cannot be read or Kubernetes client fails.
    pub async fn with_docker_backend(
        store: Arc<dyn Store>,
        docker: DockerBackend,
    ) -> anyhow::Result<Self> {
        let kubernetes_backend =
            KubernetesBackend::new(crate::backends::KubernetesConfig::load_or_default()).await?;

        Self::new(
            store,
            Arc::new(GitBackend::new()),
            Arc::new(ZellijBackend::new()),
            Arc::new(docker),
            Arc::new(kubernetes_backend),
        )
        .await
    }

    /// Set the proxy manager for per-session filtering
    ///
    /// This should be called after construction to enable per-session proxy support.
    pub fn set_proxy_manager(&mut self, proxy_manager: Arc<crate::proxy::ProxyManager>) {
        self.proxy_manager = Some(proxy_manager);
    }

    /// Set the HTTP server port for hook communication
    ///
    /// This should be called after construction to enable Docker/K8s hook communication.
    pub fn set_http_port(&self, port: u16) {
        *self.http_port.blocking_write() = Some(port);
    }

    /// Get the console manager for WebSocket-based PTY access
    ///
    /// The console manager maintains PTY connections for WebSocket clients.
    pub fn console_manager(&self) -> Arc<ConsoleManager> {
        Arc::clone(&self.console_manager)
    }

    /// Set the event broadcaster for real-time WebSocket updates
    ///
    /// This should be called after construction to enable real-time event broadcasting
    /// to WebSocket clients when session status changes occur.
    pub fn set_event_broadcaster(&mut self, broadcaster: EventBroadcaster) {
        self.event_broadcaster = Some(broadcaster);
    }

    /// List all sessions
    #[instrument(skip(self))]
    pub async fn list_sessions(&self) -> Vec<Session> {
        self.sessions.read().await.clone()
    }

    /// Get a session by ID or name
    #[instrument(skip(self), fields(id_or_name = %id_or_name))]
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
    #[instrument(skip(self))]
    pub async fn get_recent_repos(&self) -> anyhow::Result<Vec<crate::store::RecentRepo>> {
        self.store.get_recent_repos().await
    }

    /// Start session creation asynchronously (returns immediately)
    ///
    /// Creates a session in "Creating" status and spawns a background task to complete
    /// the creation process. Progress updates are broadcast via WebSocket events.
    ///
    /// # Errors
    ///
    /// Returns an error if:
    /// - Maximum session limit (15) is reached
    /// - Git repository path is invalid
    /// - Session name generation fails
    /// - Database save fails
    ///
    /// # Returns
    ///
    /// Returns the UUID of the newly created session (in Creating status)
    pub async fn start_session_creation(
        self: &Arc<Self>,
        repo_path: String,
        initial_prompt: String,
        backend: BackendType,
        agent: super::session::AgentType,
        dangerous_skip_checks: bool,
        print_mode: bool,
        plan_mode: bool,
        access_mode: super::session::AccessMode,
        images: Vec<String>,
        container_image: Option<String>,
        pull_policy: Option<String>,
        cpu_limit: Option<String>,
        memory_limit: Option<String>,
    ) -> anyhow::Result<Uuid> {
        // Validate session count limit
        let session_count = self.sessions.read().await.len();
        if session_count >= self.max_sessions {
            anyhow::bail!(
                "Maximum session limit reached ({}/{}). Delete or archive sessions before creating new ones.",
                session_count,
                self.max_sessions
            );
        }

        // Validate and resolve git repository path
        let repo_path_buf = std::path::PathBuf::from(&repo_path);
        let git_info = crate::utils::git::find_git_root(&repo_path_buf)
            .with_context(|| format!("Failed to find git repository for path: {}", repo_path))?;

        // Use git root for worktree creation
        let repo_path = git_info.git_root.to_string_lossy().to_string();
        let subdirectory = git_info.subdirectory;

        // Validate subdirectory path for security
        if subdirectory.is_absolute()
            || subdirectory
                .components()
                .any(|c| matches!(c, std::path::Component::ParentDir))
        {
            anyhow::bail!(
                "Invalid subdirectory path: must be relative without '..' components. Got: {}",
                subdirectory.display()
            );
        }

        // Generate metadata using AI (with fallback to defaults)
        let metadata = crate::utils::generate_session_name_ai(&repo_path, &initial_prompt).await;

        // Generate unique session name
        const MAX_ATTEMPTS: usize = 3;
        let full_name = {
            let mut attempts = 0;
            loop {
                let candidate = crate::utils::random::generate_session_name(&metadata.branch_name);
                let sessions = self.sessions.read().await;
                let is_unique = !sessions.iter().any(|s| s.name == candidate);
                drop(sessions);
                if is_unique {
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

        // Create session object with AI-generated metadata
        let mut session = Session::new(super::session::SessionConfig {
            name: full_name.clone(),
            title: Some(metadata.title),
            description: Some(metadata.description),
            repo_path: repo_path.clone().into(),
            worktree_path: worktree_path.clone(),
            subdirectory: subdirectory.clone(),
            branch_name: metadata.branch_name,
            initial_prompt: initial_prompt.clone(),
            backend,
            agent,
            dangerous_skip_checks,
            access_mode,
        });

        // Set history file path
        session.history_file_path = Some(super::session::get_history_file_path(
            &worktree_path,
            &session.id,
        ));

        // Set initial progress
        session.set_progress(crate::api::protocol::ProgressStep {
            step: 0,
            total: 5,
            message: "Queued for creation".to_string(),
        });

        let session_id = session.id;

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

        // Save session to store
        self.store.save_session(&session).await?;

        // Add to in-memory list with atomic check-and-add
        {
            let mut sessions = self.sessions.write().await;

            // Re-check limit with lock held (defense against race)
            if sessions.len() >= self.max_sessions {
                // Rollback database save
                let _ = self.store.delete_session(session.id).await;
                anyhow::bail!("Maximum session limit reached (prevented race condition)");
            }

            sessions.push(session.clone());
        }

        // Broadcast session created event
        if let Some(ref broadcaster) = self.event_broadcaster {
            let _ = broadcaster.send(WsEvent::SessionCreated(session.clone()));
        }

        // Spawn background task for actual creation
        let manager_clone = Arc::clone(self);
        tokio::spawn(async move {
            manager_clone
                .complete_session_creation(
                    session_id,
                    repo_path,
                    full_name,
                    worktree_path,
                    subdirectory,
                    initial_prompt,
                    backend,
                    agent,
                    print_mode,
                    plan_mode,
                    access_mode,
                    images,
                    dangerous_skip_checks,
                    container_image,
                    pull_policy,
                    cpu_limit,
                    memory_limit,
                )
                .await;
        });

        Ok(session_id)
    }

    /// Complete session creation in background (spawned by start_session_creation)
    ///
    /// This method should not be called directly - it's spawned as a background task.
    async fn complete_session_creation(
        &self,
        session_id: Uuid,
        repo_path: String,
        full_name: String,
        worktree_path: PathBuf,
        subdirectory: PathBuf,
        initial_prompt: String,
        backend: BackendType,
        agent: super::session::AgentType,
        print_mode: bool,
        plan_mode: bool,
        access_mode: super::session::AccessMode,
        images: Vec<String>,
        dangerous_skip_checks: bool,
        container_image: Option<String>,
        pull_policy: Option<String>,
        cpu_limit: Option<String>,
        memory_limit: Option<String>,
    ) {
        // Acquire semaphore to limit concurrent creations
        let Ok(_permit) = self.creation_semaphore.acquire().await else {
            tracing::error!(session_id = %session_id, "Semaphore closed during operation");
            // Mark session as failed
            let mut sessions = self.sessions.write().await;
            if let Some(session) = sessions.iter_mut().find(|s| s.id == session_id) {
                session.set_error(SessionStatus::Failed, "System is shutting down".to_string());
                if let Err(e) = self.store.save_session(session).await {
                    tracing::error!("Failed to save shutdown error: {}", e);
                }
            }
            drop(sessions);
            return;
        };

        // Helper to update progress
        let update_progress = |step: u32, message: String| async move {
            let progress = crate::api::protocol::ProgressStep {
                step,
                total: 5,
                message,
            };

            // Update session progress
            if let Some(session) = self
                .sessions
                .write()
                .await
                .iter_mut()
                .find(|s| s.id == session_id)
            {
                session.set_progress(progress.clone());
            }

            // Broadcast progress event
            if let Some(ref broadcaster) = self.event_broadcaster {
                let _ = broadcaster.send(WsEvent::SessionProgress {
                    id: session_id.to_string(),
                    progress,
                });
            }
        };

        // Execute creation steps
        let result: anyhow::Result<()> = async {
            update_progress(1, "Creating git worktree".to_string()).await;
            let repo_path_buf = PathBuf::from(&repo_path);
            let _worktree_warning = self
                .git
                .create_worktree(&repo_path_buf, &worktree_path, &full_name)
                .await?;

            // Create history directory
            let history_path = super::session::get_history_file_path(&worktree_path, &session_id);
            if let Some(parent_dir) = history_path.parent() {
                if let Err(e) = tokio::fs::create_dir_all(parent_dir).await {
                    tracing::warn!(
                        session_id = %session_id,
                        history_dir = %parent_dir.display(),
                        error = %e,
                        "Failed to create history directory"
                    );
                }
            }

            update_progress(2, "Setting up session proxy".to_string()).await;
            // Create per-session proxy for Docker backends
            let proxy_port = if backend == BackendType::Docker {
                if let Some(ref proxy_manager) = self.proxy_manager {
                    match proxy_manager
                        .create_session_proxy(session_id, access_mode)
                        .await
                    {
                        Ok(proxy_port) => {
                            if let Some(session) = self
                                .sessions
                                .write()
                                .await
                                .iter_mut()
                                .find(|s| s.id == session_id)
                            {
                                session.set_proxy_port(proxy_port);
                            }
                            tracing::info!(
                                session_id = %session_id,
                                name = %full_name,
                                port = proxy_port,
                                "Created session proxy"
                            );
                            Some(proxy_port)
                        }
                        Err(e) => {
                            tracing::warn!(
                                session_id = %session_id,
                                name = %full_name,
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

            update_progress(3, "Preparing agent environment".to_string()).await;
            // Prepend plan mode instruction if enabled
            let transformed_prompt = if plan_mode {
                format!(
                    "Enter plan mode and create a plan before doing anything.\n\n{}",
                    initial_prompt.trim()
                )
            } else {
                initial_prompt.clone()
            };

            update_progress(4, "Starting backend resource".to_string()).await;

            // Parse container image configuration from request
            let container_image_config = if let Some(image) = container_image {
                let policy = if let Some(policy_str) = pull_policy {
                    policy_str.parse::<ImagePullPolicy>().map_err(|e| {
                        anyhow::anyhow!("Invalid pull policy '{}': {}", policy_str, e)
                    })?
                } else {
                    ImagePullPolicy::default()
                };

                let image_config = ImageConfig {
                    image,
                    pull_policy: policy,
                    registry_auth: None, // Registry auth via docker login or config file
                };

                // Validate the image configuration
                image_config.validate()?;

                tracing::info!(
                    session_id = %session_id,
                    image = %image_config.image,
                    pull_policy = %image_config.pull_policy,
                    "Using custom container image for session"
                );

                Some(image_config)
            } else {
                None
            };

            // Parse container resource limits from request
            let container_resource_limits = if cpu_limit.is_some() || memory_limit.is_some() {
                let limits = ResourceLimits {
                    cpu: cpu_limit,
                    memory: memory_limit,
                };

                // Validate the resource limits
                limits.validate()?;

                tracing::info!(
                    session_id = %session_id,
                    cpu = ?limits.cpu,
                    memory = ?limits.memory,
                    "Using custom resource limits for session"
                );

                Some(limits)
            } else {
                None
            };

            // Create backend resource
            let create_options = crate::backends::CreateOptions {
                agent,
                print_mode,
                plan_mode,
                session_proxy_port: proxy_port,
                images,
                dangerous_skip_checks,
                session_id: Some(session_id),
                initial_workdir: subdirectory.clone(),
                http_port: *self.http_port.read().await,
                container_image: container_image_config,
                container_resources: container_resource_limits,
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
                BackendType::Kubernetes => {
                    self.kubernetes
                        .create(
                            &full_name,
                            &worktree_path,
                            &transformed_prompt,
                            create_options,
                        )
                        .await?
                }
            };

            update_progress(5, "Finalizing session".to_string()).await;

            // Update session with backend ID and Running status
            {
                let mut sessions = self.sessions.write().await;
                if let Some(session) = sessions.iter_mut().find(|s| s.id == session_id) {
                    session.set_backend_id(backend_id.clone());
                    session.set_status(SessionStatus::Running);
                    session.clear_progress();

                    // Save to database
                    if let Err(e) = self.store.save_session(session).await {
                        tracing::error!("Failed to save session after creation: {}", e);
                    }
                }
            }

            // Record backend ID event
            let event = Event::new(session_id, EventType::BackendIdSet { backend_id });
            self.store.record_event(&event).await?;

            // Record status change event
            let event = Event::new(
                session_id,
                EventType::StatusChanged {
                    old_status: SessionStatus::Creating,
                    new_status: SessionStatus::Running,
                },
            );
            self.store.record_event(&event).await?;

            // Track this repo in recent repos
            let repo_path_buf = PathBuf::from(&repo_path);
            if let Err(e) = self
                .store
                .add_recent_repo(repo_path_buf, subdirectory.clone())
                .await
            {
                tracing::warn!("Failed to add repo to recent list: {e}");
            }

            Ok(())
        }
        .await;

        // Handle completion or failure
        match result {
            Ok(()) => {
                // Get the updated session for broadcast
                let session = self
                    .sessions
                    .read()
                    .await
                    .iter()
                    .find(|s| s.id == session_id)
                    .cloned();

                if let Some(session) = session {
                    // Broadcast status changed event
                    if let Some(ref broadcaster) = self.event_broadcaster {
                        let _ = broadcaster.send(WsEvent::StatusChanged {
                            id: session_id.to_string(),
                            old: SessionStatus::Creating,
                            new: SessionStatus::Running,
                        });
                        let _ = broadcaster.send(WsEvent::SessionUpdated(session));
                    }
                }

                tracing::info!(session_id = %session_id, "Session creation completed successfully");
            }
            Err(e) => {
                // Mark session as failed
                let error_msg = format!("{:#}", e);
                let mut sessions = self.sessions.write().await;
                if let Some(session) = sessions.iter_mut().find(|s| s.id == session_id) {
                    session.set_error(SessionStatus::Failed, error_msg.clone());
                    session.clear_progress();

                    // Save failed state to database
                    if let Err(save_err) = self.store.save_session(session).await {
                        tracing::error!("Failed to save failed session state: {}", save_err);
                    }

                    // Broadcast failure event
                    if let Some(ref broadcaster) = self.event_broadcaster {
                        let _ = broadcaster.send(WsEvent::SessionFailed {
                            id: session_id.to_string(),
                            error: error_msg.clone(),
                        });
                    }
                }
                drop(sessions); // Release lock before cleanup

                // CLEANUP: Remove partially created resources
                tracing::warn!(session_id = %session_id, "Cleaning up after failed creation");

                // Remove proxy if created
                if backend == BackendType::Docker {
                    if let Some(ref proxy_manager) = self.proxy_manager {
                        let _ = proxy_manager.destroy_session_proxy(session_id).await;
                    }
                }

                // Remove worktree if created
                let repo_path_buf = PathBuf::from(&repo_path);
                let _ = self
                    .git
                    .delete_worktree(&repo_path_buf, &worktree_path)
                    .await;

                // Remove from database
                let _ = self.store.delete_session(session_id).await;

                // Remove from in-memory list
                self.sessions.write().await.retain(|s| s.id != session_id);

                // Broadcast deletion event so UI updates
                if let Some(ref broadcaster) = self.event_broadcaster {
                    let _ = broadcaster.send(WsEvent::SessionDeleted {
                        id: session_id.to_string(),
                    });
                }

                tracing::error!(session_id = %session_id, error = %e, "Session creation failed");
            }
        }
    }

    /// Create a new session (synchronous version - blocks until complete)
    ///
    /// # Errors
    ///
    /// Returns an error if the session cannot be created, the worktree cannot
    /// be set up, or the backend fails to start.
    ///
    /// Returns the created session and optionally a list of warnings (e.g., if
    /// the post-checkout hook failed but the worktree was created successfully).
    #[instrument(
        skip(self, images),
        fields(
            repo_path = %repo_path,
            backend = ?backend,
            agent = ?agent,
            access_mode = ?access_mode,
            image_count = images.len()
        )
    )]
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
        container_image: Option<String>,
        pull_policy: Option<String>,
        cpu_limit: Option<String>,
        memory_limit: Option<String>,
    ) -> anyhow::Result<(Session, Option<Vec<String>>)> {
        // Validate and resolve git repository path
        let repo_path_buf = std::path::PathBuf::from(&repo_path);
        let git_info = crate::utils::git::find_git_root(&repo_path_buf)
            .with_context(|| format!("Failed to find git repository for path: {}", repo_path))?;

        // Use git root for worktree creation
        let repo_path = git_info.git_root.to_string_lossy().to_string();
        let subdirectory = git_info.subdirectory;

        // Validate subdirectory path for security (defense in depth)
        if subdirectory.is_absolute()
            || subdirectory
                .components()
                .any(|c| matches!(c, std::path::Component::ParentDir))
        {
            anyhow::bail!(
                "Invalid subdirectory path: must be relative without '..' components. Got: {}",
                subdirectory.display()
            );
        }

        tracing::info!(
            original_path = %repo_path_buf.display(),
            git_root = %repo_path,
            subdirectory = %subdirectory.display(),
            "Resolved git repository root"
        );

        // Generate metadata using AI (with fallback to defaults)
        let metadata = crate::utils::generate_session_name_ai(&repo_path, &initial_prompt).await;

        // Generate unique session name with random suffix using branch_name as base
        const MAX_ATTEMPTS: usize = 3;
        let full_name = {
            let mut attempts = 0;
            loop {
                let candidate = crate::utils::random::generate_session_name(&metadata.branch_name);
                let sessions = self.sessions.read().await;
                let is_unique = !sessions.iter().any(|s| s.name == candidate);
                drop(sessions);
                if is_unique {
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

        // Create session object with AI-generated metadata
        let mut session = Session::new(super::session::SessionConfig {
            name: full_name.clone(),
            title: Some(metadata.title),
            description: Some(metadata.description),
            repo_path: repo_path.clone().into(),
            worktree_path: worktree_path.clone(),
            subdirectory: subdirectory.clone(),
            branch_name: metadata.branch_name, // Use AI branch_name (no suffix)
            initial_prompt: initial_prompt.clone(),
            backend,
            agent,
            dangerous_skip_checks,
            access_mode,
        });

        // Set history file path (directory created after worktree exists)
        session.history_file_path = Some(super::session::get_history_file_path(
            &worktree_path,
            &session.id,
        ));

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

        // Now that worktree exists, create the history directory
        if let Some(ref history_path) = session.history_file_path {
            if let Some(parent_dir) = history_path.parent() {
                if let Err(e) = tokio::fs::create_dir_all(parent_dir).await {
                    tracing::warn!(
                        session_id = %session.id,
                        history_dir = %parent_dir.display(),
                        error = %e,
                        "Failed to create history directory"
                    );
                } else {
                    tracing::debug!(
                        session_id = %session.id,
                        history_dir = %parent_dir.display(),
                        "Created history directory"
                    );
                }
            }
        }

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
                            name = %session.name,
                            port = proxy_port,
                            "Created session proxy"
                        );
                        Some(proxy_port)
                    }
                    Err(e) => {
                        tracing::warn!(
                            session_id = %session.id,
                            name = %session.name,
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

        // Parse container image configuration
        let container_image_config = if let Some(image) = container_image {
            let policy = if let Some(policy_str) = pull_policy {
                policy_str
                    .parse::<ImagePullPolicy>()
                    .map_err(|e| anyhow::anyhow!("Invalid pull policy '{}': {}", policy_str, e))?
            } else {
                ImagePullPolicy::default()
            };

            let image_config = ImageConfig {
                image,
                pull_policy: policy,
                registry_auth: None, // Registry auth via docker login or config file
            };

            // Validate the image configuration
            image_config.validate()?;

            Some(image_config)
        } else {
            None
        };

        // Parse container resource limits
        let container_resource_limits = if cpu_limit.is_some() || memory_limit.is_some() {
            let limits = ResourceLimits {
                cpu: cpu_limit,
                memory: memory_limit,
            };

            // Validate the resource limits
            limits.validate()?;

            Some(limits)
        } else {
            None
        };

        // Create backend resource
        let create_options = crate::backends::CreateOptions {
            agent,
            print_mode,
            plan_mode,
            session_proxy_port: proxy_port,
            images,
            dangerous_skip_checks,
            session_id: Some(session.id), // Pass session ID for Kubernetes PVC labeling
            initial_workdir: subdirectory.clone(),
            http_port: *self.http_port.read().await,
            container_image: container_image_config,
            container_resources: container_resource_limits,
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
            BackendType::Kubernetes => {
                self.kubernetes
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
        if let Err(e) = self
            .store
            .add_recent_repo(repo_path_buf.clone(), subdirectory.clone())
            .await
        {
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
    #[instrument(skip(self), fields(id_or_name = %id_or_name))]
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
            BackendType::Kubernetes => Ok(self.kubernetes.attach_command(backend_id)),
        }
    }

    /// Archive a session
    ///
    /// # Errors
    ///
    /// Returns an error if the session is not found or the store update fails.
    #[instrument(skip(self), fields(id_or_name = %id_or_name))]
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

    /// Start session deletion asynchronously (returns immediately)
    ///
    /// Marks the session as "Deleting" and spawns a background task to complete
    /// the deletion process. Progress updates are broadcast via WebSocket events.
    ///
    /// # Errors
    ///
    /// Returns an error if:
    /// - Session not found
    /// - Session is already being deleted
    /// - Database update fails
    #[instrument(skip(self), fields(id_or_name = %id_or_name))]
    pub async fn start_session_deletion(self: &Arc<Self>, id_or_name: &str) -> anyhow::Result<()> {
        // Get session and validate
        let (session_id, session_name) = {
            let session = self
                .get_session(id_or_name)
                .await
                .ok_or_else(|| anyhow::anyhow!("Session not found: {id_or_name}"))?;

            // Don't allow deleting if already deleting
            if session.status == SessionStatus::Deleting {
                anyhow::bail!("Session is already being deleted");
            }

            (session.id, session.name)
        };

        // Update to Deleting status
        {
            let mut sessions = self.sessions.write().await;
            if let Some(session) = sessions.iter_mut().find(|s| s.id == session_id) {
                session.set_status(SessionStatus::Deleting);
                session.set_progress(crate::api::protocol::ProgressStep {
                    step: 0,
                    total: 4,
                    message: "Queued for deletion".to_string(),
                });

                // Save to database
                if let Err(e) = self.store.save_session(session).await {
                    tracing::error!("Failed to save deleting session state: {}", e);
                }

                // Broadcast status change
                if let Some(ref broadcaster) = self.event_broadcaster {
                    let _ = broadcaster.send(WsEvent::StatusChanged {
                        id: session_id.to_string(),
                        old: session.status,
                        new: SessionStatus::Deleting,
                    });
                    let _ = broadcaster.send(WsEvent::SessionUpdated(session.clone()));
                }
            }
        }

        // Spawn background deletion task
        let manager_clone = Arc::clone(self);
        tokio::spawn(async move {
            manager_clone
                .complete_session_deletion(session_id, session_name)
                .await;
        });

        Ok(())
    }

    /// Complete session deletion in background (spawned by start_session_deletion)
    ///
    /// This method should not be called directly - it's spawned as a background task.
    async fn complete_session_deletion(&self, session_id: Uuid, session_name: String) {
        let Ok(_permit) = self.deletion_semaphore.acquire().await else {
            tracing::error!(session_id = %session_id, "Semaphore closed during deletion");
            // Mark session as failed instead of panicking
            let mut sessions = self.sessions.write().await;
            if let Some(session) = sessions.iter_mut().find(|s| s.id == session_id) {
                session.set_error(
                    SessionStatus::Failed,
                    "System is shutting down during deletion".to_string(),
                );
                if let Err(e) = self.store.save_session(session).await {
                    tracing::error!("Failed to save shutdown error: {}", e);
                }
            }
            drop(sessions);
            return;
        };

        // Helper to update progress
        let update_progress = |step: u32, message: String| async move {
            let progress = crate::api::protocol::ProgressStep {
                step,
                total: 4,
                message,
            };

            if let Some(session) = self
                .sessions
                .write()
                .await
                .iter_mut()
                .find(|s| s.id == session_id)
            {
                session.set_progress(progress.clone());
            }

            if let Some(ref broadcaster) = self.event_broadcaster {
                let _ = broadcaster.send(WsEvent::SessionProgress {
                    id: session_id.to_string(),
                    progress,
                });
            }
        };

        // Get session details before deletion
        let (backend, backend_id, repo_path, worktree_path) = {
            let sessions = self.sessions.read().await;
            if let Some(session) = sessions.iter().find(|s| s.id == session_id) {
                (
                    session.backend,
                    session.backend_id.clone(),
                    session.repo_path.clone(),
                    session.worktree_path.clone(),
                )
            } else {
                tracing::error!("Session {} disappeared during deletion", session_id);
                return;
            }
        };

        // Execute deletion steps
        let result: anyhow::Result<()> = async {
            update_progress(1, "Destroying backend resources".to_string()).await;
            // Delete backend resources
            if let Some(ref backend_id) = backend_id {
                match backend {
                    BackendType::Zellij => {
                        let _ = self.zellij.delete(backend_id).await;
                    }
                    BackendType::Docker => {
                        let _ = self.docker.delete(backend_id).await;
                    }
                    BackendType::Kubernetes => {
                        let _ = self.kubernetes.delete(backend_id).await;
                    }
                }
            }

            update_progress(2, "Removing session proxy".to_string()).await;
            // Destroy per-session proxy if it exists
            if backend == BackendType::Docker {
                if let Some(ref proxy_manager) = self.proxy_manager {
                    if let Err(e) = proxy_manager.destroy_session_proxy(session_id).await {
                        tracing::warn!(
                            session_id = %session_id,
                            name = %session_name,
                            error = %e,
                            "Failed to destroy session proxy"
                        );
                    }
                }
            }

            update_progress(3, "Removing git worktree".to_string()).await;
            // Delete git worktree
            let _ = self.git.delete_worktree(&repo_path, &worktree_path).await;

            update_progress(4, "Cleaning up database".to_string()).await;
            // Record deletion event
            let event = Event::new(session_id, EventType::SessionDeleted { reason: None });
            self.store.record_event(&event).await?;

            // Remove from store
            self.store.delete_session(session_id).await?;

            Ok(())
        }
        .await;

        // Handle completion or failure
        match result {
            Ok(()) => {
                // Remove from in-memory list
                self.sessions.write().await.retain(|s| s.id != session_id);

                // Broadcast deletion event
                if let Some(ref broadcaster) = self.event_broadcaster {
                    let _ = broadcaster.send(WsEvent::SessionDeleted {
                        id: session_id.to_string(),
                    });
                }

                tracing::info!(session_id = %session_id, "Session deletion completed successfully");
            }
            Err(e) => {
                // Mark session as failed but keep in list for inspection
                let error_msg = format!("{:#}", e);
                let mut sessions = self.sessions.write().await;
                if let Some(session) = sessions.iter_mut().find(|s| s.id == session_id) {
                    session.set_error(SessionStatus::Failed, error_msg.clone());
                    session.clear_progress();

                    // Save failed state to database
                    if let Err(save_err) = self.store.save_session(session).await {
                        tracing::error!("Failed to save failed session state: {}", save_err);
                    }

                    // Broadcast failure event
                    if let Some(ref broadcaster) = self.event_broadcaster {
                        let _ = broadcaster.send(WsEvent::SessionFailed {
                            id: session_id.to_string(),
                            error: error_msg,
                        });
                    }
                }
                drop(sessions);

                tracing::error!(session_id = %session_id, error = %e, "Session deletion failed");
            }
        }
    }

    /// Delete a session (synchronous version - blocks until complete)
    ///
    /// # Errors
    ///
    /// Returns an error if the session cannot be deleted.
    #[instrument(skip(self), fields(id_or_name = %id_or_name))]
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
                BackendType::Kubernetes => {
                    let _ = self.kubernetes.delete(backend_id).await;
                }
            }
        }

        // Destroy per-session proxy if it exists
        if session.backend == BackendType::Docker {
            if let Some(ref proxy_manager) = self.proxy_manager {
                if let Err(e) = proxy_manager.destroy_session_proxy(session.id).await {
                    tracing::warn!(
                        session_id = %session.id,
                        name = %session.name,
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

    /// Refresh a session by recreating its container with the latest image
    ///
    /// This operation:
    /// 1. Pulls the latest Docker image
    /// 2. Stops and removes the old container
    /// 3. Creates a new container with the same configuration
    /// 4. Preserves all session metadata and history
    ///
    /// # Errors
    ///
    /// Returns an error if:
    /// - Session not found
    /// - Session is not Docker-based
    /// - Image pull fails
    /// - Container recreation fails
    #[instrument(skip(self), fields(id_or_name = %id_or_name))]
    pub async fn refresh_session(&self, id_or_name: &str) -> anyhow::Result<()> {
        // Acquire deletion semaphore (refresh is destructive like delete)
        let _permit = self
            .deletion_semaphore
            .acquire()
            .await
            .map_err(|_| anyhow::anyhow!("System is shutting down"))?;

        // Get session and validate it's Docker
        let session = self
            .get_session(id_or_name)
            .await
            .ok_or_else(|| anyhow::anyhow!("Session not found: {id_or_name}"))?;

        if session.backend != BackendType::Docker {
            anyhow::bail!("Refresh only supported for Docker sessions");
        }

        let session_id = session.id;

        // Capture configuration before deletion
        let (
            name,
            _repo_path,
            worktree_path,
            subdirectory,
            initial_prompt,
            agent,
            dangerous_skip_checks,
            _access_mode,
            proxy_port,
            old_backend_id,
        ) = {
            let sessions = self.sessions.read().await;
            let s = sessions
                .iter()
                .find(|s| s.id == session_id)
                .ok_or_else(|| anyhow::anyhow!("Session disappeared"))?;

            (
                s.name.clone(),
                s.repo_path.clone(),
                s.worktree_path.clone(),
                s.subdirectory.clone(),
                s.initial_prompt.clone(),
                s.agent,
                s.dangerous_skip_checks,
                s.access_mode,
                s.proxy_port,
                s.backend_id.clone(),
            )
        };

        // Execute refresh: pull + delete + create
        let result: anyhow::Result<String> = async {
            // Pull latest image
            let docker_image = "ghcr.io/shepherdjerred/dotfiles";
            tracing::info!(image = docker_image, "Pulling Docker image");

            let output = tokio::process::Command::new("docker")
                .args(["pull", docker_image])
                .output()
                .await
                .context("Failed to execute docker pull")?;

            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                tracing::error!(
                    image = docker_image,
                    stderr = %stderr,
                    "Failed to pull Docker image"
                );
                anyhow::bail!("Failed to pull Docker image: {stderr}");
            }

            tracing::info!(image = docker_image, "Successfully pulled Docker image");

            // Delete old container
            if let Some(ref backend_id) = old_backend_id {
                let _ = self.docker.delete(backend_id).await;
            }

            // Create new container
            let create_options = crate::backends::CreateOptions {
                agent,
                print_mode: false,
                plan_mode: false,
                session_proxy_port: proxy_port,
                images: vec![],
                dangerous_skip_checks,
                session_id: Some(session_id),
                initial_workdir: subdirectory,
                http_port: *self.http_port.read().await,
                container_image: None,
                container_resources: None,
            };

            let new_backend_id = self
                .docker
                .create(&name, &worktree_path, &initial_prompt, create_options)
                .await
                .context("Failed to create new container")?;

            // Reinstall hooks for Claude Code
            if agent == super::session::AgentType::ClaudeCode {
                let container_name = format!("clauderon-{name}");
                if let Err(e) = crate::hooks::install_hooks_in_container(&container_name).await {
                    tracing::warn!(error = %e, "Failed to install hooks (non-fatal)");
                }
            }

            Ok(new_backend_id)
        }
        .await;

        // Update session based on result
        match result {
            Ok(new_backend_id) => {
                let mut sessions = self.sessions.write().await;
                if let Some(session) = sessions.iter_mut().find(|s| s.id == session_id) {
                    session.set_backend_id(new_backend_id.clone());
                    session.set_status(SessionStatus::Running);
                    session.reset_reconcile_state();

                    let session_clone = session.clone();
                    drop(sessions);

                    self.store.save_session(&session_clone).await?;

                    let event = Event::new(
                        session_id,
                        EventType::BackendIdSet {
                            backend_id: new_backend_id.clone(),
                        },
                    );
                    self.store.record_event(&event).await?;

                    // Restart console session
                    if let Err(err) = self
                        .console_manager
                        .ensure_session(session_id, BackendType::Docker, &new_backend_id)
                        .await
                    {
                        tracing::warn!(error = %err, "Failed to start console session");
                    }
                }
                Ok(())
            }
            Err(e) => {
                // Mark as failed
                let error_msg = format!("{:#}", e);
                let mut sessions = self.sessions.write().await;
                if let Some(session) = sessions.iter_mut().find(|s| s.id == session_id) {
                    session.set_error(SessionStatus::Failed, error_msg.clone());
                    self.store.save_session(session).await?;
                }
                Err(e)
            }
        }
    }

    /// Reconcile expected state with reality
    ///
    /// This method:
    /// - Detects missing worktrees and backends
    /// - Attempts to auto-recreate containers for Running sessions with missing backends
    /// - Uses exponential backoff between retry attempts
    /// - Gives up after MAX_RECONCILE_ATTEMPTS
    ///
    /// # Errors
    ///
    /// Returns an error if backend existence checks fail.
    #[instrument(skip(self))]
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
                    BackendType::Kubernetes => self.kubernetes.exists(backend_id).await?,
                };

                if !exists {
                    report.missing_backends.push(session.id);

                    // Only attempt auto-recreation for Running sessions
                    if session.status == SessionStatus::Running
                        && session.backend != BackendType::Zellij
                    {
                        // Check if we've exceeded max attempts
                        if session.exceeded_max_reconcile_attempts() {
                            report.gave_up.push(session.id);
                            tracing::warn!(
                                session_id = %session.id,
                                name = %session.name,
                                attempts = session.reconcile_attempts,
                                "Giving up on session after max reconciliation attempts"
                            );
                            continue;
                        }

                        // Check backoff timing
                        if !session.should_attempt_reconcile() {
                            tracing::debug!(
                                session_id = %session.id,
                                name = %session.name,
                                attempts = session.reconcile_attempts,
                                "Skipping reconciliation attempt - backoff timer not expired"
                            );
                            continue;
                        }

                        tracing::info!(
                            session_id = %session.id,
                            name = %session.name,
                            attempt = session.reconcile_attempts + 1,
                            max_attempts = MAX_RECONCILE_ATTEMPTS,
                            "Attempting container recreation"
                        );

                        // Attempt recreation
                        match self.recreate_container(session.id).await {
                            Ok(()) => {
                                report.recreated.push(session.id);
                                tracing::info!(
                                    session_id = %session.id,
                                    name = %session.name,
                                    "Container recreated successfully"
                                );
                            }
                            Err(e) => {
                                // Record failure with updated attempt count
                                let mut sessions_mut = self.sessions.write().await;
                                if let Some(sess) =
                                    sessions_mut.iter_mut().find(|s| s.id == session.id)
                                {
                                    sess.record_reconcile_failure(e.to_string());
                                    let sess_clone = sess.clone();
                                    drop(sessions_mut);

                                    // Save updated session to store
                                    if let Err(save_err) =
                                        self.store.save_session(&sess_clone).await
                                    {
                                        tracing::error!(
                                            session_id = %session.id,
                                            error = %save_err,
                                            "Failed to save session after reconcile failure"
                                        );
                                    }
                                } else {
                                    drop(sessions_mut);
                                }

                                report.recreation_failed.push(session.id);
                                tracing::error!(
                                    session_id = %session.id,
                                    name = %session.name,
                                    error = %e,
                                    "Failed to recreate container"
                                );
                            }
                        }
                    } else {
                        // Clean up orphaned session proxy for non-running sessions
                        if session.backend == BackendType::Docker {
                            if let Some(ref proxy_manager) = self.proxy_manager {
                                tracing::info!(
                                    session_id = %session.id,
                                    name = %session.name,
                                    "Destroying proxy for session with missing container"
                                );
                                let _ = proxy_manager.destroy_session_proxy(session.id).await;
                            }
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
                            name = %session.name,
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
                            BackendType::Kubernetes => {
                                let _ = self.kubernetes.delete(backend_id).await;
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
                                if tokio::net::TcpStream::connect(format!("127.0.0.1:{port}"))
                                    .await
                                    .is_err()
                                {
                                    tracing::warn!(
                                        session_id = %session.id,
                                        name = %session.name,
                                        port = port,
                                        "Session proxy not responding - attempting recreation"
                                    );
                                    // Attempt auto-recreation
                                    let _ = proxy_manager
                                        .restore_session_proxies(std::slice::from_ref(session))
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

    /// Recreate a container for a session with a missing backend
    ///
    /// This method:
    /// 1. Deletes the old container if it exists (ignoring errors)
    /// 2. Recreates the container with the same settings
    /// 3. Updates the session with the new backend ID
    /// 4. Resets the reconcile state on success
    ///
    /// # Errors
    ///
    /// Returns an error if the session is not found or container creation fails.
    pub async fn recreate_container(&self, session_id: Uuid) -> anyhow::Result<()> {
        let mut sessions = self.sessions.write().await;
        let session = sessions
            .iter_mut()
            .find(|s| s.id == session_id)
            .ok_or_else(|| anyhow::anyhow!("Session not found: {}", session_id))?;

        // Only Docker and Kubernetes backends support recreation
        if session.backend == BackendType::Zellij {
            anyhow::bail!("Zellij sessions cannot be recreated automatically");
        }

        tracing::info!(
            session_id = %session.id,
            name = %session.name,
            backend = ?session.backend,
            "Attempting to recreate container"
        );

        // Delete old container if it exists (ignore errors)
        if let Some(ref backend_id) = session.backend_id {
            match session.backend {
                BackendType::Docker => {
                    let _ = self.docker.delete(backend_id).await;
                }
                BackendType::Kubernetes => {
                    let _ = self.kubernetes.delete(backend_id).await;
                }
                BackendType::Zellij => {} // Already checked above
            }
        }

        // Build creation options from session state
        let create_options = crate::backends::CreateOptions {
            agent: session.agent,
            print_mode: false, // Never use print mode for recreation
            plan_mode: false,  // Don't enter plan mode - session already has context
            session_proxy_port: session.proxy_port,
            images: vec![], // No images for recreation
            dangerous_skip_checks: session.dangerous_skip_checks,
            session_id: Some(session.id),
            initial_workdir: session.subdirectory.clone(),
            http_port: *self.http_port.read().await,
            container_image: None,
            container_resources: None,
        };

        // Recreate container
        let backend_id = match session.backend {
            BackendType::Docker => {
                self.docker
                    .create(
                        &session.name,
                        &session.worktree_path,
                        &session.initial_prompt,
                        create_options,
                    )
                    .await?
            }
            BackendType::Kubernetes => {
                self.kubernetes
                    .create(
                        &session.name,
                        &session.worktree_path,
                        &session.initial_prompt,
                        create_options,
                    )
                    .await?
            }
            BackendType::Zellij => unreachable!(),
        };

        // Update session with new backend ID and reset reconcile state
        session.set_backend_id(backend_id.clone());
        session.reset_reconcile_state();
        let session_clone = session.clone();
        drop(sessions);

        // Record backend ID event
        let event = Event::new(session_id, EventType::BackendIdSet { backend_id });
        self.store.record_event(&event).await?;

        // Save to store
        self.store.save_session(&session_clone).await?;

        tracing::info!(
            session_id = %session_id,
            name = %session_clone.name,
            "Successfully recreated container"
        );

        // Broadcast event to WebSocket clients if broadcaster available
        if let Some(ref broadcaster) = self.event_broadcaster {
            broadcast_event(broadcaster, WsEvent::SessionUpdated(session_clone)).await;
        }

        Ok(())
    }

    /// Update session metadata (title and description)
    ///
    /// # Errors
    ///
    /// Returns an error if the session is not found or the store update fails.
    #[instrument(skip(self), fields(id_or_name = %id_or_name))]
    pub async fn update_metadata(
        &self,
        id_or_name: &str,
        title: Option<String>,
        description: Option<String>,
    ) -> anyhow::Result<()> {
        let mut sessions = self.sessions.write().await;
        let session = sessions
            .iter_mut()
            .find(|s| s.name == id_or_name || s.id.to_string() == id_or_name)
            .ok_or_else(|| anyhow::anyhow!("Session not found: {id_or_name}"))?;

        let session_id = session.id;
        session.set_title(title);
        session.set_description(description);
        let session_clone = session.clone();
        drop(sessions);

        // Update in store
        self.store.save_session(&session_clone).await?;

        tracing::info!(
            session_id = %session_id,
            name = %session_clone.name,
            "Updated session metadata"
        );

        Ok(())
    }

    /// Update the access mode for a session
    ///
    /// # Errors
    ///
    /// Returns an error if the session is not found or the store update fails.
    #[instrument(skip(self), fields(id_or_name = %id_or_name, new_mode = ?new_mode))]
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
                // Only update proxy if session actually has a proxy port allocated
                // (proxy creation can fail gracefully, leaving session without proxy)
                if session_clone.proxy_port.is_some() {
                    proxy_manager
                        .update_session_access_mode(session_id, new_mode)
                        .await?;
                }
            }
        }

        // Update in store
        self.store.save_session(&session_clone).await?;

        tracing::info!(
            session_id = %session_id,
            name = %session_clone.name,
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

    /// Link a PR URL to a session
    ///
    /// # Errors
    ///
    /// Returns an error if the session is not found or the store update fails.
    pub async fn link_pr(&self, session_id: Uuid, pr_url: String) -> anyhow::Result<()> {
        let mut sessions = self.sessions.write().await;
        let session = sessions
            .iter_mut()
            .find(|s| s.id == session_id)
            .ok_or_else(|| anyhow::anyhow!("Session not found: {}", session_id))?;

        // Don't update if PR is already linked
        if session.pr_url.is_some() {
            return Ok(());
        }

        session.set_pr_url(pr_url.clone());
        let session_clone = session.clone();
        drop(sessions);

        // Record event
        let event = Event::new(
            session_id,
            EventType::PrLinked {
                pr_url: pr_url.clone(),
            },
        );
        self.store.record_event(&event).await?;

        // Update in store
        self.store.save_session(&session_clone).await?;

        tracing::info!(
            session_id = %session_id,
            pr_url = %pr_url,
            "Linked PR to session"
        );

        // Broadcast event to WebSocket clients if broadcaster available
        if let Some(ref broadcaster) = self.event_broadcaster {
            if let Some(session) = self.get_session(&session_id.to_string()).await {
                broadcast_event(broadcaster, WsEvent::SessionUpdated(session)).await;
            }
        }

        Ok(())
    }

    /// Update merge conflict status for a session
    ///
    /// # Errors
    ///
    /// Returns an error if the session is not found or the store update fails.
    pub async fn update_conflict_status(
        &self,
        session_id: Uuid,
        has_conflict: bool,
    ) -> anyhow::Result<()> {
        let mut sessions = self.sessions.write().await;
        let session = sessions
            .iter_mut()
            .find(|s| s.id == session_id)
            .ok_or_else(|| anyhow::anyhow!("Session not found: {}", session_id))?;

        // Don't update if status hasn't changed
        if session.merge_conflict == has_conflict {
            return Ok(());
        }

        session.set_merge_conflict(has_conflict);
        let session_clone = session.clone();
        drop(sessions);

        // Record event
        let event = Event::new(
            session_id,
            EventType::ConflictStatusChanged { has_conflict },
        );
        self.store.record_event(&event).await?;

        // Update in store
        self.store.save_session(&session_clone).await?;

        tracing::info!(
            session_id = %session_id,
            has_conflict = %has_conflict,
            "Updated merge conflict status"
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
                let container_name = format!("clauderon-{backend_id}");
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
            BackendType::Kubernetes => {
                // Send prompt via kubectl exec with stdin (similar to Docker)
                let namespace = crate::backends::KubernetesConfig::load_or_default().namespace;
                let mut child = tokio::process::Command::new("kubectl")
                    .args([
                        "exec", "-i", "-n", &namespace, backend_id, "-c", "claude", "--", "claude",
                    ])
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
                    format!(
                        "{start}****...{end}",
                        start = &value[..8],
                        end = &value[value.len() - 4..]
                    )
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

            // Collect proxy status (only Talos gateway is global)
            if pm.is_talos_configured() {
                proxies.push(ProxyStatus {
                    name: "Talos mTLS Gateway".to_string(),
                    port: pm.talos_gateway_port(),
                    active: true,
                    proxy_type: "global".to_string(),
                });
            }

            // Count session-specific proxies
            active_session_proxies =
                u32::try_from(pm.active_session_proxy_count().await).unwrap_or(u32::MAX);
        }

        Ok(SystemStatus {
            credentials,
            proxies,
            active_session_proxies,
            claude_usage: None,
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
    pub fn update_credential(&self, service_id: &str, value: &str) -> anyhow::Result<()> {
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
            _ => anyhow::bail!("Invalid service ID: {service_id}"),
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
            _ => anyhow::bail!("Invalid service ID: {service_id}"),
        }
    }
}
