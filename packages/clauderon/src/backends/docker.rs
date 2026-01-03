use async_trait::async_trait;
use std::path::{Path, PathBuf};
use tokio::process::Command;

use super::traits::ExecutionBackend;

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

/// Detect if a directory is a git worktree and return the parent .git directory path
///
/// # Errors
///
/// Returns an error if the .git file cannot be read or paths cannot be resolved
fn detect_git_worktree(path: &Path) -> anyhow::Result<Option<PathBuf>> {
    let git_file = path.join(".git");

    // Check if .git exists and is a file (not a directory)
    if !git_file.exists() || !git_file.is_file() {
        return Ok(None);
    }

    // Read the gitdir reference
    let contents = std::fs::read_to_string(&git_file)?;
    let gitdir_line = contents
        .lines()
        .find(|line| line.starts_with("gitdir: "))
        .ok_or_else(|| anyhow::anyhow!("Invalid .git file format: missing 'gitdir:' line"))?;

    // Extract the path after "gitdir: " and trim whitespace
    let gitdir = gitdir_line.strip_prefix("gitdir: ").unwrap().trim();

    // Handle both absolute and relative paths
    // Git can use relative paths like "../.git/worktrees/name"
    let gitdir_path = if Path::new(gitdir).is_absolute() {
        PathBuf::from(gitdir)
    } else {
        // Resolve relative path from the worktree directory
        path.join(gitdir)
    };

    // Canonicalize to resolve symlinks and get absolute path
    // This also protects against path traversal attacks
    let canonical_gitdir = gitdir_path.canonicalize().map_err(|e| {
        anyhow::anyhow!(
            "Failed to canonicalize gitdir path {}: {}",
            gitdir_path.display(),
            e
        )
    })?;

    // The gitdir points to something like /path/to/repo/.git/worktrees/name
    // We need to get the parent .git directory: /path/to/repo/.git
    if let Some(worktrees) = canonical_gitdir.parent() {
        if let Some(git_parent) = worktrees.parent() {
            let parent_git = git_parent.to_path_buf();

            // Validate that the parent .git directory actually exists
            if !parent_git.exists() {
                anyhow::bail!(
                    "Parent .git directory does not exist: {}. \
                    The worktree may be corrupted or the parent repository may have been moved/deleted.",
                    parent_git.display()
                );
            }

            // Validate that it's actually a git directory
            if !parent_git.join("HEAD").exists() {
                anyhow::bail!(
                    "Parent directory exists but doesn't appear to be a valid git repository: {}",
                    parent_git.display()
                );
            }

            return Ok(Some(parent_git));
        }
    }

    Ok(None)
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

/// Proxy configuration for Docker containers.
#[derive(Debug, Clone, Default)]
pub struct DockerProxyConfig {
    /// Enable proxy support.
    pub enabled: bool,
    /// HTTP proxy port.
    pub http_proxy_port: u16,
    /// Path to the clauderon config directory (contains CA cert, kubeconfig, talosconfig).
    pub clauderon_dir: PathBuf,
    /// Session-specific proxy port (overrides http_proxy_port if set).
    pub session_proxy_port: Option<u16>,
}

impl DockerProxyConfig {
    /// Create a new proxy configuration.
    #[must_use]
    pub fn new(http_proxy_port: u16, clauderon_dir: PathBuf) -> Self {
        Self {
            enabled: true,
            http_proxy_port,
            clauderon_dir,
            session_proxy_port: None,
        }
    }

    /// Create a disabled proxy configuration.
    #[must_use]
    pub fn disabled() -> Self {
        Self::default()
    }
}

/// Docker container backend
pub struct DockerBackend {
    /// Proxy configuration.
    proxy_config: DockerProxyConfig,
}

impl DockerBackend {
    /// Create a new Docker backend without proxy support.
    #[must_use]
    pub const fn new() -> Self {
        Self {
            proxy_config: DockerProxyConfig {
                enabled: false,
                http_proxy_port: 0,
                clauderon_dir: PathBuf::new(),
                session_proxy_port: None,
            },
        }
    }

    /// Create a new Docker backend with proxy support.
    #[must_use]
    pub const fn with_proxy(proxy_config: DockerProxyConfig) -> Self {
        Self { proxy_config }
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
    /// * `print_mode` - If true, run in non-interactive mode with `--print --verbose` flags.
    ///                  The container will output the response and exit.
    ///                  If false, run interactively for `docker attach`.
    ///
    /// # Errors
    ///
    /// Returns an error if the proxy CA certificate is required but missing.
    pub fn build_create_args(
        name: &str,
        workdir: &Path,
        initial_prompt: &str,
        uid: u32,
        proxy_config: Option<&DockerProxyConfig>,
        print_mode: bool,
        dangerous_skip_checks: bool,
        images: &[String],
        git_user_name: Option<&str>,
        git_user_email: Option<&str>,
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
            format!("{}:/workspace", workdir.display()),
            "-w".to_string(),
            "/workspace".to_string(),
            "-e".to_string(),
            "TERM=xterm-256color".to_string(),
            "-e".to_string(),
            "HOME=/workspace".to_string(),
        ];

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

        // Mount .clauderon directory for hook socket communication
        // This allows Claude Code hooks inside the container to send status updates
        // to the daemon on the host via shared Unix sockets
        let home_dir = std::env::var("HOME").unwrap_or_else(|_| "/root".to_string());
        let clauderon_dir = format!("{}/.clauderon", home_dir);
        args.extend([
            "-v".to_string(),
            format!("{}:/workspace/.clauderon", clauderon_dir),
        ]);

        // Detect if workdir is a git worktree and mount parent .git directory
        match detect_git_worktree(workdir) {
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
                    format!("{}:{}", parent_git_dir.display(), parent_git_dir.display()),
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

        // Add proxy configuration if enabled
        if let Some(proxy) = proxy_config {
            if proxy.enabled {
                // Use session-specific port if available, otherwise use global port
                let port = proxy.session_proxy_port.unwrap_or(proxy.http_proxy_port);
                let clauderon_dir = &proxy.clauderon_dir;

                // Validate required files exist before attempting to mount them
                let ca_cert_path = clauderon_dir.join("proxy-ca.pem");
                let kube_config_dir = clauderon_dir.join("kube");
                let talos_config_dir = clauderon_dir.join("talos");

                // CA certificate is required - fail fast if missing
                if !ca_cert_path.exists() {
                    anyhow::bail!(
                        "Proxy CA certificate not found at {:?}. \
                        Ensure the clauderon daemon is running and initialized.",
                        ca_cert_path
                    );
                }

                // Check optional configs
                let has_kube_config = kube_config_dir.exists();
                let has_talos_config = talos_config_dir.exists();

                if !has_kube_config {
                    tracing::debug!(
                        "Kubeconfig not found at {:?}, skipping mount",
                        kube_config_dir
                    );
                }

                if !has_talos_config {
                    tracing::debug!(
                        "Talosconfig not found at {:?}, skipping mount",
                        talos_config_dir
                    );
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
                    // Set placeholder OAuth token - Claude Code uses this for auth
                    // The proxy will intercept API requests and inject the real OAuth token
                    "-e".to_string(),
                    "CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-clauderon-proxy-placeholder".to_string(),
                ]);

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
                    format!("{}:/etc/clauderon/proxy-ca.pem:ro", ca_cert_path.display()),
                ]);

                // Mount and configure Kubernetes if available
                if has_kube_config {
                    args.extend([
                        "-v".to_string(),
                        format!("{}:/etc/clauderon/kube:ro", kube_config_dir.display()),
                        "-e".to_string(),
                        "KUBECONFIG=/etc/clauderon/kube/config".to_string(),
                    ]);
                }

                // Mount and configure Talos if available
                if has_talos_config {
                    args.extend([
                        "-v".to_string(),
                        format!("{}:/etc/clauderon/talos:ro", talos_config_dir.display()),
                        "-e".to_string(),
                        "TALOSCONFIG=/etc/clauderon/talos/config".to_string(),
                    ]);
                }
            }
        }

        // Git user configuration from host
        // Set both AUTHOR and COMMITTER variables so git commits have proper attribution
        if let Some(name) = git_user_name {
            args.extend([
                "-e".to_string(),
                format!("GIT_AUTHOR_NAME={}", name),
                "-e".to_string(),
                format!("GIT_COMMITTER_NAME={}", name),
            ]);
        }
        if let Some(email) = git_user_email {
            args.extend([
                "-e".to_string(),
                format!("GIT_AUTHOR_EMAIL={}", email),
                "-e".to_string(),
                format!("GIT_COMMITTER_EMAIL={}", email),
            ]);
        }

        // NOTE: We intentionally do NOT create a fake .credentials.json file.
        // The ANTHROPIC_API_KEY env var is sufficient and avoids validation issues.
        // When a credentials file exists, Claude Code validates it against the API,
        // which would fail with our fake tokens. The env var path skips this validation.

        // Determine config directory - use proxy clauderon_dir if available, otherwise create temp dir
        // Note: When proxy is disabled, we create a temp directory for the session config.
        // These temp directories persist after container deletion and are cleaned up by the OS.
        // This is acceptable since the files are tiny (just .claude.json) and sessions are infrequent.
        let config_dir = if let Some(proxy) = proxy_config {
            proxy.clauderon_dir.clone()
        } else {
            // Create a temp directory for Claude config when proxy is disabled
            let temp_dir = std::env::temp_dir().join(format!("clauderon-{}", name));
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
                    format!("{}:/workspace/.claude.json", claude_json_path.display()),
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

        // Add image and command
        let claude_cmd = {
            use crate::agents::claude_code::ClaudeCodeAgent;
            use crate::agents::traits::Agent;

            let agent = ClaudeCodeAgent::new();
            let mut cmd_vec = agent.start_command(&escaped_prompt, images, dangerous_skip_checks);

            // Add print mode flags if enabled
            if print_mode {
                // Insert after "claude" but before other args
                cmd_vec.insert(1, "--print".to_string());
                cmd_vec.insert(2, "--verbose".to_string());
            }

            // Join all arguments into a shell command, properly quoting each argument
            cmd_vec
                .iter()
                .map(|arg| {
                    // Always quote arguments that contain special characters or spaces
                    if arg.contains('\'')
                        || arg.contains(' ')
                        || arg.contains('\n')
                        || arg.contains('&')
                        || arg.contains('|')
                    {
                        format!("'{}'", arg.replace('\'', "'\\''"))
                    } else {
                        arg.clone()
                    }
                })
                .collect::<Vec<_>>()
                .join(" ")
        };

        args.extend([
            DOCKER_IMAGE.to_string(),
            "bash".to_string(),
            "-c".to_string(),
            claude_cmd,
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

        let mut proxy_config = self.proxy_config.clone();

        // Override with session-specific proxy port if provided
        if let Some(session_port) = options.session_proxy_port {
            proxy_config.session_proxy_port = Some(session_port);
        }

        let proxy_config_ref = if proxy_config.enabled {
            Some(&proxy_config)
        } else {
            None
        };

        // Read git user configuration from the host
        let (git_user_name, git_user_email) = read_git_user_config().await;

        // Ensure cache directories exist before creating container
        // This prevents Docker from creating them as root when mounting named volumes
        Self::ensure_cache_directories(workdir);

        let args = Self::build_create_args(
            name,
            workdir,
            initial_prompt,
            uid,
            proxy_config_ref,
            options.print_mode,
            options.dangerous_skip_checks,
            &options.images,
            git_user_name.as_deref(),
            git_user_email.as_deref(),
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
        if let Err(e) = crate::hooks::install_hooks_in_container(&container_name).await {
            tracing::warn!(
                container_name = %container_name,
                error = %e,
                "Failed to install hooks in container (non-fatal), status tracking may not work"
            );
        }

        Ok(container_name)
    }

    /// Check if a Docker container exists
    ///
    /// # Errors
    ///
    /// Returns an error if the docker command fails to execute.
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
                print_mode: false,
                plan_mode: true, // Default to plan mode
                session_proxy_port: None,
                images: vec![],
                dangerous_skip_checks: false,
                session_id: None,
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
            "test prompt",
            1000,
            None,
            false, // interactive mode
            true,  // dangerous_skip_checks
            &[],   // no images
            None,  // git user name
            None,  // git user email
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
            "test prompt",
            uid,
            None,
            false, // print mode
            true,  // dangerous_skip_checks
            &[],   // no images
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

    /// Test that Rust caching is configured with cargo and sccache volumes
    #[test]
    fn test_rust_caching_configured() {
        let args = DockerBackend::build_create_args(
            "test-session",
            &PathBuf::from("/workspace"),
            "test prompt",
            1000,
            None,
            false, // print_mode
            true,  // dangerous_skip_checks
            &[],   // images
            None,  // git_user_name
            None,  // git_user_email
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
            prompt_with_quotes,
            1000,
            None,
            false, // print mode
            true,  // dangerous_skip_checks
            &[],   // no images
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
            "test prompt",
            1000,
            None,
            false, // print mode
            true,  // dangerous_skip_checks
            &[],   // no images
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

        // Create kube and talos directories so they get mounted
        let kube_dir = clauderon_dir.path().join("kube");
        let talos_dir = clauderon_dir.path().join("talos");
        std::fs::create_dir(&kube_dir).expect("Failed to create kube dir");
        std::fs::create_dir(&talos_dir).expect("Failed to create talos dir");
        std::fs::write(kube_dir.join("config"), "dummy").expect("Failed to write kube config");
        std::fs::write(talos_dir.join("config"), "dummy").expect("Failed to write talos config");

        let proxy_config = DockerProxyConfig::new(18080, clauderon_dir.path().to_path_buf());
        let args = DockerBackend::build_create_args(
            "test-session",
            &PathBuf::from("/workspace"),
            "test prompt",
            1000,
            Some(&proxy_config),
            false, // print mode
            true,  // dangerous_skip_checks
            &[],   // no images
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

        // Should have KUBECONFIG
        let has_kubeconfig = args.iter().any(|a| a.contains("KUBECONFIG"));
        assert!(has_kubeconfig, "Expected KUBECONFIG env var, got: {args:?}");
    }

    /// Test that proxy config adds volume mounts for configs
    #[test]
    fn test_proxy_config_adds_volume_mounts() {
        use tempfile::tempdir;
        let clauderon_dir = tempdir().expect("Failed to create temp dir");
        let ca_cert_path = clauderon_dir.path().join("proxy-ca.pem");
        std::fs::write(&ca_cert_path, "dummy cert").expect("Failed to write cert");

        // Create kube directory so it gets mounted
        let kube_dir = clauderon_dir.path().join("kube");
        std::fs::create_dir(&kube_dir).expect("Failed to create kube dir");
        std::fs::write(kube_dir.join("config"), "dummy").expect("Failed to write kube config");

        let proxy_config = DockerProxyConfig::new(18080, clauderon_dir.path().to_path_buf());
        let args = DockerBackend::build_create_args(
            "test-session",
            &PathBuf::from("/workspace"),
            "test prompt",
            1000,
            Some(&proxy_config),
            false, // print mode
            true,  // dangerous_skip_checks
            &[],   // no images
        )
        .expect("Failed to build args");

        // Should have proxy-ca.pem mount
        let has_ca_mount = args.iter().any(|a| a.contains("proxy-ca.pem"));
        assert!(has_ca_mount, "Expected proxy-ca.pem mount, got: {args:?}");

        // Should have kube config mount
        let has_kube_mount = args.iter().any(|a| a.contains("/etc/clauderon/kube:ro"));
        assert!(has_kube_mount, "Expected kube config mount, got: {args:?}");
    }

    /// Test that disabled proxy config doesn't add env vars
    #[test]
    fn test_disabled_proxy_config() {
        let proxy_config = DockerProxyConfig::disabled();
        let args = DockerBackend::build_create_args(
            "test-session",
            &PathBuf::from("/workspace"),
            "test prompt",
            1000,
            Some(&proxy_config),
            false, // print mode
            true,  // dangerous_skip_checks
            &[],   // no images
        )
        .expect("Failed to build args");

        // Should NOT have HTTPS_PROXY
        let has_https_proxy = args.iter().any(|a| a.contains("HTTPS_PROXY"));
        assert!(
            !has_https_proxy,
            "Disabled proxy should not add HTTPS_PROXY"
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

        let proxy_config = DockerProxyConfig::new(18080, clauderon_dir.path().to_path_buf());
        let args = DockerBackend::build_create_args(
            "test-session",
            &PathBuf::from("/workspace"),
            "test prompt",
            1000,
            Some(&proxy_config),
            false, // print mode
            true,  // dangerous_skip_checks
            &[],   // no images
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
            "test prompt",
            1000,
            None,
            true, // print mode
            &[],  // no images
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
            "test prompt",
            1000,
            None,
            false, // interactive mode
            &[],   // no images
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

        // Create a .git file that points to the parent repo
        let git_file_content = format!("gitdir: {}/worktrees/test", repo_git.display());
        std::fs::write(worktree_dir.join(".git"), git_file_content)
            .expect("Failed to write .git file");

        // Build args with the worktree directory
        let args = DockerBackend::build_create_args(
            "test-session",
            &worktree_dir,
            "test prompt",
            1000,
            None,
            false, // print_mode
            true,  // dangerous_skip_checks
            &[],   // images
            None,  // git_user_name
            None,  // git_user_email
        )
        .expect("Failed to build args");

        // Should have workspace mount
        let has_workspace_mount = args.iter().any(|a| a.contains("/workspace"));
        assert!(
            has_workspace_mount,
            "Expected /workspace mount, got: {args:?}"
        );

        // Should also have parent .git directory mount (read-write for commits)
        let expected_git_mount = format!("{}:{}", repo_git.display(), repo_git.display());
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
        let normal_dir = temp_dir.path().join("normal");
        std::fs::create_dir_all(&normal_dir).expect("Failed to create normal dir");

        // Create a normal .git directory (not a worktree)
        let git_dir = normal_dir.join(".git");
        std::fs::create_dir_all(&git_dir).expect("Failed to create .git dir");

        let args = DockerBackend::build_create_args(
            "test-session",
            &normal_dir,
            "test prompt",
            1000,
            None,
            false, // print_mode
            true,  // dangerous_skip_checks
            &[],   // images
            None,  // git_user_name
            None,  // git_user_email
        )
        .expect("Failed to build args");

        // Count volume mounts (should have workspace + 3 cargo/sccache cache mounts)
        let mount_count = args.iter().filter(|a| *a == "-v").count();
        assert_eq!(
            mount_count, 4,
            "Normal git repo should have workspace + 3 cache mounts, got {mount_count} mounts"
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
            "test prompt",
            1000,
            None,
            false, // print_mode
            true,  // dangerous_skip_checks
            &[],   // images
            None,  // git_user_name
            None,  // git_user_email
        )
        .expect("Failed to build args");

        // Should have parent .git directory mount
        let has_git_mount = args
            .iter()
            .any(|a| a.contains(&format!("{}:", repo_git.display())));
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
        let git_file_content = format!("gitdir: {}/worktrees/test   \n", repo_git.display());
        std::fs::write(worktree_dir.join(".git"), git_file_content)
            .expect("Failed to write .git file");

        let args = DockerBackend::build_create_args(
            "test-session",
            &worktree_dir,
            "test prompt",
            1000,
            None,
            false, // print_mode
            true,  // dangerous_skip_checks
            &[],   // images
            None,  // git_user_name
            None,  // git_user_email
        )
        .expect("Failed to build args");

        // Should still work despite whitespace
        let has_git_mount = args
            .iter()
            .any(|a| a.contains(&format!("{}:", repo_git.display())));
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
            "test prompt",
            1000,
            None,
            false, // print_mode
            true,  // dangerous_skip_checks
            &[],   // images
            None,  // git_user_name
            None,  // git_user_email
        )
        .expect("Failed to build args");

        // Should have workspace + 3 cache mounts (no git parent mount)
        let mount_count = args.iter().filter(|a| *a == "-v").count();
        assert_eq!(
            mount_count, 4,
            "Malformed worktree should have workspace + 3 cache mounts, got {mount_count} mounts"
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
        let git_file_content = format!("gitdir: {}", fake_git_path.display());
        std::fs::write(worktree_dir.join(".git"), git_file_content)
            .expect("Failed to write .git file");

        // Should not panic, just skip the git mount and log a warning
        let args = DockerBackend::build_create_args(
            "test-session",
            &worktree_dir,
            "test prompt",
            1000,
            None,
            false, // print_mode
            true,  // dangerous_skip_checks
            &[],   // images
            None,  // git_user_name
            None,  // git_user_email
        )
        .expect("Failed to build args");

        // Should have workspace + 3 cache mounts (no git parent mount due to validation failure)
        let mount_count = args.iter().filter(|a| *a == "-v").count();
        assert_eq!(
            mount_count, 4,
            "Worktree with missing parent should have workspace + 3 cache mounts, got {mount_count} mounts"
        );
    }

    /// Test that dangerous_skip_checks works without proxy
    #[test]
    fn test_dangerous_skip_checks_without_proxy() {
        let args = DockerBackend::build_create_args(
            "test-session",
            &PathBuf::from("/workspace"),
            "test prompt",
            1000,
            None,  // No proxy config
            false, // print_mode
            true,  // dangerous_skip_checks = true
            &[],   // images
            None,  // git_user_name
            None,  // git_user_email
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
            "test prompt",
            1000,
            None,  // No proxy config
            false, // print_mode
            false, // dangerous_skip_checks = false
            &[],   // images
            None,  // git_user_name
            None,  // git_user_email
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
