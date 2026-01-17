use std::collections::HashMap;
use std::sync::Arc;

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::{Mutex, broadcast, mpsc};
use tokio::task::JoinHandle;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use crate::api::console_protocol::SignalType;
use crate::core::session::BackendType;
use crate::tui::attached::TerminalBuffer;
use crate::utils::terminal_queries::{
    TerminalEvent, TerminalQuery, TerminalQueryParser, build_query_response,
};

/// Channel buffer size for write requests.
const WRITE_CHANNEL_SIZE: usize = 256;

/// Channel buffer size for output broadcast.
const OUTPUT_CHANNEL_SIZE: usize = 256;

/// Buffer size for PTY reads.
const READ_BUFFER_SIZE: usize = 4096;

/// Requests sent to the PTY writer task.
#[derive(Debug)]
enum WriteRequest {
    Bytes(Vec<u8>),
    Resize { rows: u16, cols: u16 },
    Signal { signal: SignalType },
}

struct ConsoleSession {
    write_tx: mpsc::Sender<WriteRequest>,
    output_tx: broadcast::Sender<Vec<u8>>,
    terminal_buffer: Arc<Mutex<TerminalBuffer>>,
    cancel_token: CancellationToken,
    reader_task: JoinHandle<()>,
    writer_task: JoinHandle<()>,
}

impl ConsoleSession {
    async fn spawn_docker(backend_id: &str) -> anyhow::Result<Self> {
        // Create PTY and spawn docker attach
        let (pty, pts) = pty_process::open()?;
        let cmd = pty_process::Command::new("docker").args(["attach", backend_id]);
        let _child = cmd.spawn(pts)?;

        let (pty_reader, pty_writer) = pty.into_split();

        let (write_tx, write_rx) = mpsc::channel(WRITE_CHANNEL_SIZE);
        let (output_tx, _) = broadcast::channel(OUTPUT_CHANNEL_SIZE);
        let terminal_buffer = Arc::new(Mutex::new(TerminalBuffer::new(24, 80)));
        let cancel_token = CancellationToken::new();

        let reader_task = {
            let terminal_buffer = Arc::clone(&terminal_buffer);
            let output_tx = output_tx.clone();
            let write_tx = write_tx.clone();
            let cancel_token = cancel_token.clone();
            tokio::spawn(async move {
                Self::reader_loop(
                    pty_reader,
                    terminal_buffer,
                    output_tx,
                    write_tx,
                    cancel_token,
                )
                .await;
            })
        };

        let writer_task = {
            let cancel_token = cancel_token.clone();
            tokio::spawn(async move {
                Self::writer_loop(pty_writer, write_rx, cancel_token).await;
            })
        };

        Ok(Self {
            write_tx,
            output_tx,
            terminal_buffer,
            cancel_token,
            reader_task,
            writer_task,
        })
    }

    async fn spawn_zellij(backend_id: &str) -> anyhow::Result<Self> {
        let (pty, pts) = pty_process::open()?;
        let cmd = pty_process::Command::new("zellij").args(["attach", backend_id]);
        let _child = cmd.spawn(pts)?;

        let (pty_reader, pty_writer) = pty.into_split();

        let (write_tx, write_rx) = mpsc::channel(WRITE_CHANNEL_SIZE);
        let (output_tx, _) = broadcast::channel(OUTPUT_CHANNEL_SIZE);
        let terminal_buffer = Arc::new(Mutex::new(TerminalBuffer::new(24, 80)));
        let cancel_token = CancellationToken::new();

        let reader_task = {
            let terminal_buffer = Arc::clone(&terminal_buffer);
            let output_tx = output_tx.clone();
            let write_tx = write_tx.clone();
            let cancel_token = cancel_token.clone();
            tokio::spawn(async move {
                Self::reader_loop(
                    pty_reader,
                    terminal_buffer,
                    output_tx,
                    write_tx,
                    cancel_token,
                )
                .await;
            })
        };

        let writer_task = {
            let cancel_token = cancel_token.clone();
            tokio::spawn(async move {
                Self::writer_loop(pty_writer, write_rx, cancel_token).await;
            })
        };

        Ok(Self {
            write_tx,
            output_tx,
            terminal_buffer,
            cancel_token,
            reader_task,
            writer_task,
        })
    }

    fn subscribe(&self) -> broadcast::Receiver<Vec<u8>> {
        self.output_tx.subscribe()
    }

    async fn send_input(&self, data: Vec<u8>) -> anyhow::Result<()> {
        self.write_tx
            .send(WriteRequest::Bytes(data))
            .await
            .map_err(|_| anyhow::anyhow!("Console PTY write channel closed"))
    }

    async fn resize(&self, rows: u16, cols: u16) {
        let _ = self
            .write_tx
            .send(WriteRequest::Resize { rows, cols })
            .await;
        let mut buffer = self.terminal_buffer.lock().await;
        buffer.resize(rows, cols);
    }

    async fn send_signal(&self, signal: SignalType) -> anyhow::Result<()> {
        self.write_tx
            .send(WriteRequest::Signal { signal })
            .await
            .map_err(|_| anyhow::anyhow!("Console PTY write channel closed"))
    }

    async fn shutdown(&self) {
        self.cancel_token.cancel();
        self.reader_task.abort();
        self.writer_task.abort();
    }

    async fn reader_loop(
        mut reader: pty_process::OwnedReadPty,
        terminal_buffer: Arc<Mutex<TerminalBuffer>>,
        output_tx: broadcast::Sender<Vec<u8>>,
        write_tx: mpsc::Sender<WriteRequest>,
        cancel_token: CancellationToken,
    ) {
        let mut buf = vec![0u8; READ_BUFFER_SIZE];
        let mut query_parser = TerminalQueryParser::new();

        loop {
            tokio::select! {
                result = reader.read(&mut buf) => {
                    match result {
                        Ok(0) => break,
                        Ok(n) => {
                            let events = query_parser.parse(&buf[..n]);
                            let mut responses = Vec::new();
                            let mut output = Vec::new();

                            {
                                let mut buffer = terminal_buffer.lock().await;
                                for event in events {
                                    match event {
                                        TerminalEvent::Output(data) => {
                                            if !data.is_empty() {
                                                buffer.process(&data);
                                                output.extend_from_slice(&data);
                                            }
                                        }
                                        TerminalEvent::Query(query) => {
                                            let cursor = match query {
                                                TerminalQuery::CursorPosition => {
                                                    Some(buffer.screen().cursor_position())
                                                }
                                                _ => None,
                                            };
                                            responses.push(build_query_response(query, cursor));
                                        }
                                    }
                                }
                            }

                            if !output.is_empty() {
                                let _ = output_tx.send(output);
                            }

                            for response in responses {
                                if write_tx.send(WriteRequest::Bytes(response)).await.is_err() {
                                    break;
                                }
                            }
                        }
                        Err(err) => {
                            tracing::error!("Console PTY read error: {}", err);
                            break;
                        }
                    }
                }
                () = cancel_token.cancelled() => break,
            }
        }
    }

    async fn writer_loop(
        mut writer: pty_process::OwnedWritePty,
        mut write_rx: mpsc::Receiver<WriteRequest>,
        cancel_token: CancellationToken,
    ) {
        loop {
            tokio::select! {
                data = write_rx.recv() => {
                    match data {
                        Some(WriteRequest::Bytes(bytes)) => {
                            if writer.write_all(&bytes).await.is_err() {
                                break;
                            }
                        }
                        Some(WriteRequest::Resize { rows, cols }) => {
                            let size = pty_process::Size::new(rows, cols);
                            if writer.resize(size).is_err() {
                                break;
                            }
                        }
                        Some(WriteRequest::Signal { signal }) => {
                            tracing::info!(
                                signal = ?signal,
                                signal_num = signal.as_signal_number(),
                                "Sending signal to PTY"
                            );

                            // Write control character to PTY for common signals
                            let control_char = match signal {
                                SignalType::Sigint => Some(vec![0x03]),   // Ctrl+C
                                SignalType::Sigtstp => Some(vec![0x1A]),  // Ctrl+Z
                                SignalType::Sigquit => Some(vec![0x1C]),  // Ctrl+\
                                _ => None,
                            };

                            if let Some(char_bytes) = control_char {
                                if let Err(e) = writer.write_all(&char_bytes).await {
                                    tracing::error!(
                                        signal = ?signal,
                                        error = %e,
                                        "Failed to write signal control character to PTY"
                                    );
                                    break;
                                }
                                tracing::info!(
                                    signal = ?signal,
                                    "Signal control character written to PTY successfully"
                                );
                            } else {
                                tracing::warn!(
                                    signal = ?signal,
                                    "Non-control-character signal forwarding not yet implemented"
                                );
                            }
                        }
                        None => break,
                    }
                }
                () = cancel_token.cancelled() => break,
            }
        }
    }
}

#[derive(Default)]
pub struct ConsoleManager {
    sessions: Mutex<HashMap<Uuid, Arc<ConsoleSession>>>,
}

impl ConsoleManager {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    pub async fn ensure_session(
        &self,
        session_id: Uuid,
        backend: BackendType,
        backend_id: &str,
    ) -> anyhow::Result<ConsoleSessionHandle> {
        let sessions = self.sessions.lock().await;
        if let Some(existing) = sessions.get(&session_id).cloned() {
            drop(sessions);
            return Ok(ConsoleSessionHandle::new(existing));
        }
        drop(sessions);

        #[cfg(target_os = "macos")]
        let session = match backend {
            BackendType::Docker => ConsoleSession::spawn_docker(backend_id).await?,
            BackendType::Zellij => ConsoleSession::spawn_zellij(backend_id).await?,
            BackendType::Kubernetes | BackendType::AppleContainer => {
                anyhow::bail!("Console manager not supported for backend: {backend:?}")
            }
        };

        #[cfg(not(target_os = "macos"))]
        let session = match backend {
            BackendType::Docker => ConsoleSession::spawn_docker(backend_id).await?,
            BackendType::Zellij => ConsoleSession::spawn_zellij(backend_id).await?,
            BackendType::Kubernetes => {
                anyhow::bail!("Console manager not supported for backend: {backend:?}")
            }
        };

        let session = Arc::new(session);
        let mut sessions = self.sessions.lock().await;
        let entry = sessions
            .entry(session_id)
            .or_insert_with(|| Arc::clone(&session));
        let handle = ConsoleSessionHandle::new(Arc::clone(entry));
        drop(sessions);
        Ok(handle)
    }

    pub async fn remove_session(&self, session_id: Uuid) {
        let session = self.sessions.lock().await.remove(&session_id);
        if let Some(session) = session {
            session.shutdown().await;
        }
    }
}

#[derive(Clone)]
pub struct ConsoleSessionHandle {
    session: Arc<ConsoleSession>,
}

impl ConsoleSessionHandle {
    fn new(session: Arc<ConsoleSession>) -> Self {
        Self { session }
    }

    #[must_use]
    pub fn subscribe(&self) -> broadcast::Receiver<Vec<u8>> {
        self.session.subscribe()
    }

    pub async fn send_input(&self, data: Vec<u8>) -> anyhow::Result<()> {
        self.session.send_input(data).await
    }

    pub async fn resize(&self, rows: u16, cols: u16) {
        self.session.resize(rows, cols).await;
    }

    #[tracing::instrument(skip(self), fields(signal = ?signal))]
    pub async fn send_signal(&self, signal: SignalType) -> anyhow::Result<()> {
        self.session.send_signal(signal).await
    }
}
