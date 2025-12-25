use clap::{Parser, Subcommand};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

use multiplexer::{api, core, tui};

#[derive(Parser)]
#[command(name = "mux")]
#[command(about = "Session management for AI coding agents", long_about = None)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Start the multiplexer daemon
    Daemon,

    /// Launch the terminal UI
    Tui,

    /// Create a new session
    Create {
        /// Session name (a random suffix will be added)
        #[arg(short, long)]
        name: String,

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

    /// Reconcile state with reality
    Reconcile,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Initialize tracing
    tracing_subscriber::registry()
        .with(tracing_subscriber::EnvFilter::new(
            std::env::var("RUST_LOG").unwrap_or_else(|_| "multiplexer=info".into()),
        ))
        .with(tracing_subscriber::fmt::layer())
        .init();

    let cli = Cli::parse();

    match cli.command {
        Commands::Daemon => {
            tracing::info!("Starting multiplexer daemon");
            api::server::run_daemon().await?;
        }
        Commands::Tui => {
            tracing::info!("Launching TUI");
            tui::run().await?;
        }
        Commands::Create {
            name,
            repo,
            prompt,
            backend,
            dangerous_skip_checks,
        } => {
            let backend_type = match backend.to_lowercase().as_str() {
                "zellij" => core::session::BackendType::Zellij,
                "docker" => core::session::BackendType::Docker,
                _ => anyhow::bail!("Unknown backend: {}. Use 'zellij' or 'docker'", backend),
            };

            let client = api::client::Client::connect().await?;
            let session = client
                .create_session(api::protocol::CreateSessionRequest {
                    name,
                    repo_path: repo,
                    initial_prompt: prompt,
                    backend: backend_type,
                    agent: core::session::AgentType::ClaudeCode,
                    dangerous_skip_checks,
                })
                .await?;

            println!("Created session: {}", session.name);
        }
        Commands::List { archived } => {
            let client = api::client::Client::connect().await?;
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
            let client = api::client::Client::connect().await?;
            let attach_cmd = client.attach_session(&session).await?;

            // Execute the attach command, replacing our process
            let err = exec::execvp(&attach_cmd[0], &attach_cmd);
            anyhow::bail!("Failed to exec: {:?}", err);
        }
        Commands::Archive { session } => {
            let client = api::client::Client::connect().await?;
            client.archive_session(&session).await?;
            println!("Archived session: {}", session);
        }
        Commands::Delete { session, force } => {
            if !force {
                println!("Are you sure you want to delete session '{}'? (y/N)", session);
                let mut input = String::new();
                std::io::stdin().read_line(&mut input)?;
                if input.trim().to_lowercase() != "y" {
                    println!("Aborted");
                    return Ok(());
                }
            }

            let client = api::client::Client::connect().await?;
            client.delete_session(&session).await?;
            println!("Deleted session: {}", session);
        }
        Commands::Reconcile => {
            let client = api::client::Client::connect().await?;
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
    }

    Ok(())
}
