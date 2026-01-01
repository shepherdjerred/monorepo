use std::path::PathBuf;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::net::{UnixListener, UnixStream};
use tokio::sync::mpsc;

use super::HookMessage;

/// Hook listener that receives messages from Claude Code hooks
pub struct HookListener {
    socket_path: PathBuf,
    message_tx: mpsc::Sender<HookMessage>,
}

impl HookListener {
    /// Create a new hook listener
    ///
    /// Returns the listener and a receiver for hook messages
    pub fn new(socket_path: PathBuf) -> (Self, mpsc::Receiver<HookMessage>) {
        let (tx, rx) = mpsc::channel(100);
        (
            Self {
                socket_path,
                message_tx: tx,
            },
            rx,
        )
    }

    /// Start the listener (spawns background task)
    ///
    /// # Errors
    ///
    /// Returns an error if the socket cannot be bound or other I/O errors occur.
    pub async fn start(self) -> anyhow::Result<()> {
        // Remove existing socket
        if self.socket_path.exists() {
            tokio::fs::remove_file(&self.socket_path).await?;
        }

        // Ensure parent directory exists
        if let Some(parent) = self.socket_path.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }

        let listener = UnixListener::bind(&self.socket_path)?;
        tracing::info!(
            socket = %self.socket_path.display(),
            "Hook listener started"
        );

        loop {
            match listener.accept().await {
                Ok((stream, _)) => {
                    let tx = self.message_tx.clone();
                    tokio::spawn(async move {
                        if let Err(e) = handle_hook_connection(stream, tx).await {
                            tracing::error!(error = %e, "Hook connection error");
                        }
                    });
                }
                Err(e) => {
                    tracing::error!(error = %e, "Hook accept error");
                }
            }
        }
    }
}

/// Handle a single hook connection
async fn handle_hook_connection(
    stream: UnixStream,
    tx: mpsc::Sender<HookMessage>,
) -> anyhow::Result<()> {
    let reader = BufReader::new(stream);
    let mut lines = reader.lines();

    while let Some(line) = lines.next_line().await? {
        match serde_json::from_str::<HookMessage>(&line) {
            Ok(message) => {
                tracing::debug!(
                    session_id = %message.session_id,
                    event = ?message.event,
                    "Received hook message"
                );
                if let Err(e) = tx.send(message).await {
                    tracing::warn!(
                        session_id = %e.0.session_id,
                        error = "Channel closed or full",
                        "Failed to send hook message (receiver dropped?)"
                    );
                }
            }
            Err(e) => {
                tracing::warn!(error = %e, line = %line, "Failed to parse hook message");
            }
        }
    }

    Ok(())
}
