use std::io::ErrorKind;
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::{UnixListener, UnixStream};

use crate::core::SessionManager;
use crate::store::SqliteStore;
use crate::utils::paths;

use super::handlers::{handle_create_session_with_progress, handle_request};
use super::protocol::{Request, Response};

/// Run the multiplexer daemon
///
/// # Errors
///
/// Returns an error if the database cannot be opened, the socket cannot be
/// bound, or other I/O errors occur.
pub async fn run_daemon() -> anyhow::Result<()> {
    // Initialize the store
    let db_path = paths::database_path();
    let store = Arc::new(SqliteStore::new(&db_path).await?);

    // Initialize the session manager
    let manager = Arc::new(SessionManager::with_defaults(store).await?);

    // Create the socket path
    let socket_path = paths::socket_path();

    // Remove existing socket if present
    if socket_path.exists() {
        tokio::fs::remove_file(&socket_path).await?;
    }

    // Ensure parent directory exists
    if let Some(parent) = socket_path.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }

    // Bind to the Unix socket
    let listener = UnixListener::bind(&socket_path)?;

    tracing::info!(socket = %socket_path.display(), "Daemon listening");

    // Accept connections
    loop {
        match listener.accept().await {
            Ok((stream, _addr)) => {
                let manager = Arc::clone(&manager);
                tokio::spawn(async move {
                    if let Err(e) = handle_connection(stream, manager).await {
                        tracing::error!(error = %e, "Connection error");
                    }
                });
            }
            Err(e) => {
                tracing::error!(error = %e, "Accept error");
            }
        }
    }
}

/// Handle a single client connection
async fn handle_connection(stream: UnixStream, manager: Arc<SessionManager>) -> anyhow::Result<()> {
    let (reader, mut writer) = stream.into_split();
    let mut reader = BufReader::new(reader);
    let mut line = String::new();

    loop {
        line.clear();
        let bytes_read = match reader.read_line(&mut line).await {
            Ok(n) => n,
            Err(e) if e.kind() == ErrorKind::BrokenPipe => {
                tracing::debug!("Client disconnected (broken pipe on read)");
                break;
            }
            Err(e) => return Err(e.into()),
        };

        if bytes_read == 0 {
            // Client disconnected
            break;
        }

        // Parse the request
        let request: Request = match serde_json::from_str(line.trim()) {
            Ok(req) => req,
            Err(e) => {
                tracing::warn!(error = %e, input = %line.trim(), "Failed to parse request");
                let response = Response::Error {
                    code: "PARSE_ERROR".to_string(),
                    message: e.to_string(),
                };
                let json = serde_json::to_string(&response)?;
                if write_response(&mut writer, &json).await.is_err() {
                    break;
                }
                continue;
            }
        };

        // Handle CreateSession specially to support progress streaming
        if let Request::CreateSession(req) = request {
            handle_create_session_with_progress(req, &manager, &mut writer).await?;
            continue;
        }

        // Handle other requests
        let response = handle_request(request, &manager).await;

        // Send the response
        let json = serde_json::to_string(&response)?;
        if write_response(&mut writer, &json).await.is_err() {
            break;
        }
    }

    Ok(())
}

/// Write a response to the client, handling broken pipe gracefully
async fn write_response(
    writer: &mut tokio::net::unix::OwnedWriteHalf,
    json: &str,
) -> Result<(), ()> {
    if let Err(e) = writer.write_all(json.as_bytes()).await {
        if e.kind() == ErrorKind::BrokenPipe {
            tracing::debug!("Client disconnected (broken pipe on write)");
        } else {
            tracing::warn!(error = %e, "Failed to write response");
        }
        return Err(());
    }
    if let Err(e) = writer.write_all(b"\n").await {
        if e.kind() == ErrorKind::BrokenPipe {
            tracing::debug!("Client disconnected (broken pipe on newline)");
        } else {
            tracing::warn!(error = %e, "Failed to write newline");
        }
        return Err(());
    }
    Ok(())
}
