//! Console session management with persistent background reader.
//!
//! This module provides:
//! - Console socket attachment via daemon
//! - Background reader that continues even when detached
//! - Write channel for sending input/resizes
//! - Session status tracking

use std::sync::Arc;

use base64::Engine;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::UnixStream;
use tokio::sync::mpsc;
use tokio::task::JoinHandle;
use tokio_util::sync::CancellationToken;

use super::terminal_buffer::TerminalBuffer;
use crate::api::console_protocol::{ConsoleMessage, SignalType};
use crate::utils::paths;

/// Channel buffer size for console events.
const EVENT_CHANNEL_SIZE: usize = 256;

/// Channel buffer size for write requests.
const WRITE_CHANNEL_SIZE: usize = 256;

/// Requests sent to the console writer task.
#[derive(Debug)]
enum WriteRequest {
    Bytes(Vec<u8>),
    Resize { rows: u16, cols: u16 },
    Signal { signal: SignalType },
}

/// Events emitted by a console session.
#[derive(Debug)]
pub enum PtyEvent {
    /// New output data from the console (already processed into terminal buffer).
    Output,
    /// Console connection closed.
    Exited(i32),
    /// Error occurred.
    Error(String),
}

/// Status of a console session.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SessionStatus {
    /// Session is running.
    Running,
    /// Session exited with code.
    Exited(i32),
    /// Session encountered an error.
    Error(String),
}

/// A console session with background reader.
pub struct PtySession {
    /// Session identifier (matches clauderon session ID).
    session_id: uuid::Uuid,

    /// Container ID for reconnection.
    container_id: String,

    /// Channel to send input to the console.
    write_tx: mpsc::Sender<WriteRequest>,

    /// Terminal buffer (shared with background reader).
    terminal_buffer: Arc<tokio::sync::Mutex<TerminalBuffer>>,

    /// Channel to receive console events.
    event_rx: mpsc::Receiver<PtyEvent>,

    /// Background reader task handle (Option for shutdown).
    reader_task: Option<JoinHandle<()>>,

    /// Background writer task handle (Option for shutdown).
    writer_task: Option<JoinHandle<()>>,

    /// Cancellation token for graceful shutdown.
    cancel_token: CancellationToken,

    /// Current session status.
    status: SessionStatus,
}

impl PtySession {
    /// Spawn a new console session attached to a Docker session via the daemon.
    ///
    /// # Errors
    ///
    /// Returns an error if the console socket cannot be opened.
    pub async fn spawn_docker_attach(
        session_id: uuid::Uuid,
        container_id: String,
        rows: u16,
        cols: u16,
    ) -> anyhow::Result<Self> {
        let socket_path = paths::console_socket_path();
        let stream = UnixStream::connect(&socket_path).await?;
        let (reader, mut writer) = stream.into_split();

        let attach = ConsoleMessage::Attach {
            session_id: session_id.to_string(),
            rows,
            cols,
        };
        let payload = serde_json::to_string(&attach)?;
        writer.write_all(payload.as_bytes()).await?;
        writer.write_all(b"\n").await?;

        let mut reader = BufReader::new(reader);
        let mut line = String::new();
        let bytes_read = reader.read_line(&mut line).await?;
        if bytes_read == 0 {
            anyhow::bail!("Console connection closed before attach");
        }

        match serde_json::from_str::<ConsoleMessage>(line.trim())? {
            ConsoleMessage::Attached => {}
            ConsoleMessage::Error { message } => {
                anyhow::bail!("Console attach failed: {message}");
            }
            _ => {
                anyhow::bail!("Unexpected console attach response");
            }
        }

        let (write_tx, write_rx) = mpsc::channel::<WriteRequest>(WRITE_CHANNEL_SIZE);
        let (event_tx, event_rx) = mpsc::channel::<PtyEvent>(EVENT_CHANNEL_SIZE);

        let terminal_buffer = Arc::new(tokio::sync::Mutex::new(TerminalBuffer::new(rows, cols)));
        let cancel_token = CancellationToken::new();

        let reader_task = {
            let terminal_buffer = Arc::clone(&terminal_buffer);
            let cancel_token = cancel_token.clone();
            tokio::spawn(async move {
                Self::reader_loop(reader, terminal_buffer, event_tx, cancel_token).await;
            })
        };

        let writer_task = {
            let cancel_token = cancel_token.clone();
            tokio::spawn(async move {
                Self::writer_loop(writer, write_rx, cancel_token).await;
            })
        };

        Ok(Self {
            session_id,
            container_id,
            write_tx,
            terminal_buffer,
            event_rx,
            reader_task: Some(reader_task),
            writer_task: Some(writer_task),
            cancel_token,
            status: SessionStatus::Running,
        })
    }

    async fn reader_loop(
        mut reader: BufReader<tokio::net::unix::OwnedReadHalf>,
        terminal_buffer: Arc<tokio::sync::Mutex<TerminalBuffer>>,
        event_tx: mpsc::Sender<PtyEvent>,
        cancel_token: CancellationToken,
    ) {
        let mut line = String::new();
        loop {
            tokio::select! {
                result = reader.read_line(&mut line) => {
                    match result {
                        Ok(0) => {
                            let _ = event_tx.send(PtyEvent::Error("Console connection closed".to_string())).await;
                            break;
                        }
                        Ok(_) => {
                            let message = serde_json::from_str::<ConsoleMessage>(line.trim());
                            line.clear();
                            match message {
                                Ok(ConsoleMessage::Output { data }) => {
                                    if let Ok(bytes) = base64::prelude::BASE64_STANDARD.decode(data) {
                                        let mut buffer = terminal_buffer.lock().await;
                                        buffer.process(&bytes);
                                        drop(buffer);
                                        let _ = event_tx.send(PtyEvent::Output).await;
                                    }
                                }
                                Ok(ConsoleMessage::Snapshot { data, rows, cols, .. }) => {
                                    // Process snapshot data to recreate terminal state
                                    if let Ok(bytes) = base64::prelude::BASE64_STANDARD.decode(data) {
                                        let mut buffer = terminal_buffer.lock().await;
                                        buffer.resize(rows, cols);
                                        buffer.process(&bytes);
                                        drop(buffer);
                                        let _ = event_tx.send(PtyEvent::Output).await;
                                    }
                                }
                                Ok(ConsoleMessage::Error { message }) => {
                                    let _ = event_tx.send(PtyEvent::Error(message)).await;
                                }
                                Ok(_) => {}
                                Err(e) => {
                                    let _ = event_tx.send(PtyEvent::Error(e.to_string())).await;
                                }
                            }
                        }
                        Err(e) => {
                            let _ = event_tx.send(PtyEvent::Error(e.to_string())).await;
                            break;
                        }
                    }
                }
                () = cancel_token.cancelled() => break,
            }
        }
    }

    async fn writer_loop(
        mut writer: tokio::net::unix::OwnedWriteHalf,
        mut write_rx: mpsc::Receiver<WriteRequest>,
        cancel_token: CancellationToken,
    ) {
        loop {
            tokio::select! {
                data = write_rx.recv() => {
                    match data {
                        Some(WriteRequest::Bytes(bytes)) => {
                            let data = base64::prelude::BASE64_STANDARD.encode(bytes);
                            let message = ConsoleMessage::Input { data };
                            if let Ok(payload) = serde_json::to_string(&message) {
                                if writer.write_all(payload.as_bytes()).await.is_err() {
                                    break;
                                }
                                if writer.write_all(b"\n").await.is_err() {
                                    break;
                                }
                            }
                        }
                        Some(WriteRequest::Resize { rows, cols }) => {
                            let message = ConsoleMessage::Resize { rows, cols };
                            if let Ok(payload) = serde_json::to_string(&message) {
                                if writer.write_all(payload.as_bytes()).await.is_err() {
                                    break;
                                }
                                if writer.write_all(b"\n").await.is_err() {
                                    break;
                                }
                            }
                        }
                        Some(WriteRequest::Signal { signal }) => {
                            let message = ConsoleMessage::Signal { signal };
                            if let Ok(payload) = serde_json::to_string(&message) {
                                if writer.write_all(payload.as_bytes()).await.is_err() {
                                    tracing::error!(signal = ?signal, "Failed to write signal message");
                                    break;
                                }
                                if writer.write_all(b"\n").await.is_err() {
                                    tracing::error!(signal = ?signal, "Failed to write newline after signal");
                                    break;
                                }
                                tracing::debug!(signal = ?signal, "Signal message sent to daemon");
                            } else {
                                tracing::error!(signal = ?signal, "Failed to serialize signal message");
                            }
                        }
                        None => break,
                    }
                }
                () = cancel_token.cancelled() => break,
            }
        }
    }

    /// Send input to the console.
    ///
    /// # Errors
    ///
    /// Returns an error if the write channel is closed.
    pub async fn write(&self, data: Vec<u8>) -> anyhow::Result<()> {
        self.write_tx
            .send(WriteRequest::Bytes(data))
            .await
            .map_err(|_| anyhow::anyhow!("Console write channel closed"))
    }

    /// Try to receive the next console event (non-blocking).
    pub fn try_recv_event(&mut self) -> Option<PtyEvent> {
        self.event_rx.try_recv().ok()
    }

    /// Receive the next console event (blocking).
    pub async fn recv_event(&mut self) -> Option<PtyEvent> {
        self.event_rx.recv().await
    }

    /// Get a reference to the terminal buffer.
    #[must_use]
    pub fn terminal_buffer(&self) -> &Arc<tokio::sync::Mutex<TerminalBuffer>> {
        &self.terminal_buffer
    }

    /// Get the session ID.
    #[must_use]
    pub fn session_id(&self) -> uuid::Uuid {
        self.session_id
    }

    /// Get the container ID.
    #[must_use]
    pub fn container_id(&self) -> &str {
        &self.container_id
    }

    /// Get the current session status.
    #[must_use]
    pub fn status(&self) -> &SessionStatus {
        &self.status
    }

    /// Update the session status.
    pub fn set_status(&mut self, status: SessionStatus) {
        self.status = status;
    }

    /// Resize the console session.
    pub async fn resize(&self, rows: u16, cols: u16) {
        let _ = self
            .write_tx
            .send(WriteRequest::Resize { rows, cols })
            .await;
        let mut buffer = self.terminal_buffer.lock().await;
        buffer.resize(rows, cols);
    }

    /// Send a signal to the PTY process.
    ///
    /// # Errors
    ///
    /// Returns an error if the write channel is closed or signal send fails.
    #[tracing::instrument(skip(self), fields(
        session_id = %self.session_id,
        signal = ?signal
    ))]
    pub async fn send_signal(&self, signal: SignalType) -> anyhow::Result<()> {
        tracing::debug!(
            session_id = %self.session_id,
            signal = ?signal,
            "Queueing signal for transmission"
        );

        self.write_tx
            .send(WriteRequest::Signal { signal })
            .await
            .map_err(|_| anyhow::anyhow!("Console write channel closed"))?;

        tracing::info!(
            session_id = %self.session_id,
            signal = ?signal,
            "Signal queued successfully"
        );

        Ok(())
    }

    /// Gracefully shutdown the session.
    pub async fn shutdown(&mut self) {
        self.cancel_token.cancel();

        let reader_task = self.reader_task.take();
        let writer_task = self.writer_task.take();

        let _ = tokio::time::timeout(std::time::Duration::from_secs(5), async {
            if let Some(task) = reader_task {
                let _ = task.await;
            }
            if let Some(task) = writer_task {
                let _ = task.await;
            }
        })
        .await;
    }

    /// Check if the session is still running.
    #[must_use]
    pub fn is_running(&self) -> bool {
        matches!(self.status, SessionStatus::Running)
    }
}

impl Drop for PtySession {
    fn drop(&mut self) {
        self.cancel_token.cancel();
        if let Some(task) = self.reader_task.take() {
            task.abort();
        }
        if let Some(task) = self.writer_task.take() {
            task.abort();
        }
    }
}
