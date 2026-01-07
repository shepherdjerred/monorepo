use std::sync::Arc;

use base64::Engine;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::{UnixListener, UnixStream};
use uuid::Uuid;

use crate::api::console_protocol::ConsoleMessage;
use crate::api::console_state::ConsoleState;
use crate::core::SessionManager;
use crate::utils::paths;

/// Run the console Unix socket server for local TUI streaming.
pub async fn run_console_socket_server(
    manager: Arc<SessionManager>,
    console_state: Arc<ConsoleState>,
) -> anyhow::Result<()> {
    let socket_path = paths::console_socket_path();

    if socket_path.exists() {
        tokio::fs::remove_file(&socket_path).await?;
    }

    if let Some(parent) = socket_path.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }

    let listener = UnixListener::bind(&socket_path)?;
    tracing::info!(socket = %socket_path.display(), "Console socket listening");

    loop {
        match listener.accept().await {
            Ok((stream, _addr)) => {
                let manager = Arc::clone(&manager);
                let console_state = Arc::clone(&console_state);
                tokio::spawn(async move {
                    if let Err(e) = handle_console_connection(stream, manager, console_state).await
                    {
                        tracing::error!(error = %e, "Console connection error");
                    }
                });
            }
            Err(e) => {
                tracing::error!(error = %e, "Console accept error");
            }
        }
    }
}

async fn handle_console_connection(
    stream: UnixStream,
    manager: Arc<SessionManager>,
    console_state: Arc<ConsoleState>,
) -> anyhow::Result<()> {
    let client_id = Uuid::new_v4();
    let (reader, mut writer) = stream.into_split();
    let mut reader = BufReader::new(reader);
    let mut line = String::new();

    let bytes_read = reader.read_line(&mut line).await?;
    if bytes_read == 0 {
        anyhow::bail!("Console client disconnected before attach");
    }

    let attach_msg: ConsoleMessage = serde_json::from_str(line.trim())?;
    let (session_id, rows, cols) = match attach_msg {
        ConsoleMessage::Attach {
            session_id,
            rows,
            cols,
        } => (session_id, rows, cols),
        _ => {
            send_console_error(&mut writer, "Expected attach message").await?;
            anyhow::bail!("Unexpected console message");
        }
    };

    let session = manager
        .get_session(&session_id)
        .await
        .ok_or_else(|| anyhow::anyhow!("Session not found: {session_id}"))?;
    let backend_id = session
        .backend_id
        .clone()
        .ok_or_else(|| anyhow::anyhow!("Session {session_id} has no backend_id"))?;

    let console_handle = manager
        .console_manager()
        .ensure_session(session.id, session.backend, &backend_id)
        .await?;

    let is_active = console_state.register_client(&session_id, client_id).await;
    if is_active {
        console_handle.resize(rows, cols).await;
    }

    let attached = ConsoleMessage::Attached;
    let attached_payload = serde_json::to_string(&attached)?;
    writer.write_all(attached_payload.as_bytes()).await?;
    writer.write_all(b"\n").await?;

    let mut output_rx = console_handle.subscribe();
    line.clear();

    loop {
        tokio::select! {
            output = output_rx.recv() => {
                match output {
                    Ok(bytes) => {
                        let data = base64::prelude::BASE64_STANDARD.encode(&bytes);
                        let message = ConsoleMessage::Output { data };
                        let payload = serde_json::to_string(&message)?;
                        writer.write_all(payload.as_bytes()).await?;
                        writer.write_all(b"\n").await?;
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                }
            }
            read_result = reader.read_line(&mut line) => {
                let bytes_read = read_result?;
                if bytes_read == 0 {
                    break;
                }

                let message: ConsoleMessage = match serde_json::from_str(line.trim()) {
                    Ok(msg) => msg,
                    Err(e) => {
                        tracing::warn!("Invalid console message: {}", e);
                        line.clear();
                        continue;
                    }
                };
                line.clear();

                match message {
                    ConsoleMessage::Input { data } => {
                        if let Ok(bytes) = base64::prelude::BASE64_STANDARD.decode(data) {
                            console_state
                                .set_active(&session_id, client_id)
                                .await;
                            if let Err(e) = console_handle.send_input(bytes).await {
                                tracing::error!("Failed to send console input: {}", e);
                                break;
                            }
                        }
                    }
                    ConsoleMessage::Resize { rows, cols } => {
                        let is_active = console_state
                            .is_active(&session_id, client_id)
                            .await
                            || console_state
                                .set_active_if_none(&session_id, client_id)
                                .await;
                        if is_active {
                            console_handle.resize(rows, cols).await;
                        }
                    }
                    _ => {
                        tracing::debug!("Ignoring console message: {:?}", message);
                    }
                }
            }
        }
    }

    console_state
        .unregister_client(&session_id, client_id)
        .await;
    Ok(())
}

async fn send_console_error(
    writer: &mut tokio::net::unix::OwnedWriteHalf,
    message: &str,
) -> anyhow::Result<()> {
    let error = ConsoleMessage::Error {
        message: message.to_string(),
    };
    let payload = serde_json::to_string(&error)?;
    writer.write_all(payload.as_bytes()).await?;
    writer.write_all(b"\n").await?;
    Ok(())
}
