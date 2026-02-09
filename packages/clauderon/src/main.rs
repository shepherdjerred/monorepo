use clap::{Parser, Subcommand};
use tracing_subscriber::{Layer, layer::SubscriberExt, util::SubscriberInitExt};

use clauderon::{api, core, tui, utils};

#[derive(Parser)]
#[command(name = "clauderon")]
#[command(version)]
#[command(about = "Session management for AI coding agents")]
#[command(long_about = "\
clauderon manages isolated sessions for AI coding agents like Claude Code.

It provides:
  - Session lifecycle management (create, list, attach, archive, delete)
  - Multiple backends (Zellij terminal multiplexer, Docker containers)
  - Credential proxy for secure API access
  - Real-time session monitoring via TUI or web UI

The daemon runs in the background and handles all session operations.
Sessions run in isolated git worktrees to prevent conflicts.")]
#[command(after_long_help = "\
QUICK START:
    clauderon create --repo ~/project --prompt 'Implement feature X'
    clauderon list
    clauderon attach <session-name>

ENVIRONMENT VARIABLES:
    RUST_LOG                    Log level filter (default: clauderon=info)
    VISUAL, EDITOR              Preferred editor for prompts
    CLAUDERON_BIND_ADDR         HTTP server bind address (default: 127.0.0.1)
                                Specific IPs auto-add 127.0.0.1 listener for Docker
    CLAUDERON_ORIGIN            WebAuthn origin URL (required for non-localhost bindings)
                                Example: http://192.168.1.100:3030
    CLAUDERON_RP_ID             WebAuthn RP ID (default: hostname from ORIGIN)

    Credentials (env var or file in ~/.clauderon/secrets/):
        GITHUB_TOKEN            GitHub API token
        CLAUDE_CODE_OAUTH_TOKEN Anthropic OAuth token
        OPENAI_API_KEY          OpenAI API key
        CODEX_API_KEY           Codex API key (alias of OPENAI_API_KEY)
        PAGERDUTY_TOKEN         PagerDuty API token (or PAGERDUTY_API_KEY)
        SENTRY_AUTH_TOKEN       Sentry authentication token
        GRAFANA_API_KEY         Grafana API key
        NPM_TOKEN               npm registry token
        DOCKER_TOKEN            Docker registry token
        K8S_TOKEN               Kubernetes token
        TALOS_TOKEN             Talos OS token
    Codex auth (env var or ~/.codex/auth.json):
        CODEX_ACCESS_TOKEN      Codex access token
        CODEX_REFRESH_TOKEN     Codex refresh token
        CODEX_ID_TOKEN          Codex ID token
        CODEX_ACCOUNT_ID        ChatGPT account ID (optional)
        CODEX_AUTH_JSON_PATH    Override ~/.codex/auth.json path

FILE LOCATIONS:
    ~/.clauderon/               Base directory for all data
    ~/.clauderon/db.sqlite      Session database (SQLite)
    ~/.clauderon/clauderon.sock Unix socket for daemon IPC
    ~/.clauderon/hooks.sock     Unix socket for hook communication
    ~/.clauderon/worktrees/     Git worktrees for sessions
    ~/.clauderon/logs/          Log files (daily rotation)
    ~/.clauderon/config.toml    Main configuration file
    ~/.clauderon/proxy.toml     Proxy service configuration
    ~/.clauderon/audit.jsonl    HTTP proxy audit log
    ~/.clauderon/secrets/       Credential files directory

PROXY CONFIGURATION (~/.clauderon/proxy.toml):
    secrets_dir                 Credential files directory (default: ~/.clauderon/secrets)
    talos_gateway_port          Talos mTLS gateway port (default: 18082)
    audit_enabled               Enable audit logging (default: true)
    audit_log_path              Audit log file path
    codex_auth_json_path        Path to host Codex auth.json (default: ~/.codex/auth.json)

Use 'clauderon <command> --help' for command-specific information.
Use 'clauderon config' to inspect current configuration and paths.")]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Start the clauderon daemon
    ///
    /// The daemon manages all session operations and runs in the background.
    /// It is automatically spawned when needed, but can be started manually.
    #[command(after_help = "\
EXAMPLES:
    # Start daemon with defaults (proxy enabled, HTTP on port 3030)
    clauderon daemon

    # Start daemon without proxy services
    clauderon daemon --no-proxy

    # Start daemon with HTTP server disabled
    clauderon daemon --http-port 0

    # Start daemon on custom HTTP port
    clauderon daemon --http-port 8080

    # Bind to all interfaces (requires CLAUDERON_ORIGIN for auth)
    CLAUDERON_ORIGIN=http://myhost.local:3030 CLAUDERON_BIND_ADDR=0.0.0.0 clauderon daemon

    # Bind to specific IP (auto-adds 127.0.0.1 for Docker)
    CLAUDERON_ORIGIN=http://myhost.local:3030 CLAUDERON_BIND_ADDR=100.64.1.1 clauderon daemon

ENVIRONMENT:
    CLAUDERON_BIND_ADDR   Bind address (default: 127.0.0.1)
                          Specific IPs automatically add 127.0.0.1 listener for Docker
    CLAUDERON_ORIGIN      WebAuthn origin URL (required for non-localhost bindings)
    CLAUDERON_RP_ID       WebAuthn RP ID (default: hostname from ORIGIN)
    CLAUDERON_LOG_FORMAT  Log format: 'text' (default) or 'json' for structured logs")]
    Daemon {
        /// Disable proxy services (credential injection, TLS interception)
        #[arg(long, default_value = "false")]
        no_proxy: bool,

        /// HTTP server port for web UI and API (0 to disable)
        #[arg(long, default_value = "3030")]
        http_port: u16,

        /// Enable development mode (serve frontend from filesystem instead of embedded)
        ///
        /// Can also be enabled via CLAUDERON_DEV=1 environment variable.
        #[arg(long, default_value = "false")]
        dev: bool,

        // Server Settings
        /// HTTP server bind address (default: 127.0.0.1)
        ///
        /// Use 0.0.0.0 to bind to all interfaces.
        /// Specific IPs auto-add 127.0.0.1 listener for Docker container access.
        #[arg(long, env = "CLAUDERON_BIND_ADDR", help_heading = "Server Settings")]
        bind_addr: Option<String>,

        /// WebAuthn origin URL for authentication
        ///
        /// Required when binding to non-localhost addresses.
        /// Example: http://192.168.1.100:3030 or https://clauderon.example.com
        #[arg(long, env = "CLAUDERON_ORIGIN", help_heading = "Server Settings")]
        origin: Option<String>,

        /// Disable authentication (dangerous for non-localhost bindings)
        ///
        /// Only use in trusted networks or behind a reverse proxy with its own auth.
        #[arg(long, env = "CLAUDERON_DISABLE_AUTH", help_heading = "Server Settings")]
        disable_auth: bool,

        /// Anthropic organization ID for Claude API usage tracking
        ///
        /// Falls back to ANTHROPIC_ORG_ID if not set.
        #[arg(
            long,
            env = "CLAUDE_ORG_ID",
            visible_alias = "anthropic-org-id",
            help_heading = "Server Settings"
        )]
        org_id: Option<String>,

        // Feature Flags
        /// [default: false] Enable WebAuthn passwordless authentication for the web UI.
        /// Allows passkey-based login instead of session tokens.
        /// Env: CLAUDERON_FEATURE_ENABLE_WEBAUTHN_AUTH
        #[arg(long, help_heading = "Feature Flags")]
        enable_webauthn_auth: Option<bool>,

        /// [default: true] Enable AI-powered session metadata generation.
        /// Uses Claude to generate descriptive session titles from prompts.
        /// Env: CLAUDERON_FEATURE_ENABLE_AI_METADATA
        #[arg(long, help_heading = "Feature Flags")]
        enable_ai_metadata: Option<bool>,

        /// [default: true] Enable automatic session reconciliation on startup.
        /// Syncs database state with actual backend resources (containers, pods, etc).
        /// Env: CLAUDERON_FEATURE_ENABLE_AUTO_RECONCILE
        #[arg(long, help_heading = "Feature Flags")]
        enable_auto_reconcile: Option<bool>,

        /// [default: false] Enable proxy port reuse across sessions (experimental).
        /// Reduces port allocation but may cause conflicts.
        /// Env: CLAUDERON_FEATURE_ENABLE_PROXY_PORT_REUSE
        #[arg(long, help_heading = "Feature Flags")]
        enable_proxy_port_reuse: Option<bool>,

        /// [default: false] Enable Claude API usage tracking.
        /// Records token usage and costs per session.
        /// Env: CLAUDERON_FEATURE_ENABLE_USAGE_TRACKING
        #[arg(long, help_heading = "Feature Flags")]
        enable_usage_tracking: Option<bool>,

        /// [default: false] Enable Kubernetes backend (experimental).
        /// Allows running sessions as pods in a K8s cluster.
        /// Requires: kubectl configured, namespace created, storage class available.
        /// Env: CLAUDERON_FEATURE_ENABLE_KUBERNETES_BACKEND
        #[arg(long, help_heading = "Feature Flags")]
        enable_kubernetes_backend: Option<bool>,

        /// [default: false] Enable experimental AI models (Codex, Gemini).
        /// Env: CLAUDERON_FEATURE_ENABLE_EXPERIMENTAL_MODELS
        #[arg(long, help_heading = "Feature Flags")]
        enable_experimental_models: Option<bool>,

        /// [default: false] Enable read-only mode (experimental, security issues #424, #205).
        /// Env: CLAUDERON_FEATURE_ENABLE_READONLY_MODE
        #[arg(long, help_heading = "Feature Flags")]
        enable_readonly_mode: Option<bool>,
    },

    /// Launch the terminal UI
    ///
    /// Interactive terminal interface for managing sessions.
    /// Provides real-time session status, creation, and attachment.
    #[command(after_help = "\
EXAMPLES:
    # Launch the TUI
    clauderon tui

KEYBOARD SHORTCUTS:
    q           Quit
    j/k         Navigate up/down
    Enter       Attach to selected session
    n           Create new session
    a           Archive selected session
    d           Delete selected session")]
    Tui,

    /// Create a new session
    ///
    /// Creates an isolated git worktree and launches an AI coding agent.
    /// The session runs in the specified backend with proxy credential injection.
    #[command(after_help = "\
EXAMPLES:
    # Create a basic session
    clauderon create --repo ~/myproject --prompt 'Fix the login bug'

    # Create with Docker backend for stronger isolation
    clauderon create --repo ~/myproject --prompt 'Add tests' --backend docker

    # Create in read-only mode (safer for exploration tasks)
    clauderon create --repo ~/myproject --prompt 'Explain this code' --access-mode read-only

    # Skip plan mode for quick tasks
    clauderon create --repo ~/myproject --prompt 'Fix typo in README' --no-plan-mode

    # Non-interactive mode (for scripts)
    clauderon create --repo ~/myproject --prompt 'Generate docs' --print

ACCESS MODES:
    read-only   Only GET/HEAD/OPTIONS requests allowed (safe for exploration)
    read-write  All HTTP methods allowed (required for commits, PRs)

BACKENDS:
    zellij      Terminal multiplexer (default, fastest startup)
    docker      Container-based (stronger isolation, reproducible)")]
    Create {
        /// Path to the git repository
        #[arg(short, long)]
        repo: String,

        /// Initial prompt for the AI agent
        #[arg(short, long)]
        prompt: String,

        /// Backend to use: 'zellij' (default) or 'docker'
        #[arg(short, long, default_value = "zellij", value_parser = ["zellij", "docker"])]
        backend: String,

        /// Agent to use (claude, codex, or gemini)
        #[arg(short, long, default_value = "claude")]
        agent: String,

        /// Skip safety checks (dangerous - bypasses dirty repo checks)
        #[arg(long, default_value = "false")]
        dangerous_skip_checks: bool,

        /// Copy real credentials to remote backends (dangerous)
        ///
        /// For remote backends (Sprites, Kubernetes): injects real API tokens.
        /// WARNING: This exposes your tokens to the remote environment.
        /// Only use when daemon_address is not configured.
        #[arg(long, default_value = "false")]
        dangerous_copy_creds: bool,

        /// Non-interactive print mode (outputs response and exits)
        #[arg(long, default_value = "false")]
        print: bool,

        /// Access mode: 'read-only' or 'read-write' (default)
        #[arg(long, default_value = "read-write", value_parser = ["read-only", "read-write"])]
        access_mode: String,

        /// Skip plan mode (start directly in implementation mode)
        #[arg(long, default_value = "false")]
        no_plan_mode: bool,

        /// Custom container image (overrides backend default)
        ///
        /// Format: [registry/]repository[:tag]
        /// Example: ghcr.io/user/custom-dev:latest
        ///
        /// Image must include: claude/codex CLI, bash, curl, git (recommended)
        /// See docs/IMAGE_COMPATIBILITY.md for full requirements
        #[arg(
            long,
            help = "Custom container image (e.g., ghcr.io/user/image:tag)\nRequires: claude/codex CLI, bash, curl, git\nSee docs/IMAGE_COMPATIBILITY.md"
        )]
        image: Option<String>,

        /// Image pull policy: always, if-not-present (default), never
        #[arg(long, value_parser = ["always", "if-not-present", "never"])]
        pull_policy: Option<String>,

        /// CPU limit (e.g., "2.0" for 2 cores, "500m" for 0.5 cores)
        #[arg(long)]
        cpu_limit: Option<String>,

        /// Memory limit (e.g., "2g" for 2 gigabytes, "512m" for 512 megabytes)
        #[arg(long)]
        memory_limit: Option<String>,
    },

    /// List all sessions
    ///
    /// Shows session names, status, and backend type.
    #[command(after_help = "\
EXAMPLES:
    # List active sessions
    clauderon list

    # Include archived sessions
    clauderon list --archived

OUTPUT COLUMNS:
    Name        Session name (also used for attachment)
    Status      Creating, Running, Idle, Completed, Failed, Archived
    Backend     Zellij or Docker")]
    List {
        /// Include archived sessions in the list
        #[arg(long)]
        archived: bool,
    },

    /// Attach to a session
    ///
    /// Connects to an existing session's terminal.
    /// Uses exec to replace the current process.
    #[command(after_help = "\
EXAMPLES:
    # Attach by session name
    clauderon attach my-feature-branch

    # Attach by session ID (UUID)
    clauderon attach 550e8400-e29b-41d4-a716-446655440000")]
    Attach {
        /// Session name or UUID
        session: String,
    },

    /// Archive a session
    ///
    /// Marks a session as archived without deleting it.
    /// Archived sessions don't appear in normal listings.
    #[command(after_help = "\
EXAMPLES:
    clauderon archive my-completed-feature")]
    Archive {
        /// Session name or UUID
        session: String,
    },

    /// Refresh a session (pull latest image and recreate container)
    ///
    /// Recreates the container from scratch to apply plugin changes or pull image updates.
    #[command(after_help = "\
EXAMPLES:
    # Refresh a session by name
    clauderon refresh my-session

    # Refresh a session by UUID
    clauderon refresh 550e8400-e29b-41d4-a716-446655440000

USE CASES:
    - Apply changes to Claude Code plugins
    - Pull latest Docker image with bug fixes
    - Fix containers stuck in bad state

NOTES:
    - Only works with Docker backend sessions
    - Session UUID and history are preserved
    - All configuration is maintained")]
    Refresh {
        /// Session name or UUID
        session: String,
    },

    /// Delete a session
    ///
    /// Permanently removes a session, its worktree, and backend resources.
    /// Prompts for confirmation unless --force is specified.
    #[command(after_help = "\
EXAMPLES:
    # Delete with confirmation prompt
    clauderon delete my-old-session

    # Delete without confirmation (for scripts)
    clauderon delete my-old-session --force")]
    Delete {
        /// Session name or UUID
        session: String,

        /// Skip confirmation prompt
        #[arg(short, long)]
        force: bool,
    },

    /// Update session access mode
    ///
    /// Changes the HTTP proxy filtering mode for a session.
    #[command(after_help = "\
EXAMPLES:
    # Switch to read-only mode (safer)
    clauderon set-access-mode my-session --mode read-only

    # Switch to read-write mode (allows commits, PRs)
    clauderon set-access-mode my-session --mode read-write")]
    SetAccessMode {
        /// Session name or UUID
        session: String,

        /// Access mode: 'read-only' or 'read-write'
        #[arg(long, value_parser = ["read-only", "read-write"])]
        mode: String,
    },

    /// Reconcile database state with actual backends
    ///
    /// Checks for orphaned worktrees or missing backend processes
    /// and cleans up stale database entries.
    #[command(after_help = "\
EXAMPLES:
    clauderon reconcile

USE CASES:
    - After system crash or unclean shutdown
    - When sessions appear stuck in 'Creating' or 'Deleting'
    - To clean up after manual backend termination")]
    Reconcile,

    /// Clean Rust compiler cache volumes (frees disk space)
    ///
    /// Removes Docker volumes used for shared Rust compilation caches.
    /// Future builds will need to redownload dependencies.
    #[command(after_help = "\
EXAMPLES:
    # Clean with confirmation prompt
    clauderon clean-cache

    # Clean without confirmation (for scripts)
    clauderon clean-cache --force

VOLUMES REMOVED:
    clauderon-cargo-registry    Downloaded crates (~/.cargo/registry)
    clauderon-cargo-git         Git dependencies
    clauderon-sccache           Shared compilation cache")]
    CleanCache {
        /// Skip confirmation prompt
        #[arg(short, long)]
        force: bool,
    },

    /// Show configuration, paths, and environment info
    ///
    /// Inspect current runtime configuration and credential status.
    #[command(subcommand)]
    Config(ConfigCommands),
}

#[derive(Subcommand)]
enum ConfigCommands {
    /// Show all configuration and file paths
    ///
    /// Displays current configuration values, file locations,
    /// and their existence status.
    #[command(after_help = "\
EXAMPLES:
    clauderon config show")]
    Show,

    /// Show all file paths used by clauderon
    ///
    /// Lists every file and directory path with existence status.
    #[command(after_help = "\
EXAMPLES:
    clauderon config paths")]
    Paths,

    /// Show all environment variables
    ///
    /// Lists recognized environment variables and their current values.
    #[command(after_help = "\
EXAMPLES:
    clauderon config env")]
    Env,

    /// Show credential status
    ///
    /// Lists all credentials with their source (env var, file, or missing).
    #[command(after_help = "\
EXAMPLES:
    clauderon config credentials")]
    Credentials,
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

    // Parse CLI first to determine if this is a daemon command
    let cli = Cli::parse();

    // Check if this is the daemon command - only daemon gets full logging infrastructure
    let is_daemon = matches!(cli.command, Commands::Daemon { .. });

    if is_daemon {
        // Set up full daemon logging infrastructure
        initialize_daemon_logging()?;
    } else {
        // Set up simple console-only logging for CLI commands
        initialize_cli_logging();
    }

    match cli.command {
        Commands::Daemon {
            no_proxy,
            http_port,
            dev,
            bind_addr,
            origin,
            disable_auth,
            org_id,
            enable_webauthn_auth,
            enable_ai_metadata,
            enable_auto_reconcile,
            enable_proxy_port_reuse,
            enable_usage_tracking,
            enable_kubernetes_backend,
            enable_experimental_models,
            enable_readonly_mode,
        } => {
            // Build CLI feature flag overrides
            let cli_flags = clauderon::feature_flags::CliFeatureFlags {
                enable_webauthn_auth,
                enable_ai_metadata,
                enable_auto_reconcile,
                enable_proxy_port_reuse,
                enable_usage_tracking,
                enable_kubernetes_backend,
                enable_experimental_models,
                enable_readonly_mode,
            };

            // Build CLI server config overrides
            let cli_server = clauderon::feature_flags::CliServerConfig {
                bind_addr,
                origin,
                disable_auth: if disable_auth { Some(true) } else { None },
                org_id,
            };

            // Load feature flags with priority: CLI → env → TOML → defaults
            let flags = clauderon::feature_flags::FeatureFlags::load(Some(cli_flags))?;
            flags.log_state();

            // Load server config with priority: CLI (incl. env via clap) → TOML → defaults
            let server_config = clauderon::feature_flags::ServerConfig::load(&cli_server)?;
            server_config.log_state();

            let port = if http_port > 0 { Some(http_port) } else { None };
            let dev_mode = dev || std::env::var("CLAUDERON_DEV").is_ok();
            api::server::run_daemon_with_http(!no_proxy, port, dev_mode, flags, server_config)
                .await?;
        }
        Commands::Tui => {
            tui::run().await?;
        }
        Commands::Create {
            repo,
            prompt,
            backend,
            agent,
            dangerous_skip_checks,
            dangerous_copy_creds,
            print,
            access_mode,
            no_plan_mode,
            image,
            pull_policy,
            cpu_limit,
            memory_limit,
        } => {
            let backend_type = match backend.to_lowercase().as_str() {
                "zellij" => core::session::BackendType::Zellij,
                "docker" => core::session::BackendType::Docker,
                "kubernetes" | "k8s" => core::session::BackendType::Kubernetes,
                "sprites" => core::session::BackendType::Sprites,
                #[cfg(target_os = "macos")]
                "apple" | "apple-container" => core::session::BackendType::AppleContainer,
                _ => anyhow::bail!(
                    "Unknown backend: {backend}. Use 'zellij', 'docker', 'kubernetes', 'sprites'{}",
                    if cfg!(target_os = "macos") {
                        ", or 'apple'"
                    } else {
                        ""
                    }
                ),
            };

            let agent_type = match agent.to_lowercase().as_str() {
                "claude" | "claude-code" | "claude_code" => core::session::AgentType::ClaudeCode,
                "codex" => core::session::AgentType::Codex,
                "gemini" => core::session::AgentType::Gemini,
                _ => anyhow::bail!("Unknown agent: {agent}. Use 'claude', 'codex', or 'gemini'"),
            };

            let access_mode = access_mode.parse::<core::session::AccessMode>()?;

            // Validate read-only mode is enabled if requested
            if access_mode == core::session::AccessMode::ReadOnly {
                let flags = clauderon::feature_flags::FeatureFlags::load(None)?;
                if !flags.enable_readonly_mode {
                    anyhow::bail!(
                        "Read-only mode is not available. Enable with --enable-readonly-mode or CLAUDERON_FEATURE_ENABLE_READONLY_MODE=true"
                    );
                }
            }

            let mut client = api::client::Client::connect().await?;
            let (session, warnings) = client
                .create_session(api::protocol::CreateSessionRequest {
                    repo_path: repo,
                    repositories: None,
                    initial_prompt: prompt,
                    backend: backend_type,
                    agent: agent_type,
                    model: None, // CLI doesn't support model selection yet
                    dangerous_skip_checks,
                    dangerous_copy_creds,
                    print_mode: print,
                    plan_mode: !no_plan_mode,
                    access_mode,
                    images: vec![],
                    container_image: image,
                    pull_policy,
                    cpu_limit,
                    memory_limit,
                    storage_class: None,
                })
                .await?;

            println!("Created session: {name}", name = &session.name);

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
        Commands::Refresh { session } => {
            let mut client = api::client::Client::connect().await?;

            println!("Refreshing session '{session}'...");
            println!("This will pull the latest image and recreate the container.");

            client.refresh_session(&session).await?;
            println!("Successfully refreshed session: {session}");
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

            // Validate read-only mode is enabled if requested
            if access_mode == core::session::AccessMode::ReadOnly {
                let flags = clauderon::feature_flags::FeatureFlags::load(None)?;
                if !flags.enable_readonly_mode {
                    anyhow::bail!(
                        "Read-only mode is not available. Enable with --enable-readonly-mode or CLAUDERON_FEATURE_ENABLE_READONLY_MODE=true"
                    );
                }
            }

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
        Commands::Config(config_cmd) => {
            handle_config_command(&config_cmd);
        }
    }

    Ok(())
}

/// Initialize simple console-only logging for CLI commands.
///
/// This is used for non-daemon commands that don't need file logging.
fn initialize_cli_logging() {
    let env_filter = tracing_subscriber::EnvFilter::new(
        std::env::var("RUST_LOG").unwrap_or_else(|_| "clauderon=warn".into()),
    );

    tracing_subscriber::registry()
        .with(
            tracing_subscriber::fmt::layer()
                .with_writer(std::io::stderr)
                .with_filter(env_filter),
        )
        .init();
}

/// Initialize full daemon logging infrastructure.
///
/// Sets up:
/// - Timestamped log files (info, debug, error levels)
/// - Symlinks to latest log files
/// - Automatic cleanup of old logs (>7 days)
/// - Startup banner
/// - Optional JSON format via CLAUDERON_LOG_FORMAT=json
fn initialize_daemon_logging() -> anyhow::Result<()> {
    // Ensure log directory exists
    let logs_dir = utils::paths::logs_dir();
    std::fs::create_dir_all(&logs_dir)?;

    // Clean up old log files (older than 7 days) - do this before logging is initialized
    let cleanup_result = utils::log_cleanup::cleanup_old_logs(&logs_dir, None);

    // Generate timestamped log filenames for this daemon instance
    let timestamp = chrono::Local::now().format("%Y-%m-%dT%H-%M-%S");
    let log_filename = format!("clauderon.{timestamp}.log");
    let debug_log_filename = format!("clauderon.{timestamp}.debug.log");
    let error_log_filename = format!("clauderon.{timestamp}.error.log");

    // Set up file appenders (new files per daemon start)
    let file_appender = tracing_appender::rolling::never(&logs_dir, &log_filename);
    let debug_file_appender = tracing_appender::rolling::never(&logs_dir, &debug_log_filename);
    let error_file_appender = tracing_appender::rolling::never(&logs_dir, &error_log_filename);

    // Create/update symlinks to latest logs
    #[cfg(unix)]
    {
        use std::os::unix::fs::symlink;
        let _ = std::fs::remove_file(logs_dir.join("latest.log"));
        let _ = std::fs::remove_file(logs_dir.join("latest.debug.log"));
        let _ = std::fs::remove_file(logs_dir.join("latest.error.log"));
        let _ = symlink(&log_filename, logs_dir.join("latest.log"));
        let _ = symlink(&debug_log_filename, logs_dir.join("latest.debug.log"));
        let _ = symlink(&error_log_filename, logs_dir.join("latest.error.log"));
    }

    // Check if JSON format is requested
    let json_format = std::env::var("CLAUDERON_LOG_FORMAT")
        .map(|v| v.to_lowercase() == "json")
        .unwrap_or(false);

    // Get the RUST_LOG value once to avoid duplicate reads
    let rust_log_value = std::env::var("RUST_LOG").unwrap_or_else(|_| "clauderon=info".into());

    // Initialize tracing with console, normal file, debug file, and error file output
    let console_filter = tracing_subscriber::EnvFilter::new(&rust_log_value);
    let file_filter = tracing_subscriber::EnvFilter::new(&rust_log_value);
    let debug_filter = tracing_subscriber::EnvFilter::new("clauderon=debug");
    let error_filter = tracing_subscriber::EnvFilter::new("clauderon=warn");

    // Configure console output with structured logging
    let console_layer = tracing_subscriber::fmt::layer()
        .with_writer(std::io::stdout)
        .with_target(cfg!(debug_assertions))
        .with_thread_ids(cfg!(debug_assertions))
        .with_line_number(cfg!(debug_assertions));

    // Build the subscriber with conditional JSON formatting
    if json_format {
        tracing_subscriber::registry()
            .with(console_layer.with_filter(console_filter))
            .with(
                tracing_subscriber::fmt::layer()
                    .json()
                    .with_writer(file_appender)
                    .with_filter(file_filter),
            )
            .with(
                tracing_subscriber::fmt::layer()
                    .json()
                    .with_writer(debug_file_appender)
                    .with_filter(debug_filter),
            )
            .with(
                tracing_subscriber::fmt::layer()
                    .json()
                    .with_writer(error_file_appender)
                    .with_filter(error_filter),
            )
            .init();
    } else {
        tracing_subscriber::registry()
            .with(console_layer.with_filter(console_filter))
            .with(
                tracing_subscriber::fmt::layer()
                    .with_writer(file_appender)
                    .with_ansi(false)
                    .with_filter(file_filter),
            )
            .with(
                tracing_subscriber::fmt::layer()
                    .with_writer(debug_file_appender)
                    .with_ansi(false)
                    .with_filter(debug_filter),
            )
            .with(
                tracing_subscriber::fmt::layer()
                    .with_writer(error_file_appender)
                    .with_ansi(false)
                    .with_filter(error_filter),
            )
            .init();
    }

    // Log startup banner
    tracing::info!("========================================");
    tracing::info!("     clauderon daemon v{}     ", env!("CARGO_PKG_VERSION"));
    tracing::info!("========================================");
    tracing::info!("PID: {}", std::process::id());
    tracing::info!("Log directory: {}", logs_dir.display());
    tracing::info!("  Info log: {}", log_filename);
    tracing::info!("  Debug log: {}", debug_log_filename);
    tracing::info!("  Error log: {}", error_log_filename);
    if json_format {
        tracing::info!("  Format: JSON");
    }
    tracing::info!("Log level: {}", rust_log_value);

    // Log the cleanup result
    match cleanup_result {
        Ok(result) => {
            if result.removed > 0 {
                tracing::info!("Cleaned up {} old log files", result.removed);
            }
            for file in &result.failed {
                tracing::warn!("Failed to remove old log file: {}", file);
            }
        }
        Err(e) => tracing::warn!("Failed to clean up old logs: {}", e),
    }

    Ok(())
}

fn handle_config_command(cmd: &ConfigCommands) {
    match cmd {
        ConfigCommands::Show => {
            println!("clauderon configuration\n");

            // Version info
            println!("VERSION:");
            println!("    {}", env!("CARGO_PKG_VERSION"));
            println!();

            // File paths
            println!("FILE PATHS:");
            print_path("Base directory", &utils::paths::base_dir());
            print_path("Database", &utils::paths::database_path());
            print_path("Unix socket", &utils::paths::socket_path());
            print_path("Worktrees directory", &utils::paths::worktrees_dir());
            print_path("Log file", &utils::paths::log_path());
            print_path("Config file", &utils::paths::config_path());

            let home = dirs::home_dir().unwrap_or_default();
            print_path("Proxy config", &home.join(".clauderon/proxy.toml"));
            print_path("Audit log", &home.join(".clauderon/audit.jsonl"));
            print_path("Secrets directory", &home.join(".clauderon/secrets"));
            print_path("Codex auth.json", &codex_auth_json_path());
            println!();

            // Key environment variables
            println!("ENVIRONMENT:");
            print_env("RUST_LOG", Some("clauderon=info"));
            print_env("CLAUDERON_BIND_ADDR", Some("127.0.0.1"));
            print_env("VISUAL", None);
            print_env("EDITOR", None);
            println!();

            // Credential summary
            println!("CREDENTIALS:");
            let secrets_dir = home.join(".clauderon/secrets");
            print_credential_status("GitHub", "GITHUB_TOKEN", "github_token", &secrets_dir);
            print_credential_status(
                "Anthropic",
                "CLAUDE_CODE_OAUTH_TOKEN",
                "anthropic_oauth_token",
                &secrets_dir,
            );
            print_credential_status("OpenAI", "OPENAI_API_KEY", "openai_api_key", &secrets_dir);
            print_codex_credential_status(&codex_auth_json_path());
            print_credential_status(
                "PagerDuty",
                "PAGERDUTY_TOKEN",
                "pagerduty_token",
                &secrets_dir,
            );
            print_credential_status(
                "Sentry",
                "SENTRY_AUTH_TOKEN",
                "sentry_auth_token",
                &secrets_dir,
            );
            print_credential_status(
                "Grafana",
                "GRAFANA_API_KEY",
                "grafana_api_key",
                &secrets_dir,
            );
            print_credential_status("npm", "NPM_TOKEN", "npm_token", &secrets_dir);
            print_credential_status("Docker", "DOCKER_TOKEN", "docker_token", &secrets_dir);
            print_credential_status("Kubernetes", "K8S_TOKEN", "k8s_token", &secrets_dir);
            print_credential_status("Talos", "TALOS_TOKEN", "talos_token", &secrets_dir);
        }
        ConfigCommands::Paths => {
            println!("clauderon file paths\n");

            let home = dirs::home_dir().unwrap_or_default();

            println!("CORE:");
            print_path("Base directory", &utils::paths::base_dir());
            print_path("Database", &utils::paths::database_path());
            print_path("Config file", &utils::paths::config_path());
            println!();

            println!("SOCKETS:");
            print_path("Daemon socket", &utils::paths::socket_path());
            println!();

            println!("DATA:");
            print_path("Worktrees", &utils::paths::worktrees_dir());
            print_path("Logs", &utils::paths::log_path());
            print_path("Audit log", &home.join(".clauderon/audit.jsonl"));
            println!();

            println!("CONFIGURATION:");
            print_path("Proxy config", &home.join(".clauderon/proxy.toml"));
            print_path("Secrets directory", &home.join(".clauderon/secrets"));
            print_path("Codex auth.json", &codex_auth_json_path());
        }
        ConfigCommands::Env => {
            println!("clauderon environment variables\n");

            println!("GENERAL:");
            print_env_detailed("RUST_LOG", "Log level filter", Some("clauderon=info"));
            print_env_detailed("VISUAL", "Preferred editor (GUI)", None);
            print_env_detailed("EDITOR", "Preferred editor (terminal)", None);
            print_env_detailed("HOME", "Home directory", None);
            println!();

            println!("HTTP SERVER:");
            print_env_detailed(
                "CLAUDERON_BIND_ADDR",
                "HTTP bind address",
                Some("127.0.0.1"),
            );
            print_env_detailed("CLAUDERON_ORIGIN", "WebAuthn origin URL", None);
            print_env_detailed(
                "CLAUDERON_RP_ID",
                "WebAuthn relying party ID",
                Some("localhost"),
            );
            println!();

            println!("CREDENTIALS:");
            print_env_detailed("GITHUB_TOKEN", "GitHub API token", None);
            print_env_detailed("CLAUDE_CODE_OAUTH_TOKEN", "Anthropic OAuth token", None);
            print_env_detailed("OPENAI_API_KEY", "OpenAI API key", None);
            print_env_detailed(
                "CODEX_API_KEY",
                "Codex API key (alias of OPENAI_API_KEY)",
                None,
            );
            print_env_detailed("PAGERDUTY_TOKEN", "PagerDuty API token", None);
            print_env_detailed("PAGERDUTY_API_KEY", "PagerDuty API key (alt)", None);
            print_env_detailed("SENTRY_AUTH_TOKEN", "Sentry auth token", None);
            print_env_detailed("GRAFANA_API_KEY", "Grafana API key", None);
            print_env_detailed("NPM_TOKEN", "npm registry token", None);
            print_env_detailed("DOCKER_TOKEN", "Docker registry token", None);
            print_env_detailed("K8S_TOKEN", "Kubernetes token", None);
            print_env_detailed("TALOS_TOKEN", "Talos OS token", None);
            println!();
            println!("CODEX AUTH:");
            print_env_detailed("CODEX_ACCESS_TOKEN", "Codex access token", None);
            print_env_detailed("CODEX_REFRESH_TOKEN", "Codex refresh token", None);
            print_env_detailed("CODEX_ID_TOKEN", "Codex ID token", None);
            print_env_detailed("CODEX_ACCOUNT_ID", "ChatGPT account ID (optional)", None);
            print_env_detailed(
                "CODEX_AUTH_JSON_PATH",
                "Override ~/.codex/auth.json path",
                None,
            );
        }
        ConfigCommands::Credentials => {
            println!("clauderon credential status\n");

            let home = dirs::home_dir().unwrap_or_default();
            let secrets_dir = home.join(".clauderon/secrets");

            println!("{:<20} {:<12} {:<30}", "SERVICE", "STATUS", "SOURCE");
            println!("{}", "-".repeat(62));

            print_credential_row("GitHub", "GITHUB_TOKEN", "github_token", &secrets_dir);
            print_credential_row(
                "Anthropic",
                "CLAUDE_CODE_OAUTH_TOKEN",
                "anthropic_oauth_token",
                &secrets_dir,
            );
            print_credential_row("OpenAI", "OPENAI_API_KEY", "openai_api_key", &secrets_dir);
            print_codex_credential_row(&codex_auth_json_path());
            print_credential_row(
                "PagerDuty",
                "PAGERDUTY_TOKEN",
                "pagerduty_token",
                &secrets_dir,
            );
            print_credential_row(
                "Sentry",
                "SENTRY_AUTH_TOKEN",
                "sentry_auth_token",
                &secrets_dir,
            );
            print_credential_row(
                "Grafana",
                "GRAFANA_API_KEY",
                "grafana_api_key",
                &secrets_dir,
            );
            print_credential_row("npm", "NPM_TOKEN", "npm_token", &secrets_dir);
            print_credential_row("Docker", "DOCKER_TOKEN", "docker_token", &secrets_dir);
            print_credential_row("Kubernetes", "K8S_TOKEN", "k8s_token", &secrets_dir);
            print_credential_row("Talos", "TALOS_TOKEN", "talos_token", &secrets_dir);

            println!();
            println!("Credentials are loaded from environment variables first,");
            println!("then from files in {}", secrets_dir.display());
            println!(
                "Codex auth tokens are loaded from env or {}",
                codex_auth_json_path().display()
            );
        }
    }
}

fn print_path(name: &str, path: &std::path::Path) {
    let exists = path.exists();
    let status = if exists { "exists" } else { "missing" };
    let marker = if exists { "+" } else { "-" };
    println!("    [{marker}] {name:<25} {path}", path = path.display());
    if !exists {
        println!("        ({status})");
    }
}

fn print_env(name: &str, default: Option<&str>) {
    match std::env::var(name) {
        Ok(val) => {
            // Truncate long values and mask sensitive ones
            let display_val = if val.len() > 40 {
                format!("{}...", &val[..40])
            } else {
                val
            };
            println!("    {name:<30} = {display_val}");
        }
        Err(_) => {
            if let Some(def) = default {
                println!("    {name:<30} = (default: {def})");
            } else {
                println!("    {name:<30} = (not set)");
            }
        }
    }
}

fn print_env_detailed(name: &str, description: &str, default: Option<&str>) {
    let status = match std::env::var(name) {
        Ok(_) => "SET".to_string(),
        Err(_) => {
            if let Some(def) = default {
                format!("default: {def}")
            } else {
                "not set".to_string()
            }
        }
    };
    println!("    {name:<30} [{status}]");
    println!("        {description}");
}

fn print_credential_status(
    service: &str,
    env_var: &str,
    file_name: &str,
    secrets_dir: &std::path::Path,
) {
    let from_env = std::env::var(env_var).is_ok();
    let from_file = secrets_dir.join(file_name).exists();

    let status = if from_env {
        "from env"
    } else if from_file {
        "from file"
    } else {
        "missing"
    };

    let marker = if from_env || from_file { "+" } else { "-" };
    println!("    [{marker}] {service:<20} ({status})");
}

fn print_credential_row(
    service: &str,
    env_var: &str,
    file_name: &str,
    secrets_dir: &std::path::Path,
) {
    let from_env = std::env::var(env_var).is_ok();
    let file_path = secrets_dir.join(file_name);
    let from_file = file_path.exists();

    let (status, source) = if from_env {
        ("loaded", format!("env:{env_var}"))
    } else if from_file {
        ("loaded", format!("file:{}", file_path.display()))
    } else {
        ("missing", "-".to_string())
    };

    println!("{:<20} {:<12} {:<30}", service, status, source);
}

fn codex_auth_json_path() -> std::path::PathBuf {
    if let Ok(path) = std::env::var("CODEX_AUTH_JSON_PATH") {
        return std::path::PathBuf::from(path);
    }
    dirs::home_dir()
        .unwrap_or_default()
        .join(".codex/auth.json")
}

fn codex_env_present() -> bool {
    [
        "CODEX_ACCESS_TOKEN",
        "CODEX_REFRESH_TOKEN",
        "CODEX_ID_TOKEN",
    ]
    .iter()
    .any(|name| std::env::var(name).is_ok())
}

fn print_codex_credential_status(auth_path: &std::path::Path) {
    let from_env = codex_env_present();
    let from_file = auth_path.exists();

    let status = if from_env {
        "from env"
    } else if from_file {
        "from auth.json"
    } else {
        "missing"
    };

    let marker = if from_env || from_file { "+" } else { "-" };
    println!(
        "    [{marker}] {service:<20} ({status})",
        service = "ChatGPT"
    );
}

fn print_codex_credential_row(auth_path: &std::path::Path) {
    let from_env = codex_env_present();
    let from_file = auth_path.exists();

    let (status, source) = if from_env {
        ("loaded", "env:CODEX_*".to_string())
    } else if from_file {
        ("loaded", format!("auth.json:{}", auth_path.display()))
    } else {
        ("missing", "-".to_string())
    };

    println!("{:<20} {:<12} {:<30}", "ChatGPT", status, source);
}
