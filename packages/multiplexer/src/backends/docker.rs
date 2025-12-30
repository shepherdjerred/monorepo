use async_trait::async_trait;
use std::path::{Path, PathBuf};
use tokio::process::Command;

use super::traits::ExecutionBackend;

/// Docker container image to use
const DOCKER_IMAGE: &str = "ghcr.io/shepherdjerred/dotfiles";

/// Proxy configuration for Docker containers.
#[derive(Debug, Clone, Default)]
pub struct DockerProxyConfig {
    /// Enable proxy support.
    pub enabled: bool,
    /// HTTP proxy port.
    pub http_proxy_port: u16,
    /// Path to the mux config directory (contains CA cert, kubeconfig, talosconfig).
    pub mux_dir: PathBuf,
}

impl DockerProxyConfig {
    /// Create a new proxy configuration.
    #[must_use]
    pub fn new(http_proxy_port: u16, mux_dir: PathBuf) -> Self {
        Self {
            enabled: true,
            http_proxy_port,
            mux_dir,
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
                mux_dir: PathBuf::new(),
            },
        }
    }

    /// Create a new Docker backend with proxy support.
    #[must_use]
    pub fn with_proxy(proxy_config: DockerProxyConfig) -> Self {
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

    /// Build the docker run command arguments (exposed for testing)
    ///
    /// Returns all arguments that would be passed to `docker run`.
    #[must_use]
    pub fn build_create_args(
        name: &str,
        workdir: &Path,
        initial_prompt: &str,
        uid: u32,
        home_dir: &str,
        proxy_config: Option<&DockerProxyConfig>,
        dangerous_skip_checks: bool,
    ) -> Vec<String> {
        let container_name = format!("mux-{name}");
        let claude_config = format!("{home_dir}/.claude");
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
            "-v".to_string(),
            format!("{claude_config}:/workspace/.claude"),
            "-w".to_string(),
            "/workspace".to_string(),
            "-e".to_string(),
            "TERM=xterm-256color".to_string(),
            "-e".to_string(),
            "HOME=/workspace".to_string(),
        ];

        // Add proxy configuration if enabled
        if let Some(proxy) = proxy_config {
            if proxy.enabled {
                let port = proxy.http_proxy_port;
                let mux_dir = &proxy.mux_dir;

                // Validate required files exist before attempting to mount them
                let ca_cert_path = mux_dir.join("proxy-ca.pem");
                let kube_config_dir = mux_dir.join("kube");
                let talos_config_dir = mux_dir.join("talos");

                // CA certificate is required - fail fast if missing
                if !ca_cert_path.exists() {
                    panic!(
                        "Proxy CA certificate not found at {:?}. \
                        Ensure the multiplexer daemon is running and initialized.",
                        ca_cert_path
                    );
                }

                // Check optional configs
                let has_kube_config = kube_config_dir.exists();
                let has_talos_config = talos_config_dir.exists();

                if !has_kube_config {
                    tracing::debug!("Kubeconfig not found at {:?}, skipping mount", kube_config_dir);
                }

                if !has_talos_config {
                    tracing::debug!("Talosconfig not found at {:?}, skipping mount", talos_config_dir);
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
                    "GH_TOKEN=mux-proxy".to_string(),
                    "-e".to_string(),
                    "GITHUB_TOKEN=mux-proxy".to_string(),
                    // NOTE: Don't set ANTHROPIC_API_KEY - Claude Code will use OAuth from ~/.claude
                    // and the proxy will inject the real API key when intercepting requests
                ]);

                // SSL/TLS environment variables for CA trust
                args.extend([
                    "-e".to_string(),
                    "NODE_EXTRA_CA_CERTS=/etc/mux/proxy-ca.pem".to_string(),
                    "-e".to_string(),
                    "SSL_CERT_FILE=/etc/mux/proxy-ca.pem".to_string(),
                    "-e".to_string(),
                    "REQUESTS_CA_BUNDLE=/etc/mux/proxy-ca.pem".to_string(),
                ]);

                // Volume mounts for proxy configs (read-only)
                // CA certificate is always mounted (required)
                args.extend([
                    "-v".to_string(),
                    format!("{}:/etc/mux/proxy-ca.pem:ro", ca_cert_path.display()),
                ]);

                // Mount and configure Kubernetes if available
                if has_kube_config {
                    args.extend([
                        "-v".to_string(),
                        format!("{}:/etc/mux/kube:ro", kube_config_dir.display()),
                        "-e".to_string(),
                        "KUBECONFIG=/etc/mux/kube/config".to_string(),
                    ]);
                }

                // Mount and configure Talos if available
                if has_talos_config {
                    args.extend([
                        "-v".to_string(),
                        format!("{}:/etc/mux/talos:ro", talos_config_dir.display()),
                        "-e".to_string(),
                        "TALOSCONFIG=/etc/mux/talos/config".to_string(),
                    ]);
                }
            }
        }

        // Configure bypass permissions mode if enabled
        if dangerous_skip_checks {
            // Create managed settings file to suppress the bypass permissions warning
            let managed_settings_dir = if let Some(proxy) = proxy_config {
                proxy.mux_dir.clone()
            } else {
                // Use ~/.mux as fallback
                PathBuf::from(home_dir).join(".mux")
            };

            let managed_settings_path = managed_settings_dir.join("managed-settings.json");

            // Create the directory if it doesn't exist
            if let Err(e) = std::fs::create_dir_all(&managed_settings_dir) {
                tracing::warn!(
                    "Failed to create managed settings directory at {:?}: {}",
                    managed_settings_dir,
                    e
                );
            } else {
                // Write managed settings file
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
                    // Mount the managed settings file into the container
                    args.extend([
                        "-v".to_string(),
                        format!("{}:/etc/claude-code/managed-settings.json:ro", managed_settings_path.display()),
                    ]);
                }
            }
        }

        // Add image and command
        args.extend([
            DOCKER_IMAGE.to_string(),
            "bash".to_string(),
            "-c".to_string(),
            format!("claude --dangerously-skip-permissions '{escaped_prompt}'"),
        ]);

        args
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
        dangerous_skip_checks: bool,
    ) -> anyhow::Result<String> {
        // Create a container name from the session name
        let container_name = format!("mux-{name}");

        // Create the container with the worktree mounted
        // Run as current user to avoid root privileges (claude refuses --dangerously-skip-permissions as root)
        let uid = std::process::id();
        let home_dir = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());

        let proxy_config = if self.proxy_config.enabled {
            Some(&self.proxy_config)
        } else {
            None
        };

        let args = Self::build_create_args(name, workdir, initial_prompt, uid, &home_dir, proxy_config, dangerous_skip_checks);
        let output = Command::new("docker")
            .args(&args)
            .output()
            .await?;

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
        self.create(name, workdir, initial_prompt, false).await
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
            "/home/user",
            None,
            false,
        );

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

    /// Test that docker run includes --user flag with non-root UID
    #[test]
    fn test_create_runs_as_non_root() {
        let uid = 1000u32;
        let args = DockerBackend::build_create_args(
            "test-session",
            &PathBuf::from("/workspace"),
            "test prompt",
            uid,
            "/home/user",
            None,
            false,
        );

        // Find --user flag and verify it's followed by the UID
        let user_idx = args.iter().position(|a| a == "--user");
        assert!(user_idx.is_some(), "Expected --user flag, got: {args:?}");

        let uid_arg = &args[user_idx.unwrap() + 1];
        assert_eq!(
            uid_arg, "1000",
            "Expected UID 1000 after --user, got: {uid_arg}"
        );
    }

    /// Test that .claude config directory is mounted
    #[test]
    fn test_claude_config_mounted() {
        let args = DockerBackend::build_create_args(
            "test-session",
            &PathBuf::from("/workspace"),
            "test prompt",
            1000,
            "/home/user",
            None,
        );

        // Look for volume mount containing .claude
        let has_claude_mount = args.iter().any(|a| a.contains(".claude"));
        assert!(
            has_claude_mount,
            "Expected .claude volume mount, got: {args:?}"
        );
    }

    /// Test that .claude mount is writable (no :ro suffix)
    #[test]
    fn test_claude_config_writable() {
        let args = DockerBackend::build_create_args(
            "test-session",
            &PathBuf::from("/workspace"),
            "test prompt",
            1000,
            "/home/user",
            None,
        );

        // Find the .claude volume mount
        let claude_mount = args.iter().find(|a| a.contains(".claude"));
        assert!(claude_mount.is_some(), "Expected .claude mount");

        let mount = claude_mount.unwrap();
        assert!(
            !mount.ends_with(":ro"),
            "Claude config must be writable, not read-only: {mount}"
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
            "/home/user",
            None,
        );

        // Find the command argument (last one containing the prompt)
        let cmd_arg = args.last().unwrap();

        // Single quotes should be escaped as '\'' for shell safety
        assert!(
            cmd_arg.contains("'\\''"),
            "Single quotes should be escaped as '\\'': {cmd_arg}"
        );
    }

    /// Test that container name is prefixed with mux-
    #[test]
    fn test_container_name_prefixed() {
        let args = DockerBackend::build_create_args(
            "my-session",
            &PathBuf::from("/workspace"),
            "test prompt",
            1000,
            "/home/user",
            None,
        );

        // Find --name flag and verify the container name
        let name_idx = args.iter().position(|a| a == "--name");
        assert!(name_idx.is_some(), "Expected --name flag");

        let container_name = &args[name_idx.unwrap() + 1];
        assert!(
            container_name.starts_with("mux-"),
            "Container name should start with 'mux-': {container_name}"
        );
        assert_eq!(container_name, "mux-my-session");
    }

    /// Test that proxy config adds expected environment variables
    #[test]
    fn test_proxy_config_adds_env_vars() {
        let proxy_config = DockerProxyConfig::new(18080, PathBuf::from("/home/user/.mux"));
        let args = DockerBackend::build_create_args(
            "test-session",
            &PathBuf::from("/workspace"),
            "test prompt",
            1000,
            "/home/user",
            Some(&proxy_config),
        );

        // Should have HTTPS_PROXY
        let has_https_proxy = args.iter().any(|a| a.contains("HTTPS_PROXY"));
        assert!(has_https_proxy, "Expected HTTPS_PROXY env var, got: {args:?}");

        // Should have SSL_CERT_FILE
        let has_ssl_cert = args.iter().any(|a| a.contains("SSL_CERT_FILE"));
        assert!(has_ssl_cert, "Expected SSL_CERT_FILE env var, got: {args:?}");

        // Should have KUBECONFIG
        let has_kubeconfig = args.iter().any(|a| a.contains("KUBECONFIG"));
        assert!(has_kubeconfig, "Expected KUBECONFIG env var, got: {args:?}");
    }

    /// Test that proxy config adds volume mounts for configs
    #[test]
    fn test_proxy_config_adds_volume_mounts() {
        let proxy_config = DockerProxyConfig::new(18080, PathBuf::from("/home/user/.mux"));
        let args = DockerBackend::build_create_args(
            "test-session",
            &PathBuf::from("/workspace"),
            "test prompt",
            1000,
            "/home/user",
            Some(&proxy_config),
        );

        // Should have proxy-ca.pem mount
        let has_ca_mount = args.iter().any(|a| a.contains("proxy-ca.pem"));
        assert!(has_ca_mount, "Expected proxy-ca.pem mount, got: {args:?}");

        // Should have kube config mount
        let has_kube_mount = args.iter().any(|a| a.contains("/etc/mux/kube:ro"));
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
            "/home/user",
            Some(&proxy_config),
        );

        // Should NOT have HTTPS_PROXY
        let has_https_proxy = args.iter().any(|a| a.contains("HTTPS_PROXY"));
        assert!(!has_https_proxy, "Disabled proxy should not add HTTPS_PROXY");
    }

    /// Test that --add-host is always added for host.docker.internal resolution
    /// This is required for Linux and macOS with OrbStack
    #[test]
    fn test_host_docker_internal_always_added() {
        let proxy_config = DockerProxyConfig::new(18080, PathBuf::from("/tmp/mux"));
        let args = DockerBackend::build_create_args(
            "test-session",
            &PathBuf::from("/workspace"),
            "test prompt",
            1000,
            "/home/user",
            Some(&proxy_config),
        );

        // Should have --add-host flag
        assert!(
            args.iter().any(|arg| arg == "--add-host"),
            "Expected --add-host flag, got: {args:?}"
        );

        // Should have host.docker.internal:host-gateway
        assert!(
            args.iter().any(|arg| arg == "host.docker.internal:host-gateway"),
            "Expected host.docker.internal:host-gateway, got: {args:?}"
        );
    }
}
