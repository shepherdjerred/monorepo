use std::net::SocketAddr;
use std::process::ExitCode;

use charts::config::{Config, DEFAULT_STATIC_DIR, resolve_static_dir};
use charts::metrics::AppMetrics;
use charts::routes::{AppState, build_router};
use charts::smoke::run_smoke;
use charts::storage::ChartStore;
use tokio::net::TcpListener;
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> ExitCode {
    init_tracing();

    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.iter().any(|arg| arg == "--smoke") {
        let configured_static = std::env::var("CHARTS_STATIC_DIR").ok();
        let static_dir =
            resolve_static_dir(configured_static.as_deref().or(Some(DEFAULT_STATIC_DIR)));
        return match run_smoke(&static_dir).await {
            Ok(()) => {
                tracing::info!("charts smoke suite passed");
                ExitCode::SUCCESS
            }
            Err(err) => {
                tracing::error!(error = %err, "charts smoke suite failed");
                ExitCode::FAILURE
            }
        };
    }

    if let Err(err) = run_server().await {
        tracing::error!(error = %err, "charts server failed");
        return ExitCode::FAILURE;
    }

    ExitCode::SUCCESS
}

fn init_tracing() {
    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));
    let _ = tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_target(false)
        .try_init();
}

async fn run_server() -> Result<(), String> {
    let config = Config::from_env().map_err(|err| err.to_string())?;
    let store =
        ChartStore::open(&config.data_dir, config.quota_bytes).map_err(|err| err.to_string())?;
    let metrics = AppMetrics::new(config.quota_bytes);

    let bind_str = format!("{}:{}", config.host, config.port);
    let addr: SocketAddr = bind_str
        .parse()
        .map_err(|err| format!("invalid listen address '{bind_str}': {err}"))?;

    let listener = TcpListener::bind(addr)
        .await
        .map_err(|err| format!("failed binding {addr}: {err}"))?;
    let bound_addr = listener
        .local_addr()
        .map_err(|err| format!("failed querying bound address: {err}"))?;

    tracing::info!(
        listen = %bound_addr,
        data_dir = %config.data_dir.display(),
        static_dir = %config.static_dir.display(),
        basic_auth_enabled = config.basic_auth.is_some(),
        "charts registry listening"
    );

    let app = build_router(AppState {
        store,
        metrics,
        basic_auth: config.basic_auth,
        static_dir: config.static_dir,
    });

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await
        .map_err(|err| format!("http server error: {err}"))
}

async fn shutdown_signal() {
    let ctrl_c = async {
        let _ = tokio::signal::ctrl_c().await;
    };

    #[cfg(unix)]
    let terminate = async {
        if let Ok(mut sigterm) =
            tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
        {
            let _ = sigterm.recv().await;
        } else {
            std::future::pending::<()>().await;
        }
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        () = ctrl_c => {},
        () = terminate => {},
    }
    tracing::info!("shutdown signal received");
}
