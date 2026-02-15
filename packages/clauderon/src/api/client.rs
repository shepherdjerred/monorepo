use async_trait::async_trait;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::UnixStream;

use crate::core::Session;
use crate::utils::{daemon, paths};

use super::protocol::{CreateSessionRequest, ProgressStep, Request, Response};
use super::traits::ApiClient;
use super::types::ReconcileReportDto;

/// Callback type for progress updates
pub type ProgressCallback = Box<dyn Fn(ProgressStep) + Send + Sync>;

/// Client for communicating with the clauderon daemon.
pub struct Client {
    /// Unix socket connection to the daemon.
    stream: UnixStream,
}

impl std::fmt::Debug for Client {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Client").finish()
    }
}

impl Client {
    /// Connect to the clauderon daemon, auto-spawning it if not running
    ///
    /// This method will automatically spawn the daemon as a detached background
    /// process if it's not already running. The daemon will continue running
    /// even after this client (and its parent process) exits.
    ///
    /// # Errors
    ///
    /// Returns an error if the daemon cannot be spawned or connected to.
    pub async fn connect() -> anyhow::Result<Self> {
        let socket_path = paths::socket_path();

        // First attempt to connect to existing daemon
        if let Ok(stream) = UnixStream::connect(&socket_path).await {
            return Ok(Self { stream });
        }

        // Daemon not running - spawn it and wait for it to be ready
        // This handles race conditions via file locking
        daemon::ensure_daemon_running().await?;

        // Connect after daemon is ready
        let stream = UnixStream::connect(&socket_path).await.map_err(|e| {
            anyhow::anyhow!(
                "Failed to connect to daemon at {} after ensuring it's running. Error: {e}",
                socket_path.display(),
            )
        })?;

        Ok(Self { stream })
    }

    /// Send a request and receive a response
    async fn send_request(&mut self, request: Request) -> anyhow::Result<Response> {
        let json = serde_json::to_string(&request)?;

        let (reader, mut writer) = self.stream.split();

        writer.write_all(json.as_bytes()).await?;
        writer.write_all(b"\n").await?;

        let mut reader = BufReader::new(reader);
        let mut line = String::new();
        let bytes_read = reader.read_line(&mut line).await?;

        if bytes_read == 0 {
            anyhow::bail!("Daemon closed connection unexpectedly (0 bytes read)");
        }

        let trimmed = line.trim();
        if trimmed.is_empty() {
            anyhow::bail!(
                "Daemon returned empty response (read {bytes_read} bytes, trimmed to empty)"
            );
        }

        let response: Response = serde_json::from_str(trimmed).map_err(|e| {
            anyhow::anyhow!(
                "Failed to parse daemon response: {}. Raw response ({} bytes): {:?}",
                e,
                trimmed.len(),
                if trimmed.len() > 200 {
                    &trimmed[..200]
                } else {
                    trimmed
                }
            )
        })?;
        Ok(response)
    }

    /// List all sessions
    ///
    /// # Errors
    ///
    /// Returns an error if the request fails or the daemon returns an error.
    pub async fn list_sessions(&mut self) -> anyhow::Result<Vec<Session>> {
        let response = self.send_request(Request::ListSessions).await?;

        match response {
            Response::Sessions(sessions) => Ok(sessions),
            Response::Error { code, message } => {
                anyhow::bail!("[{code}] {message}")
            }
            _ => anyhow::bail!("Unexpected response"),
        }
    }

    /// Get a session by ID or name
    ///
    /// # Errors
    ///
    /// Returns an error if the session is not found or the request fails.
    pub async fn get_session(&mut self, id: &str) -> anyhow::Result<Session> {
        let response = self
            .send_request(Request::GetSession { id: id.to_owned() })
            .await?;

        match response {
            Response::Session(session) => Ok(session),
            Response::Error { code, message } => {
                anyhow::bail!("[{code}] {message}")
            }
            _ => anyhow::bail!("Unexpected response"),
        }
    }

    /// Create a new session with optional progress callback
    ///
    /// # Errors
    ///
    /// Returns an error if session creation fails or the request fails.
    ///
    /// Returns the created session and optionally a list of warnings.
    pub async fn create_session_with_progress(
        &mut self,
        request: CreateSessionRequest,
        on_progress: Option<ProgressCallback>,
    ) -> anyhow::Result<(Session, Option<Vec<String>>)> {
        // Send the request
        let json = serde_json::to_string(&Request::CreateSession(request))?;
        let (reader, mut writer) = self.stream.split();
        writer.write_all(json.as_bytes()).await?;
        writer.write_all(b"\n").await?;

        // Read responses until we get a final one (Created or Error)
        let mut reader = BufReader::new(reader);
        let mut line = String::new();

        let (session_id, warnings) = loop {
            line.clear();
            let bytes_read = reader.read_line(&mut line).await?;
            if bytes_read == 0 {
                anyhow::bail!("Connection closed unexpectedly during session creation");
            }

            let response: Response = serde_json::from_str(line.trim())?;

            match response {
                Response::Progress(step) => {
                    if let Some(ref callback) = on_progress {
                        callback(step);
                    }
                }
                Response::Created { id, warnings } => {
                    break (id, warnings);
                }
                Response::Error { code, message } => {
                    anyhow::bail!("[{code}] {message}");
                }
                _ => anyhow::bail!("Unexpected response"),
            }
        };

        // Reconnect and fetch the session
        let socket_path = paths::socket_path();
        self.stream = UnixStream::connect(&socket_path).await?;
        let session = self.get_session(&session_id).await?;
        Ok((session, warnings))
    }

    /// Create a new session (no progress callback)
    ///
    /// # Errors
    ///
    /// Returns an error if session creation fails or the request fails.
    ///
    /// Returns the created session and optionally a list of warnings.
    pub async fn create_session(
        &mut self,
        request: CreateSessionRequest,
    ) -> anyhow::Result<(Session, Option<Vec<String>>)> {
        self.create_session_with_progress(request, None).await
    }

    /// Delete a session
    ///
    /// # Errors
    ///
    /// Returns an error if the session is not found or the request fails.
    pub async fn delete_session(&mut self, id: &str) -> anyhow::Result<()> {
        let response = self
            .send_request(Request::DeleteSession { id: id.to_owned() })
            .await?;

        match response {
            Response::Deleted => Ok(()),
            Response::Error { code, message } => {
                anyhow::bail!("[{code}] {message}")
            }
            _ => anyhow::bail!("Unexpected response"),
        }
    }

    /// Archive a session
    ///
    /// # Errors
    ///
    /// Returns an error if the session is not found or the request fails.
    pub async fn archive_session(&mut self, id: &str) -> anyhow::Result<()> {
        let response = self
            .send_request(Request::ArchiveSession { id: id.to_owned() })
            .await?;

        match response {
            Response::Archived => Ok(()),
            Response::Error { code, message } => {
                anyhow::bail!("[{code}] {message}")
            }
            _ => anyhow::bail!("Unexpected response"),
        }
    }

    /// Unarchive a session
    ///
    /// # Errors
    ///
    /// Returns an error if the session is not found, not archived, or the request fails.
    pub async fn unarchive_session(&mut self, id: &str) -> anyhow::Result<()> {
        let response = self
            .send_request(Request::UnarchiveSession { id: id.to_owned() })
            .await?;

        match response {
            Response::Unarchived => Ok(()),
            Response::Error { code, message } => {
                anyhow::bail!("[{code}] {message}")
            }
            _ => anyhow::bail!("Unexpected response"),
        }
    }

    /// Refresh a session (pull latest image and recreate container)
    ///
    /// # Errors
    ///
    /// Returns an error if the session is not found or refresh fails.
    pub async fn refresh_session(&mut self, id: &str) -> anyhow::Result<()> {
        let response = self
            .send_request(Request::RefreshSession { id: id.to_owned() })
            .await?;

        match response {
            Response::Refreshed => Ok(()),
            Response::Error { code, message } => {
                anyhow::bail!("[{code}] {message}")
            }
            _ => anyhow::bail!("Unexpected response"),
        }
    }

    /// Get the attach command for a session
    ///
    /// # Errors
    ///
    /// Returns an error if the session is not found or the request fails.
    pub async fn attach_session(&mut self, id: &str) -> anyhow::Result<Vec<String>> {
        let response = self
            .send_request(Request::AttachSession { id: id.to_owned() })
            .await?;

        match response {
            Response::AttachReady { command } => Ok(command),
            Response::Error { code, message } => {
                anyhow::bail!("[{code}] {message}")
            }
            _ => anyhow::bail!("Unexpected response"),
        }
    }

    /// Reconcile state with reality
    ///
    /// # Errors
    ///
    /// Returns an error if the reconciliation fails or the request fails.
    pub async fn reconcile(&mut self) -> anyhow::Result<ReconcileReportDto> {
        let response = self.send_request(Request::Reconcile).await?;

        match response {
            Response::ReconcileReport(report) => Ok(report),
            Response::Error { code, message } => {
                anyhow::bail!("[{code}] {message}")
            }
            _ => anyhow::bail!("Unexpected response"),
        }
    }

    /// Get recent repositories with timestamps
    ///
    /// # Errors
    ///
    /// Returns an error if the request fails.
    pub async fn get_recent_repos(
        &mut self,
    ) -> anyhow::Result<Vec<super::protocol::RecentRepoDto>> {
        let response = self.send_request(Request::GetRecentRepos).await?;

        match response {
            Response::RecentRepos(repos) => Ok(repos),
            Response::Error { code, message } => {
                anyhow::bail!("[{code}] {message}")
            }
            _ => anyhow::bail!("Unexpected response"),
        }
    }

    /// Update the access mode for a session
    ///
    /// # Errors
    ///
    /// Returns an error if the session is not found or the request fails.
    pub async fn update_access_mode(
        &mut self,
        id: &str,
        access_mode: crate::core::session::AccessMode,
    ) -> anyhow::Result<()> {
        let response = self
            .send_request(Request::UpdateAccessMode {
                id: id.to_owned(),
                access_mode,
            })
            .await?;

        match response {
            Response::AccessModeUpdated => Ok(()),
            Response::Error { code, message } => {
                anyhow::bail!("[{code}] {message}")
            }
            _ => anyhow::bail!("Unexpected response"),
        }
    }

    /// Send a prompt to a session (for hotkey triggers)
    ///
    /// # Errors
    ///
    /// Returns an error if the session is not found or the request fails.
    pub async fn send_prompt(&mut self, session_name: &str, prompt: &str) -> anyhow::Result<()> {
        let response = self
            .send_request(Request::SendPrompt {
                session: session_name.to_owned(),
                prompt: prompt.to_owned(),
            })
            .await?;

        match response {
            Response::Ok => Ok(()),
            Response::Error { code, message } => {
                anyhow::bail!("[{code}] {message}")
            }
            _ => anyhow::bail!("Unexpected response"),
        }
    }

    /// Get current feature flags from the daemon
    ///
    /// # Errors
    ///
    /// Returns an error if the request fails or the daemon returns an error.
    pub async fn get_feature_flags(
        &mut self,
    ) -> anyhow::Result<crate::feature_flags::FeatureFlags> {
        let response = self.send_request(Request::GetFeatureFlags).await?;

        match response {
            Response::FeatureFlags { flags } => Ok(flags),
            Response::Error { code, message } => {
                anyhow::bail!("[{code}] {message}")
            }
            _ => anyhow::bail!("Unexpected response"),
        }
    }

    /// Get health status of all sessions.
    ///
    /// # Errors
    ///
    /// Returns an error if the request fails.
    pub async fn get_health(&mut self) -> anyhow::Result<crate::core::session::HealthCheckResult> {
        let response = self.send_request(Request::GetHealth).await?;

        match response {
            Response::HealthCheckResult(result) => Ok(result),
            Response::Error { code, message } => {
                anyhow::bail!("[{code}] {message}")
            }
            _ => anyhow::bail!("Unexpected response"),
        }
    }

    /// Start a stopped session.
    ///
    /// # Errors
    ///
    /// Returns an error if the request fails or the server returns an error response.
    pub async fn start_session(&mut self, id: uuid::Uuid) -> anyhow::Result<()> {
        let response = self
            .send_request(Request::StartSession { id: id.to_string() })
            .await?;

        match response {
            Response::Ok => Ok(()),
            Response::Error { code, message } => {
                anyhow::bail!("[{code}] {message}")
            }
            _ => anyhow::bail!("Unexpected response"),
        }
    }

    /// Wake a hibernated session.
    ///
    /// # Errors
    ///
    /// Returns an error if the request fails or the server returns an error response.
    pub async fn wake_session(&mut self, id: uuid::Uuid) -> anyhow::Result<()> {
        let response = self
            .send_request(Request::WakeSession { id: id.to_string() })
            .await?;

        match response {
            Response::Ok => Ok(()),
            Response::Error { code, message } => {
                anyhow::bail!("[{code}] {message}")
            }
            _ => anyhow::bail!("Unexpected response"),
        }
    }

    /// Recreate a session (preserves data).
    ///
    /// # Errors
    ///
    /// Returns an error if the request fails or the server returns an error response.
    pub async fn recreate_session(&mut self, id: uuid::Uuid) -> anyhow::Result<()> {
        let response = self
            .send_request(Request::RecreateSession { id: id.to_string() })
            .await?;

        match response {
            Response::Ok => Ok(()),
            Response::Error { code, message } => {
                anyhow::bail!("[{code}] {message}")
            }
            _ => anyhow::bail!("Unexpected response"),
        }
    }

    /// Recreate a session fresh (data lost).
    ///
    /// # Errors
    ///
    /// Returns an error if the request fails or the server returns an error response.
    pub async fn recreate_session_fresh(&mut self, id: uuid::Uuid) -> anyhow::Result<()> {
        let response = self
            .send_request(Request::RecreateSessionFresh { id: id.to_string() })
            .await?;

        match response {
            Response::Ok => Ok(()),
            Response::Error { code, message } => {
                anyhow::bail!("[{code}] {message}")
            }
            _ => anyhow::bail!("Unexpected response"),
        }
    }

    /// Update session image and recreate (same as refresh).
    ///
    /// # Errors
    ///
    /// Returns an error if the request fails or the server returns an error response.
    pub async fn update_session_image(&mut self, id: uuid::Uuid) -> anyhow::Result<()> {
        let response = self
            .send_request(Request::RefreshSession { id: id.to_string() })
            .await?;

        match response {
            Response::Ok => Ok(()),
            Response::Error { code, message } => {
                anyhow::bail!("[{code}] {message}")
            }
            _ => anyhow::bail!("Unexpected response"),
        }
    }

    /// Cleanup a session (remove from clauderon).
    ///
    /// # Errors
    ///
    /// Returns an error if the request fails or the server returns an error response.
    pub async fn cleanup_session(&mut self, id: uuid::Uuid) -> anyhow::Result<()> {
        let response = self
            .send_request(Request::CleanupSession { id: id.to_string() })
            .await?;

        match response {
            Response::Ok => Ok(()),
            Response::Error { code, message } => {
                anyhow::bail!("[{code}] {message}")
            }
            _ => anyhow::bail!("Unexpected response"),
        }
    }

    /// Merge a pull request for a session
    ///
    /// # Errors
    ///
    /// Returns an error if the session is not found or the merge fails.
    pub async fn merge_pr(
        &mut self,
        id: &str,
        method: crate::core::MergeMethod,
        delete_branch: bool,
    ) -> anyhow::Result<()> {
        let response = self
            .send_request(Request::MergePr {
                id: id.to_owned(),
                method,
                delete_branch,
            })
            .await?;

        match response {
            Response::Ok => Ok(()),
            Response::Error { code, message } => {
                anyhow::bail!("[{code}] {message}")
            }
            _ => anyhow::bail!("Unexpected response"),
        }
    }
}

#[async_trait]
impl ApiClient for Client {
    async fn list_sessions(&mut self) -> anyhow::Result<Vec<Session>> {
        Self::list_sessions(self).await
    }

    async fn get_session(&mut self, id: &str) -> anyhow::Result<Session> {
        Self::get_session(self, id).await
    }

    async fn create_session(
        &mut self,
        request: CreateSessionRequest,
    ) -> anyhow::Result<(Session, Option<Vec<String>>)> {
        Self::create_session(self, request).await
    }

    async fn delete_session(&mut self, id: &str) -> anyhow::Result<()> {
        Self::delete_session(self, id).await
    }

    async fn archive_session(&mut self, id: &str) -> anyhow::Result<()> {
        Self::archive_session(self, id).await
    }

    async fn unarchive_session(&mut self, id: &str) -> anyhow::Result<()> {
        Self::unarchive_session(self, id).await
    }

    async fn refresh_session(&mut self, id: &str) -> anyhow::Result<()> {
        Self::refresh_session(self, id).await
    }

    async fn attach_session(&mut self, id: &str) -> anyhow::Result<Vec<String>> {
        Self::attach_session(self, id).await
    }

    async fn reconcile(&mut self) -> anyhow::Result<ReconcileReportDto> {
        Self::reconcile(self).await
    }

    async fn get_recent_repos(&mut self) -> anyhow::Result<Vec<super::protocol::RecentRepoDto>> {
        Self::get_recent_repos(self).await
    }

    async fn get_feature_flags(&mut self) -> anyhow::Result<crate::feature_flags::FeatureFlags> {
        Self::get_feature_flags(self).await
    }

    async fn get_health(&mut self) -> anyhow::Result<crate::core::session::HealthCheckResult> {
        Self::get_health(self).await
    }

    async fn start_session(&mut self, id: uuid::Uuid) -> anyhow::Result<()> {
        Self::start_session(self, id).await
    }

    async fn wake_session(&mut self, id: uuid::Uuid) -> anyhow::Result<()> {
        Self::wake_session(self, id).await
    }

    async fn recreate_session(&mut self, id: uuid::Uuid) -> anyhow::Result<()> {
        Self::recreate_session(self, id).await
    }

    async fn recreate_session_fresh(&mut self, id: uuid::Uuid) -> anyhow::Result<()> {
        Self::recreate_session_fresh(self, id).await
    }

    async fn update_session_image(&mut self, id: uuid::Uuid) -> anyhow::Result<()> {
        Self::update_session_image(self, id).await
    }

    async fn cleanup_session(&mut self, id: uuid::Uuid) -> anyhow::Result<()> {
        Self::cleanup_session(self, id).await
    }

    async fn merge_pr(
        &mut self,
        id: &str,
        method: crate::core::MergeMethod,
        delete_branch: bool,
    ) -> anyhow::Result<()> {
        Self::merge_pr(self, id, method, delete_branch).await
    }
}
