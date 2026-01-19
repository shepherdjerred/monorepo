use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tokio::process::Command;
use tracing::instrument;

use super::apple_container_config::AppleContainerConfig;
use super::container_config::{ImageConfig, ResourceLimits};
use super::traits::{CreateOptions, ExecutionBackend};
use crate::core::AgentType;
use crate::plugins::{PluginDiscovery, PluginManifest};
use crate::proxy::{dummy_auth_json_string, dummy_config_toml, generate_plugin_config};

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

/// Proxy configuration for Apple Container.
#[derive(Debug, Clone)]
pub struct AppleContainerProxyConfig {
    /// Session-specific proxy port (required).
    pub session_proxy_port: u16,
    /// Path to the clauderon config directory (contains CA cert, talosconfig).
    pub clauderon_dir: PathBuf,
}

impl AppleContainerProxyConfig {
    /// Create a new proxy configuration.
    #[must_use]
    pub fn new(session_proxy_port: u16, clauderon_dir: PathBuf) -> Self {
        Self {
            session_proxy_port,
            clauderon_dir,
        }
    }
}

/// Apple Container backend
///
/// This backend uses Apple's native container runtime available on macOS 26+ with Apple silicon.
/// It provides lightweight containerization with sub-second start times through optimized VMs.
#[cfg(target_os = "macos")]
pub struct AppleContainerBackend {
    /// Path to clauderon directory for proxy CA and configs.
    clauderon_dir: PathBuf,
    /// Apple Container backend configuration (loaded from ~/.clauderon/apple-container-config.toml or defaults)
    config: AppleContainerConfig,
}

#[cfg(target_os = "macos")]
impl AppleContainerBackend {
    /// Create a new Apple Container backend.
    ///
    /// Loads configuration from `~/.clauderon/apple-container-config.toml` if present,
    /// otherwise uses default configuration.
    #[must_use]
    pub fn new() -> Self {
        let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("/tmp"));
        let config = AppleContainerConfig::load_or_default();
        Self {
            clauderon_dir: home.join(".clauderon"),
            config,
        }
    }

    /// Create an Apple Container backend with a specific clauderon directory.
    #[must_use]
    pub fn with_clauderon_dir(clauderon_dir: PathBuf) -> Self {
        let config = AppleContainerConfig::load_or_default();
        Self {
            clauderon_dir,
            config,
        }
    }

    /// Create an Apple Container backend with custom configuration (for testing).
    #[cfg(test)]
    #[must_use]
    pub fn with_config(config: AppleContainerConfig) -> Self {
        let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("/tmp"));
        Self {
            clauderon_dir: home.join(".clauderon"),
            config,
        }
    }

    /// Check if a container is running
    ///
    /// # Errors
    ///
    /// Returns an error if the container command fails to execute.
    pub async fn is_running(&self, name: &str) -> anyhow::Result<bool> {
        let output = Command::new("container")
            .args(["list", "--format", "json"])
            .output()
            .await?;

        if !output.status.success() {
            return Ok(false);
        }

        let stdout = String::from_utf8_lossy(&output.stdout);

        // Parse JSON output and check if our container is running
        #[derive(Deserialize)]
        struct ContainerInfo {
            name: String,
            status: String,
        }

        if let Ok(containers) = serde_json::from_str::<Vec<ContainerInfo>>(&stdout) {
            Ok(containers
                .iter()
                .any(|c| c.name == name && c.status.to_lowercase().contains("running")))
        } else {
            Ok(false)
        }
    }

    /// Ensure cache directories exist in workdir with correct permissions.
    ///
    /// Creates .cargo/registry, .cargo/git, and .cache/sccache directories if they don't exist.
    /// This prevents container runtime from creating them with wrong permissions.
    ///
    /// This is a best-effort operation - if directory creation fails, we log a warning and
    /// continue.
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
            } else {
                tracing::trace!(
                    path = %dir.display(),
                    "Created cache directory"
                );
            }
        }
    }

    /// Ensure cache volumes exist with correct ownership for the current user.
    ///
    /// Docker named volumes are created with root ownership by default. When containers
    /// run as non-root users, they can't write to these volumes.
    ///
    /// This function creates each cache volume and fixes ownership by running a small
    /// alpine container that chowns the volume contents to the specified UID:GID.
    ///
    /// This is idempotent - if the volume already has correct ownership, the chown
    /// is a fast no-op.
    #[instrument(skip(self))]
    async fn ensure_cache_volumes_with_ownership(&self, uid: u32, gid: u32) {
        let volumes = [
            "clauderon-cargo-registry",
            "clauderon-cargo-git",
            "clauderon-sccache",
        ];

        for volume_name in volumes {
            // Create volume if it doesn't exist (idempotent)
            let create_output = Command::new("docker")
                .args(["volume", "create", volume_name])
                .output()
                .await;

            if let Err(e) = create_output {
                tracing::warn!(
                    volume = volume_name,
                    error = %e,
                    "Failed to create Docker volume"
                );
                continue;
            }

            // Fix ownership using alpine container
            // This is fast if ownership is already correct (chown is a no-op)
            let chown_output = Command::new("docker")
                .args([
                    "run",
                    "--rm",
                    "-v",
                    &format!("{volume_name}:/vol"),
                    "alpine:latest",
                    "chown",
                    "-R",
                    &format!("{uid}:{gid}"),
                    "/vol",
                ])
                .output()
                .await;

            match chown_output {
                Ok(output) if output.status.success() => {
                    tracing::debug!(
                        volume = volume_name,
                        uid = uid,
                        gid = gid,
                        "Ensured volume ownership"
                    );
                }
                Ok(output) => {
                    let stderr = String::from_utf8_lossy(&output.stderr);
                    tracing::warn!(
                        volume = volume_name,
                        stderr = %stderr,
                        "Failed to fix volume ownership"
                    );
                }
                Err(e) => {
                    tracing::warn!(
                        volume = volume_name,
                        error = %e,
                        "Failed to run ownership fix container"
                    );
                }
            }
        }
    }

    /// Build the container run command arguments (exposed for testing)
    ///
    /// Returns all arguments that would be passed to `container run`.
    ///
    /// # Arguments
    ///
    /// * `print_mode` - If true, run in non-interactive mode.
    ///                  The container will output the response and exit.
    ///                  If false, run interactively for attachment.
    ///
    /// # Errors
    ///
    /// Returns an error if the proxy CA certificate is required but missing.
    #[allow(clippy::too_many_arguments)]
    pub fn build_create_args(
        name: &str,
        workdir: &Path,
        initial_workdir: &Path,
        initial_prompt: &str,
        uid: u32,
        proxy_config: Option<&AppleContainerProxyConfig>,
        agent: AgentType,
        print_mode: bool,
        dangerous_skip_checks: bool,
        images: &[String],
        git_user_name: Option<&str>,
        git_user_email: Option<&str>,
        session_id: Option<&uuid::Uuid>,
        http_port: Option<u16>,
        config: &AppleContainerConfig,
        image_override: Option<&ImageConfig>,
        resource_override: Option<&ResourceLimits>,
    ) -> anyhow::Result<Vec<String>> {
        let container_name = format!("clauderon-{name}");
        let escaped_prompt = initial_prompt.replace('\'', "'\\''");

        // Determine effective image configuration and pull policy (override > config > default)
        let (image_str, pull_policy) = if let Some(image_cfg) = image_override {
            // Validate override image
            image_cfg.validate()?;
            (image_cfg.image.as_str(), image_cfg.pull_policy)
        } else if let Some(ref img) = config.container_image {
            // Validate config image using ImageConfig validation
            let temp_config = ImageConfig {
                image: img.clone(),
                pull_policy: super::container_config::ImagePullPolicy::IfNotPresent,
                registry_auth: None,
            };
            temp_config.validate()?;
            (
                img.as_str(),
                super::container_config::ImagePullPolicy::IfNotPresent,
            )
        } else {
            // Use default image (no validation needed for hardcoded constant)
            (
                "ghcr.io/anthropics/claude-code",
                super::container_config::ImagePullPolicy::IfNotPresent,
            )
        };

        let mut args = vec!["run".to_string()];

        // Add pull policy flag if not default (IfNotPresent is the default)
        // Apple Container supports the same --pull flag as Docker
        if let Some(pull_flag) = pull_policy.to_docker_flag() {
            args.push("--pull".to_string());
            args.push(pull_flag.to_string());
        }

        args.extend(["-d".to_string(), "-i".to_string(), "-t".to_string()]);

        // Set container name
        args.extend(["--name".to_string(), container_name]);

        // Set user
        args.extend(["--user".to_string(), uid.to_string()]);

        // Add resource limits if configured
        let resource_limits = resource_override.or(config.resources.as_ref());
        if let Some(resources) = resource_limits {
            resources.validate()?;
            // Convert to Apple container format
            if let Some(ref cpu) = resources.cpu {
                args.extend(["--cpus".to_string(), cpu.clone()]);
            }
            if let Some(ref memory) = resources.memory {
                args.extend(["--memory".to_string(), memory.clone()]);
            }
        }

        // Mount workspace
        args.extend([
            "-v".to_string(),
            format!("{display}:/workspace", display = workdir.display()),
        ]);

        // Set working directory
        args.extend([
            "-w".to_string(),
            if initial_workdir.as_os_str().is_empty() {
                "/workspace".to_string()
            } else {
                format!("/workspace/{}", initial_workdir.display())
            },
        ]);

        // Environment variables
        args.extend([
            "-e".to_string(),
            "TERM=xterm-256color".to_string(),
            "-e".to_string(),
            "HOME=/workspace".to_string(),
        ]);

        if agent == AgentType::Codex {
            args.extend(["-e".to_string(), "CODEX_HOME=/workspace/.codex".to_string()]);
        }

        // Mount shared Rust cargo and sccache cache volumes
        args.extend([
            "-v".to_string(),
            "clauderon-cargo-registry:/workspace/.cargo/registry".to_string(),
            "-v".to_string(),
            "clauderon-cargo-git:/workspace/.cargo/git".to_string(),
            "-v".to_string(),
            "clauderon-sccache:/workspace/.cache/sccache".to_string(),
        ]);

        // Configure sccache
        args.extend([
            "-e".to_string(),
            "CARGO_HOME=/workspace/.cargo".to_string(),
            "-e".to_string(),
            "RUSTC_WRAPPER=sccache".to_string(),
            "-e".to_string(),
            "SCCACHE_DIR=/workspace/.cache/sccache".to_string(),
        ]);

        // Add hook communication environment variables
        if let (Some(sid), Some(port)) = (session_id, http_port) {
            args.extend([
                "-e".to_string(),
                format!("CLAUDERON_SESSION_ID={sid}"),
                "-e".to_string(),
                format!("CLAUDERON_HTTP_PORT={port}"),
            ]);
        }

        // Mount .clauderon directory
        let home_dir = std::env::var("HOME").unwrap_or_else(|_| "/root".to_string());
        let clauderon_dir = format!("{home_dir}/.clauderon");
        args.extend([
            "-v".to_string(),
            format!("{clauderon_dir}:/workspace/.clauderon"),
        ]);

        // Mount uploads directory
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
                tracing::debug!(
                    workdir = %workdir.display(),
                    "Not a git worktree, skipping parent .git mount"
                );
            }
            Err(e) => {
                tracing::warn!(
                    workdir = %workdir.display(),
                    error = %e,
                    "Failed to detect git worktree, git operations may not work correctly"
                );
            }
        }

        // Add proxy configuration
        if let Some(proxy) = proxy_config {
            let port = proxy.session_proxy_port;
            let clauderon_dir = &proxy.clauderon_dir;

            let ca_cert_path = clauderon_dir.join("proxy-ca.pem");
            let talos_config_dir = clauderon_dir.join("talos");

            if !ca_cert_path.exists() {
                anyhow::bail!(
                    "Proxy CA certificate not found at {}. \
                    Ensure the clauderon daemon is running and initialized.",
                    ca_cert_path.display()
                );
            }

            let has_talos_config = talos_config_dir.exists();

            // Create Codex config directories
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
                    if let Ok(contents) = dummy_auth_json_string(None) {
                        let _ = std::fs::write(&codex_auth_path, contents);
                    }
                }
                if !codex_config_path.exists() {
                    let _ = std::fs::write(&codex_config_path, dummy_config_toml());
                }
            }

            // Apple containers can reach the host via the gateway address 192.168.64.1
            // (not host.docker.internal which is Docker-specific).
            // See: https://github.com/apple/container/blob/main/docs/technical-overview.md
            args.extend([
                "-e".to_string(),
                format!("HTTP_PROXY=http://192.168.64.1:{port}"),
                "-e".to_string(),
                format!("HTTPS_PROXY=http://192.168.64.1:{port}"),
                "-e".to_string(),
                "NO_PROXY=localhost,127.0.0.1".to_string(),
            ]);

            // Set dummy tokens
            args.extend([
                "-e".to_string(),
                "GH_TOKEN=clauderon-proxy".to_string(),
                "-e".to_string(),
                "GITHUB_TOKEN=clauderon-proxy".to_string(),
            ]);

            match agent {
                AgentType::ClaudeCode => {
                    args.extend([
                        "-e".to_string(),
                        "CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-clauderon-proxy-placeholder"
                            .to_string(),
                    ]);
                }
                AgentType::Codex => {
                    args.extend([
                        "-e".to_string(),
                        "OPENAI_API_KEY=sk-openai-clauderon-proxy-placeholder".to_string(),
                        "-e".to_string(),
                        "CODEX_API_KEY=sk-openai-clauderon-proxy-placeholder".to_string(),
                    ]);
                }
                AgentType::Gemini => {
                    args.extend([
                        "-e".to_string(),
                        "GEMINI_API_KEY=sk-gemini-clauderon-proxy-placeholder".to_string(),
                    ]);
                }
            }

            // SSL/TLS environment variables
            args.extend([
                "-e".to_string(),
                "NODE_EXTRA_CA_CERTS=/etc/clauderon/proxy-ca.pem".to_string(),
                "-e".to_string(),
                "SSL_CERT_FILE=/etc/clauderon/proxy-ca.pem".to_string(),
                "-e".to_string(),
                "REQUESTS_CA_BUNDLE=/etc/clauderon/proxy-ca.pem".to_string(),
            ]);

            // Mount proxy configs
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

        // Git user configuration
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

        // Claude Code configuration
        if agent == AgentType::ClaudeCode {
            let config_dir = if let Some(proxy) = proxy_config {
                proxy.clauderon_dir.clone()
            } else {
                std::env::temp_dir().join(format!("clauderon-{name}"))
            };

            // Discover plugins
            let plugin_discovery = PluginDiscovery::new(
                dirs::home_dir()
                    .unwrap_or_else(|| PathBuf::from("/tmp"))
                    .join(".claude"),
            );
            let plugin_manifest = plugin_discovery.discover_plugins().unwrap_or_else(|e| {
                tracing::warn!("Failed to discover plugins: {}", e);
                PluginManifest::empty()
            });

            // Create config directory
            if let Err(e) = std::fs::create_dir_all(&config_dir) {
                tracing::warn!(
                    "Failed to create config directory at {:?}: {}",
                    config_dir,
                    e
                );
            } else {
                // Write claude.json
                let claude_json_path = config_dir.join("claude.json");
                let claude_json = if dangerous_skip_checks {
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
                    args.extend([
                        "-v".to_string(),
                        format!(
                            "{display}:/workspace/.claude.json",
                            display = claude_json_path.display()
                        ),
                    ]);
                }

                // Generate and mount plugin configuration
                if !plugin_manifest.installed_plugins.is_empty() {
                    if let Err(e) = generate_plugin_config(&config_dir, &plugin_manifest) {
                        tracing::warn!("Failed to generate plugin config: {}", e);
                    } else {
                        let plugin_config_path = config_dir.join("plugins/known_marketplaces.json");
                        if plugin_config_path.exists() {
                            args.extend([
                                "-v".to_string(),
                                format!(
                                    "{}:/workspace/.claude/plugins/known_marketplaces.json:ro",
                                    plugin_config_path.display()
                                ),
                            ]);
                        }

                        let host_plugins_dir = dirs::home_dir()
                            .unwrap_or_else(|| PathBuf::from("/tmp"))
                            .join(".claude/plugins/marketplaces");

                        if host_plugins_dir.exists() {
                            args.extend([
                                "-v".to_string(),
                                format!(
                                    "{}:/workspace/.claude/plugins/marketplaces:ro",
                                    host_plugins_dir.display()
                                ),
                            ]);
                            tracing::info!(
                                "Mounted {} plugins from {} to container",
                                plugin_manifest.installed_plugins.len(),
                                host_plugins_dir.display()
                            );
                        }
                    }
                }

                // Write managed settings for proxy
                if let Some(_proxy) = proxy_config {
                    let managed_settings_path = config_dir.join("managed-settings.json");
                    let managed_settings = r#"{
  "permissions": {
    "defaultMode": "bypassPermissions"
  }
}"#;
                    if std::fs::write(&managed_settings_path, managed_settings).is_ok() {
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

        // Build agent command
        let agent_cmd = {
            use crate::agents::traits::Agent;
            use crate::agents::{ClaudeCodeAgent, CodexAgent, GeminiCodeAgent};

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

            let translated_images: Vec<String> = images
                .iter()
                .map(|image_path| {
                    crate::utils::paths::translate_image_path_to_container(image_path)
                })
                .collect();

            match agent {
                AgentType::ClaudeCode => {
                    let mut cmd_vec = ClaudeCodeAgent::new().start_command(
                        &escaped_prompt,
                        &translated_images,
                        dangerous_skip_checks,
                        None,
                        None,
                    );

                    if print_mode {
                        cmd_vec.insert(1, "--print".to_string());
                        cmd_vec.insert(2, "--verbose".to_string());
                    }

                    if let Some(sid) = session_id {
                        let session_id_str = sid.to_string();
                        let mut create_cmd = vec!["claude".to_string()];
                        create_cmd.push("--session-id".to_string());
                        create_cmd.push(session_id_str.clone());
                        create_cmd.extend(cmd_vec.iter().skip(1).cloned());
                        let create_cmd_str = create_cmd
                            .iter()
                            .map(|a| quote_arg(a))
                            .collect::<Vec<_>>()
                            .join(" ");

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

                        let project_path = if initial_workdir.as_os_str().is_empty() {
                            "-workspace".to_string()
                        } else {
                            format!(
                                "-workspace-{}",
                                initial_workdir.display().to_string().replace('/', "-")
                            )
                        };

                        format!(
                            r#"SESSION_ID="{session_id}"
HISTORY_FILE="/workspace/.claude/projects/{project_path}/${{SESSION_ID}}.jsonl"
if [ -f "$HISTORY_FILE" ]; then
    echo "Resuming existing session $SESSION_ID"
    exec {resume_cmd}
else
    echo "Creating new session $SESSION_ID"
    exec {create_cmd}
fi"#,
                            session_id = session_id_str,
                            project_path = project_path,
                            resume_cmd = resume_cmd_str,
                            create_cmd = create_cmd_str,
                        )
                    } else {
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
                            cmd_vec.push(escaped_prompt);
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
                            None,
                        );
                        let create_cmd_str = create_cmd_vec
                            .iter()
                            .map(|a| quote_arg(a))
                            .collect::<Vec<_>>()
                            .join(" ");

                        format!("{codex_preamble}\n{create_cmd_str}")
                    }
                }
                AgentType::Gemini => {
                    let mut cmd_vec = GeminiCodeAgent::new().start_command(
                        &escaped_prompt,
                        &translated_images,
                        dangerous_skip_checks,
                        None,
                        None,
                    );

                    if print_mode {
                        cmd_vec.insert(1, "--print".to_string());
                        cmd_vec.insert(2, "--verbose".to_string());
                    }

                    cmd_vec
                        .iter()
                        .map(|arg| quote_arg(arg))
                        .collect::<Vec<_>>()
                        .join(" ")
                }
            }
        };

        // Add extra flags from config (advanced users only)
        for flag in &config.extra_flags {
            args.push(flag.clone());
        }

        // Add image and command
        args.push(image_str.to_string());
        args.push("sh".to_string());
        args.push("-c".to_string());
        args.push(agent_cmd);

        Ok(args)
    }

    /// Build the attach command arguments
    #[must_use]
    pub fn build_attach_args(name: &str) -> Vec<String> {
        vec![
            "bash".to_string(),
            "-c".to_string(),
            // Apple containers don't have attach, so we use exec with bash
            format!("container start {name} 2>/dev/null; container exec -i -t {name} bash"),
        ]
    }
}

#[cfg(target_os = "macos")]
impl Default for AppleContainerBackend {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(target_os = "macos")]
#[async_trait]
impl ExecutionBackend for AppleContainerBackend {
    /// Create a new Apple container with Claude Code
    ///
    /// # Errors
    ///
    /// Returns an error if the container command fails to execute.
    #[instrument(skip(self, initial_prompt, options), fields(name = %name, workdir = %workdir.display()))]
    async fn create(
        &self,
        name: &str,
        workdir: &Path,
        initial_prompt: &str,
        options: CreateOptions,
    ) -> anyhow::Result<String> {
        let container_name = format!("clauderon-{name}");

        tracing::info!(
            container_name = %container_name,
            workdir = %workdir.display(),
            agent = ?options.agent,
            "Creating Apple container"
        );

        // Get UID and GID using safe users crate
        let uid = users::get_current_uid();
        let gid = users::get_current_gid();

        // Ensure cache volumes exist with correct ownership before creating container
        // This fixes permission issues with Docker named volumes (which are created as root by default)
        self.ensure_cache_volumes_with_ownership(uid, gid).await;

        // Build proxy config
        let proxy_config = options.session_proxy_port.map(|session_port| {
            AppleContainerProxyConfig::new(session_port, self.clauderon_dir.clone())
        });

        let proxy_config_ref = proxy_config.as_ref();

        // Read git user configuration
        let (git_user_name, git_user_email) = read_git_user_config().await;

        // Ensure cache directories exist
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
            &self.config,
            options.container_image.as_ref(),
            options.container_resources.as_ref(),
        )?;

        let output = Command::new("container").args(&args).output().await?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            tracing::error!(
                container_name = %container_name,
                workdir = %workdir.display(),
                stderr = %stderr,
                "Failed to create Apple container"
            );
            anyhow::bail!("Failed to create Apple container: {stderr}");
        }

        let container_id = String::from_utf8_lossy(&output.stdout).trim().to_string();

        tracing::info!(
            container_id = %container_id,
            container_name = %container_name,
            workdir = %workdir.display(),
            "Created Apple container"
        );

        // Install hooks for Claude Code
        if options.agent == AgentType::ClaudeCode {
            if let Err(e) = crate::hooks::install_hooks_in_container(&container_name).await {
                tracing::warn!(
                    container_name = %container_name,
                    error = %e,
                    "Failed to install hooks in container (non-fatal)"
                );
            }
        }

        Ok(container_name)
    }

    /// Check if an Apple container exists
    ///
    /// # Errors
    ///
    /// Returns an error if the container command fails to execute.
    #[instrument(skip(self), fields(name = %name))]
    async fn exists(&self, name: &str) -> anyhow::Result<bool> {
        let output = Command::new("container")
            .args(["list", "--all", "--format", "json"])
            .output()
            .await?;

        if !output.status.success() {
            return Ok(false);
        }

        let stdout = String::from_utf8_lossy(&output.stdout);

        #[derive(Deserialize)]
        struct ContainerInfo {
            name: String,
        }

        if let Ok(containers) = serde_json::from_str::<Vec<ContainerInfo>>(&stdout) {
            Ok(containers.iter().any(|c| c.name == name))
        } else {
            Ok(false)
        }
    }

    /// Delete an Apple container
    ///
    /// # Errors
    ///
    /// Returns an error if the container command fails to execute.
    #[instrument(skip(self), fields(name = %name))]
    async fn delete(&self, name: &str) -> anyhow::Result<()> {
        // Stop the container first (ignore failure)
        let _ = Command::new("container")
            .args(["stop", name])
            .output()
            .await;

        // Delete the container
        let output = Command::new("container")
            .args(["delete", "--force", name])
            .output()
            .await?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            tracing::error!(
                container_name = %name,
                stderr = %stderr,
                "Failed to delete Apple container"
            );
            anyhow::bail!("Failed to delete Apple container: {stderr}");
        }

        tracing::info!(container_name = %name, "Deleted Apple container");
        Ok(())
    }

    /// Get the attach command for an Apple container
    fn attach_command(&self, name: &str) -> Vec<String> {
        Self::build_attach_args(name)
    }

    /// Get recent logs from an Apple container
    ///
    /// Note: Apple containers don't have a built-in `logs` command yet.
    /// This is a limitation of the platform.
    ///
    /// # Errors
    ///
    /// Returns an error indicating logs are not supported.
    #[instrument(skip(self), fields(name = %name, lines = %_lines))]
    async fn get_output(&self, name: &str, _lines: usize) -> anyhow::Result<String> {
        tracing::warn!(
            container_name = %name,
            "Apple Container backend does not support log retrieval yet"
        );
        anyhow::bail!(
            "Log retrieval not supported for Apple Container backend. \
            This is a platform limitation as the container CLI lacks a logs command."
        )
    }
}
