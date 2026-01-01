use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::{UnixListener, UnixStream};
use uuid::Uuid;

use crate::backends::{DockerBackend, DockerProxyConfig};
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
    run_daemon_with_http(enable_proxy, Some(3030)).await
}

/// Run the multiplexer daemon with HTTP server option
///
/// # Errors
///
/// Returns an error if the database cannot be opened, the socket cannot be
/// bound, or other I/O errors occur.
pub async fn run_daemon_with_http(enable_proxy: bool, http_port: Option<u16>) -> anyhow::Result<()> {
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

    // Restore session proxies for active sessions (if proxy manager is enabled)
    if let Some(ref pm) = proxy_manager {
        tracing::info!("Restoring session proxies for active sessions...");

        // Get all sessions from database
        let sessions = manager.list_sessions().await;

        // Extract port allocations for PortAllocator restoration
        let port_allocations: Vec<(u16, Uuid)> = sessions
            .iter()
            .filter_map(|s| s.proxy_port.map(|port| (port, s.id)))
            .collect();

        // Restore port allocations in PortAllocator
        // This must succeed before we attempt to restore session proxies to avoid state inconsistency
        let port_allocation_success = if !port_allocations.is_empty() {
            match pm.port_allocator().restore_allocations(port_allocations).await {
                Ok(()) => true,
                Err(e) => {
                    tracing::error!("Failed to restore port allocations: {}", e);
                    tracing::warn!("Skipping session proxy restoration to avoid port conflicts");
                    false
                }
            }
        } else {
            true // No ports to restore, safe to proceed
        };

        // Restore session proxies only if port allocations were successful
        if port_allocation_success {
            if let Err(e) = pm.restore_session_proxies(&sessions).await {
                tracing::error!("Failed to restore session proxies: {}", e);
                tracing::warn!("Existing sessions may not have network connectivity");
            }
        }
    }

    // Spawn both Unix socket and HTTP servers concurrently
    let unix_socket_future = run_unix_socket_server(Arc::clone(&manager));

    if let Some(port) = http_port {
        let http_future = run_http_server(Arc::clone(&manager), port);

        tracing::info!("Starting daemon with Unix socket and HTTP server on port {}", port);

        tokio::select! {
            result = unix_socket_future => {
                tracing::error!("Unix socket server exited: {:?}", result);
                result
            }
            result = http_future => {
                tracing::error!("HTTP server exited: {:?}", result);
                result
            }
        }
    } else {
        tracing::info!("Starting daemon with Unix socket only");
        unix_socket_future.await
    }
}

/// Run the Unix socket server
async fn run_unix_socket_server(manager: Arc<SessionManager>) -> anyhow::Result<()> {
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

    tracing::info!(socket = %socket_path.display(), "Unix socket daemon listening");

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

/// Run the HTTP server
async fn run_http_server(manager: Arc<SessionManager>, port: u16) -> anyhow::Result<()> {
    use crate::api::http_server::create_router;
    use crate::api::protocol::Event;
    use crate::api::ws_console::ws_console_handler;
    use crate::api::ws_events::ws_events_handler;
    use tokio::sync::broadcast;

    // Create broadcast channel for session events
    // Capacity of 100 means we can buffer 100 events before oldest are dropped
    let (event_broadcaster, _) = broadcast::channel::<Event>(100);

    // Create state
    let state = crate::api::http_server::AppState {
        session_manager: Arc::clone(&manager),
        event_broadcaster,
    };

    // Create the HTTP router with all routes and state
    let app = create_router()
        .route("/ws/events", axum::routing::get(ws_events_handler))
        .route("/ws/console/:sessionId", axum::routing::get(ws_console_handler))
        .with_state(state);

    // Bind to localhost only for security - prevents remote code execution
    let addr = std::net::SocketAddr::from(([127, 0, 0, 1], port));
    let listener = tokio::net::TcpListener::bind(addr).await?;

    tracing::info!("HTTP server listening on {}", addr);

    // Start the server
    axum::serve(listener, app).await?;

    Ok(())
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
