use async_trait::async_trait;
use std::path::{Path, PathBuf};
use tokio::process::Command;
use tracing::instrument;

use super::traits::ExecutionBackend;
use crate::core::AgentType;
use crate::proxy::{dummy_auth_json_string, dummy_config_toml};

/// Sanitize git config value to prevent environment variable injection
///
/// Removes newlines and other control characters that could be used for injection attacks
fn sanitize_git_config_value(value: &str) -> String {
    value
        .chars()
        .filter(|c| !c.is_control() || *c == '\t')
        .collect()
}

/// Read git user configuration from the host system
///
/// Returns (user.name, user.email) if available from git config
/// Values are sanitized to prevent environment variable injection
async fn read_git_user_config() -> (Option<String>, Option<String>) {
    let name = Command::new("git")
        .args(["config", "--get", "user.name"])
        .output()
        .await
        .ok()
        .and_then(|output| {
            if output.status.success() {
                String::from_utf8(output.stdout)
                    .ok()
                    .map(|s| sanitize_git_config_value(s.trim()))
                    .filter(|s| !s.is_empty())
            } else {
                None
            }
        });

    let email = Command::new("git")
        .args(["config", "--get", "user.email"])
        .output()
        .await
        .ok()
        .and_then(|output| {
            if output.status.success() {
                String::from_utf8(output.stdout)
                    .ok()
                    .map(|s| sanitize_git_config_value(s.trim()))
                    .filter(|s| !s.is_empty())
            } else {
                None
            }
        });

    (name, email)
}

/// Docker container image to use
const DOCKER_IMAGE: &str = "ghcr.io/shepherdjerred/dotfiles";

/// Shared cache volumes used across all clauderon Docker containers for faster Rust builds:
/// - clauderon-cargo-registry: Downloaded crates from crates.io (/workspace/.cargo/registry)
/// - clauderon-cargo-git: Git dependencies (/workspace/.cargo/git)
/// - clauderon-sccache: Compilation cache (/workspace/.cache/sccache)
///
/// Caches are mounted under /workspace (HOME) since containers run as non-root user.
/// sccache (Mozilla's compilation cache) is configured via RUSTC_WRAPPER environment variable.
/// If sccache is not installed in the dotfiles image, cargo will show a warning but continue
/// to work. To enable sccache compilation caching, install it in the dotfiles image:
///   cargo install sccache
/// or add it to the Dockerfile.
///
/// Proxy configuration for Docker containers.
#[derive(Debug, Clone)]
pub struct DockerProxyConfig {
    /// Session-specific proxy port (required).
    pub session_proxy_port: u16,
    /// Path to the clauderon config directory (contains CA cert, talosconfig).
    pub clauderon_dir: PathBuf,
}

impl DockerProxyConfig {
    /// Create a new proxy configuration.
    #[must_use]
    pub fn new(session_proxy_port: u16, clauderon_dir: PathBuf) -> Self {
        Self {
            session_proxy_port,
            clauderon_dir,
        }
    }
}

/// Docker container backend
pub struct DockerBackend {
    /// Path to clauderon directory for proxy CA and configs.
    clauderon_dir: PathBuf,
}

impl DockerBackend {
    /// Create a new Docker backend.
    #[must_use]
    pub fn new() -> Self {
        let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("/tmp"));
        Self {
            clauderon_dir: home.join(".clauderon"),
        }
    }

    /// Create a Docker backend with a specific clauderon directory.
    #[must_use]
    pub fn with_clauderon_dir(clauderon_dir: PathBuf) -> Self {
        Self { clauderon_dir }
    }

    /// Check if a container is running
    ///
    /// # Errors
    ///
    /// Returns an error if the docker command fails to execute.
    pub async fn is_running(&self, name: &str) -> anyhow::Result<bool> {
        let output = Command::new("docker")
            .args(["ps", "--format", "{{.Names}}"])
            .output()
            .await?;

        if !output.status.success() {
            return Ok(false);
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        Ok(stdout.lines().any(|line| line == name))
    }

    /// Ensure cache directories exist in workdir with correct permissions.
    ///
    /// Creates .cargo/registry, .cargo/git, and .cache/sccache directories if they don't exist.
    /// This prevents Docker from creating them as root when mounting named volumes.
    ///
    /// This is a best-effort operation - if directory creation fails, we log a warning and
    /// continue. Docker will still create the directories, but they'll be owned by root.
    fn ensure_cache_directories(workdir: &Path) {
        let cache_dirs = [
            workdir.join(".cargo/registry"),
            workdir.join(".cargo/git"),
            workdir.join(".cache/sccache"),
        ];

        for dir in &cache_dirs {
            if let Err(e) = std::fs::create_dir_all(dir) {
                tracing::warn!(
                    path = %dir.display(),
                    error = %e,
                    "Failed to create cache directory"
                );
                // Continue anyway - Docker will create it, but as root
            } else {
                tracing::trace!(
                    path = %dir.display(),
                    "Created cache directory"
                );
            }
        }
    }

    /// Build the docker run command arguments (exposed for testing)
    ///
    /// Returns all arguments that would be passed to `docker run`.
    ///
    /// # Arguments
    ///
    /// * `print_mode` - If true, run in non-interactive mode.
    ///                  Claude Code uses `--print --verbose`, Codex uses `codex exec`.
    ///                  The container will output the response and exit.
    ///                  If false, run interactively for `docker attach`.
    ///
    /// # Errors
    ///
    /// Returns an error if the proxy CA certificate is required but missing.
    pub fn build_create_args(
        name: &str,
        workdir: &Path,
        initial_workdir: &Path,
        initial_prompt: &str,
        uid: u32,
        proxy_config: Option<&DockerProxyConfig>,
        agent: AgentType,
        print_mode: bool,
        dangerous_skip_checks: bool,
        images: &[String],
        git_user_name: Option<&str>,
        git_user_email: Option<&str>,
        session_id: Option<&uuid::Uuid>,
        http_port: Option<u16>,
    ) -> anyhow::Result<Vec<String>> {
        let container_name = format!("clauderon-{name}");
        let escaped_prompt = initial_prompt.replace('\'', "'\\''");

        let mut args = vec![
            "run".to_string(),
            "-dit".to_string(),
            "--name".to_string(),
            container_name,
            "--user".to_string(),
            uid.to_string(),
            "-v".to_string(),
            format!("{display}:/workspace", display = workdir.display()),
            "-w".to_string(),
            if initial_workdir.as_os_str().is_empty() {
                "/workspace".to_string()
            } else {
                format!("/workspace/{}", initial_workdir.display())
            },
            "-e".to_string(),
            "TERM=xterm-256color".to_string(),
            "-e".to_string(),
            "HOME=/workspace".to_string(),
        ];
        if agent == AgentType::Codex {
            args.extend(["-e".to_string(), "CODEX_HOME=/workspace/.codex".to_string()]);
        }

        // Mount shared Rust cargo and sccache cache volumes for faster builds
        // These are shared across ALL clauderon sessions and persist between container restarts
        // sccache provides compilation caching (path-independent, content-addressed)
        // cargo caches provide dependency download caching
        // Note: Mounted under /workspace (HOME) since containers run as non-root user
        args.extend([
            "-v".to_string(),
            "clauderon-cargo-registry:/workspace/.cargo/registry".to_string(),
            "-v".to_string(),
            "clauderon-cargo-git:/workspace/.cargo/git".to_string(),
            "-v".to_string(),
            "clauderon-sccache:/workspace/.cache/sccache".to_string(),
        ]);

        // Configure sccache as Rust compiler wrapper (if installed in dotfiles image)
        // If sccache is not installed, cargo will show a clear warning but continue to work
        // This is a progressive enhancement - works without sccache, better with it
        args.extend([
            "-e".to_string(),
            "CARGO_HOME=/workspace/.cargo".to_string(),
            "-e".to_string(),
            "RUSTC_WRAPPER=sccache".to_string(),
            "-e".to_string(),
            "SCCACHE_DIR=/workspace/.cache/sccache".to_string(),
        ]);

        // Add hook communication environment variables
        // These allow Claude Code hooks to send status updates via HTTP to the daemon
        // (Unix sockets don't work across the macOS VM boundary in Docker/OrbStack)
        if let (Some(sid), Some(port)) = (session_id, http_port) {
            args.extend([
                "-e".to_string(),
                format!("CLAUDERON_SESSION_ID={sid}"),
                "-e".to_string(),
                format!("CLAUDERON_HTTP_PORT={port}"),
            ]);
        }

        // Mount .clauderon directory for config/cache (hooks use HTTP, not sockets)
        let home_dir = std::env::var("HOME").unwrap_or_else(|_| "/root".to_string());
        let clauderon_dir = format!("{home_dir}/.clauderon");
        args.extend([
            "-v".to_string(),
            format!("{clauderon_dir}:/workspace/.clauderon"),
        ]);

        // Mount uploads directory for image attachments
        // - Read-write: allows bidirectional file communication between app and Claude
        // - Shared across sessions with per-session subdirectories for isolation
        // - Images uploaded via API (POST /api/sessions/{id}/upload) are stored here
        // - Paths are translated from host to container in the agent command below
        let uploads_dir = format!("{home_dir}/.clauderon/uploads");
        args.extend([
            "-v".to_string(),
            format!("{uploads_dir}:/workspace/.clauderon/uploads"),
        ]);

        // Detect if workdir is a git worktree and mount parent .git directory
        match crate::utils::git::detect_worktree_parent_git_dir(workdir) {
            Ok(Some(parent_git_dir)) => {
                tracing::info!(
                    workdir = %workdir.display(),
                    parent_git = %parent_git_dir.display(),
                    "Detected git worktree, mounting parent .git directory"
                );

                // Mount the parent .git directory to the same absolute path in the container
                // This allows git operations (including commits) to work correctly with worktrees
                // Read-write access is required for commits, branch operations, etc.
                //
                // NOTE: This requires the host and container to have compatible filesystem layouts.
                // The parent .git directory must be accessible at the same absolute path.
                // This works for most cases but may fail if:
                // - The parent repo is on a different volume than the worktree
                // - There are path conflicts in the container
                // - The worktree and parent repo are in very different directory structures
                args.extend([
                    "-v".to_string(),
                    format!(
                        "{display1}:{display2}",
                        display1 = parent_git_dir.display(),
                        display2 = parent_git_dir.display()
                    ),
                ]);
            }
            Ok(None) => {
                // Not a git worktree, that's fine - normal git repos work without extra mounts
                tracing::debug!(
                    workdir = %workdir.display(),
                    "Not a git worktree, skipping parent .git mount"
                );
            }
            Err(e) => {
                // Failed to detect worktree - log a warning but continue
                // Git operations may not work properly if this is actually a worktree
                tracing::warn!(
                    workdir = %workdir.display(),
                    error = %e,
                    "Failed to detect git worktree, git operations may not work correctly. \
                    If this directory is a git worktree, you may need to fix the .git file or parent repository."
                );
            }
        }

        // Add proxy configuration
        if let Some(proxy) = proxy_config {
            let port = proxy.session_proxy_port;
            let clauderon_dir = &proxy.clauderon_dir;

            // Validate required files exist before attempting to mount them
            let ca_cert_path = clauderon_dir.join("proxy-ca.pem");
            let talos_config_dir = clauderon_dir.join("talos");

            // CA certificate is required - fail fast if missing
            if !ca_cert_path.exists() {
                anyhow::bail!(
                    "Proxy CA certificate not found at {}. \
                    Ensure the clauderon daemon is running and initialized.",
                    ca_cert_path.display()
                );
            }

            // Check optional configs
            let has_talos_config = talos_config_dir.exists();

            if !has_talos_config {
                tracing::debug!(
                    "Talosconfig not found at {:?}, skipping mount",
                    talos_config_dir
                );
            }

            let codex_dir = clauderon_dir.join("codex");
            let codex_auth_path = codex_dir.join("auth.json");
            let codex_config_path = codex_dir.join("config.toml");
            if let Err(e) = std::fs::create_dir_all(&codex_dir) {
                tracing::warn!(
                    "Failed to create Codex config directory at {:?}: {}",
                    codex_dir,
                    e
                );
            } else {
                if !codex_auth_path.exists() {
                    match dummy_auth_json_string(None) {
                        Ok(contents) => {
                            if let Err(e) = std::fs::write(&codex_auth_path, contents) {
                                tracing::warn!(
                                    "Failed to write Codex auth.json at {:?}: {}",
                                    codex_auth_path,
                                    e
                                );
                            }
                        }
                        Err(e) => {
                            tracing::warn!("Failed to build Codex auth.json contents: {}", e);
                        }
                    }
                }
                if !codex_config_path.exists() {
                    if let Err(e) = std::fs::write(&codex_config_path, dummy_config_toml()) {
                        tracing::warn!(
                            "Failed to write Codex config.toml at {:?}: {}",
                            codex_config_path,
                            e
                        );
                    }
                }
            }

            // Add host.docker.internal resolution
            // Required for Linux and macOS with OrbStack
            // Harmless on Docker Desktop (flag is ignored if host already exists)
            args.extend([
                "--add-host".to_string(),
                "host.docker.internal:host-gateway".to_string(),
            ]);

            // Proxy environment variables
            args.extend([
                "-e".to_string(),
                format!("HTTP_PROXY=http://host.docker.internal:{port}"),
                "-e".to_string(),
                format!("HTTPS_PROXY=http://host.docker.internal:{port}"),
                "-e".to_string(),
                "NO_PROXY=localhost,127.0.0.1,host.docker.internal".to_string(),
            ]);

            // Set dummy tokens so CLI tools will make requests (proxy replaces with real tokens)
            args.extend([
                "-e".to_string(),
                "GH_TOKEN=clauderon-proxy".to_string(),
                "-e".to_string(),
                "GITHUB_TOKEN=clauderon-proxy".to_string(),
            ]);

            match agent {
                AgentType::ClaudeCode => {
                    // Set placeholder OAuth token - Claude Code uses this for auth
                    // The proxy will intercept API requests and inject the real OAuth token
                    args.extend([
                        "-e".to_string(),
                        "CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-clauderon-proxy-placeholder"
                            .to_string(),
                    ]);
                }
                AgentType::Codex => {
                    // Codex uses OpenAI API keys (exec supports CODEX_API_KEY, CLI generally uses OPENAI_API_KEY)
                    args.extend([
                        "-e".to_string(),
                        "OPENAI_API_KEY=sk-openai-clauderon-proxy-placeholder".to_string(),
                        "-e".to_string(),
                        "CODEX_API_KEY=sk-openai-clauderon-proxy-placeholder".to_string(),
                    ]);
                }
            }

            // SSL/TLS environment variables for CA trust
            args.extend([
                "-e".to_string(),
                "NODE_EXTRA_CA_CERTS=/etc/clauderon/proxy-ca.pem".to_string(),
                "-e".to_string(),
                "SSL_CERT_FILE=/etc/clauderon/proxy-ca.pem".to_string(),
                "-e".to_string(),
                "REQUESTS_CA_BUNDLE=/etc/clauderon/proxy-ca.pem".to_string(),
            ]);

            // Volume mounts for proxy configs (read-only)
            // CA certificate is always mounted (required)
            args.extend([
                "-v".to_string(),
                format!(
                    "{display}:/etc/clauderon/proxy-ca.pem:ro",
                    display = ca_cert_path.display()
                ),
            ]);
            if codex_dir.exists() {
                args.extend([
                    "-v".to_string(),
                    format!(
                        "{display}:/etc/clauderon/codex:ro",
                        display = codex_dir.display()
                    ),
                ]);
            }

            // Mount and configure Talos if available
            if has_talos_config {
                args.extend([
                    "-v".to_string(),
                    format!(
                        "{display}:/etc/clauderon/talos:ro",
                        display = talos_config_dir.display()
                    ),
                    "-e".to_string(),
                    "TALOSCONFIG=/etc/clauderon/talos/config".to_string(),
                ]);
            }
        }

        // Git user configuration from host
        // Set both AUTHOR and COMMITTER variables so git commits have proper attribution
        if let Some(name) = git_user_name {
            args.extend([
                "-e".to_string(),
                format!("GIT_AUTHOR_NAME={name}"),
                "-e".to_string(),
                format!("GIT_COMMITTER_NAME={name}"),
            ]);
        }
        if let Some(email) = git_user_email {
            args.extend([
                "-e".to_string(),
                format!("GIT_AUTHOR_EMAIL={email}"),
                "-e".to_string(),
                format!("GIT_COMMITTER_EMAIL={email}"),
            ]);
        }

        // NOTE: We intentionally do NOT create a fake .credentials.json file.
        // The ANTHROPIC_API_KEY env var is sufficient and avoids validation issues.
        // When a credentials file exists, Claude Code validates it against the API,
        // which would fail with our fake tokens. The env var path skips this validation.

        if agent == AgentType::ClaudeCode {
            // Determine config directory - use proxy clauderon_dir if available, otherwise create temp dir
            // Note: When proxy is disabled, we create a temp directory for the session config.
            // These temp directories persist after container deletion and are cleaned up by the OS.
            // This is acceptable since the files are tiny (just .claude.json) and sessions are infrequent.
            let config_dir = if let Some(proxy) = proxy_config {
                proxy.clauderon_dir.clone()
            } else {
                // Create a temp directory for Claude config when proxy is disabled
                let temp_dir = std::env::temp_dir().join(format!("clauderon-{name}"));
                temp_dir
            };

            // Create the config directory if it doesn't exist
            if let Err(e) = std::fs::create_dir_all(&config_dir) {
                tracing::warn!(
                    "Failed to create config directory at {:?}: {}",
                    config_dir,
                    e
                );
            } else {
                // Write claude.json to skip onboarding and optionally suppress bypass permissions warning
                // This tells Claude Code we've already completed the setup wizard
                // Note: Claude Code writes to this file, so we can't mount it read-only
                let claude_json_path = config_dir.join("claude.json");
                let claude_json = if dangerous_skip_checks {
                    // If bypass permissions is enabled, also suppress the warning
                    r#"{"hasCompletedOnboarding": true, "bypassPermissionsModeAccepted": true}"#
                } else {
                    r#"{"hasCompletedOnboarding": true}"#
                };
                if let Err(e) = std::fs::write(&claude_json_path, claude_json) {
                    tracing::warn!(
                        "Failed to write claude.json file at {:?}: {}",
                        claude_json_path,
                        e
                    );
                } else {
                    // Mount to /workspace/.claude.json since HOME=/workspace in container
                    // Note: NOT read-only because Claude Code writes to it
                    args.extend([
                        "-v".to_string(),
                        format!(
                            "{display}:/workspace/.claude.json",
                            display = claude_json_path.display()
                        ),
                    ]);
                }

                // Proxy-specific configuration (only when proxy is enabled)
                if let Some(_proxy) = proxy_config {
                    // Write managed settings file for proxy environments
                    // Note: managed-settings.json is only created when proxy is enabled because it's
                    // part of the proxy infrastructure that requires elevated permissions.
                    // For non-proxy users, .claude.json with bypassPermissionsModeAccepted is sufficient.
                    let managed_settings_path = config_dir.join("managed-settings.json");
                    let managed_settings = r#"{
  "permissions": {
    "defaultMode": "bypassPermissions"
  }
}"#;
                    if let Err(e) = std::fs::write(&managed_settings_path, managed_settings) {
                        tracing::warn!(
                            "Failed to write managed settings file at {:?}: {}",
                            managed_settings_path,
                            e
                        );
                    } else {
                        args.extend([
                            "-v".to_string(),
                            format!(
                                "{}:/etc/claude-code/managed-settings.json:ro",
                                managed_settings_path.display()
                            ),
                        ]);
                    }
                }
            }
        }

        // Add image and command
        // Build a wrapper script that handles both initial creation and container restart:
        // - On first run: session file doesn't exist → create new session with prompt
        // - On restart: session file exists → resume session
        let agent_cmd = {
            use crate::agents::traits::Agent;
            use crate::agents::{ClaudeCodeAgent, CodexAgent};

            // Helper to quote shell arguments
            let quote_arg = |arg: &str| -> String {
                if arg.contains('\'')
                    || arg.contains(' ')
                    || arg.contains('\n')
                    || arg.contains('&')
                    || arg.contains('|')
                {
                    let escaped = arg.replace('\'', "'\\''");
                    format!("'{escaped}'")
                } else {
                    arg.to_string()
                }
            };

            // Translate image paths from host to container
            // Host: /Users/name/.clauderon/uploads/... → Container: /workspace/.clauderon/uploads/...
            let translated_images: Vec<String> = images
                .iter()
                .map(|image_path| {
                    let home = std::env::var("HOME").unwrap_or_else(|_| "/root".to_string());
                    let host_uploads_prefix = format!("{home}/.clauderon/uploads");

                    if image_path.starts_with(&host_uploads_prefix) {
                        // Replace host prefix with container prefix
                        image_path.replace(&host_uploads_prefix, "/workspace/.clauderon/uploads")
                    } else {
                        // Path not in uploads dir - pass through unchanged (e.g., relative paths to workspace)
                        image_path.clone()
                    }
                })
                .collect();

            match agent {
                AgentType::ClaudeCode => {
                    let mut cmd_vec = ClaudeCodeAgent::new().start_command(
                        &escaped_prompt,
                        &translated_images,
                        dangerous_skip_checks,
                        None,
                    ); // Don't pass session_id here, we handle it in the wrapper

                    // Add print mode flags if enabled
                    if print_mode {
                        // Insert after "claude" but before other args
                        cmd_vec.insert(1, "--print".to_string());
                        cmd_vec.insert(2, "--verbose".to_string());
                    }

                    // If we have a session ID, generate a wrapper script that handles restart
                    if let Some(sid) = session_id {
                        let session_id_str = sid.to_string();

                        // Build the create command (for first run)
                        let mut create_cmd = vec!["claude".to_string()];
                        create_cmd.push("--session-id".to_string());
                        create_cmd.push(session_id_str.clone());
                        // Add remaining args (skip "claude" at index 0)
                        create_cmd.extend(cmd_vec.iter().skip(1).cloned());
                        let create_cmd_str = create_cmd
                            .iter()
                            .map(|a| quote_arg(a))
                            .collect::<Vec<_>>()
                            .join(" ");

                        // Build the resume command (for restart)
                        // Use --resume to continue an existing session instead of --session-id
                        // which would try to create a new session with that ID
                        // --fork-session creates a new session ID from the session so we don't modify the original
                        let resume_cmd_str = if dangerous_skip_checks {
                            format!(
                                "claude --dangerously-skip-permissions --resume {} --fork-session",
                                quote_arg(&session_id_str)
                            )
                        } else {
                            format!(
                                "claude --resume {} --fork-session",
                                quote_arg(&session_id_str)
                            )
                        };

                        // Generate wrapper script that detects restart via session history file
                        // Claude Code stores session history at: .claude/projects/-workspace/<session-id>.jsonl
                        format!(
                            r#"SESSION_ID="{session_id}"
HISTORY_FILE="/workspace/.claude/projects/-workspace/${{SESSION_ID}}.jsonl"
if [ -f "$HISTORY_FILE" ]; then
    echo "Resuming existing session $SESSION_ID"
    exec {resume_cmd}
else
    echo "Creating new session $SESSION_ID"
    exec {create_cmd}
fi"#,
                            session_id = session_id_str,
                            resume_cmd = resume_cmd_str,
                            create_cmd = create_cmd_str,
                        )
                    } else {
                        // No session ID - just run the command directly
                        cmd_vec
                            .iter()
                            .map(|arg| quote_arg(arg))
                            .collect::<Vec<_>>()
                            .join(" ")
                    }
                }
                AgentType::Codex => {
                    let codex_preamble = r#"CODEX_HOME="/workspace/.codex"
export CODEX_HOME
mkdir -p "$CODEX_HOME"
if [ -f /etc/clauderon/codex/auth.json ]; then
    cp /etc/clauderon/codex/auth.json "$CODEX_HOME/auth.json"
fi
if [ -f /etc/clauderon/codex/config.toml ]; then
    cp /etc/clauderon/codex/config.toml "$CODEX_HOME/config.toml"
fi"#;
                    if print_mode {
                        let mut cmd_vec = vec!["codex".to_string()];
                        if dangerous_skip_checks {
                            cmd_vec.push("--full-auto".to_string());
                        }
                        cmd_vec.push("exec".to_string());
                        for image in &translated_images {
                            cmd_vec.push("--image".to_string());
                            cmd_vec.push(image.clone());
                        }
                        if !escaped_prompt.is_empty() {
                            cmd_vec.push(escaped_prompt.clone());
                        }
                        let cmd = cmd_vec
                            .iter()
                            .map(|arg| quote_arg(arg))
                            .collect::<Vec<_>>()
                            .join(" ");
                        format!("{codex_preamble}\n{cmd}")
                    } else {
                        let create_cmd_vec = CodexAgent::new().start_command(
                            &escaped_prompt,
                            images,
                            dangerous_skip_checks,
                            None,
                        );
                        let create_cmd_str = create_cmd_vec
                            .iter()
                            .map(|a| quote_arg(a))
                            .collect::<Vec<_>>()
                            .join(" ");

                        let mut resume_cmd_vec = vec!["codex".to_string()];
                        if dangerous_skip_checks {
                            resume_cmd_vec.push("--full-auto".to_string());
                        }
                        resume_cmd_vec.push("resume".to_string());
                        resume_cmd_vec.push("--last".to_string());
                        let resume_cmd_str = resume_cmd_vec
                            .iter()
                            .map(|a| quote_arg(a))
                            .collect::<Vec<_>>()
                            .join(" ");

                        format!(
                            r#"{codex_preamble}
CODEX_DIR="/workspace/.codex/sessions"
if [ -d "$CODEX_DIR" ] && [ "$(ls -A "$CODEX_DIR" 2>/dev/null)" ]; then
    echo "Resuming last Codex session"
    exec {resume_cmd}
else
    echo "Creating new Codex session"
    exec {create_cmd}
fi"#,
                            resume_cmd = resume_cmd_str,
                            create_cmd = create_cmd_str,
                        )
                    }
                }
            }
        };

        args.extend([
            DOCKER_IMAGE.to_string(),
            "bash".to_string(),
            "-c".to_string(),
            agent_cmd,
        ]);

        Ok(args)
    }

    /// Build the attach command arguments (exposed for testing)
    #[must_use]
    pub fn build_attach_args(name: &str) -> Vec<String> {
        vec![
            "bash".to_string(),
            "-c".to_string(),
            format!("docker start {name} 2>/dev/null; docker attach {name}"),
        ]
    }
}

impl Default for DockerBackend {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl ExecutionBackend for DockerBackend {
    /// Create a new Docker container with Claude Code
    ///
    /// # Errors
    ///
    /// Returns an error if the docker command fails.
    #[instrument(skip(self, initial_prompt, options), fields(name = %name, workdir = %workdir.display()))]
    async fn create(
        &self,
        name: &str,
        workdir: &Path,
        initial_prompt: &str,
        options: super::traits::CreateOptions,
    ) -> anyhow::Result<String> {
        // Create a container name from the session name
        let container_name = format!("clauderon-{name}");

        // Create the container with the worktree mounted
        // Run as current user to avoid root privileges (claude refuses --dangerously-skip-permissions as root)
        let uid = std::process::id();

        // Build proxy config dynamically from session-specific port
        let proxy_config = options
            .session_proxy_port
            .map(|session_port| DockerProxyConfig::new(session_port, self.clauderon_dir.clone()));

        let proxy_config_ref = proxy_config.as_ref();

        // Read git user configuration from the host
        let (git_user_name, git_user_email) = read_git_user_config().await;

        // Ensure cache directories exist before creating container
        // This prevents Docker from creating them as root when mounting named volumes
        Self::ensure_cache_directories(workdir);

        let args = Self::build_create_args(
            name,
            workdir,
            &options.initial_workdir,
            initial_prompt,
            uid,
            proxy_config_ref,
            options.agent,
            options.print_mode,
            options.dangerous_skip_checks,
            &options.images,
            git_user_name.as_deref(),
            git_user_email.as_deref(),
            options.session_id.as_ref(),
            options.http_port,
        )?;
        let output = Command::new("docker").args(&args).output().await?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            tracing::error!(
                container_name = %container_name,
                workdir = %workdir.display(),
                stderr = %stderr,
                "Failed to create Docker container"
            );
            anyhow::bail!("Failed to create Docker container: {stderr}");
        }

        let container_id = String::from_utf8_lossy(&output.stdout).trim().to_string();

        tracing::info!(
            container_id = %container_id,
            container_name = %container_name,
            workdir = %workdir.display(),
            "Created Docker container"
        );

        // Install Claude Code hooks inside the container for status tracking
        if options.agent == AgentType::ClaudeCode {
            if let Err(e) = crate::hooks::install_hooks_in_container(&container_name).await {
                tracing::warn!(
                    container_name = %container_name,
                    error = %e,
                    "Failed to install hooks in container (non-fatal), status tracking may not work"
                );
            }
        }

        Ok(container_name)
    }

    /// Check if a Docker container exists
    ///
    /// # Errors
    ///
    /// Returns an error if the docker command fails to execute.
    #[instrument(skip(self), fields(name = %name))]
    async fn exists(&self, name: &str) -> anyhow::Result<bool> {
        let output = Command::new("docker")
            .args(["ps", "-a", "--format", "{{.Names}}"])
            .output()
            .await?;

        if !output.status.success() {
            return Ok(false);
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        Ok(stdout.lines().any(|line| line == name))
    }

    /// Delete a Docker container
    ///
    /// # Errors
    ///
    /// Returns an error if the docker command fails to execute.
    #[instrument(skip(self), fields(name = %name))]
    async fn delete(&self, name: &str) -> anyhow::Result<()> {
        // Stop the container first
        let _ = Command::new("docker").args(["stop", name]).output().await;

        // Then remove it
        let output = Command::new("docker")
            .args(["rm", "-f", name])
            .output()
            .await?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            tracing::warn!("Failed to remove Docker container: {stderr}");
        }

        tracing::info!(container = name, "Deleted Docker container");

        Ok(())
    }

    /// Get the command to attach to a Docker container
    /// Uses bash to start the container first if stopped, then attach
    fn attach_command(&self, name: &str) -> Vec<String> {
        Self::build_attach_args(name)
    }

    /// Get recent logs from a Docker container
    ///
    /// # Errors
    ///
    /// Returns an error if the docker logs command fails.
    #[instrument(skip(self), fields(name = %name, lines = %lines))]
    async fn get_output(&self, name: &str, lines: usize) -> anyhow::Result<String> {
        let output = Command::new("docker")
            .args(["logs", "--tail", &lines.to_string(), name])
            .output()
            .await?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            anyhow::bail!("Failed to get Docker logs: {stderr}");
        }

        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    }
}

// Legacy method names for backward compatibility during migration
impl DockerBackend {
    /// Create a new Docker container (legacy name)
    #[deprecated(note = "Use ExecutionBackend::create instead")]
    pub async fn create_container(
        &self,
        name: &str,
        workdir: &Path,
        initial_prompt: &str,
    ) -> anyhow::Result<String> {
        self.create(
            name,
            workdir,
            initial_prompt,
            super::traits::CreateOptions {
                agent: AgentType::ClaudeCode,
                print_mode: false,
                plan_mode: true, // Default to plan mode
                session_proxy_port: None,
                images: vec![],
                dangerous_skip_checks: false,
                session_id: None,
                initial_workdir: std::path::PathBuf::new(),
                http_port: None,
            },
        )
        .await
    }

    /// Check if a Docker container exists (legacy name)
    #[deprecated(note = "Use ExecutionBackend::exists instead")]
    pub async fn container_exists(&self, name: &str) -> anyhow::Result<bool> {
        self.exists(name).await
    }

    /// Delete a Docker container (legacy name)
    #[deprecated(note = "Use ExecutionBackend::delete instead")]
    pub async fn delete_container(&self, name: &str) -> anyhow::Result<()> {
        self.delete(name).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    /// Test that docker run uses -dit (detach + interactive + TTY), not just -d
    #[test]
    fn test_create_uses_dit_not_d() {
        let args = DockerBackend::build_create_args(
            "test-session",
            &PathBuf::from("/workspace"),
            &PathBuf::new(), // initial_workdir (empty = root)
            "test prompt",
            1000,
            None,
            AgentType::ClaudeCode,
            false, // interactive mode
            true,  // dangerous_skip_checks
            &[],   // no images
            None,  // git user name
            None,  // git user email
            None,  // session_id
            None,  // http_port
        )
        .expect("Failed to build args");

        // Must have -dit for interactive TTY sessions
        assert!(
            args.contains(&"-dit".to_string()),
            "Expected -dit flag for TTY allocation, got: {args:?}"
        );
        // Should NOT have plain -d
        assert!(
            !args.contains(&"-d".to_string()),
            "Should not use -d alone, need -dit for interactive sessions"
        );
    }

    /// Test sanitization of git config values to prevent injection attacks
    #[test]
    fn test_sanitize_git_config_removes_newlines() {
        // Test newline injection attempt
        let malicious = "John Doe\nGIT_EVIL=injected";
        let sanitized = sanitize_git_config_value(malicious);
        assert_eq!(sanitized, "John DoeGIT_EVIL=injected");
        assert!(!sanitized.contains('\n'));
    }

    #[test]
    fn test_sanitize_git_config_removes_control_chars() {
        // Test various control characters
        let malicious = "user\x00name\x01with\x02control";
        let sanitized = sanitize_git_config_value(malicious);
        assert!(!sanitized.contains('\x00'));
        assert!(!sanitized.contains('\x01'));
        assert!(!sanitized.contains('\x02'));
        assert_eq!(sanitized, "usernamewithcontrol");
    }

    #[test]
    fn test_sanitize_git_config_preserves_tabs() {
        // Tabs should be preserved as they're valid in names
        let with_tab = "John\tDoe";
        let sanitized = sanitize_git_config_value(with_tab);
        assert_eq!(sanitized, "John\tDoe");
    }

    #[test]
    fn test_sanitize_git_config_preserves_normal_chars() {
        // Normal characters should pass through
        let normal = "John Doe <john@example.com>";
        let sanitized = sanitize_git_config_value(normal);
        assert_eq!(sanitized, normal);
    }

    /// Test that docker run includes --user flag with non-root UID
    #[test]
    fn test_create_runs_as_non_root() {
        let uid = 1000u32;
        let args = DockerBackend::build_create_args(
            "test-session",
            &PathBuf::from("/workspace"),
            &PathBuf::new(), // initial_workdir (empty = root)
            "test prompt",
            uid,
            None,
            AgentType::ClaudeCode,
            false, // print mode
            true,  // dangerous_skip_checks
            &[],   // no images
            None,  // git_user_name
            None,  // git_user_email
            None,  // session_id
            None,  // http_port
        )
        .expect("Failed to build args");

        // Find --user flag and verify it's followed by the UID
        let user_idx = args.iter().position(|a| a == "--user");
        assert!(user_idx.is_some(), "Expected --user flag, got: {args:?}");

        let uid_arg = &args[user_idx.unwrap() + 1];
        assert_eq!(
            uid_arg, "1000",
            "Expected UID 1000 after --user, got: {uid_arg}"
        );
    }

    /// Test that initial_workdir is correctly set in Docker -w flag when subdirectory is provided
    #[test]
    fn test_initial_workdir_subdirectory() {
        let args = DockerBackend::build_create_args(
            "test-session",
            &PathBuf::from("/workspace"),
            &PathBuf::from("packages/foo"), // subdirectory
            "test prompt",
            1000,
            None,
            AgentType::ClaudeCode,
            false, // print_mode
            false, // dangerous_skip_checks
            &[],   // images
            None,  // git_user_name
            None,  // git_user_email
            None,  // session_id
            None,  // http_port
        )
        .expect("Failed to build args");

        // Find -w flag and verify it's set to /workspace/packages/foo
        let w_idx = args.iter().position(|a| a == "-w");
        assert!(
            w_idx.is_some(),
            "Expected -w flag for working directory, got: {args:?}"
        );

        let workdir = &args[w_idx.unwrap() + 1];
        assert_eq!(
            workdir, "/workspace/packages/foo",
            "Expected working directory to be /workspace/packages/foo, got: {workdir}"
        );
    }

    /// Test that initial_workdir with empty path uses /workspace as working directory
    #[test]
    fn test_initial_workdir_empty() {
        let args = DockerBackend::build_create_args(
            "test-session",
            &PathBuf::from("/workspace"),
            &PathBuf::new(), // empty initial_workdir
            "test prompt",
            1000,
            None,
            AgentType::ClaudeCode,
            false, // print_mode
            false, // dangerous_skip_checks
            &[],   // images
            None,  // git_user_name
            None,  // git_user_email
            None,  // session_id
            None,  // http_port
        )
        .expect("Failed to build args");

        // Find -w flag and verify it's set to /workspace
        let w_idx = args.iter().position(|a| a == "-w");
        assert!(
            w_idx.is_some(),
            "Expected -w flag for working directory, got: {args:?}"
        );

        let workdir = &args[w_idx.unwrap() + 1];
        assert_eq!(
            workdir, "/workspace",
            "Expected working directory to be /workspace when initial_workdir is empty, got: {workdir}"
        );
    }

    /// Test that Rust caching is configured with cargo and sccache volumes
    #[test]
    fn test_rust_caching_configured() {
        let args = DockerBackend::build_create_args(
            "test-session",
            &PathBuf::from("/workspace"),
            &PathBuf::new(), // initial_workdir (empty = root)
            "test prompt",
            1000,
            None,
            AgentType::ClaudeCode,
            false, // print_mode
            true,  // dangerous_skip_checks
            &[],   // images
            None,  // git_user_name
            None,  // git_user_email
            None,  // session_id
            None,  // http_port
        )
        .expect("Failed to build args");

        // Check cargo cache volumes
        let has_registry = args
            .iter()
            .any(|a| a.contains("clauderon-cargo-registry:/workspace/.cargo/registry"));
        assert!(
            has_registry,
            "Expected clauderon-cargo-registry volume mount"
        );

        let has_git = args
            .iter()
            .any(|a| a.contains("clauderon-cargo-git:/workspace/.cargo/git"));
        assert!(has_git, "Expected clauderon-cargo-git volume mount");

        // Check sccache volume
        let has_sccache = args
            .iter()
            .any(|a| a.contains("clauderon-sccache:/workspace/.cache/sccache"));
        assert!(has_sccache, "Expected clauderon-sccache volume mount");

        // Check cargo and sccache environment variables
        let has_cargo_home = args.iter().any(|a| a == "CARGO_HOME=/workspace/.cargo");
        assert!(has_cargo_home, "Expected CARGO_HOME=/workspace/.cargo");

        let has_rustc_wrapper = args.iter().any(|a| a == "RUSTC_WRAPPER=sccache");
        assert!(has_rustc_wrapper, "Expected RUSTC_WRAPPER=sccache");

        let has_sccache_dir = args
            .iter()
            .any(|a| a == "SCCACHE_DIR=/workspace/.cache/sccache");
        assert!(
            has_sccache_dir,
            "Expected SCCACHE_DIR=/workspace/.cache/sccache"
        );
    }

    /// Test that attach command uses bash, not zsh (which doesn't exist in container)
    #[test]
    fn test_attach_uses_bash_not_zsh() {
        let args = DockerBackend::build_attach_args("test-container");

        // Should use bash
        assert_eq!(args[0], "bash", "Expected bash, got: {}", args[0]);

        // Should NOT contain zsh anywhere
        let has_zsh = args.iter().any(|a| a.contains("zsh"));
        assert!(!has_zsh, "Should not use zsh: {args:?}");
    }

    /// Test that attach command starts stopped containers first
    #[test]
    fn test_attach_starts_stopped_container() {
        let args = DockerBackend::build_attach_args("test-container");

        // The command string should contain both docker start and docker attach
        let cmd_string = args.join(" ");
        assert!(
            cmd_string.contains("docker start"),
            "Expected 'docker start' in attach command: {cmd_string}"
        );
        assert!(
            cmd_string.contains("docker attach"),
            "Expected 'docker attach' in attach command: {cmd_string}"
        );

        // docker start should come before docker attach
        let start_pos = cmd_string.find("docker start");
        let attach_pos = cmd_string.find("docker attach");
        assert!(
            start_pos < attach_pos,
            "'docker start' should come before 'docker attach'"
        );
    }

    /// Test that single quotes in prompts are properly escaped
    #[test]
    fn test_prompt_escaping() {
        let prompt_with_quotes = "Say 'hello world'";
        let args = DockerBackend::build_create_args(
            "test-session",
            &PathBuf::from("/workspace"),
            &PathBuf::new(), // initial_workdir (empty = root)
            prompt_with_quotes,
            1000,
            None,
            AgentType::ClaudeCode,
            false, // print mode
            true,  // dangerous_skip_checks
            &[],   // no images
            None,  // git_user_name
            None,  // git_user_email
            None,  // session_id
            None,  // http_port
        )
        .expect("Failed to build args");

        // Find the command argument (last one containing the prompt)
        let cmd_arg = args.last().unwrap();

        // Single quotes should be escaped as '\'' for shell safety
        assert!(
            cmd_arg.contains("'\\''"),
            "Single quotes should be escaped as '\\'': {cmd_arg}"
        );
    }

    /// Test that container name is prefixed with clauderon-
    #[test]
    fn test_container_name_prefixed() {
        let args = DockerBackend::build_create_args(
            "my-session",
            &PathBuf::from("/workspace"),
            &PathBuf::new(), // initial_workdir (empty = root)
            "test prompt",
            1000,
            None,
            AgentType::ClaudeCode,
            false, // print mode
            true,  // dangerous_skip_checks
            &[],   // no images
            None,  // git_user_name
            None,  // git_user_email
            None,  // session_id
            None,  // http_port
        )
        .expect("Failed to build args");

        // Find --name flag and verify the container name
        let name_idx = args.iter().position(|a| a == "--name");
        assert!(name_idx.is_some(), "Expected --name flag");

        let container_name = &args[name_idx.unwrap() + 1];
        assert!(
            container_name.starts_with("clauderon-"),
            "Container name should start with 'clauderon-': {container_name}"
        );
        assert_eq!(container_name, "clauderon-my-session");
    }

    /// Test that proxy config adds expected environment variables
    #[test]
    fn test_proxy_config_adds_env_vars() {
        use tempfile::tempdir;
        let clauderon_dir = tempdir().expect("Failed to create temp dir");
        let ca_cert_path = clauderon_dir.path().join("proxy-ca.pem");
        std::fs::write(&ca_cert_path, "dummy cert").expect("Failed to write cert");

        // Create talos directory so it gets mounted
        let talos_dir = clauderon_dir.path().join("talos");
        std::fs::create_dir(&talos_dir).expect("Failed to create talos dir");
        std::fs::write(talos_dir.join("config"), "dummy").expect("Failed to write talos config");

        let proxy_config = DockerProxyConfig::new(18100, clauderon_dir.path().to_path_buf());
        let args = DockerBackend::build_create_args(
            "test-session",
            &PathBuf::from("/workspace"),
            &PathBuf::new(), // initial_workdir (empty = root)
            "test prompt",
            1000,
            Some(&proxy_config),
            AgentType::ClaudeCode,
            false, // print mode
            true,  // dangerous_skip_checks
            &[],   // no images
            None,  // git_user_name
            None,  // git_user_email
            None,  // session_id
            None,  // http_port
        )
        .expect("Failed to build args");

        // Should have HTTPS_PROXY
        let has_https_proxy = args.iter().any(|a| a.contains("HTTPS_PROXY"));
        assert!(
            has_https_proxy,
            "Expected HTTPS_PROXY env var, got: {args:?}"
        );

        // Should have SSL_CERT_FILE
        let has_ssl_cert = args.iter().any(|a| a.contains("SSL_CERT_FILE"));
        assert!(
            has_ssl_cert,
            "Expected SSL_CERT_FILE env var, got: {args:?}"
        );
    }

    /// Test that proxy config adds volume mounts for configs
    #[test]
    fn test_proxy_config_adds_volume_mounts() {
        use tempfile::tempdir;
        let clauderon_dir = tempdir().expect("Failed to create temp dir");
        let ca_cert_path = clauderon_dir.path().join("proxy-ca.pem");
        std::fs::write(&ca_cert_path, "dummy cert").expect("Failed to write cert");

        let proxy_config = DockerProxyConfig::new(18100, clauderon_dir.path().to_path_buf());
        let args = DockerBackend::build_create_args(
            "test-session",
            &PathBuf::from("/workspace"),
            &PathBuf::new(), // initial_workdir (empty = root)
            "test prompt",
            1000,
            Some(&proxy_config),
            AgentType::ClaudeCode,
            false, // print mode
            true,  // dangerous_skip_checks
            &[],   // no images
            None,  // git_user_name
            None,  // git_user_email
            None,  // session_id
            None,  // http_port
        )
        .expect("Failed to build args");

        // Should have proxy-ca.pem mount
        let has_ca_mount = args.iter().any(|a| a.contains("proxy-ca.pem"));
        assert!(has_ca_mount, "Expected proxy-ca.pem mount, got: {args:?}");
    }

    /// Test that no proxy config doesn't add env vars
    #[test]
    fn test_no_proxy_config() {
        let args = DockerBackend::build_create_args(
            "test-session",
            &PathBuf::from("/workspace"),
            &PathBuf::new(), // initial_workdir (empty = root)
            "test prompt",
            1000,
            None, // No proxy config
            AgentType::ClaudeCode,
            false, // print mode
            true,  // dangerous_skip_checks
            &[],   // no images
            None,  // git_user_name
            None,  // git_user_email
            None,  // session_id
            None,  // http_port
        )
        .expect("Failed to build args");

        // Should NOT have HTTPS_PROXY
        let has_https_proxy = args.iter().any(|a| a.contains("HTTPS_PROXY"));
        assert!(
            !has_https_proxy,
            "No proxy config should not add HTTPS_PROXY"
        );
    }

    /// Test that --add-host is always added for host.docker.internal resolution
    /// This is required for Linux and macOS with OrbStack
    #[test]
    fn test_host_docker_internal_always_added() {
        use tempfile::tempdir;
        let clauderon_dir = tempdir().expect("Failed to create temp dir");
        let ca_cert_path = clauderon_dir.path().join("proxy-ca.pem");
        std::fs::write(&ca_cert_path, "dummy cert").expect("Failed to write cert");

        let proxy_config = DockerProxyConfig::new(18100, clauderon_dir.path().to_path_buf());
        let args = DockerBackend::build_create_args(
            "test-session",
            &PathBuf::from("/workspace"),
            &PathBuf::new(), // initial_workdir (empty = root)
            "test prompt",
            1000,
            Some(&proxy_config),
            AgentType::ClaudeCode,
            false, // print mode
            true,  // dangerous_skip_checks
            &[],   // no images
            None,  // git_user_name
            None,  // git_user_email
            None,  // session_id
            None,  // http_port
        )
        .expect("Failed to build args");

        // Should have --add-host flag
        assert!(
            args.iter().any(|arg| arg == "--add-host"),
            "Expected --add-host flag, got: {args:?}"
        );

        // Should have host.docker.internal:host-gateway
        assert!(
            args.iter()
                .any(|arg| arg == "host.docker.internal:host-gateway"),
            "Expected host.docker.internal:host-gateway, got: {args:?}"
        );
    }

    /// Test that print mode adds --print --verbose flags
    #[test]
    fn test_print_mode_adds_flags() {
        let args = DockerBackend::build_create_args(
            "test-session",
            &PathBuf::from("/workspace"),
            &PathBuf::new(), // initial_workdir (empty = root)
            "test prompt",
            1000,
            None,
            AgentType::ClaudeCode,
            true, // print mode
            true, // dangerous_skip_checks
            &[],  // no images
            None, // git_user_name
            None, // git_user_email
            None, // session_id
            None, // http_port
        )
        .expect("Failed to build args");

        let cmd_arg = args.last().unwrap();
        assert!(
            cmd_arg.contains("--print"),
            "Print mode should include --print flag: {cmd_arg}"
        );
        assert!(
            cmd_arg.contains("--verbose"),
            "Print mode should include --verbose flag: {cmd_arg}"
        );
    }

    /// Test that interactive mode (non-print) does NOT have --print flag
    #[test]
    fn test_interactive_mode_no_print_flag() {
        let args = DockerBackend::build_create_args(
            "test-session",
            &PathBuf::from("/workspace"),
            &PathBuf::new(), // initial_workdir (empty = root)
            "test prompt",
            1000,
            None,
            AgentType::ClaudeCode,
            false, // interactive mode
            true,  // dangerous_skip_checks
            &[],   // no images
            None,  // git_user_name
            None,  // git_user_email
            None,  // session_id
            None,  // http_port
        )
        .expect("Failed to build args");

        let cmd_arg = args.last().unwrap();
        assert!(
            !cmd_arg.contains("--print"),
            "Interactive mode should NOT include --print flag: {cmd_arg}"
        );
    }

    /// Test that git worktrees get their parent .git directory mounted
    #[test]
    fn test_git_worktree_mounts_parent_git() {
        use tempfile::tempdir;

        // Create a fake worktree structure
        let temp_dir = tempdir().expect("Failed to create temp dir");
        let repo_git = temp_dir.path().join("repo/.git");
        let worktree_dir = temp_dir.path().join("worktree");

        // Create the directory structure
        std::fs::create_dir_all(&repo_git).expect("Failed to create repo .git");
        std::fs::create_dir_all(repo_git.join("worktrees/test"))
            .expect("Failed to create worktrees dir");
        std::fs::create_dir_all(&worktree_dir).expect("Failed to create worktree dir");

        // Create HEAD file in .git directory (required for validation)
        std::fs::write(repo_git.join("HEAD"), "ref: refs/heads/main")
            .expect("Failed to write HEAD");

        // Create a .git file that points to the parent repo
        let git_file_content = format!(
            "gitdir: {display}/worktrees/test",
            display = repo_git.display()
        );
        std::fs::write(worktree_dir.join(".git"), git_file_content)
            .expect("Failed to write .git file");

        // Build args with the worktree directory
        let args = DockerBackend::build_create_args(
            "test-session",
            &worktree_dir,
            &PathBuf::new(), // initial_workdir
            "test prompt",
            1000,
            None,
            AgentType::ClaudeCode,
            false, // print_mode
            true,  // dangerous_skip_checks
            &[],   // images
            None,  // git_user_name
            None,  // git_user_email
            None,  // session_id
            None,  // http_port
        )
        .expect("Failed to build args");

        // Should have workspace mount
        let has_workspace_mount = args.iter().any(|a| a.contains("/workspace"));
        assert!(
            has_workspace_mount,
            "Expected /workspace mount, got: {args:?}"
        );

        // Should also have parent .git directory mount (read-write for commits)
        // Use canonicalized path since the function resolves symlinks (e.g. /var -> /private/var on macOS)
        let canonical_git = repo_git.canonicalize().expect("Failed to canonicalize");
        let expected_git_mount = format!(
            "{display1}:{display2}",
            display1 = canonical_git.display(),
            display2 = canonical_git.display()
        );
        let has_git_mount = args.iter().any(|a| a == &expected_git_mount);
        assert!(
            has_git_mount,
            "Expected parent .git mount at {expected_git_mount}, got: {args:?}"
        );
    }

    /// Test that non-worktree directories don't get extra git mounts
    #[test]
    fn test_non_worktree_no_extra_mounts() {
        use tempfile::tempdir;

        let temp_dir = tempdir().expect("Failed to create temp dir");
        let test_dir = temp_dir.path().join("test-repo");
        std::fs::create_dir_all(&test_dir).expect("Failed to create test dir");

        // Create a normal .git directory (not a worktree)
        let git_dir = test_dir.join(".git");
        std::fs::create_dir_all(&git_dir).expect("Failed to create .git dir");

        let args = DockerBackend::build_create_args(
            "test-session",
            &test_dir,
            &PathBuf::new(), // initial_workdir (empty = root)
            "test prompt",
            1000,
            None,
            AgentType::ClaudeCode,
            false, // print_mode
            true,  // dangerous_skip_checks
            &[],   // images
            None,  // git_user_name
            None,  // git_user_email
            None,  // session_id
            None,  // http_port
        )
        .expect("Failed to build args");

        // Count volume mounts (should have workspace + 3 cargo/sccache cache mounts + clauderon dir + uploads + claude.json)
        let mount_count = args.iter().filter(|a| *a == "-v").count();
        assert_eq!(
            mount_count, 7,
            "Normal git repo should have workspace + 3 cache mounts + clauderon dir + uploads + claude.json, got {mount_count} mounts"
        );
    }

    /// Test that uploads directory is mounted
    #[test]
    fn test_uploads_directory_mounted() {
        use tempfile::tempdir;

        let temp_dir = tempdir().expect("Failed to create temp dir");
        let test_dir = temp_dir.path().join("test-repo");
        std::fs::create_dir_all(&test_dir).expect("Failed to create test dir");

        let args = DockerBackend::build_create_args(
            "test-session",
            &test_dir,
            &PathBuf::new(),
            "test prompt",
            1000,
            None,
            AgentType::ClaudeCode,
            false,
            true,
            &[],
            None,
            None,
            None,
            None,
        )
        .expect("Failed to build args");

        // Should have uploads mount
        let has_uploads_mount = args
            .iter()
            .any(|a| a.contains("/uploads:/workspace/.clauderon/uploads"));
        assert!(
            has_uploads_mount,
            "Expected uploads directory mount, got: {args:?}"
        );
    }

    /// Test that image paths are translated from host to container
    #[test]
    fn test_image_path_translation() {
        use tempfile::tempdir;

        let temp_dir = tempdir().expect("Failed to create temp dir");
        let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
        let session_id = uuid::Uuid::new_v4();
        let host_path = format!("{home}/.clauderon/uploads/{session_id}/test-image.png");

        let args = DockerBackend::build_create_args(
            "test-session",
            &temp_dir.path().to_path_buf(),
            &PathBuf::new(),
            "test prompt",
            1000,
            None,
            AgentType::ClaudeCode,
            false,
            true,
            &[host_path.clone()],
            None,
            None,
            None,
            None,
        )
        .expect("Failed to build args");

        let cmd_arg = args.last().unwrap();

        // Host path should NOT appear in command
        assert!(
            !cmd_arg.contains(&host_path),
            "Host path should be translated, not passed directly: {cmd_arg}"
        );

        // Container path SHOULD appear
        assert!(
            cmd_arg.contains("/workspace/.clauderon/uploads"),
            "Container path should be used: {cmd_arg}"
        );
    }

    /// Test git worktree with relative gitdir path
    #[test]
    fn test_git_worktree_relative_path() {
        use tempfile::tempdir;

        let temp_dir = tempdir().expect("Failed to create temp dir");
        let repo_git = temp_dir.path().join("repo/.git");
        let worktree_dir = temp_dir.path().join("repo/worktrees/test-worktree");

        // Create the directory structure
        std::fs::create_dir_all(&repo_git).expect("Failed to create repo .git");
        std::fs::create_dir_all(repo_git.join("worktrees/test"))
            .expect("Failed to create worktrees dir");
        std::fs::create_dir_all(&worktree_dir).expect("Failed to create worktree dir");
        std::fs::write(repo_git.join("HEAD"), "ref: refs/heads/main")
            .expect("Failed to write HEAD");

        // Create a .git file with RELATIVE path (common for worktrees in same repo tree)
        let git_file_content = "gitdir: ../../.git/worktrees/test";
        std::fs::write(worktree_dir.join(".git"), git_file_content)
            .expect("Failed to write .git file");

        // Build args - should resolve relative path correctly
        let args = DockerBackend::build_create_args(
            "test-session",
            &worktree_dir,
            &PathBuf::new(), // initial_workdir
            "test prompt",
            1000,
            None,
            AgentType::ClaudeCode,
            false, // print_mode
            true,  // dangerous_skip_checks
            &[],   // images
            None,  // git_user_name
            None,  // git_user_email
            None,  // session_id
            None,  // http_port
        )
        .expect("Failed to build args");

        // Should have parent .git directory mount
        let has_git_mount = args
            .iter()
            .any(|a| a.contains(&format!("{display}:", display = repo_git.display())));
        assert!(
            has_git_mount,
            "Expected parent .git mount for worktree with relative path, got: {args:?}"
        );
    }

    /// Test git worktree with trailing whitespace in .git file
    #[test]
    fn test_git_worktree_trailing_whitespace() {
        use tempfile::tempdir;

        let temp_dir = tempdir().expect("Failed to create temp dir");
        let repo_git = temp_dir.path().join("repo/.git");
        let worktree_dir = temp_dir.path().join("worktree");

        std::fs::create_dir_all(&repo_git).expect("Failed to create repo .git");
        std::fs::create_dir_all(repo_git.join("worktrees/test"))
            .expect("Failed to create worktrees dir");
        std::fs::create_dir_all(&worktree_dir).expect("Failed to create worktree dir");
        std::fs::write(repo_git.join("HEAD"), "ref: refs/heads/main")
            .expect("Failed to write HEAD");

        // Create .git file with trailing whitespace (common from manual editing)
        let git_file_content = format!(
            "gitdir: {display}/worktrees/test   \n",
            display = repo_git.display()
        );
        std::fs::write(worktree_dir.join(".git"), git_file_content)
            .expect("Failed to write .git file");

        let args = DockerBackend::build_create_args(
            "test-session",
            &worktree_dir,
            &PathBuf::new(), // initial_workdir
            "test prompt",
            1000,
            None,
            AgentType::ClaudeCode,
            false, // print_mode
            true,  // dangerous_skip_checks
            &[],   // images
            None,  // git_user_name
            None,  // git_user_email
            None,  // session_id
            None,  // http_port
        )
        .expect("Failed to build args");

        // Should still work despite whitespace
        let has_git_mount = args
            .iter()
            .any(|a| a.contains(&format!("{display}:", display = repo_git.display())));
        assert!(
            has_git_mount,
            "Expected parent .git mount despite trailing whitespace, got: {args:?}"
        );
    }

    /// Test that malformed .git files don't crash, just skip the mount
    #[test]
    fn test_malformed_git_file_graceful_failure() {
        use tempfile::tempdir;

        let temp_dir = tempdir().expect("Failed to create temp dir");
        let worktree_dir = temp_dir.path().join("worktree");
        std::fs::create_dir_all(&worktree_dir).expect("Failed to create worktree dir");

        // Create a malformed .git file (missing gitdir: line)
        std::fs::write(worktree_dir.join(".git"), "invalid content\n")
            .expect("Failed to write .git file");

        // Should not panic, just skip the git mount
        let args = DockerBackend::build_create_args(
            "test-session",
            &worktree_dir,
            &PathBuf::new(), // initial_workdir
            "test prompt",
            1000,
            None,
            AgentType::ClaudeCode,
            false, // print_mode
            true,  // dangerous_skip_checks
            &[],   // images
            None,  // git_user_name
            None,  // git_user_email
            None,  // session_id
            None,  // http_port
        )
        .expect("Failed to build args");

        // Should have workspace + 3 cache mounts + clauderon dir + uploads + claude.json (no git parent mount)
        let mount_count = args.iter().filter(|a| *a == "-v").count();
        assert_eq!(
            mount_count, 7,
            "Malformed worktree should have workspace + 3 cache mounts + clauderon dir + uploads + claude.json, got {mount_count} mounts"
        );
    }

    /// Test that missing parent .git directory is handled gracefully
    #[test]
    fn test_missing_parent_git_graceful_failure() {
        use tempfile::tempdir;

        let temp_dir = tempdir().expect("Failed to create temp dir");
        let worktree_dir = temp_dir.path().join("worktree");
        std::fs::create_dir_all(&worktree_dir).expect("Failed to create worktree dir");

        // Point to a non-existent parent .git directory
        let fake_git_path = temp_dir.path().join("nonexistent/.git/worktrees/test");
        let git_file_content = format!("gitdir: {display}", display = fake_git_path.display());
        std::fs::write(worktree_dir.join(".git"), git_file_content)
            .expect("Failed to write .git file");

        // Should not panic, just skip the git mount and log a warning
        let args = DockerBackend::build_create_args(
            "test-session",
            &worktree_dir,
            &PathBuf::new(), // initial_workdir
            "test prompt",
            1000,
            None,
            AgentType::ClaudeCode,
            false, // print_mode
            true,  // dangerous_skip_checks
            &[],   // images
            None,  // git_user_name
            None,  // git_user_email
            None,  // session_id
            None,  // http_port
        )
        .expect("Failed to build args");

        // Should have workspace + 3 cache mounts + clauderon dir + uploads + claude.json (no git parent mount due to validation failure)
        let mount_count = args.iter().filter(|a| *a == "-v").count();
        assert_eq!(
            mount_count, 7,
            "Worktree with missing parent should have workspace + 3 cache mounts + clauderon dir + uploads + claude.json, got {mount_count} mounts"
        );
    }

    /// Test that dangerous_skip_checks works without proxy
    #[test]
    fn test_dangerous_skip_checks_without_proxy() {
        let args = DockerBackend::build_create_args(
            "test-session",
            &PathBuf::from("/workspace"),
            &PathBuf::new(), // initial_workdir (empty = root)
            "test prompt",
            1000,
            None, // No proxy config
            AgentType::ClaudeCode,
            false, // print_mode
            true,  // dangerous_skip_checks = true
            &[],   // images
            None,  // git_user_name
            None,  // git_user_email
            None,  // session_id
            None,  // http_port
        )
        .expect("Failed to build args");

        // Should include --dangerously-skip-permissions flag
        let cmd_arg = args.last().unwrap();
        assert!(
            cmd_arg.contains("--dangerously-skip-permissions"),
            "Flag should be present even without proxy: {cmd_arg}"
        );

        // Should mount .claude.json with bypassPermissionsModeAccepted
        let has_claude_json = args.iter().any(|a| a.contains(".claude.json"));
        assert!(
            has_claude_json,
            "Should mount .claude.json even without proxy"
        );

        // Verify the mount includes the container path
        let claude_json_mount = args.iter().find(|a| a.contains(".claude.json")).unwrap();
        assert!(
            claude_json_mount.contains(":/workspace/.claude.json"),
            "Should mount to /workspace/.claude.json: {claude_json_mount}"
        );
    }

    /// Test that .claude.json is created without dangerous_skip_checks
    #[test]
    fn test_claude_json_without_dangerous_skip_checks() {
        let args = DockerBackend::build_create_args(
            "test-session",
            &PathBuf::from("/workspace"),
            &PathBuf::new(), // initial_workdir (empty = root)
            "test prompt",
            1000,
            None, // No proxy config
            AgentType::ClaudeCode,
            false, // print_mode
            false, // dangerous_skip_checks = false
            &[],   // images
            None,  // git_user_name
            None,  // git_user_email
            None,  // session_id
            None,  // http_port
        )
        .expect("Failed to build args");

        // Should still mount .claude.json (for onboarding)
        let has_claude_json = args.iter().any(|a| a.contains(".claude.json"));
        assert!(
            has_claude_json,
            "Should mount .claude.json for onboarding even without bypass mode"
        );
    }
}
