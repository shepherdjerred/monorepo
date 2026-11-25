use std::net::SocketAddr;
use std::process::ExitCode;
use std::sync::Arc;

use ci_cache::config::Config;
use ci_cache::evictor::spawn_background_workers;
use ci_cache::{AppState, build_router, smoke};
use tracing_subscriber::EnvFilter;

fn init_tracing() {
    let filter =
        EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info,ci_cache=info"));
    let _ = tracing_subscriber::fmt()
        .with_env_filter(filter)
        .json()
        .try_init();
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
        () = ctrl_c => {}
        () = terminate => {}
    }
}

#[tokio::main]
async fn main() -> ExitCode {
    init_tracing();

    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.iter().any(|arg| arg == "--version" || arg == "-V") {
        println!("ci-cache {}", env!("CARGO_PKG_VERSION"));
        return ExitCode::SUCCESS;
    }
    if args.iter().any(|arg| arg == "--smoke") {
        return match smoke::run_smoke(None).await {
            Ok(()) => {
                println!("ci-cache --smoke passed");
                ExitCode::SUCCESS
            }
            Err(err) => {
                eprintln!("ci-cache --smoke failed: {err}");
                ExitCode::FAILURE
            }
        };
    }

    let config = match Config::from_env() {
        Ok(cfg) => cfg,
        Err(err) => {
            tracing::error!(error = %err, "invalid configuration");
            return ExitCode::FAILURE;
        }
    };

    let bind_addr = SocketAddr::new(config.host, config.port);
    let state = match AppState::new(config) {
        Ok(st) => Arc::new(st),
        Err(err) => {
            tracing::error!(error = %err, "failed to initialize cache store");
            return ExitCode::FAILURE;
        }
    };

    let (shutdown_tx, shutdown_rx) = tokio::sync::watch::channel(false);
    let (flush_handle, evict_handle) = spawn_background_workers(Arc::clone(&state), shutdown_rx);
    let router = build_router(Arc::clone(&state));

    let listener = match tokio::net::TcpListener::bind(bind_addr).await {
        Ok(l) => l,
        Err(err) => {
            tracing::error!(error = %err, %bind_addr, "failed to bind TCP listener");
            let _ = shutdown_tx.send(true);
            let _ = flush_handle.await;
            let _ = evict_handle.await;
            return ExitCode::FAILURE;
        }
    };

    tracing::info!(
        %bind_addr,
        data_dir = %state.config.data_dir.display(),
        static_dir = %state.config.static_dir.display(),
        "ci-cache listening"
    );

    let (drain_tx, mut drain_rx) = tokio::sync::watch::channel(false);
    let serve_task = tokio::spawn(async move {
        axum::serve(listener, router)
            .with_graceful_shutdown(async move {
                shutdown_signal().await;
                tracing::info!("shutdown signal received; draining connections and flushing index");
                let _ = shutdown_tx.send(true);
                let _ = drain_tx.send(true);
            })
            .await
    });

    let _ = drain_rx.changed().await;
    let serve_res = match tokio::time::timeout(std::time::Duration::from_secs(10), serve_task).await
    {
        Ok(Ok(res)) => res,
        Ok(Err(join_err)) => Err(std::io::Error::other(join_err.to_string())),
        Err(_) => Ok(()),
    };
    let _ = flush_handle.await;
    let _ = evict_handle.await;

    if let Err(err) = serve_res {
        tracing::error!(error = %err, "server exited with error");
        return ExitCode::FAILURE;
    }

    ExitCode::SUCCESS
}
