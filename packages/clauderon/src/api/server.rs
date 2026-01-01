use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::{UnixListener, UnixStream};

use crate::backends::{DockerBackend, DockerProxyConfig};
use crate::core::SessionManager;
use crate::proxy::{ProxyConfig, ProxyManager};
use crate::store::SqliteStore;
use crate::utils::paths;

use super::handlers::handle_request;
use super::protocol::{Request, Response};

/// Run the clauderon daemon
///
/// # Errors
///
/// Returns an error if the database cannot be opened, the socket cannot be
/// bound, or other I/O errors occur.
pub async fn run_daemon() -> anyhow::Result<()> {
    run_daemon_with_options(true).await
}

/// Run the clauderon daemon with proxy option
///
/// # Errors
///
/// Returns an error if the database cannot be opened, the socket cannot be
/// bound, or other I/O errors occur.
pub async fn run_daemon_with_options(enable_proxy: bool) -> anyhow::Result<()> {
    // Initialize the store
    tracing::debug!("Initializing database store...");
    let db_path = paths::database_path();
    let store = Arc::new(SqliteStore::new(&db_path).await.map_err(|e| {
        tracing::error!("Failed to initialize database at {:?}: {}", db_path, e);
        e
    })?);
    tracing::debug!("Database store initialized successfully");

    // Initialize proxy services if enabled
    let proxy_manager: Option<Arc<ProxyManager>> = if enable_proxy {
        match ProxyManager::new(ProxyConfig::default()) {
            Ok(mut pm) => {
                if let Err(e) = pm.start().await {
                    tracing::error!("Failed to start proxy services: {}", e);
                    tracing::warn!("Continuing without proxy support");
                    None
                } else {
                    Some(Arc::new(pm))
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

    // Initialize the session manager with proxy support if available
    tracing::debug!("Initializing session manager...");
    let manager = if let Some(ref pm) = proxy_manager {
        let docker_proxy_config = DockerProxyConfig::new(
            pm.http_proxy_port(),
            pm.mux_dir().clone(),
        );
        let docker_backend = DockerBackend::with_proxy(docker_proxy_config);
        let mut session_manager = SessionManager::with_docker_backend(store, docker_backend)
            .await
            .map_err(|e| {
                tracing::error!("Failed to initialize session manager: {}", e);
                e
            })?;

        // Wire up proxy manager for per-session filtering
        session_manager.set_proxy_manager(Arc::clone(pm));

        Arc::new(session_manager)
    } else {
        Arc::new(SessionManager::with_defaults(store).await.map_err(|e| {
            tracing::error!("Failed to initialize session manager (no proxy): {}", e);
            e
        })?)
    };
    tracing::info!("Session manager initialized");

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

    // Start hook listener for Claude status updates
    let hook_socket_path = paths::hooks_socket_path();
    let (hook_listener, mut hook_rx) = crate::hooks::HookListener::new(hook_socket_path);

    tokio::spawn(async move {
        if let Err(e) = hook_listener.start().await {
            tracing::error!("Hook listener failed: {}", e);
        }
    });

    // Process hook messages
    let process_manager = Arc::clone(&manager);
    tokio::spawn(async move {
        use crate::core::ClaudeWorkingStatus;
        use crate::hooks::HookEvent;

        while let Some(msg) = hook_rx.recv().await {
            let new_status = match msg.event {
                HookEvent::UserPromptSubmit => ClaudeWorkingStatus::Working,
                HookEvent::PreToolUse { .. } => ClaudeWorkingStatus::Working,
                HookEvent::PermissionRequest => ClaudeWorkingStatus::WaitingApproval,
                HookEvent::Stop => ClaudeWorkingStatus::WaitingInput,
                HookEvent::IdlePrompt => ClaudeWorkingStatus::Idle,
            };

            if let Err(e) = process_manager
                .update_claude_status(msg.session_id, new_status)
                .await
            {
                tracing::error!(
                    session_id = %msg.session_id,
                    error = %e,
                    "Failed to update Claude status from hook"
                );
            }
        }
    });

    // Start CI status poller for GitHub PR checks
    let ci_poller = crate::ci::CIPoller::new(Arc::clone(&manager));
    tokio::spawn(async move {
        ci_poller.start().await;
    });

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
