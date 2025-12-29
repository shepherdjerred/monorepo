use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::{UnixListener, UnixStream};
use tokio::sync::Mutex;

use crate::core::SessionManager;
use crate::proxy::{ProxyConfig, ProxyManager};
use crate::store::SqliteStore;
use crate::utils::paths;

use super::handlers::handle_request;
use super::protocol::{Request, Response};

/// Run the multiplexer daemon
///
/// # Errors
///
/// Returns an error if the database cannot be opened, the socket cannot be
/// bound, or other I/O errors occur.
pub async fn run_daemon() -> anyhow::Result<()> {
    run_daemon_with_options(true).await
}

/// Run the multiplexer daemon with proxy option
///
/// # Errors
///
/// Returns an error if the database cannot be opened, the socket cannot be
/// bound, or other I/O errors occur.
pub async fn run_daemon_with_options(enable_proxy: bool) -> anyhow::Result<()> {
    // Initialize the store
    let db_path = paths::database_path();
    let store = Arc::new(SqliteStore::new(&db_path).await?);

    // Initialize proxy services if enabled
    let proxy_manager: Option<Arc<Mutex<ProxyManager>>> = if enable_proxy {
        match ProxyManager::new(ProxyConfig::default()) {
            Ok(mut pm) => {
                if let Err(e) = pm.start().await {
                    tracing::error!("Failed to start proxy services: {}", e);
                    tracing::warn!("Continuing without proxy support");
                    None
                } else {
                    Some(Arc::new(Mutex::new(pm)))
                }
            }
            Err(e) => {
                tracing::error!("Failed to create proxy manager: {}", e);
                tracing::warn!("Continuing without proxy support");
                None
            }
        }
    } else {
        tracing::info!("Proxy services disabled");
        None
    };

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
        let bytes_read = reader.read_line(&mut line).await?;

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
                writer.write_all(json.as_bytes()).await?;
                writer.write_all(b"\n").await?;
                continue;
            }
        };

        // Handle the request
        let response = handle_request(request, &manager).await;

        // Send the response
        let json = serde_json::to_string(&response)?;
        writer.write_all(json.as_bytes()).await?;
        writer.write_all(b"\n").await?;
    }

    Ok(())
}
