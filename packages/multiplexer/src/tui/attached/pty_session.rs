//! PTY session management with persistent background reader.
//!
//! This module provides:
//! - PTY spawning via pty-process
//! - Background reader that continues even when detached
//! - Write channel for sending input to PTY
//! - Session status tracking

use std::sync::Arc;

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::process::Child;
use tokio::sync::mpsc;
use tokio::task::JoinHandle;
use tokio_util::sync::CancellationToken;

use super::terminal_buffer::TerminalBuffer;

/// Buffer size for PTY reads.
const READ_BUFFER_SIZE: usize = 4096;

/// Channel buffer size for PTY events.
const EVENT_CHANNEL_SIZE: usize = 256;

/// Channel buffer size for write requests.
const WRITE_CHANNEL_SIZE: usize = 256;

/// Events emitted by a PTY session.
#[derive(Debug)]
pub enum PtyEvent {
    /// New output data from the PTY (already processed into terminal buffer).
    Output,
    /// PTY process exited.
    Exited(i32),
    /// Error occurred.
    Error(String),
}

/// Status of a PTY session.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SessionStatus {
    /// Session is running.
    Running,
    /// Session exited with code.
    Exited(i32),
    /// Session encountered an error.
    Error(String),
}

/// A PTY session with background reader.
pub struct PtySession {
    /// Session identifier (matches mux session ID).
    session_id: uuid::Uuid,

    /// Container ID for reconnection.
    container_id: String,

    /// Channel to send input to the PTY.
    write_tx: mpsc::Sender<Vec<u8>>,

    /// Terminal buffer (shared with background reader).
    terminal_buffer: Arc<tokio::sync::Mutex<TerminalBuffer>>,

    /// Channel to receive PTY events.
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
    /// Spawn a new PTY session attached to a Docker container.
    ///
    /// # Errors
    ///
    /// Returns an error if the PTY cannot be spawned.
    pub async fn spawn_docker_attach(
        session_id: uuid::Uuid,
        container_id: String,
        rows: u16,
        cols: u16,
    ) -> anyhow::Result<Self> {
        // Create PTY using the open() function
        let (pty, pts) = pty_process::open()?;
        pty.resize(pty_process::Size::new(rows, cols))?;

        // Spawn docker attach command
        let cmd = pty_process::Command::new("docker").args(["attach", &container_id]);

        let child: Child = cmd.spawn(pts)?;

        // Split PTY into read/write halves
        let (pty_reader, pty_writer) = pty.into_split();

        // Create channels
        let (write_tx, write_rx) = mpsc::channel::<Vec<u8>>(WRITE_CHANNEL_SIZE);
        let (event_tx, event_rx) = mpsc::channel::<PtyEvent>(EVENT_CHANNEL_SIZE);

        // Create shared terminal buffer
        let terminal_buffer = Arc::new(tokio::sync::Mutex::new(TerminalBuffer::new(rows, cols)));

        // Create cancellation token
        let cancel_token = CancellationToken::new();

        // Spawn background reader task
        let reader_task = {
            let terminal_buffer = Arc::clone(&terminal_buffer);
            let event_tx = event_tx.clone();
            let cancel_token = cancel_token.clone();

            tokio::spawn(async move {
                Self::reader_loop(pty_reader, terminal_buffer, event_tx, cancel_token).await;
            })
        };

        // Spawn background writer task
        let writer_task = {
            let cancel_token = cancel_token.clone();

            tokio::spawn(async move {
                Self::writer_loop(pty_writer, write_rx, cancel_token).await;
            })
        };

        // Spawn task to wait for child exit
        let event_tx_exit = event_tx;
        let cancel_token_exit = cancel_token.clone();
        tokio::spawn(async move {
            Self::child_exit_loop(child, event_tx_exit, cancel_token_exit).await;
        });

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

    /// Wait for child process to exit.
    async fn child_exit_loop(
        mut child: Child,
        event_tx: mpsc::Sender<PtyEvent>,
        cancel_token: CancellationToken,
    ) {
        tokio::select! {
            result = child.wait() => {
                let exit_code = match result {
                    Ok(status) => status.code().unwrap_or(-1),
                    Err(_) => -1,
                };
                let _ = event_tx.send(PtyEvent::Exited(exit_code)).await;
            }
            () = cancel_token.cancelled() => {
                // Cancelled, try to kill child
                let _ = child.kill().await;
            }
        }
    }

    /// Background reader loop.
    async fn reader_loop(
        mut reader: pty_process::OwnedReadPty,
        terminal_buffer: Arc<tokio::sync::Mutex<TerminalBuffer>>,
        event_tx: mpsc::Sender<PtyEvent>,
        cancel_token: CancellationToken,
    ) {
        let mut buf = vec![0u8; READ_BUFFER_SIZE];

        loop {
            tokio::select! {
                result = reader.read(&mut buf) => {
                    match result {
                        Ok(0) => {
                            // EOF
                            break;
                        }
                        Ok(n) => {
                            // Process data into terminal buffer
                            {
                                let mut buffer = terminal_buffer.lock().await;
                                buffer.process(&buf[..n]);
                            }
                            // Notify of output
                            if event_tx.send(PtyEvent::Output).await.is_err() {
                                break;
                            }
                        }
                        Err(e) => {
                            let _ = event_tx.send(PtyEvent::Error(e.to_string())).await;
                            break;
                        }
                    }
                }
                () = cancel_token.cancelled() => {
                    break;
                }
            }
        }
    }

    /// Background writer loop.
    async fn writer_loop(
        mut writer: pty_process::OwnedWritePty,
        mut write_rx: mpsc::Receiver<Vec<u8>>,
        cancel_token: CancellationToken,
    ) {
        loop {
            tokio::select! {
                data = write_rx.recv() => {
                    match data {
                        Some(bytes) => {
                            if writer.write_all(&bytes).await.is_err() {
                                break;
                            }
                        }
                        None => break,
                    }
                }
                () = cancel_token.cancelled() => {
                    break;
                }
            }
        }
    }

    /// Send input to the PTY.
    ///
    /// # Errors
    ///
    /// Returns an error if the write channel is closed.
    pub async fn write(&self, data: Vec<u8>) -> anyhow::Result<()> {
        self.write_tx
            .send(data)
            .await
            .map_err(|_| anyhow::anyhow!("PTY write channel closed"))
    }

    /// Try to receive the next PTY event (non-blocking).
    pub fn try_recv_event(&mut self) -> Option<PtyEvent> {
        self.event_rx.try_recv().ok()
    }

    /// Receive the next PTY event (blocking).
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

    /// Resize the PTY.
    ///
    /// Note: This requires recreating the PTY or using platform-specific APIs.
    /// For now, this only updates the terminal buffer.
    pub async fn resize(&self, rows: u16, cols: u16) {
        let mut buffer = self.terminal_buffer.lock().await;
        buffer.resize(rows, cols);
    }

    /// Gracefully shutdown the session.
    pub async fn shutdown(&mut self) {
        // Signal cancellation
        self.cancel_token.cancel();

        // Take task handles and wait for completion
        let reader_task = self.reader_task.take();
        let writer_task = self.writer_task.take();

        // Wait for tasks to complete (with timeout)
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
        // Cancel background tasks (tasks will exit on next poll)
        self.cancel_token.cancel();

        // Abort tasks if they're still running
        if let Some(task) = self.reader_task.take() {
            task.abort();
        }
        if let Some(task) = self.writer_task.take() {
            task.abort();
        }
    }
}
