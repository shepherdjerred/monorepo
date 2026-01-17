use std::str::FromStr;
use std::sync::Arc;

use anyhow::Context;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::{UnixListener, UnixStream};
use uuid::Uuid;

use crate::backends::{DockerBackend, DockerProxyConfig};
use crate::core::SessionManager;
use crate::proxy::{ProxyConfig, ProxyManager};
use crate::store::{SqliteStore, Store};
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
    let flags = crate::feature_flags::FeatureFlags::load(None)?;
    run_daemon_with_http(enable_proxy, Some(3030), false, flags).await
}

/// Run the clauderon daemon with HTTP server option
///
/// # Arguments
///
/// * `enable_proxy` - Whether to enable proxy services
/// * `http_port` - HTTP server port (None to disable)
/// * `dev_mode` - Whether to serve frontend from filesystem instead of embedded
///
/// # Errors
///
/// Returns an error if the database cannot be opened, the socket cannot be
/// bound, or other I/O errors occur.
pub async fn run_daemon_with_http(
    enable_proxy: bool,
    http_port: Option<u16>,
    dev_mode: bool,
    feature_flags: crate::feature_flags::FeatureFlags,
) -> anyhow::Result<()> {
    // Write daemon info for auto-restart detection
    use crate::utils::binary_info::DaemonInfo;
    if let Err(e) = DaemonInfo::current().and_then(|info| info.write()) {
        tracing::warn!(error = %e, "Failed to write daemon info");
    }

    if dev_mode {
        tracing::info!("Development mode enabled - serving frontend from filesystem");
    }

    // Initialize the store
    tracing::debug!("Initializing database store...");
    let db_path = paths::database_path();
    let sqlite_store = SqliteStore::new(&db_path).await.map_err(|e| {
        tracing::error!("Failed to initialize database at {:?}: {}", db_path, e);
        e
    })?;
    // Get pool reference before wrapping in Arc<dyn Store> (for auth handlers)
    let db_pool = sqlite_store.pool();
    let store: Arc<dyn Store> = Arc::new(sqlite_store);
    tracing::debug!("Database store initialized successfully");

    // Initialize proxy services if enabled
    let proxy_manager: Option<Arc<ProxyManager>> = if enable_proxy {
        match ProxyManager::new(ProxyConfig::default(), None) {
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

    // Initialize the session manager
    // Note: Proxy config is now provided per-session, not at backend initialization
    tracing::debug!("Initializing session manager...");
    let docker_backend = DockerBackend::new();
    let mut session_manager =
        SessionManager::with_docker_backend(Arc::clone(&store), docker_backend)
            .await
            .map_err(|e| {
                tracing::error!("Failed to initialize session manager: {}", e);
                e
            })?;

    // Wire up proxy manager for per-session filtering (if available)
    if let Some(ref pm) = proxy_manager {
        session_manager.set_proxy_manager(Arc::clone(pm));
    }

    // Create event broadcaster and wire it up if HTTP server is enabled
    if let Some(port) = http_port {
        use crate::api::protocol::Event;

        // Create broadcast channel for session events
        let (event_broadcaster, _) = tokio::sync::broadcast::channel::<Event>(100);

        // Set broadcaster on manager before Arc wrapping
        session_manager.set_event_broadcaster(event_broadcaster.clone());

        // Set HTTP port for Docker/K8s hook communication
        session_manager.set_http_port(port);

        let manager = Arc::new(session_manager);
        let console_state = Arc::new(crate::api::console_state::ConsoleState::new());
        tracing::info!("Session manager initialized with event broadcasting");

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
                match pm
                    .port_allocator()
                    .restore_allocations(port_allocations)
                    .await
                {
                    Ok(()) => true,
                    Err(e) => {
                        tracing::error!("Failed to restore port allocations: {}", e);
                        tracing::warn!(
                            "Skipping session proxy restoration to avoid port conflicts"
                        );
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
        let console_socket_future = crate::api::console_socket::run_console_socket_server(
            Arc::clone(&manager),
            Arc::clone(&console_state),
        );
        let http_future = run_http_server(
            Arc::clone(&manager),
            port,
            event_broadcaster,
            Arc::clone(&console_state),
            dev_mode,
            db_pool,
            feature_flags.clone(),
        );

        tracing::info!(
            "Starting daemon with Unix socket and HTTP server on port {}",
            port
        );

        tokio::select! {
            result = unix_socket_future => {
                tracing::error!("Unix socket server exited: {:?}", result);
                result
            }
            result = console_socket_future => {
                tracing::error!("Console socket server exited: {:?}", result);
                result
            }
            result = http_future => {
                tracing::error!("HTTP server exited: {:?}", result);
                result
            }
        }
    } else {
        let manager = Arc::new(session_manager);
        let console_state = Arc::new(crate::api::console_state::ConsoleState::new());
        tracing::info!("Session manager initialized");

        // Spawn Unix socket server only
        let unix_socket_future = run_unix_socket_server(Arc::clone(&manager));
        let console_socket_future = crate::api::console_socket::run_console_socket_server(
            Arc::clone(&manager),
            Arc::clone(&console_state),
        );
        tracing::info!("Starting daemon with Unix socket and console socket");
        tokio::select! {
            result = unix_socket_future => {
                tracing::error!("Unix socket server exited: {:?}", result);
                result
            }
            result = console_socket_future => {
                tracing::error!("Console socket server exited: {:?}", result);
                result
            }
        }
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

    // Note: Hook messages are now received via HTTP endpoint (/api/hooks)
    // for Docker/K8s backends. Zellij uses the same HTTP endpoint.

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
async fn run_http_server(
    manager: Arc<SessionManager>,
    port: u16,
    event_broadcaster: tokio::sync::broadcast::Sender<crate::api::protocol::Event>,
    console_state: Arc<crate::api::console_state::ConsoleState>,
    dev_mode: bool,
    db_pool: sqlx::SqlitePool,
    feature_flags: crate::feature_flags::FeatureFlags,
) -> anyhow::Result<()> {
    use crate::api::http_server::create_router;
    use crate::api::ws_console::ws_console_handler;
    use crate::api::ws_events::ws_events_handler;
    use crate::auth::{AuthState, SessionStore, WebAuthnHandler};

    // Read bind address from environment (default: localhost only)
    let bind_addr =
        std::env::var("CLAUDERON_BIND_ADDR").unwrap_or_else(|_| "127.0.0.1".to_string());

    // Check if auth is explicitly disabled via environment variable
    let auth_disabled = std::env::var("CLAUDERON_DISABLE_AUTH")
        .map(|v| v == "1" || v.to_lowercase() == "true")
        .unwrap_or(false);

    // Determine if authentication is required (for any non-localhost binding)
    let is_localhost = bind_addr == "127.0.0.1" || bind_addr == "localhost";
    let is_all_interfaces = bind_addr == "0.0.0.0" || bind_addr == "::";
    let requires_auth = !is_localhost && !auth_disabled;

    // Warn if auth is disabled on a non-localhost binding
    if !is_localhost && auth_disabled {
        tracing::warn!("╔══════════════════════════════════════════════════════════════════╗");
        tracing::warn!("║  WARNING: Authentication is DISABLED on external interface!     ║");
        tracing::warn!("║                                                                  ║");
        tracing::warn!("║  This allows ANYONE with network access to execute arbitrary    ║");
        tracing::warn!("║  code on this machine via Claude Code sessions.                 ║");
        tracing::warn!("║                                                                  ║");
        tracing::warn!("║  Only use CLAUDERON_DISABLE_AUTH=true in trusted networks       ║");
        tracing::warn!("║  or behind a reverse proxy with its own authentication.         ║");
        tracing::warn!("╚══════════════════════════════════════════════════════════════════╝");
    }

    // Initialize auth state if needed
    let auth_state = if requires_auth {
        // Read WebAuthn configuration from environment
        let rp_origin = std::env::var("CLAUDERON_ORIGIN").ok();

        // Validate origin is set when binding externally
        let rp_origin = match rp_origin {
            Some(origin) => origin,
            None => {
                anyhow::bail!(
                    "CLAUDERON_ORIGIN environment variable is required for non-localhost bindings\n\
                    \n\
                    WebAuthn authentication requires a valid origin URL that clients will use.\n\
                    \n\
                    Current binding: {}\n\
                    \n\
                    Example:\n\
                      CLAUDERON_ORIGIN=http://192.168.1.100:3030 clauderon daemon\n\
                    \n\
                    For HTTPS behind a reverse proxy:\n\
                      CLAUDERON_ORIGIN=https://clauderon.example.com clauderon daemon\n\
                    \n\
                    Or disable authentication (not recommended for production):\n\
                      CLAUDERON_DISABLE_AUTH=true clauderon daemon",
                    bind_addr
                );
            }
        };

        // Validate origin is a proper URL
        if !rp_origin.starts_with("http://") && !rp_origin.starts_with("https://") {
            anyhow::bail!(
                "CLAUDERON_ORIGIN must be a full URL with scheme (http:// or https://)\n\
                \n\
                Received: {}\n\
                Expected: https://{}\n\
                \n\
                Example:\n\
                  CLAUDERON_ORIGIN=https://{}:3030 clauderon daemon",
                rp_origin,
                rp_origin,
                rp_origin
            );
        }

        // Extract hostname from origin for default RP ID
        let origin_host = rp_origin
            .strip_prefix("http://")
            .or_else(|| rp_origin.strip_prefix("https://"))
            .and_then(|s| s.split(':').next())
            .and_then(|s| s.split('/').next())
            .unwrap_or("localhost");

        // RP ID defaults to origin hostname (can be overridden)
        let rp_id = std::env::var("CLAUDERON_RP_ID").unwrap_or_else(|_| origin_host.to_string());

        tracing::info!(
            "WebAuthn configured with origin: {}, RP ID: {}",
            rp_origin,
            rp_id
        );

        // Initialize WebAuthn handler
        let webauthn = WebAuthnHandler::new(&rp_origin, &rp_id).with_context(|| {
            format!(
                "Failed to initialize WebAuthn.\n\
                Origin: {}\n\
                RP ID: {}\n\
                \n\
                The RP ID must match or be a registrable suffix of the origin's hostname.",
                rp_origin, rp_id
            )
        })?;

        // Use the shared pool from SqliteStore (migrations already applied)
        let pool = db_pool.clone();

        // Create session store
        let session_store = SessionStore::new(pool.clone());

        Some(AuthState {
            pool,
            webauthn,
            session_store,
            requires_auth,
        })
    } else {
        tracing::info!("Authentication disabled");
        None
    };

    // Wrap feature flags in Arc for sharing
    let feature_flags = Arc::new(feature_flags);

    // Create state with the provided event broadcaster
    let state = crate::api::http_server::AppState {
        session_manager: Arc::clone(&manager),
        event_broadcaster,
        auth_state: auth_state.clone(),
        console_state,
        feature_flags: Arc::clone(&feature_flags),
    };

    // Create the HTTP router with all routes and state
    let app = create_router(&auth_state, dev_mode)
        .route("/ws/events", axum::routing::get(ws_events_handler))
        .route(
            "/ws/console/{sessionId}",
            axum::routing::get(ws_console_handler),
        )
        .with_state(state);

    // Determine if we need additional localhost listener for container access
    let needs_localhost_listener = !is_localhost && !is_all_interfaces;

    // Parse and bind primary address
    let primary_addr: std::net::SocketAddr = format!("{}:{}", bind_addr, port).parse()?;
    let primary_listener = tokio::net::TcpListener::bind(primary_addr).await?;

    tracing::info!(
        "HTTP server listening on {} (authentication {})",
        primary_addr,
        if requires_auth {
            "REQUIRED"
        } else {
            "not required"
        }
    );

    // Create localhost listener for container access if needed
    let localhost_listener = if needs_localhost_listener {
        let localhost_addr: std::net::SocketAddr = format!("127.0.0.1:{}", port).parse()?;
        match tokio::net::TcpListener::bind(localhost_addr).await {
            Ok(listener) => {
                tracing::info!(
                    "Additional listener on {} for container access",
                    localhost_addr
                );
                Some(listener)
            }
            Err(e) => {
                tracing::warn!("Failed to bind additional localhost listener: {}", e);
                tracing::warn!(
                    "Container hooks may not work if Docker cannot reach {}",
                    bind_addr
                );
                None
            }
        }
    } else {
        None
    };

    // Start the server (on both listeners if applicable)
    match localhost_listener {
        Some(localhost_listener) => {
            // Serve on both listeners concurrently
            tokio::try_join!(
                axum::serve(primary_listener, app.clone()),
                axum::serve(localhost_listener, app)
            )?;
        }
        None => {
            // Single listener
            axum::serve(primary_listener, app).await?;
        }
    }

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
