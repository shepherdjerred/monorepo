use async_trait::async_trait;
use std::path::Path;
use tokio::process::Command;

use super::traits::ExecutionBackend;

/// Docker container image to use
const DOCKER_IMAGE: &str = "ghcr.io/shepherdjerred/dotfiles";

/// Docker container backend
pub struct DockerBackend;

impl DockerBackend {
    /// Create a new Docker backend
    #[must_use]
    pub const fn new() -> Self {
        Self
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
    ) -> Vec<String> {
        let container_name = format!("mux-{name}");
        let claude_config = format!("{home_dir}/.claude");
        let escaped_prompt = initial_prompt.replace('\'', "'\\''");

        vec![
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
            DOCKER_IMAGE.to_string(),
            "bash".to_string(),
            "-c".to_string(),
            format!("claude --dangerously-skip-permissions '{escaped_prompt}'"),
        ]
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
    ) -> anyhow::Result<String> {
        // Create a container name from the session name
        let container_name = format!("mux-{name}");

        // Create the container with the worktree mounted
        // Run as current user to avoid root privileges (claude refuses --dangerously-skip-permissions as root)
        let uid = std::process::id();
        let home_dir = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());

        let args = Self::build_create_args(name, workdir, initial_prompt, uid, &home_dir);
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
        self.create(name, workdir, initial_prompt).await
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
}
