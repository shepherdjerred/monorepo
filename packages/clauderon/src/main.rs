use clap::{Parser, Subcommand};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

use clauderon::{api, core, tui, utils};

#[derive(Parser)]
#[command(name = "clauderon")]
#[command(about = "Session management for AI coding agents", long_about = None)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Start the clauderon daemon
    Daemon {
        /// Disable proxy services
        #[arg(long, default_value = "false")]
        no_proxy: bool,

        /// HTTP server port (0 to disable)
        #[arg(long, default_value = "3030")]
        http_port: u16,
    },

    /// Launch the terminal UI
    Tui,

    /// Create a new session
    Create {
        /// Path to the repository
        #[arg(short, long)]
        repo: String,

        /// Initial prompt for the AI agent
        #[arg(short, long)]
        prompt: String,

        /// Backend to use (zellij or docker)
        #[arg(short, long, default_value = "zellij")]
        backend: String,

        /// Skip safety checks (dangerous)
        #[arg(long, default_value = "false")]
        dangerous_skip_checks: bool,

        /// Run in print mode (non-interactive, outputs response and exits)
        #[arg(long, default_value = "false")]
        print: bool,

        /// Access mode (read-only or read-write)
        #[arg(long, default_value = "read-write")]
        access_mode: String,

        /// Skip plan mode (start directly in implementation mode)
        #[arg(long, default_value = "false")]
        no_plan_mode: bool,
    },

    /// List all sessions
    List {
        /// Show archived sessions
        #[arg(long)]
        archived: bool,
    },

    /// Attach to a session
    Attach {
        /// Session name or ID
        session: String,
    },

    /// Archive a session
    Archive {
        /// Session name or ID
        session: String,
    },

    /// Delete a session
    Delete {
        /// Session name or ID
        session: String,

        /// Force delete without confirmation
        #[arg(short, long)]
        force: bool,
    },

    /// Update session access mode
    SetAccessMode {
        /// Session name or ID
        session: String,

        /// Access mode (read-only or read-write)
        #[arg(long)]
        mode: String,
    },

    /// Reconcile state with reality
    Reconcile,

    /// Clean Rust compiler cache volumes (frees disk space)
    CleanCache {
        /// Force cleanup without confirmation
        #[arg(short, long)]
        force: bool,
    },
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Initialize Sentry for error reporting (guard must outlive main to flush events)
    let _sentry_guard = if clauderon::config::SENTRY_DSN.is_empty() {
        None
    } else {
        Some(sentry::init((
            clauderon::config::SENTRY_DSN,
            sentry::ClientOptions {
                release: Some(env!("CARGO_PKG_VERSION").into()),
                environment: Some(
                    if cfg!(debug_assertions) {
                        "development"
                    } else {
                        "production"
                    }
                    .into(),
                ),
                ..Default::default()
            },
        )))
    };

    // Install the ring crypto provider for rustls before any TLS operations
    // This is required because multiple dependencies enable conflicting crypto providers
    rustls::crypto::ring::default_provider()
        .install_default()
        .expect("Failed to install rustls crypto provider");

    // Ensure log directory exists
    let log_path = utils::paths::log_path();
    if let Some(log_dir) = log_path.parent() {
        std::fs::create_dir_all(log_dir)?;
    }

    // Set up file appender
    let file_appender =
        tracing_appender::rolling::daily(log_path.parent().unwrap(), log_path.file_name().unwrap());

    // Initialize tracing with both console and file output
    let env_filter = tracing_subscriber::EnvFilter::new(
        std::env::var("RUST_LOG").unwrap_or_else(|_| "clauderon=info".into()),
    );

    // Configure console output based on build type
    let console_layer = if cfg!(debug_assertions) {
        // Development: pretty formatting with more context
        tracing_subscriber::fmt::layer()
            .with_writer(std::io::stdout)
            .with_target(true)
            .with_thread_ids(true)
            .with_line_number(true)
            .with_file(false)
            .pretty()
    } else {
        // Production: compact formatting
        tracing_subscriber::fmt::layer()
            .with_writer(std::io::stdout)
            .with_target(false)
            .with_thread_ids(false)
            .with_line_number(false)
    };

    tracing_subscriber::registry()
        .with(env_filter)
        .with(console_layer)
        .with(
            tracing_subscriber::fmt::layer()
                .with_writer(file_appender)
                .with_ansi(false),
        )
        .init();

    let cli = Cli::parse();

    match cli.command {
        Commands::Daemon {
            no_proxy,
            http_port,
        } => {
            tracing::info!("Starting clauderon daemon");
            let port = if http_port > 0 { Some(http_port) } else { None };
            api::server::run_daemon_with_http(!no_proxy, port).await?;
        }
        Commands::Tui => {
            tracing::info!("Launching TUI");
            tui::run().await?;
        }
        Commands::Create {
            repo,
            prompt,
            backend,
            dangerous_skip_checks,
            print,
            access_mode,
            no_plan_mode,
        } => {
            let backend_type = match backend.to_lowercase().as_str() {
                "zellij" => core::session::BackendType::Zellij,
                "docker" => core::session::BackendType::Docker,
                _ => anyhow::bail!("Unknown backend: {backend}. Use 'zellij' or 'docker'"),
            };

            let access_mode = access_mode.parse::<core::session::AccessMode>()?;

            let mut client = api::client::Client::connect().await?;
            let (session, warnings) = client
                .create_session(api::protocol::CreateSessionRequest {
                    repo_path: repo,
                    initial_prompt: prompt,
                    backend: backend_type,
                    agent: core::session::AgentType::ClaudeCode,
                    dangerous_skip_checks,
                    print_mode: print,
                    plan_mode: !no_plan_mode,
                    access_mode,
                    images: vec![],
                })
                .await?;

            println!("Created session: {}", &session.name);

            if let Some(warnings) = warnings {
                for warning in warnings {
                    eprintln!("Warning: {warning}");
                }
            }
        }
        Commands::List { archived } => {
            let mut client = api::client::Client::connect().await?;
            let sessions = client.list_sessions().await?;

            for session in sessions {
                if archived || session.status != core::session::SessionStatus::Archived {
                    println!(
                        "{:<30} {:?} {:?}",
                        session.name, session.status, session.backend
                    );
                }
            }
        }
        Commands::Attach { session } => {
            let mut client = api::client::Client::connect().await?;
            let attach_cmd = client.attach_session(&session).await?;

            // Execute the attach command, replacing our process
            let err = exec::execvp(&attach_cmd[0], &attach_cmd);
            anyhow::bail!("Failed to exec: {err:?}");
        }
        Commands::Archive { session } => {
            let mut client = api::client::Client::connect().await?;
            client.archive_session(&session).await?;
            println!("Archived session: {session}");
        }
        Commands::Delete { session, force } => {
            if !force {
                println!("Are you sure you want to delete session '{session}'? (y/N)");
                let mut input = String::new();
                std::io::stdin().read_line(&mut input)?;
                if input.trim().to_lowercase() != "y" {
                    println!("Aborted");
                    return Ok(());
                }
            }

            let mut client = api::client::Client::connect().await?;
            client.delete_session(&session).await?;
            println!("Deleted session: {session}");
        }
        Commands::SetAccessMode { session, mode } => {
            let access_mode = mode.parse::<core::session::AccessMode>()?;
            let mut client = api::client::Client::connect().await?;
            client.update_access_mode(&session, access_mode).await?;
            println!("Updated '{session}' to {access_mode}");
        }
        Commands::Reconcile => {
            let mut client = api::client::Client::connect().await?;
            let report = client.reconcile().await?;

            if report.missing_worktrees.is_empty() && report.missing_backends.is_empty() {
                println!("All sessions are in sync");
            } else {
                if !report.missing_worktrees.is_empty() {
                    println!("Missing worktrees:");
                    for id in &report.missing_worktrees {
                        println!("  - {id}");
                    }
                }
                if !report.missing_backends.is_empty() {
                    println!("Missing backends:");
                    for id in &report.missing_backends {
                        println!("  - {id}");
                    }
                }
            }
        }
        Commands::CleanCache { force } => {
            use std::io::Write;

            if !force {
                println!("This will delete shared Rust compiler cache volumes:");
                println!("  - clauderon-cargo-registry (downloaded crates)");
                println!("  - clauderon-cargo-git (git dependencies)");
                println!("  - clauderon-sccache (compilation cache)");
                println!("\nFuture builds will redownload dependencies and recompile.");
                print!("Continue? (y/N) ");
                std::io::stdout().flush()?;

                let mut input = String::new();
                std::io::stdin().read_line(&mut input)?;
                if input.trim().to_lowercase() != "y" {
                    println!("Aborted");
                    return Ok(());
                }
            }

            for volume in [
                "clauderon-cargo-registry",
                "clauderon-cargo-git",
                "clauderon-sccache",
            ] {
                let output = tokio::process::Command::new("docker")
                    .args(["volume", "rm", volume])
                    .output()
                    .await?;

                if output.status.success() {
                    println!("Deleted volume: {volume}");
                } else {
                    let stderr = String::from_utf8_lossy(&output.stderr);
                    eprintln!("Warning: Failed to delete {volume}: {stderr}");
                }
            }

            println!("Cache cleanup complete");
        }
    }

    Ok(())
}
