use anyhow::Context;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::{RwLock, Semaphore};
use tracing::instrument;
use uuid::Uuid;

use crate::backends::{
    DockerBackend, ExecutionBackend, GitBackend, GitOperations, ImageConfig, ImagePullPolicy,
    AiSandboxBackend, ResourceLimits, ZellijBackend,
};

use crate::core::console_manager::ConsoleManager;
use crate::store::Store;

use super::events::{Event, EventType};
use super::session::{
    BackendType, CheckStatus, ClaudeWorkingStatus, MergeMethod, PrReviewStatus, Session,
    SessionStatus,
};

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

/// Error type for recreate operations
///
/// Distinguishes between blocked recreates (which return 409 Conflict)
/// and other errors (which return 500 Internal Server Error).
#[derive(Debug)]
pub enum RecreateError {
    /// Recreate was blocked for safety reasons
    Blocked(crate::core::session::RecreateBlockedError),
    /// Other error occurred
    Other(anyhow::Error),
}

impl std::fmt::Display for RecreateError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Blocked(err) => write!(f, "Recreate blocked: {}", err.reason),
            Self::Other(err) => write!(f, "Recreate failed: {err}"),
        }
    }
}

impl std::error::Error for RecreateError {}

impl From<crate::core::session::RecreateBlockedError> for RecreateError {
    fn from(err: crate::core::session::RecreateBlockedError) -> Self {
        Self::Blocked(err)
    }
}

impl From<anyhow::Error> for RecreateError {
    fn from(err: anyhow::Error) -> Self {
        Self::Other(err)
    }
}

/// Cache for Claude Code usage data
struct UsageCache {
    data: Option<crate::api::protocol::ClaudeUsage>,
    fetched_at: Option<Instant>,
    ttl: Duration,
}

impl UsageCache {
    fn new() -> Self {
        Self {
            data: None,
            fetched_at: None,
            ttl: Duration::from_secs(5 * 60), // 5 minutes
        }
    }

    fn is_valid(&self) -> bool {
        if let Some(fetched_at) = self.fetched_at {
            fetched_at.elapsed() < self.ttl
        } else {
            false
        }
    }

    fn set(&mut self, data: crate::api::protocol::ClaudeUsage) {
        self.data = Some(data);
        self.fetched_at = Some(Instant::now());
    }

    fn get(&self) -> Option<&crate::api::protocol::ClaudeUsage> {
        if self.is_valid() {
            self.data.as_ref()
        } else {
            None
        }
    }
}

/// Manages session lifecycle and state
pub struct SessionManager {
    store: Arc<dyn Store>,
    git: Arc<dyn GitOperations>,
    zellij: Arc<dyn ExecutionBackend>,
    docker: Arc<dyn ExecutionBackend>,
    ai_sandbox: Arc<dyn ExecutionBackend>,
    console_manager: Arc<ConsoleManager>,
    sessions: RwLock<Vec<Session>>,
    /// Optional event broadcaster for real-time WebSocket updates
    event_broadcaster: Option<EventBroadcaster>,
    /// Semaphore to limit concurrent creations (max 3)
    creation_semaphore: Arc<Semaphore>,
    /// Semaphore to limit concurrent deletions (max 3)
    deletion_semaphore: Arc<Semaphore>,
    /// Maximum total sessions allowed
    max_sessions: usize,
    /// HTTP server port for hook communication (Docker only)
    http_port: Option<u16>,
    /// Cache for Claude Code usage data
    usage_cache: Arc<RwLock<UsageCache>>,
    /// Feature flags for controlling behavior
    feature_flags: Arc<crate::feature_flags::FeatureFlags>,
    /// Server config for org_id and other settings
    server_config: Option<Arc<crate::feature_flags::ServerConfig>>,
}

impl std::fmt::Debug for SessionManager {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SessionManager")
            .field("max_sessions", &self.max_sessions)
            .finish_non_exhaustive()
    }
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
        ai_sandbox: Arc<dyn ExecutionBackend>,
        feature_flags: Arc<crate::feature_flags::FeatureFlags>,
    ) -> anyhow::Result<Self> {
        let sessions = store.list_sessions().await?;

        Ok(Self {
            store,
            git,
            zellij,
            docker,
            ai_sandbox,
            console_manager: Arc::new(ConsoleManager::new()),
            sessions: RwLock::new(sessions),
            event_broadcaster: None,
            creation_semaphore: Arc::new(Semaphore::new(3)),
            deletion_semaphore: Arc::new(Semaphore::new(3)),
            max_sessions: 15,
            http_port: None,
            usage_cache: Arc::new(RwLock::new(UsageCache::new())),
            feature_flags,
            server_config: None,
        })
    }

    /// Create a new session manager with default backends
    ///
    /// This is a convenience constructor for production use that creates
    /// real Git, Zellij, Docker, and other backends.
    ///
    /// # Errors
    ///
    /// Returns an error if the store cannot be read.
    pub async fn with_defaults(
        store: Arc<dyn Store>,
        feature_flags: Arc<crate::feature_flags::FeatureFlags>,
    ) -> anyhow::Result<Self> {
        let git: Arc<dyn GitOperations> = Arc::new(GitBackend::new());
        Self::new(
            store,
            Arc::clone(&git),
            Arc::new(ZellijBackend::new()),
            Arc::new(DockerBackend::new()),
            Arc::new(AiSandboxBackend::new(Arc::clone(&git))),
            feature_flags,
        )
        .await
    }

    /// Create a new session manager with a custom Docker backend
    ///
    /// This is useful for providing a custom DockerBackend configuration.
    ///
    /// # Errors
    ///
    /// Returns an error if the store cannot be read.
    pub async fn with_docker_backend(
        store: Arc<dyn Store>,
        docker: DockerBackend,
        feature_flags: Arc<crate::feature_flags::FeatureFlags>,
    ) -> anyhow::Result<Self> {
        let git: Arc<dyn GitOperations> = Arc::new(GitBackend::new());
        Self::new(
            store,
            Arc::clone(&git),
            Arc::new(ZellijBackend::new()),
            Arc::new(docker),
            Arc::new(AiSandboxBackend::new(Arc::clone(&git))),
            feature_flags,
        )
        .await
    }

    /// Set the event broadcaster for real-time WebSocket updates
    ///
    /// This should be called after construction to enable real-time event broadcasting
    /// to WebSocket clients when session status changes occur.
    pub fn set_event_broadcaster(&mut self, broadcaster: EventBroadcaster) {
        self.event_broadcaster = Some(broadcaster);
    }

    /// Set the HTTP server port for hook communication
    ///
    /// This should be called after construction to enable HTTP-based hook communication
    /// for Docker containers (required since Unix sockets don't work
    /// across VM/network boundaries).
    pub fn set_http_port(&mut self, port: u16) {
        self.http_port = Some(port);
    }

    /// Set the server config for org_id and other settings
    ///
    /// This should be called after construction to enable config-based org_id lookup
    /// for Claude usage tracking.
    pub fn set_server_config(&mut self, config: Arc<crate::feature_flags::ServerConfig>) {
        self.server_config = Some(config);
    }

    /// Validate that the requested backend is enabled via feature flags
    fn validate_backend_enabled(&self, _backend: BackendType) -> anyhow::Result<()> {

        Ok(())
    }

    /// Get a shared reference to the console manager.
    #[must_use]
    pub fn console_manager(&self) -> Arc<ConsoleManager> {
        Arc::clone(&self.console_manager)
    }


    /// Get reference to feature flags
    ///
    /// Returns the current feature flag configuration.
    #[must_use]
    pub fn feature_flags(&self) -> Arc<crate::feature_flags::FeatureFlags> {
        Arc::clone(&self.feature_flags)
    }

    /// List all sessions
    #[instrument(skip(self))]
    pub async fn list_sessions(&self) -> Vec<Session> {
        self.sessions.read().await.clone()
    }

    // ========================================================================
    // Health Check Methods
    // ========================================================================

    /// Create a health service using the manager's backends
    fn create_health_service(&self) -> crate::core::health::HealthService {
        crate::core::health::HealthService::new(
            Arc::clone(&self.git),
            Arc::clone(&self.zellij),
            Arc::clone(&self.docker),
            Arc::clone(&self.ai_sandbox),
        )
    }

    /// Perform a startup health check
    ///
    /// Checks all sessions for missing backend resources. This should be called
    /// at daemon/TUI startup to detect issues that occurred while clauderon was
    /// not running.
    ///
    /// # Returns
    ///
    /// A `HealthCheckResult` containing reports for all sessions, with counts of
    /// healthy vs unhealthy sessions.
    #[instrument(skip(self))]
    pub async fn startup_health_check(&self) -> crate::core::session::HealthCheckResult {
        let sessions = self.sessions.read().await.clone();
        let health_service = self.create_health_service();
        health_service.check_all_sessions(&sessions).await
    }

    /// Check the health of all sessions
    ///
    /// Returns detailed health reports for all sessions, including their current
    /// state and available actions.
    #[instrument(skip(self))]
    pub async fn check_all_sessions_health(&self) -> crate::core::session::HealthCheckResult {
        let sessions = self.sessions.read().await.clone();
        let health_service = self.create_health_service();
        health_service.check_all_sessions(&sessions).await
    }

    /// Check the health of a specific session
    ///
    /// Returns a detailed health report for the session, including its current
    /// state and available actions.
    ///
    /// # Arguments
    ///
    /// * `session_id` - UUID of the session to check
    ///
    /// # Errors
    ///
    /// Returns an error if the session is not found.
    #[instrument(skip(self), fields(session_id = %session_id))]
    pub async fn check_session_health(
        &self,
        session_id: Uuid,
    ) -> anyhow::Result<crate::core::session::SessionHealthReport> {
        let sessions = self.sessions.read().await;
        let session = sessions
            .iter()
            .find(|s| s.id == session_id)
            .ok_or_else(|| anyhow::anyhow!("Session not found: {session_id}"))?
            .clone();
        drop(sessions);

        let health_service = self.create_health_service();
        Ok(health_service.check_session(&session).await)
    }

    /// Preview what a recreate operation would do for a session
    ///
    /// Returns a health report describing the current state and what actions
    /// are available. This is useful for showing a confirmation dialog before
    /// actually performing the recreate.
    ///
    /// # Arguments
    ///
    /// * `session_id` - UUID of the session to preview
    ///
    /// # Errors
    ///
    /// Returns an error if the session is not found.
    #[instrument(skip(self), fields(session_id = %session_id))]
    pub async fn preview_recreate(
        &self,
        session_id: Uuid,
    ) -> anyhow::Result<crate::core::session::SessionHealthReport> {
        // This is the same as check_session_health for now
        self.check_session_health(session_id).await
    }

    // ========================================================================
    // Session Action Methods (Start, Recreate)
    // ========================================================================

    /// Start a stopped container session
    ///
    /// Only applicable to backends that support starting stopped resources
    /// (Docker and Apple Container).
    ///
    /// # Arguments
    ///
    /// * `session_id` - UUID of the session to start
    ///
    /// # Errors
    ///
    /// Returns an error if the session is not found, the backend doesn't support
    /// starting, or the start operation fails.
    #[instrument(skip(self), fields(session_id = %session_id))]
    pub async fn start_session(
        &self,
        session_id: Uuid,
    ) -> anyhow::Result<crate::core::session::RecreateResult> {
        let sessions = self.sessions.read().await;
        let session = sessions
            .iter()
            .find(|s| s.id == session_id)
            .ok_or_else(|| anyhow::anyhow!("Session not found: {session_id}"))?;

        let backend = self.get_backend(session.backend);
        let capabilities = backend.capabilities();

        if !capabilities.can_start {
            anyhow::bail!(
                "Backend {:?} does not support starting stopped resources",
                session.backend
            );
        }

        let backend_id = session
            .backend_id
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("Session has no backend ID"))?
            .clone();
        let session_name = session.name.clone();
        drop(sessions);

        tracing::info!(
            session_id = %session_id,
            name = %session_name,
            backend_id = %backend_id,
            "Starting stopped session"
        );

        backend.start(&backend_id).await?;

        // Update session status
        let mut sessions = self.sessions.write().await;
        if let Some(session) = sessions.iter_mut().find(|s| s.id == session_id) {
            session.set_status(SessionStatus::Running);
            let session_clone = session.clone();
            drop(sessions);

            self.store.save_session(&session_clone).await?;

            // Broadcast event
            if let Some(ref broadcaster) = self.event_broadcaster {
                broadcast_event(broadcaster, WsEvent::SessionUpdated(session_clone)).await;
            }
        }

        tracing::info!(session_id = %session_id, "Successfully started session");

        Ok(crate::core::session::RecreateResult {
            session_id,
            new_backend_id: backend_id,
            success: true,
            message: "Session started successfully".to_owned(),
        })
    }

    /// Recreate a session with blocking check
    ///
    /// This is the new unified recreate method that:
    /// 1. Checks if recreation is blocked
    /// 2. Returns a RecreateBlockedError if blocked
    /// 3. Otherwise performs the recreation and returns RecreateResult
    ///
    /// # Arguments
    ///
    /// * `session_id` - UUID of the session to recreate
    ///
    /// # Errors
    ///
    /// Returns `RecreateBlockedError` if recreation is blocked, or other errors
    /// if the session is not found or recreation fails.
    #[instrument(skip(self), fields(session_id = %session_id))]
    pub async fn recreate_session(
        &self,
        session_id: Uuid,
    ) -> Result<crate::core::session::RecreateResult, RecreateError> {
        // First check if recreate is blocked
        let sessions = self.sessions.read().await;
        let session = sessions
            .iter()
            .find(|s| s.id == session_id)
            .ok_or_else(|| {
                RecreateError::Blocked(crate::core::session::RecreateBlockedError {
                    session_id,
                    reason: "Session not found".to_owned(),
                    suggestions: vec![],
                })
            })?;

        let health_service = self.create_health_service();
        if let Some(reason) = health_service.is_recreate_blocked(session) {
            return Err(RecreateError::Blocked(
                crate::core::session::RecreateBlockedError {
                    session_id,
                    reason,
                    suggestions: vec![
                        "Push your changes to git before recreating".to_owned(),
                        "Create a new session instead".to_owned(),
                    ],
                },
            ));
        }
        drop(sessions);

        // Perform the recreation using the existing method
        self.recreate_container(session_id)
            .await
            .map_err(RecreateError::Other)?;

        // Get the new backend ID
        let sessions = self.sessions.read().await;
        let new_backend_id = sessions
            .iter()
            .find(|s| s.id == session_id)
            .and_then(|s| s.backend_id.clone())
            .unwrap_or_default();

        Ok(crate::core::session::RecreateResult {
            session_id,
            new_backend_id,
            success: true,
            message: "Session recreated successfully".to_owned(),
        })
    }

    /// Recreate a session fresh by deleting worktree and re-cloning
    ///
    /// This is used when data has been lost (e.g., volume deleted) and
    /// the user wants to start fresh. Unlike `recreate_session`, this
    /// does not check for blocking conditions since data is already lost.
    ///
    /// # Errors
    ///
    /// Returns an error if the session is not found or recreation fails.
    #[instrument(skip(self), fields(session_id = %session_id))]
    pub async fn recreate_session_fresh(
        &self,
        session_id: Uuid,
    ) -> anyhow::Result<crate::core::session::RecreateResult> {
        // Get session info before deletion
        let sessions = self.sessions.read().await;
        let session = sessions
            .iter()
            .find(|s| s.id == session_id)
            .cloned()
            .ok_or_else(|| anyhow::anyhow!("Session not found: {session_id}"))?;
        drop(sessions);

        tracing::info!(
            session_id = %session_id,
            session_name = %session.name,
            "Recreating session fresh (data will be lost)"
        );

        // For fresh recreate, we just recreate the container
        // The worktree will be recreated from scratch by the create process
        self.recreate_container(session_id).await?;

        // Get the new backend ID
        let sessions = self.sessions.read().await;
        let new_backend_id = sessions
            .iter()
            .find(|s| s.id == session_id)
            .and_then(|s| s.backend_id.clone())
            .unwrap_or_default();

        Ok(crate::core::session::RecreateResult {
            session_id,
            new_backend_id,
            success: true,
            message: "Session recreated fresh (data reset)".to_owned(),
        })
    }

    /// Cleanup a session by removing it from the database
    ///
    /// This is used when a session's worktree has been deleted externally
    /// and the user wants to remove the orphaned session record.
    ///
    /// # Errors
    ///
    /// Returns an error if the session is not found or cleanup fails.
    #[instrument(skip(self), fields(session_id = %session_id))]
    pub async fn cleanup_session(&self, session_id: Uuid) -> anyhow::Result<()> {
        // Get the session
        let sessions = self.sessions.read().await;
        let session = sessions
            .iter()
            .find(|s| s.id == session_id)
            .cloned()
            .ok_or_else(|| anyhow::anyhow!("Session not found: {session_id}"))?;
        drop(sessions);

        tracing::info!(
            session_id = %session_id,
            session_name = %session.name,
            "Cleaning up session"
        );

        // Try to delete the backend resource if it still exists
        if let Some(ref backend_id) = session.backend_id {
            let backend = self.get_backend(session.backend);
            if matches!(backend.exists(backend_id).await, Ok(true))
                && let Err(e) = backend.delete(backend_id).await
            {
                tracing::warn!(
                    session_id = %session_id,
                    backend_id = %backend_id,
                    error = %e,
                    "Failed to delete backend resource during cleanup (continuing anyway)"
                );
            }
        }

        // Delete from store
        self.store.delete_session(session_id).await?;

        // Remove from in-memory list
        {
            let mut sessions = self.sessions.write().await;
            sessions.retain(|s| s.id != session_id);
        }

        // Cleanup upload files
        if let Err(e) = crate::uploads::cleanup_session_uploads(session_id) {
            tracing::warn!(
                session_id = %session_id,
                error = %e,
                "Failed to cleanup session uploads"
            );
        }

        tracing::info!(
            session_id = %session_id,
            "Session cleaned up successfully"
        );

        Ok(())
    }

    /// Get the backend for a session type
    fn get_backend(&self, backend_type: BackendType) -> &dyn ExecutionBackend {
        match backend_type {
            BackendType::Zellij => self.zellij.as_ref(),
            BackendType::Docker => self.docker.as_ref(),
            BackendType::AiSandbox => self.ai_sandbox.as_ref(),
        }
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

    /// Generate a mount name from a repository path
    ///
    /// Extracts the repository name from the path and converts it to a valid mount name.
    /// Example: `/path/to/my-repo` → `my-repo`
    fn generate_mount_name(repo_path: &std::path::Path) -> String {
        repo_path.file_name().and_then(|n| n.to_str()).map_or_else(
            || "repo".to_owned(),
            |s| {
                // Convert to lowercase and replace underscores with hyphens
                s.to_lowercase().replace('_', "-")
            },
        )
    }

    /// Ensure mount names are unique by appending -2, -3, etc. for duplicates
    fn deduplicate_mount_names(mount_names: &mut [String]) {
        use std::collections::HashMap;
        let mut counts: HashMap<String, usize> = HashMap::new();
        let mut seen: HashMap<String, usize> = HashMap::new();

        // Count occurrences of each base name
        for name in mount_names.iter() {
            *counts.entry(name.clone()).or_insert(0) += 1;
        }

        // Rename duplicates
        for mount_name in mount_names.iter_mut() {
            let base_name = mount_name.clone();
            let count = counts.get(&base_name).copied().unwrap_or(1);

            if count > 1 {
                let occurrence = seen.entry(base_name.clone()).or_insert(0);
                *occurrence += 1;
                if *occurrence > 1 {
                    *mount_name = format!("{base_name}-{occurrence}");
                }
            }
        }
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
    #[expect(
        clippy::too_many_arguments,
        reason = "session creation requires many configuration parameters"
    )]
    pub async fn start_session_creation(
        self: &Arc<Self>,
        repo_path: String,
        repositories: Option<Vec<crate::api::protocol::CreateRepositoryInput>>,
        initial_prompt: String,
        backend: BackendType,
        agent: super::session::AgentType,
        model: Option<super::session::SessionModel>,
        dangerous_skip_checks: bool,
        print_mode: bool,
        plan_mode: bool,
        images: Vec<String>,
        container_image: Option<String>,
        pull_policy: Option<String>,
        cpu_limit: Option<String>,
        memory_limit: Option<String>,
        storage_class: Option<String>,
    ) -> anyhow::Result<Uuid> {
        // Expand tilde in user-provided repo path
        let repo_path = crate::utils::expand_tilde(&repo_path)
            .to_string_lossy()
            .to_string();

        // Validate backend is enabled
        self.validate_backend_enabled(backend)?;

        // Validate session count limit
        let sessions_guard = self.sessions.read().await;
        let active_count = sessions_guard
            .iter()
            .filter(|s| s.status != SessionStatus::Archived)
            .count();
        let archived_count = sessions_guard
            .iter()
            .filter(|s| s.status == SessionStatus::Archived)
            .count();
        drop(sessions_guard);

        if active_count >= self.max_sessions {
            tracing::warn!(
                active_sessions = active_count,
                archived_sessions = archived_count,
                max_sessions = self.max_sessions,
                "Session creation blocked - maximum active sessions reached"
            );
            anyhow::bail!(
                "Maximum session limit reached ({} active / {} total, max {}). Archive or delete sessions before creating new ones.",
                active_count,
                active_count + archived_count,
                self.max_sessions
            );
        }

        // Validate experimental models are enabled
        crate::core::session::validate_experimental_agent(
            agent,
            model.as_ref(),
            self.feature_flags.enable_experimental_models,
        )
        .with_context(|| format!("Cannot create session with agent {agent:?}"))?;

        // Process repositories (multi-repo mode or legacy single-repo mode)
        let repo_inputs = if let Some(repos) = repositories {
            // Multi-repo mode: validate and process
            if repos.is_empty() {
                anyhow::bail!("repositories array cannot be empty");
            }
            if repos.len() > 5 {
                anyhow::bail!("Maximum 5 repositories per session (got {})", repos.len());
            }

            // Validate exactly one primary
            let primary_count = repos.iter().filter(|r| r.is_primary).count();
            if primary_count != 1 {
                anyhow::bail!(
                    "Exactly one repository must be marked as primary (got {primary_count})"
                );
            }

            repos
        } else {
            // Legacy mode: convert single repo_path to repository input
            vec![crate::api::protocol::CreateRepositoryInput {
                repo_path: repo_path.clone(),
                mount_name: Some("primary".to_owned()),
                is_primary: true,
                base_branch: None,
            }]
        };

        // Validate and resolve git repository paths for all repos
        struct ResolvedRepo {
            git_root: PathBuf,
            subdirectory: PathBuf,
            mount_name: String,
            is_primary: bool,
            base_branch: Option<String>,
        }

        let mut resolved_repos = Vec::new();
        for repo_input in &repo_inputs {
            let repo_path_buf = PathBuf::from(&repo_input.repo_path);
            let git_info = crate::utils::git::find_git_root(&repo_path_buf).with_context(|| {
                format!(
                    "Failed to find git repository for path: {}",
                    repo_input.repo_path
                )
            })?;

            // Validate subdirectory path for security
            if git_info.subdirectory.is_absolute()
                || git_info
                    .subdirectory
                    .components()
                    .any(|c| matches!(c, std::path::Component::ParentDir))
            {
                anyhow::bail!(
                    "Invalid subdirectory path: must be relative without '..' components. Got: {}",
                    git_info.subdirectory.display()
                );
            }

            // Generate or use provided mount name
            let mount_name = if let Some(ref name) = repo_input.mount_name {
                name.clone()
            } else {
                Self::generate_mount_name(&git_info.git_root)
            };

            resolved_repos.push(ResolvedRepo {
                git_root: git_info.git_root,
                subdirectory: git_info.subdirectory,
                mount_name,
                is_primary: repo_input.is_primary,
                base_branch: repo_input.base_branch.clone(),
            });
        }

        // Deduplicate mount names
        let mut mount_names: Vec<String> = resolved_repos
            .iter()
            .map(|r| r.mount_name.clone())
            .collect();
        Self::deduplicate_mount_names(&mut mount_names);
        for (i, repo) in resolved_repos.iter_mut().enumerate() {
            repo.mount_name.clone_from(&mount_names[i]);
        }

        // Get primary repository for session metadata
        let primary_repo = resolved_repos
            .iter()
            .find(|r| r.is_primary)
            .ok_or_else(|| anyhow::anyhow!("No primary repository found"))?;

        let repo_path = primary_repo.git_root.to_string_lossy().to_string();
        let subdirectory = primary_repo.subdirectory.clone();

        // Generate metadata using AI (with fallback to defaults)
        let metadata = crate::utils::generate_session_name_ai(&repo_path, &initial_prompt).await;

        // Generate unique session name
        const MAX_ATTEMPTS: usize = 3;
        let full_name = {
            let mut attempts = 0;
            loop {
                let candidate = crate::utils::random::generate_session_name(&metadata.branch_name);
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

        // Create session object with AI-generated metadata
        let mut session = Session::new(super::session::SessionConfig {
            name: full_name.clone(),
            title: Some(metadata.title),
            description: Some(metadata.description),
            repo_path: repo_path.clone().into(),
            worktree_path: worktree_path.clone(),
            subdirectory: subdirectory.clone(),
            branch_name: full_name.clone(), // Use full name WITH suffix to match actual git branch
            repositories: None,             // Will be set after worktree creation
            initial_prompt: initial_prompt.clone(),
            backend,
            agent,
            model,
            dangerous_skip_checks,
        });

        // Set history file path for Claude Code sessions
        if session.agent == super::session::AgentType::ClaudeCode {
            session.history_file_path = Some(super::session::get_history_file_path(
                &worktree_path,
                &session.id,
                &subdirectory,
            ));
        }

        // Set initial progress
        session.set_progress(crate::api::protocol::ProgressStep {
            step: 0,
            total: 4,
            message: "Queued for creation".to_owned(),
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
            if sessions
                .iter()
                .filter(|s| s.status != SessionStatus::Archived)
                .count()
                >= self.max_sessions
            {
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

        // Convert resolved repos to simpler structure for passing to async task
        let repos_for_task: Vec<(PathBuf, PathBuf, String, bool, Option<String>)> = resolved_repos
            .iter()
            .map(|r| {
                (
                    r.git_root.clone(),
                    r.subdirectory.clone(),
                    r.mount_name.clone(),
                    r.is_primary,
                    r.base_branch.clone(),
                )
            })
            .collect();

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
                    repos_for_task,
                    initial_prompt,
                    backend,
                    agent,
                    model,
                    print_mode,
                    plan_mode,
                    images,
                    dangerous_skip_checks,
                    container_image,
                    pull_policy,
                    cpu_limit,
                    memory_limit,
                    storage_class,
                )
                .await;
        });

        Ok(session_id)
    }

    /// Complete session creation in background (spawned by start_session_creation)
    ///
    /// This method should not be called directly - it's spawned as a background task.
    #[expect(
        clippy::too_many_arguments,
        reason = "session creation requires many configuration parameters"
    )]
    async fn complete_session_creation(
        &self,
        session_id: Uuid,
        repo_path: String,
        full_name: String,
        worktree_path: PathBuf,
        subdirectory: PathBuf,
        repos_for_task: Vec<(PathBuf, PathBuf, String, bool, Option<String>)>,
        initial_prompt: String,
        backend: BackendType,
        agent: super::session::AgentType,
        model: Option<super::session::SessionModel>,
        print_mode: bool,
        plan_mode: bool,
        images: Vec<String>,
        dangerous_skip_checks: bool,
        container_image: Option<String>,
        pull_policy: Option<String>,
        cpu_limit: Option<String>,
        memory_limit: Option<String>,
        storage_class: Option<String>,
    ) {
        // Acquire semaphore to limit concurrent creations
        let Ok(_permit) = self.creation_semaphore.acquire().await else {
            tracing::error!(session_id = %session_id, "Semaphore closed during operation");
            // Mark session as failed
            let mut sessions = self.sessions.write().await;
            if let Some(session) = sessions.iter_mut().find(|s| s.id == session_id) {
                session.set_error(SessionStatus::Failed, "System is shutting down".to_owned());
                if let Err(e) = self.store.save_session(session).await {
                    tracing::error!("Failed to save shutdown error: {}", e);
                }
            }
            return;
        };

        // Helper to update progress
        let update_progress = |step: u32, message: String| async move {
            let progress = crate::api::protocol::ProgressStep {
                step,
                total: 4,
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
            let manages_own_repo = self.get_backend(backend).manages_own_repo();

            // Create worktrees/clones for all repositories
            let created_worktrees = if !manages_own_repo {
                update_progress(1, "Creating git worktrees".to_owned()).await;

                // Create worktrees for all repositories in parallel
                let worktree_futures: Vec<_> = repos_for_task
                    .iter()
                    .map(
                        |(git_root, _subdirectory, mount_name, _is_primary, _base_branch)| {
                            let worktree_path = crate::utils::paths::worktree_path(&format!(
                                "{full_name}-{mount_name}"
                            ));
                            let git_root = git_root.clone();
                            let branch_name = full_name.clone();

                            async move {
                                tracing::info!(
                                    session_id = %session_id,
                                    mount_name = %mount_name,
                                    git_root = %git_root.display(),
                                    worktree_path = %worktree_path.display(),
                                    "Creating worktree for repository"
                                );

                                let warning = self
                                    .git
                                    .create_worktree(&git_root, &worktree_path, &branch_name)
                                    .await?;

                                Ok::<(PathBuf, Option<String>), anyhow::Error>((worktree_path, warning))
                            }
                        },
                    )
                    .collect();

                let worktree_results = futures::future::join_all(worktree_futures).await;

                // Check for any failures and collect worktree paths
                let mut created = Vec::new();
                for (idx, result) in worktree_results.into_iter().enumerate() {
                    let (worktree_path, _warning) = result.with_context(|| {
                        let (_, _, mount_name, _, _) = &repos_for_task[idx];
                        format!("Failed to create worktree for repository '{mount_name}'")
                    })?;
                    created.push(worktree_path);
                }
                created
            } else {
                update_progress(1, "Setting up local clones".to_owned()).await;

                // Clone-based setup for backends that manage their own repo
                let mut created = Vec::new();
                for (git_root, _subdirectory, mount_name, _is_primary, _base_branch) in &repos_for_task {
                    let clone_path = crate::utils::paths::worktree_path(&format!(
                        "{full_name}-{mount_name}"
                    ));

                    tracing::info!(
                        session_id = %session_id,
                        mount_name = %mount_name,
                        git_root = %git_root.display(),
                        clone_path = %clone_path.display(),
                        "Creating local clone for repository"
                    );

                    self.git
                        .claim_or_clone(git_root, &clone_path, &full_name)
                        .await
                        .with_context(|| {
                            format!("Failed to clone repository '{mount_name}'")
                        })?;

                    created.push(clone_path);
                }
                created
            };

            // Find the primary repository's actual worktree path
            let primary_worktree_path = created_worktrees
                .iter()
                .zip(repos_for_task.iter())
                .find(|(_, (_, _, _, is_primary, _))| *is_primary)
                .map_or_else(|| created_worktrees[0].clone(), |(path, _)| path.clone());

            // Create history directory (for primary repo worktree)
            let history_path = super::session::get_history_file_path(
                &primary_worktree_path,
                &session_id,
                &subdirectory,
            );
            if let Some(parent_dir) = history_path.parent()
                && let Err(e) = tokio::fs::create_dir_all(parent_dir).await
            {
                tracing::warn!(
                    session_id = %session_id,
                    history_dir = %parent_dir.display(),
                    error = %e,
                    "Failed to create history directory"
                );
            }

            // Build SessionRepository entries from created worktrees
            let session_repos: Vec<super::session::SessionRepository> = repos_for_task
                .iter()
                .zip(created_worktrees.iter())
                .map(
                    |(
                        (git_root, subdirectory, mount_name, is_primary, base_branch),
                        worktree_path,
                    )| {
                        super::session::SessionRepository {
                            repo_path: git_root.clone(),
                            subdirectory: subdirectory.clone(),
                            worktree_path: worktree_path.clone(),
                            branch_name: full_name.clone(),
                            mount_name: mount_name.clone(),
                            is_primary: *is_primary,
                            base_branch: base_branch.clone(),
                        }
                    },
                )
                .collect();

            // Save repositories to database (junction table)
            self.store
                .save_session_repositories(session_id, &session_repos)
                .await
                .context("Failed to save session repositories to database")?;

            tracing::info!(
                session_id = %session_id,
                repo_count = session_repos.len(),
                "Saved repository configuration to database"
            );

            // Update session with correct primary worktree path and history file path
            {
                let mut sessions = self.sessions.write().await;
                if let Some(session) = sessions.iter_mut().find(|s| s.id == session_id) {
                    session.worktree_path.clone_from(&primary_worktree_path);
                    if session.agent == super::session::AgentType::ClaudeCode {
                        session.history_file_path = Some(super::session::get_history_file_path(
                            &primary_worktree_path,
                            &session_id,
                            &subdirectory,
                        ));
                    }
                    tracing::debug!(
                        session_id = %session_id,
                        worktree_path = %primary_worktree_path.display(),
                        "Updated session with primary worktree path"
                    );
                }
            }

            // Persist updated worktree_path and history_file_path to database
            {
                let sessions = self.sessions.read().await;
                if let Some(session) = sessions.iter().find(|s| s.id == session_id) {
                    self.store.save_session(session).await?;
                }
            }

            update_progress(2, "Preparing agent environment".to_owned()).await;
            // Prepend plan mode instruction if enabled
            let transformed_prompt = if plan_mode {
                format!(
                    "Enter plan mode and create a plan before doing anything.\n\n{}",
                    initial_prompt.trim()
                )
            } else {
                initial_prompt.clone()
            };

            update_progress(3, "Starting backend resource".to_owned()).await;

            tracing::info!(
                session_id = %session_id,
                backend = ?backend,
                workdir = %primary_worktree_path.display(),
                "Invoking backend.create()"
            );

            // Parse container image configuration from request
            let container_image_config = if let Some(image) = container_image {
                let policy = if let Some(policy_str) = pull_policy {
                    policy_str
                        .parse::<ImagePullPolicy>()
                        .map_err(|e| anyhow::anyhow!("Invalid pull policy '{policy_str}': {e}"))?
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
                model: model.as_ref().map(|m| m.to_cli_flag().to_owned()),
                print_mode,
                plan_mode,
                images,
                dangerous_skip_checks,
                session_id: Some(session_id),
                initial_workdir: subdirectory.clone(),
                http_port: self.http_port,
                container_image: container_image_config,
                container_resources: container_resource_limits,
                storage_class_override: storage_class,
                repositories: session_repos.clone(),
                volume_mode: false, // TODO: Pass from API when volume mode is exposed
            };
            let backend_id = match backend {
                BackendType::Zellij => {
                    self.zellij
                        .create(
                            &full_name,
                            &primary_worktree_path,
                            &transformed_prompt,
                            create_options,
                        )
                        .await?
                }
                BackendType::Docker => {
                    self.docker
                        .create(
                            &full_name,
                            &primary_worktree_path,
                            &transformed_prompt,
                            create_options,
                        )
                        .await?
                }
                BackendType::AiSandbox => {
                    self.ai_sandbox
                        .create(
                            &full_name,
                            &primary_worktree_path,
                            &transformed_prompt,
                            create_options,
                        )
                        .await?
                }
            };

            update_progress(4, "Finalizing session".to_owned()).await;

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

            let is_container_backend = backend == BackendType::Docker;

            if is_container_backend
                && !print_mode
                && let Err(err) = self
                    .console_manager
                    .ensure_session(session_id, backend, &backend_id)
                    .await
            {
                tracing::warn!(
                    session_id = %session_id,
                    error = %err,
                    "Failed to start console session"
                );
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

            // Track all repos in recent repos
            for repo in &session_repos {
                if let Err(e) = self
                    .store
                    .add_recent_repo(repo.repo_path.clone(), repo.subdirectory.clone())
                    .await
                {
                    tracing::warn!(
                        repo_path = %repo.repo_path.display(),
                        mount_name = %repo.mount_name,
                        error = %e,
                        "Failed to add repo to recent list"
                    );
                }
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
                let error_msg = format!("{e:#}");
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

                // Remove worktree/clone if created
                if self.get_backend(backend).manages_own_repo() {
                    let _ = self.git.delete_clone(&worktree_path).await;
                } else {
                    let repo_path_buf = PathBuf::from(&repo_path);
                    let _ = self
                        .git
                        .delete_worktree(&repo_path_buf, &worktree_path)
                        .await;
                }

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
    ///
    /// # Panics
    ///
    /// Panics if repositories is Some but unwrap fails (should not happen due to is_some check).
    #[instrument(
        skip(self, images),
        fields(
            repo_path = %repo_path,
            backend = ?backend,
            agent = ?agent,
            image_count = images.len()
        )
    )]
    #[expect(
        clippy::too_many_arguments,
        reason = "session creation requires many configuration parameters"
    )]
    pub async fn create_session(
        &self,
        repo_path: String,
        repositories: Option<Vec<crate::api::protocol::CreateRepositoryInput>>,
        initial_prompt: String,
        backend: BackendType,
        agent: super::session::AgentType,
        model: Option<super::session::SessionModel>,
        dangerous_skip_checks: bool,
        print_mode: bool,
        plan_mode: bool,
        images: Vec<String>,
        container_image: Option<String>,
        pull_policy: Option<String>,
        cpu_limit: Option<String>,
        memory_limit: Option<String>,
        storage_class: Option<String>,
    ) -> anyhow::Result<(Session, Option<Vec<String>>)> {
        // Expand tilde in user-provided repo path
        let repo_path = crate::utils::expand_tilde(&repo_path)
            .to_string_lossy()
            .to_string();

        // Validate backend is enabled
        self.validate_backend_enabled(backend)?;

        // Multi-repository sessions are not supported in synchronous mode (used for print mode)
        // Use start_session_creation() for multi-repo support
        if repositories.as_ref().is_some_and(|r| !r.is_empty()) {
            anyhow::bail!(
                "Multi-repository sessions are not supported in synchronous/print mode. \
                Use asynchronous session creation for multi-repo support."
            );
        }

        // Validate and resolve git repository path
        let repo_path_buf = std::path::PathBuf::from(&repo_path);
        let git_info = crate::utils::git::find_git_root(&repo_path_buf)
            .with_context(|| format!("Failed to find git repository for path: {repo_path}"))?;

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

        // Create session object with AI-generated metadata
        let mut session = Session::new(super::session::SessionConfig {
            name: full_name.clone(),
            title: Some(metadata.title),
            description: Some(metadata.description),
            repo_path: repo_path.clone().into(),
            worktree_path: worktree_path.clone(),
            subdirectory: subdirectory.clone(),
            branch_name: full_name.clone(), // Use full name WITH suffix to match actual git branch
            repositories: None,             // Single-repo mode (no multi-repo support)
            initial_prompt: initial_prompt.clone(),
            backend,
            agent,
            model,
            dangerous_skip_checks,
        });

        // Set history file path for Claude Code sessions (directory created after worktree exists)
        if session.agent == super::session::AgentType::ClaudeCode {
            session.history_file_path = Some(super::session::get_history_file_path(
                &worktree_path,
                &session.id,
                &subdirectory,
            ));
        }

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

        // Create git worktree or local clone
        let repo_path_buf = PathBuf::from(&repo_path);
        let worktree_warning = if self.get_backend(backend).manages_own_repo() {
            self.git
                .claim_or_clone(&repo_path_buf, &worktree_path, &full_name)
                .await?
        } else {
            self.git
                .create_worktree(&repo_path_buf, &worktree_path, &full_name)
                .await?
        };

        // Now that worktree exists, create the history directory
        if let Some(ref history_path) = session.history_file_path
            && let Some(parent_dir) = history_path.parent()
        {
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
                    .map_err(|e| anyhow::anyhow!("Invalid pull policy '{policy_str}': {e}"))?
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
            model: model.as_ref().map(|m| m.to_cli_flag().to_owned()),
            print_mode,
            plan_mode,
            images,
            dangerous_skip_checks,
            session_id: Some(session.id),
            initial_workdir: subdirectory.clone(),
            http_port: self.http_port,
            container_image: container_image_config,
            container_resources: container_resource_limits,
            storage_class_override: storage_class,
            repositories: vec![], // Legacy single-repo mode (synchronous creation)
            volume_mode: false,
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
            BackendType::AiSandbox => {
                self.ai_sandbox
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

        // Start console session for container backends (Docker)
        let is_container_backend = backend == BackendType::Docker;

        if is_container_backend
            && !print_mode
            && let Err(err) = self
                .console_manager
                .ensure_session(session.id, backend, &backend_id)
                .await
        {
            tracing::warn!(
                session_id = %session.id,
                error = %err,
                "Failed to start console session"
            );
        }

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

        if session.status == SessionStatus::Archived {
            anyhow::bail!("Cannot attach to archived session - unarchive it first");
        }

        let backend_id = session
            .backend_id
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("Session has no backend ID"))?;

        if session.agent == super::session::AgentType::Codex {
            anyhow::bail!("Send prompt is only supported for Claude Code sessions");
        }

        match session.backend {
            BackendType::Zellij => Ok(self.zellij.attach_command(backend_id)),
            BackendType::Docker => Ok(self.docker.attach_command(backend_id)),
            BackendType::AiSandbox => Ok(self.ai_sandbox.attach_command(backend_id)),
        }
    }

    /// Archive a session
    ///
    /// Archives a session by:
    /// 1. Stopping all backend resources (containers)
    /// 2. Clearing the backend_id
    /// 3. Setting status to Archived
    ///
    /// Storage (worktrees) is preserved for potential unarchiving.
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
        let backend = session.backend;
        let backend_id = session.backend_id.clone();

        // Stop backend resources (preserving storage)
        if let Some(ref backend_id) = backend_id {
            match backend {
                BackendType::Docker => {
                    if let Err(e) = self.docker.delete(backend_id).await {
                        tracing::warn!(
                            session_id = %session_id,
                            error = %e,
                            "Failed to delete Docker container during archive"
                        );
                    }
                }
                BackendType::Zellij => {
                    if let Err(e) = self.zellij.delete(backend_id).await {
                        tracing::warn!(
                            session_id = %session_id,
                            error = %e,
                            "Failed to delete Zellij session during archive"
                        );
                    }
                }
                BackendType::AiSandbox => {
                    if let Err(e) = self.ai_sandbox.delete(backend_id).await {
                        tracing::warn!(
                            session_id = %session_id,
                            error = %e,
                            "Failed to delete AI Sandbox session during archive"
                        );
                    }
                }
            }
        }

        // Clear backend_id and set status to Archived
        session.clear_backend_id();
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
        self.console_manager.remove_session(session_id).await;

        tracing::info!(
            session_id = %session_id,
            backend = ?backend,
            "Session archived - all backend resources stopped, storage preserved"
        );

        Ok(())
    }

    /// Unarchive a session
    ///
    /// Restores an archived session by:
    /// 1. Setting status to Creating
    /// 2. Recreating container using existing worktree
    /// 3. Updating backend_id
    /// 4. Setting status to Idle
    ///
    /// # Errors
    ///
    /// Returns an error if the session is not found, is not archived, or recreation fails.
    #[instrument(skip(self), fields(id_or_name = %id_or_name))]
    pub async fn unarchive_session(&self, id_or_name: &str) -> anyhow::Result<()> {
        // Extract session info while holding the lock briefly
        let (
            session_id,
            session_name,
            backend,
            worktree_path,
            initial_prompt,
            agent,
            subdirectory,
            dangerous_skip_checks,
            model,
        ) = {
            let sessions = self.sessions.read().await;
            let session = sessions
                .iter()
                .find(|s| s.name == id_or_name || s.id.to_string() == id_or_name)
                .ok_or_else(|| anyhow::anyhow!("Session not found: {id_or_name}"))?;

            // Validate that the session is currently archived
            if session.status != SessionStatus::Archived {
                anyhow::bail!("Session {id_or_name} is not archived");
            }

            (
                session.id,
                session.name.clone(),
                session.backend,
                session.worktree_path.clone(),
                session.initial_prompt.clone(),
                session.agent,
                session.subdirectory.clone(),
                session.dangerous_skip_checks,
                session.model_cli_flag().map(str::to_string),
            )
        };

        // Set status to Creating
        {
            let mut sessions = self.sessions.write().await;
            if let Some(session) = sessions.iter_mut().find(|s| s.id == session_id) {
                session.set_status(SessionStatus::Creating);
            }
        }

        // Record restore event
        let event = Event::new(session_id, EventType::SessionRestored);
        self.store.record_event(&event).await?;

        // Build creation options
        let create_options = crate::backends::CreateOptions {
            agent,
            model,
            print_mode: false,
            plan_mode: false,
            images: vec![],
            dangerous_skip_checks,
            session_id: Some(session_id),
            initial_workdir: subdirectory,
            http_port: self.http_port,
            container_image: None,
            container_resources: None,
            repositories: vec![],
            storage_class_override: None,
            volume_mode: false,
        };

        // Recreate container based on backend type
        let new_backend_id = match backend {
            BackendType::Docker => self
                .docker
                .create(
                    &session_name,
                    &worktree_path,
                    &initial_prompt,
                    create_options,
                )
                .await
                .context("Failed to recreate Docker container")?,
            BackendType::Zellij => self
                .zellij
                .create(
                    &session_name,
                    &worktree_path,
                    &initial_prompt,
                    create_options,
                )
                .await
                .context("Failed to recreate Zellij session")?,
            BackendType::AiSandbox => self
                .ai_sandbox
                .create(
                    &session_name,
                    &worktree_path,
                    &initial_prompt,
                    create_options,
                )
                .await
                .context("Failed to recreate AI Sandbox session")?,
        };

        // Update session with new backend ID and set to Idle
        {
            let mut sessions = self.sessions.write().await;
            if let Some(session) = sessions.iter_mut().find(|s| s.id == session_id) {
                session.set_backend_id(new_backend_id.clone());
                session.set_status(SessionStatus::Idle);
                session.reset_reconcile_state();
                let session_clone = session.clone();
                drop(sessions);

                // Update in store
                self.store.save_session(&session_clone).await?;

                // Record status change event
                let event = Event::new(
                    session_id,
                    EventType::StatusChanged {
                        old_status: SessionStatus::Archived,
                        new_status: SessionStatus::Idle,
                    },
                );
                self.store.record_event(&event).await?;

                // Record backend ID event
                let event = Event::new(
                    session_id,
                    EventType::BackendIdSet {
                        backend_id: new_backend_id.clone(),
                    },
                );
                self.store.record_event(&event).await?;

                // Broadcast event to WebSocket clients if broadcaster available
                if let Some(ref broadcaster) = self.event_broadcaster {
                    broadcast_event(broadcaster, WsEvent::SessionUpdated(session_clone)).await;
                }
            }
        }

        // Start console session for the recreated container
        if let Err(err) = self
            .console_manager
            .ensure_session(session_id, backend, &new_backend_id)
            .await
        {
            tracing::warn!(error = %err, "Failed to start console session after unarchive");
        }

        tracing::info!(
            session_id = %session_id,
            backend = ?backend,
            new_backend_id = %new_backend_id,
            "Session unarchived - container recreated successfully"
        );

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
                    total: 3,
                    message: "Queued for deletion".to_owned(),
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

        self.console_manager.remove_session(session_id).await;

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
    async fn complete_session_deletion(&self, session_id: Uuid, _session_name: String) {
        let Ok(_permit) = self.deletion_semaphore.acquire().await else {
            tracing::error!(session_id = %session_id, "Semaphore closed during deletion");
            // Mark session as failed instead of panicking
            let mut sessions = self.sessions.write().await;
            if let Some(session) = sessions.iter_mut().find(|s| s.id == session_id) {
                session.set_error(
                    SessionStatus::Failed,
                    "System is shutting down during deletion".to_owned(),
                );
                if let Err(e) = self.store.save_session(session).await {
                    tracing::error!("Failed to save shutdown error: {}", e);
                }
            }
            return;
        };

        // Helper to update progress
        let update_progress = |step: u32, message: String| async move {
            let progress = crate::api::protocol::ProgressStep {
                step,
                total: 3,
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
            update_progress(1, "Destroying backend resources".to_owned()).await;
            // Delete backend resources
            if let Some(ref backend_id) = backend_id {
                match backend {
                    BackendType::Zellij => {
                        let _ = self.zellij.delete(backend_id).await;
                    }
                    BackendType::Docker => {
                        let _ = self.docker.delete(backend_id).await;
                    }
                    BackendType::AiSandbox => {
                        let _ = self.ai_sandbox.delete(backend_id).await;
                    }
                }
            }

            update_progress(2, "Removing git worktree/clone".to_owned()).await;
            if self.get_backend(backend).manages_own_repo() {
                let _ = self.git.delete_clone(&worktree_path).await;
            } else {
                let _ = self.git.delete_worktree(&repo_path, &worktree_path).await;
            }

            // Clean up uploaded files
            if let Err(e) = crate::uploads::cleanup_session_uploads(session_id) {
                tracing::warn!(
                    session_id = %session_id,
                    error = %e,
                    "Failed to clean up session uploads"
                );
            }

            update_progress(3, "Cleaning up database".to_owned()).await;
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
                let error_msg = format!("{e:#}");
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
                BackendType::AiSandbox => {
                    let _ = self.ai_sandbox.delete(backend_id).await;
                }
            }
        }

        // Delete git worktrees/clones for all repositories
        let manages_own_repo = self.get_backend(session.backend).manages_own_repo();
        if let Some(ref repositories) = session.repositories {
            // Multi-repo session: delete all worktrees/clones
            for repo in repositories {
                tracing::info!(
                    session_id = %session.id,
                    mount_name = %repo.mount_name,
                    worktree_path = %repo.worktree_path.display(),
                    "Deleting worktree/clone for repository"
                );
                let result = if manages_own_repo {
                    self.git.delete_clone(&repo.worktree_path).await
                } else {
                    self.git.delete_worktree(&repo.repo_path, &repo.worktree_path).await
                };
                if let Err(e) = result {
                    tracing::warn!(
                        session_id = %session.id,
                        mount_name = %repo.mount_name,
                        error = %e,
                        "Failed to delete worktree/clone"
                    );
                }
            }
        } else {
            // Legacy single-repo session
            if manages_own_repo {
                let _ = self.git.delete_clone(&session.worktree_path).await;
            } else {
                let _ = self
                    .git
                    .delete_worktree(&session.repo_path, &session.worktree_path)
                    .await;
            }
        }

        // Record deletion event
        let event = Event::new(session.id, EventType::SessionDeleted { reason: None });
        self.store.record_event(&event).await?;

        // Remove from store
        self.store.delete_session(session.id).await?;

        // Remove from in-memory list
        self.sessions.write().await.retain(|s| s.id != session.id);
        self.console_manager.remove_session(session.id).await;

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
            .map_err(|e| anyhow::anyhow!("System is shutting down: {e}"))?;

        // Get session and validate it's Docker
        let session = self
            .get_session(id_or_name)
            .await
            .ok_or_else(|| anyhow::anyhow!("Session not found: {id_or_name}"))?;

        if session.status == SessionStatus::Archived {
            anyhow::bail!("Cannot refresh archived session - unarchive it first");
        }

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
                model: session.model_cli_flag().map(str::to_string),
                print_mode: false,
                plan_mode: false,
                images: vec![],
                dangerous_skip_checks,
                session_id: Some(session_id),
                initial_workdir: subdirectory,
                http_port: self.http_port,
                container_image: None,
                container_resources: None,
                repositories: vec![], // Legacy single-repo mode (refresh operation)
                storage_class_override: None,
                volume_mode: false,
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
                let error_msg = format!("{e:#}");
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
                    BackendType::AiSandbox => self.ai_sandbox.exists(backend_id).await?,
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
                            }
                            BackendType::Zellij => {
                                let _ = self.zellij.delete(backend_id).await;
                            }
                            BackendType::AiSandbox => {
                                let _ = self.ai_sandbox.delete(backend_id).await;
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
            .ok_or_else(|| anyhow::anyhow!("Session not found: {session_id}"))?;

        // Cannot recreate archived sessions - use unarchive instead
        if session.status == SessionStatus::Archived {
            anyhow::bail!("Cannot recreate container for archived session - unarchive it first");
        }

        // Zellij sessions cannot be recreated
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
                BackendType::Zellij => {} // Already checked above
                BackendType::AiSandbox => {
                    let _ = self.ai_sandbox.delete(backend_id).await;
                }
            }
        }

        // Build creation options from session state
        let create_options = crate::backends::CreateOptions {
            agent: session.agent,
            model: session.model_cli_flag().map(str::to_string),
            print_mode: false, // Never use print mode for recreation
            plan_mode: false,  // Don't enter plan mode - session already has context
            images: vec![], // No images for recreation
            dangerous_skip_checks: session.dangerous_skip_checks,
            session_id: Some(session.id),
            initial_workdir: session.subdirectory.clone(),
            http_port: self.http_port,
            container_image: None,
            container_resources: None,
            repositories: vec![], // Legacy single-repo mode (recreation)
            storage_class_override: None,
            volume_mode: false,
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
            BackendType::AiSandbox => {
                self.ai_sandbox
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
    #[instrument(skip(self), fields(id_or_name = %id_or_name, title = ?title, description = ?description))]
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

    /// Regenerate session metadata using AI
    ///
    /// Calls the Claude CLI to regenerate the title, description, and branch name
    /// for a session based on its initial prompt. This is useful when the initial
    /// generation failed or timed out during session creation.
    ///
    /// # Arguments
    ///
    /// * `session_id` - The UUID of the session to regenerate metadata for
    ///
    /// # Errors
    ///
    /// Returns an error if the session is not found or the store update fails.
    ///
    /// # Note
    ///
    /// If AI generation fails and returns default values, existing metadata is preserved
    /// to avoid overwriting user-edited values with defaults.
    #[instrument(skip(self), fields(session_id = %session_id))]
    pub async fn regenerate_session_metadata(&self, session_id: Uuid) -> anyhow::Result<()> {
        // Get session
        let sessions = self.sessions.read().await;
        let session = sessions
            .iter()
            .find(|s| s.id == session_id)
            .ok_or_else(|| anyhow::anyhow!("Session not found: {session_id}"))?;

        let repo_path = session.repo_path.clone();
        let initial_prompt = session.initial_prompt.clone();
        let session_name = session.name.clone();
        drop(sessions);

        tracing::info!(
            session_id = %session_id,
            session_name = %session_name,
            "Regenerating session metadata with AI"
        );

        // Generate new metadata
        let repo_path_str = repo_path
            .to_str()
            .ok_or_else(|| anyhow::anyhow!("Invalid UTF-8 in repo path"))?;
        let metadata = crate::utils::generate_session_name_ai(repo_path_str, &initial_prompt).await;

        // Only update if we got non-default values
        // (avoid overwriting user edits with defaults)
        if metadata.title == "New Session" {
            tracing::warn!(
                session_id = %session_id,
                "Metadata regeneration returned defaults, preserving existing values"
            );
            anyhow::bail!("AI metadata generation returned defaults - possible timeout or failure");
        }

        // Update session with new metadata
        let mut sessions = self.sessions.write().await;
        let session = sessions
            .iter_mut()
            .find(|s| s.id == session_id)
            .ok_or_else(|| anyhow::anyhow!("Session not found: {session_id}"))?;

        session.set_title(Some(metadata.title.clone()));
        session.set_description(Some(metadata.description.clone()));

        let session_clone = session.clone();
        drop(sessions);

        // Save updated session
        self.store.save_session(&session_clone).await?;

        // Broadcast update event
        if let Some(ref broadcaster) = self.event_broadcaster {
            broadcast_event(broadcaster, WsEvent::SessionUpdated(session_clone.clone())).await;
        }

        tracing::info!(
            session_id = %session_id,
            title = %metadata.title,
            description = %metadata.description,
            "Successfully regenerated session metadata"
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
            .ok_or_else(|| anyhow::anyhow!("Session not found: {session_id}"))?;

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
            broadcast_event(broadcaster, WsEvent::SessionUpdated(session_clone)).await;
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
            .ok_or_else(|| anyhow::anyhow!("Session not found: {session_id}"))?;

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
            broadcast_event(broadcaster, WsEvent::SessionUpdated(session_clone)).await;
        }

        Ok(())
    }

    /// Update PR review decision for a session
    ///
    /// # Errors
    ///
    /// Returns an error if the session is not found or the store update fails.
    pub async fn update_pr_review_decision(
        &self,
        session_id: Uuid,
        new_decision: crate::core::ReviewDecision,
    ) -> anyhow::Result<()> {
        let mut sessions = self.sessions.write().await;
        let session = sessions
            .iter_mut()
            .find(|s| s.id == session_id)
            .ok_or_else(|| anyhow::anyhow!("Session not found: {session_id}"))?;

        let old_decision = session.pr_review_decision;
        session.set_pr_review_decision(new_decision);
        let session_clone = session.clone();
        drop(sessions);

        // Update in store
        self.store.save_session(&session_clone).await?;

        tracing::debug!(
            session_id = %session_id,
            old = ?old_decision,
            new = ?new_decision,
            "Updated PR review decision"
        );

        // Broadcast event to WebSocket clients if broadcaster available
        if let Some(ref broadcaster) = self.event_broadcaster {
            broadcast_event(broadcaster, WsEvent::SessionUpdated(session_clone)).await;
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
            .ok_or_else(|| anyhow::anyhow!("Session not found: {session_id}"))?;

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
            broadcast_event(broadcaster, WsEvent::SessionUpdated(session_clone)).await;
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
            .ok_or_else(|| anyhow::anyhow!("Session not found: {session_id}"))?;

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
            broadcast_event(broadcaster, WsEvent::SessionUpdated(session_clone)).await;
        }

        Ok(())
    }

    /// Update PR review status for a session
    ///
    /// # Errors
    ///
    /// Returns an error if the session is not found or the store update fails.
    #[instrument(skip(self))]
    pub async fn update_pr_review_status(
        &self,
        session_id: Uuid,
        status: PrReviewStatus,
    ) -> anyhow::Result<()> {
        let mut sessions = self.sessions.write().await;
        let session = sessions
            .iter_mut()
            .find(|s| s.id == session_id)
            .ok_or_else(|| anyhow::anyhow!("Session not found: {session_id}"))?;

        // Don't update if status hasn't changed
        if session.pr_review_status == Some(status) {
            return Ok(());
        }

        session.set_pr_review_status(status);
        let session_clone = session.clone();
        drop(sessions);

        // Update in store
        self.store.save_session(&session_clone).await?;

        tracing::debug!(
            session_id = %session_id,
            status = ?status,
            "Updated PR review status"
        );

        // Broadcast event to WebSocket clients if broadcaster available
        if let Some(ref broadcaster) = self.event_broadcaster {
            broadcast_event(broadcaster, WsEvent::SessionUpdated(session_clone)).await;
        }

        Ok(())
    }

    /// Update PR merge methods and repository settings for a session
    ///
    /// # Errors
    ///
    /// Returns an error if the session is not found or the store update fails.
    #[instrument(skip(self, methods))]
    pub async fn update_pr_merge_methods(
        &self,
        session_id: Uuid,
        methods: Vec<MergeMethod>,
        default: MergeMethod,
        delete_branch: bool,
    ) -> anyhow::Result<()> {
        let mut sessions = self.sessions.write().await;
        let session = sessions
            .iter_mut()
            .find(|s| s.id == session_id)
            .ok_or_else(|| anyhow::anyhow!("Session not found: {session_id}"))?;

        session.set_pr_merge_methods(methods.clone(), default, delete_branch);
        let session_clone = session.clone();
        drop(sessions);

        // Update in store
        self.store.save_session(&session_clone).await?;

        tracing::info!(
            session_id = %session_id,
            methods = ?methods,
            default = ?default,
            delete_branch = %delete_branch,
            "Updated PR merge methods"
        );

        // Broadcast event to WebSocket clients if broadcaster available
        if let Some(ref broadcaster) = self.event_broadcaster {
            broadcast_event(broadcaster, WsEvent::SessionUpdated(session_clone)).await;
        }

        Ok(())
    }

    /// Merge a pull request for a session
    ///
    /// # Errors
    ///
    /// Returns an error if:
    /// - Session is not found
    /// - PR cannot be merged (requirements not met)
    /// - gh CLI command fails
    #[instrument(skip(self), fields(session_id = %session_id, method = ?method))]
    pub async fn merge_pr(
        &self,
        session_id: Uuid,
        method: MergeMethod,
        delete_branch: bool,
    ) -> anyhow::Result<()> {
        // Get session info
        let session = self
            .get_session(&session_id.to_string())
            .await
            .ok_or_else(|| anyhow::anyhow!("Session not found: {session_id}"))?;

        // Validate merge requirements
        if !session.can_merge_pr {
            anyhow::bail!(
                "PR cannot be merged: requirements not met (check status: {:?}, review: {:?}, conflicts: {})",
                session.pr_check_status,
                session.pr_review_status,
                session.merge_conflict
            );
        }

        let pr_url = session
            .pr_url
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("No PR URL for session"))?;

        // Parse PR number from URL
        let pr_number = pr_url
            .split('/')
            .next_back()
            .and_then(|s| s.parse::<u32>().ok())
            .ok_or_else(|| anyhow::anyhow!("Invalid PR URL: {pr_url}"))?;

        // Get primary repository path for gh command
        let repo_path = if let Some(repos) = &session.repositories {
            repos
                .iter()
                .find(|r| r.is_primary)
                .map_or_else(|| session.repo_path.clone(), |r| r.repo_path.clone())
        } else {
            session.repo_path.clone()
        };

        // Execute gh pr merge
        let mut args = vec![
            "pr".to_owned(),
            "merge".to_owned(),
            pr_number.to_string(),
            method.to_gh_flag().to_owned(),
        ];

        if delete_branch {
            args.push("--delete-branch".to_owned());
        }

        let output = tokio::process::Command::new("gh")
            .current_dir(&repo_path)
            .args(&args)
            .output()
            .await
            .context("Failed to execute gh pr merge")?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            anyhow::bail!("gh pr merge failed: {stderr}");
        }

        tracing::info!(
            session_id = %session_id,
            pr_url = %pr_url,
            method = ?method,
            delete_branch = %delete_branch,
            "Successfully merged PR"
        );

        // Update PR status to Merged
        self.update_pr_check_status(session_id, CheckStatus::Merged)
            .await?;

        Ok(())
    }

    /// Update working tree dirty status for a session
    ///
    /// # Errors
    ///
    /// Returns an error if the session is not found or the store update fails.
    #[tracing::instrument(skip(self))]
    pub async fn update_worktree_dirty_status(
        &self,
        session_id: Uuid,
        is_dirty: bool,
        changed_files: Option<Vec<crate::utils::git::ChangedFile>>,
    ) -> anyhow::Result<()> {
        let mut sessions = self.sessions.write().await;
        let session = sessions
            .iter_mut()
            .find(|s| s.id == session_id)
            .ok_or_else(|| anyhow::anyhow!("Session not found: {session_id}"))?;

        // Don't update if status hasn't changed
        if session.worktree_dirty == is_dirty && session.worktree_changed_files == changed_files {
            return Ok(());
        }

        session.set_worktree_dirty(is_dirty);
        session.set_worktree_changed_files(changed_files.clone());
        let session_clone = session.clone();
        drop(sessions);

        // Record event
        let event = Event::new(
            session_id,
            EventType::WorktreeStatusChanged {
                is_dirty,
                changed_files,
            },
        );
        self.store.record_event(&event).await?;

        // Update in store
        self.store.save_session(&session_clone).await?;

        tracing::info!(
            session_id = %session_id,
            is_dirty = %is_dirty,
            "Updated worktree dirty status"
        );

        // Broadcast event to WebSocket clients if broadcaster available
        if let Some(ref broadcaster) = self.event_broadcaster {
            broadcast_event(broadcaster, WsEvent::SessionUpdated(session_clone)).await;
        }

        Ok(())
    }

    /// Update the cached history file path for a session
    ///
    /// Used by the history API endpoint to cache discovered Codex history file paths.
    ///
    /// # Errors
    ///
    /// Returns an error if the session is not found or the store update fails.
    #[instrument(skip(self), fields(session_id = %session_id, path = %path.display()))]
    pub async fn update_history_file_path(
        &self,
        session_id: Uuid,
        path: &std::path::Path,
    ) -> anyhow::Result<()> {
        let mut sessions = self.sessions.write().await;
        let session = sessions
            .iter_mut()
            .find(|s| s.id == session_id)
            .ok_or_else(|| anyhow::anyhow!("Session not found: {session_id}"))?;

        session.history_file_path = Some(path.to_path_buf());
        session.updated_at = chrono::Utc::now();
        let session_clone = session.clone();
        drop(sessions);

        // Update in store
        self.store.save_session(&session_clone).await?;

        tracing::debug!(
            session_id = %session_id,
            path = %path.display(),
            "Updated history file path"
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
            .ok_or_else(|| anyhow::anyhow!("Session not found: {id_or_name}"))?;

        if session.status == SessionStatus::Archived {
            anyhow::bail!("Cannot send prompt to archived session - unarchive it first");
        }

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
            BackendType::AiSandbox => {
                anyhow::bail!("Send prompt is not supported for AI Sandbox sessions - attach directly instead");
            }
        }

        tracing::info!(
            session = %id_or_name,
            prompt_len = prompt.len(),
            "Sent prompt to session"
        );

        Ok(())
    }

    /// Get system status.
    ///
    /// # Errors
    ///
    /// Returns an error if status cannot be determined.
    pub async fn get_system_status(&self) -> anyhow::Result<crate::api::protocol::SystemStatus> {
        use crate::api::protocol::SystemStatus;


        // Try to fetch Claude Code usage if OAuth token is available
        let oauth_token = std::env::var("CLAUDE_CODE_OAUTH_TOKEN").ok();
        let claude_usage = if let Some(ref oauth_token) = oauth_token {
            // Check cache first
            {
                let cache = self.usage_cache.read().await;
                if let Some(cached_usage) = cache.get() {
                    tracing::debug!("Using cached usage data");
                    Some(cached_usage.clone())
                } else {
                    drop(cache); // Release read lock

                    // Cache miss - fetch fresh data
                    let org_id_override = self.server_config.as_ref().and_then(|c| c.org_id());
                    match Self::fetch_claude_usage(oauth_token, org_id_override).await {
                        Ok(usage) => {
                            tracing::info!(
                                org_id = %usage.organization_id,
                                five_hour_utilization = %usage.five_hour.utilization,
                                seven_day_utilization = %usage.seven_day.utilization,
                                "Successfully fetched Claude Code usage"
                            );

                            // Cache successful fetch
                            let mut cache = self.usage_cache.write().await;
                            cache.set(usage.clone());

                            Some(usage)
                        }
                        Err(usage_error) => {
                            // Log with appropriate severity based on error type
                            match usage_error.error_type.as_str() {
                                "invalid_token" | "unauthorized" | "invalid_token_format" => {
                                    tracing::error!(
                                        error_type = %usage_error.error_type,
                                        message = %usage_error.message,
                                        "Usage tracking authentication failed"
                                    );
                                }
                                _ => {
                                    tracing::warn!(
                                        error_type = %usage_error.error_type,
                                        message = %usage_error.message,
                                        "Usage tracking failed - continuing without usage data"
                                    );
                                }
                            }

                            // Don't cache errors - Return ClaudeUsage with error field populated
                            use crate::api::protocol::{ClaudeUsage, UsageWindow};
                            Some(ClaudeUsage {
                                organization_id: String::new(),
                                organization_name: None,
                                five_hour: UsageWindow {
                                    current: 0.0,
                                    limit: 0.0,
                                    utilization: 0.0,
                                    resets_at: None,
                                },
                                seven_day: UsageWindow {
                                    current: 0.0,
                                    limit: 0.0,
                                    utilization: 0.0,
                                    resets_at: None,
                                },
                                seven_day_sonnet: None,
                                fetched_at: chrono::Utc::now().to_rfc3339(),
                                error: Some(usage_error),
                            })
                        }
                    }
                }
            }
        } else {
            tracing::debug!("No Anthropic OAuth token available - skipping usage fetch");
            None
        };

        Ok(SystemStatus {
            claude_usage,
        })
    }

    /// Fetch Claude Code usage data from Claude.ai API
    ///
    /// This attempts to get the org ID and usage data in one flow.
    /// Falls back to config org_id, then environment variable if API calls fail.
    #[instrument(skip(oauth_token, org_id_override))]
    async fn fetch_claude_usage(
        oauth_token: &str,
        org_id_override: Option<&str>,
    ) -> Result<crate::api::protocol::ClaudeUsage, crate::api::protocol::UsageError> {
        use crate::api::claude_client::ClaudeApiClient;
        use crate::api::protocol::UsageError;

        // Validate token format first
        if let Err(e) = ClaudeApiClient::validate_token_format(oauth_token) {
            return Err(UsageError {
                error_type: "invalid_token_format".to_owned(),
                message: "OAuth token has invalid format".to_owned(),
                details: Some(e.to_string()),
                suggestion: Some(
                    "Set CLAUDE_CODE_OAUTH_TOKEN to a valid token starting with 'sk-ant-'"
                        .to_owned(),
                ),
            });
        }

        let client = ClaudeApiClient::new();

        // First, try to get org ID from current account endpoint (with retry)
        let (org_id, org_name) = match client.get_current_account_with_retry(oauth_token).await {
            Ok(info) => info,
            Err(e) => {
                // Check if it's an auth error
                let error_str = e.to_string();
                if error_str.contains("401") || error_str.contains("403") {
                    return Err(UsageError {
                        error_type: "invalid_token".to_owned(),
                        message: "OAuth token is invalid or expired".to_owned(),
                        details: Some(error_str),
                        suggestion: Some("Get a fresh token from claude.ai settings".to_owned()),
                    });
                }

                // Fallback to config org_id, then environment variable
                tracing::warn!(
                    error = %e,
                    "Failed to get org ID from Claude.ai API, trying config/env fallback"
                );

                let org_id = if let Some(override_id) = org_id_override {
                    tracing::debug!("Using org_id from config");
                    override_id.to_owned()
                } else {
                    match std::env::var("CLAUDE_ORG_ID")
                        .or_else(|_| std::env::var("ANTHROPIC_ORG_ID"))
                    {
                        Ok(id) => id,
                        Err(_) => {
                            return Err(UsageError {
                                error_type: "missing_org_id".to_owned(),
                                message: "Failed to get organization ID".to_owned(),
                                details: Some(format!(
                                    "API error: {error_str}. No org_id in config or CLAUDE_ORG_ID env var set."
                                )),
                                suggestion: Some(
                                    "Set org_id in config.toml, or CLAUDE_ORG_ID environment variable, or use --org-id CLI flag".to_owned(),
                                ),
                            });
                        }
                    }
                };

                (org_id, None)
            }
        };

        // Now fetch usage data (with retry)
        let mut usage = match client.get_usage_with_retry(oauth_token, &org_id).await {
            Ok(u) => u,
            Err(e) => {
                let error_str = e.to_string();
                if error_str.contains("401") || error_str.contains("403") {
                    return Err(UsageError {
                        error_type: "unauthorized".to_owned(),
                        message: "Not authorized to access usage data".to_owned(),
                        details: Some(error_str),
                        suggestion: Some("Verify token has access to this organization".to_owned()),
                    });
                } else if error_str.contains("404") {
                    return Err(UsageError {
                        error_type: "not_found".to_owned(),
                        message: format!("Organization {org_id} not found"),
                        details: Some(error_str),
                        suggestion: Some("Verify CLAUDE_ORG_ID is correct".to_owned()),
                    });
                }
                return Err(UsageError {
                    error_type: "api_error".to_owned(),
                    message: "Failed to fetch usage data from Claude.ai".to_owned(),
                    details: Some(error_str),
                    suggestion: Some("Check network connectivity and try again".to_owned()),
                });
            }
        };

        // Fill in org name if we got it
        usage.organization_name = org_name;

        Ok(usage)
    }

}
