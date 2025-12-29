use std::time::Duration;

use async_trait::async_trait;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::UnixStream;

use crate::core::Session;
use crate::utils::{daemon, paths};

use super::protocol::{CreateSessionRequest, Request, Response};
use super::traits::ApiClient;
use super::types::ReconcileReportDto;

/// Client for communicating with the multiplexer daemon
pub struct Client {
    stream: UnixStream,
}

impl Client {
    /// Connect to the multiplexer daemon, auto-spawning it if not running
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

        // First attempt to connect
        match UnixStream::connect(&socket_path).await {
            Ok(stream) => return Ok(Self { stream }),
            Err(_) => {
                // Daemon not running, try to spawn it
                daemon::ensure_daemon_running().await?;

                // Wait for daemon to be ready to accept connections
                daemon::wait_for_daemon(Duration::from_secs(5)).await?;
            }
        }

        // Retry connection after spawning daemon
        let stream = UnixStream::connect(&socket_path).await.map_err(|e| {
            anyhow::anyhow!(
                "Failed to connect to daemon at {} after spawning. Error: {e}",
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
        reader.read_line(&mut line).await?;

        let response: Response = serde_json::from_str(line.trim())?;
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
            .send_request(Request::GetSession { id: id.to_string() })
            .await?;

        match response {
            Response::Session(session) => Ok(session),
            Response::Error { code, message } => {
                anyhow::bail!("[{code}] {message}")
            }
            _ => anyhow::bail!("Unexpected response"),
        }
    }

    /// Create a new session
    ///
    /// # Errors
    ///
    /// Returns an error if session creation fails or the request fails.
    pub async fn create_session(
        &mut self,
        request: CreateSessionRequest,
    ) -> anyhow::Result<Session> {
        let response = self.send_request(Request::CreateSession(request)).await?;

        match response {
            Response::Created { id } => self.get_session(&id).await,
            Response::Error { code, message } => {
                anyhow::bail!("[{code}] {message}")
            }
            _ => anyhow::bail!("Unexpected response"),
        }
    }

    /// Delete a session
    ///
    /// # Errors
    ///
    /// Returns an error if the session is not found or the request fails.
    pub async fn delete_session(&mut self, id: &str) -> anyhow::Result<()> {
        let response = self
            .send_request(Request::DeleteSession { id: id.to_string() })
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
            .send_request(Request::ArchiveSession { id: id.to_string() })
            .await?;

        match response {
            Response::Archived => Ok(()),
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
            .send_request(Request::AttachSession { id: id.to_string() })
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
}

#[async_trait]
impl ApiClient for Client {
    async fn list_sessions(&mut self) -> anyhow::Result<Vec<Session>> {
        Client::list_sessions(self).await
    }

    async fn get_session(&mut self, id: &str) -> anyhow::Result<Session> {
        Client::get_session(self, id).await
    }

    async fn create_session(
        &mut self,
        request: CreateSessionRequest,
    ) -> anyhow::Result<Session> {
        Client::create_session(self, request).await
    }

    async fn delete_session(&mut self, id: &str) -> anyhow::Result<()> {
        Client::delete_session(self, id).await
    }

    async fn archive_session(&mut self, id: &str) -> anyhow::Result<()> {
        Client::archive_session(self, id).await
    }

    async fn attach_session(&mut self, id: &str) -> anyhow::Result<Vec<String>> {
        Client::attach_session(self, id).await
    }

    async fn reconcile(&mut self) -> anyhow::Result<ReconcileReportDto> {
        Client::reconcile(self).await
    }
}
