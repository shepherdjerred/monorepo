use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::time::Duration;
use tokio::process::Command;
use tracing::instrument;

use super::sprites_config::SpritesConfig;
use super::traits::{CreateOptions, ExecutionBackend};
use crate::core::session::{AgentType, SessionRepository};

/// Response from sprites.dev API for sprite information
#[derive(Debug, Deserialize)]
struct SpriteInfo {
    name: String,
    status: String,
    #[serde(default)]
    url: Option<String>,
}

/// Response from exec command
#[derive(Debug, Deserialize)]
struct ExecResponse {
    stdout: String,
    stderr: String,
    #[serde(rename = "exitCode")]
    exit_code: i32,
}

/// Sprites.dev backend implementation
///
/// Uses sprites.dev REST API to create hardware-isolated Firecracker containers
/// with persistent ext4 filesystems. Unlike Docker/Kubernetes, sprites cannot mount
/// local directories, so this backend clones git repositories from remotes.
pub struct SpritesBackend {
    client: reqwest::Client,
    config: SpritesConfig,
    base_url: String,
}

impl SpritesBackend {
    /// Create a new Sprites backend.
    ///
    /// Loads configuration from `~/.clauderon/sprites-config.toml` if present,
    /// otherwise uses default configuration.
    #[must_use]
    pub fn new() -> Self {
        let config = SpritesConfig::load_or_default();
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(300)) // 5 minute timeout for long operations
            .build()
            .unwrap_or_else(|_| reqwest::Client::new());

        Self {
            client,
            config,
            base_url: "https://api.sprites.dev/v1/sprites".to_string(),
        }
    }

    /// Create a Sprites backend with custom configuration (for testing).
    #[cfg(test)]
    #[must_use]
    pub fn with_config(config: SpritesConfig) -> Self {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(300))
            .build()
            .unwrap_or_else(|_| reqwest::Client::new());

        Self {
            client,
            config,
            base_url: "https://api.sprites.dev/v1/sprites".to_string(),
        }
    }

    /// Get the authentication token from config or environment
    fn get_token(&self) -> anyhow::Result<String> {
        self.config.get_token()
    }

    /// Create a sprite via PUT API call
    ///
    /// # Errors
    ///
    /// Returns an error if the API request fails or sprite creation is rejected.
    #[instrument(skip(self))]
    async fn create_sprite(&self, name: &str) -> anyhow::Result<()> {
        let token = self.get_token()?;
        let url = format!("{}/{}", self.base_url, name);

        tracing::info!(
            sprite_name = %name,
            image = %self.config.image.base_image,
            cpu = ?self.config.resources.cpu,
            memory = ?self.config.resources.memory,
            "Creating sprite"
        );

        let mut body = serde_json::json!({
            "image": self.config.image.base_image,
        });

        // Add resource limits if configured
        if let Some(cpu) = self.config.resources.cpu {
            body["cpu"] = serde_json::json!(cpu);
        }
        if let Some(memory) = self.config.resources.memory {
            body["memory"] = serde_json::json!(format!("{}Gi", memory));
        }

        // Add network policy configuration
        body["network_policy"] = serde_json::json!(self.config.network.default_policy.to_string());
        if self.config.network.default_policy
            == crate::backends::sprites_config::NetworkPolicy::AllowList
        {
            body["allowed_domains"] = serde_json::json!(self.config.network.allowed_domains);
        }

        let response = self
            .client
            .put(&url)
            .bearer_auth(token)
            .json(&body)
            .send()
            .await
            .map_err(|e| anyhow::anyhow!("Failed to send create sprite request: {}", e))?;

        let status = response.status();
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            anyhow::bail!(
                "Failed to create sprite '{}' (HTTP {}): {}",
                name,
                status,
                body
            );
        }

        tracing::info!(sprite_name = %name, "Sprite creation initiated");
        Ok(())
    }

    /// Wait for sprite to be ready (running status)
    ///
    /// Polls the sprite status endpoint until it reports "running" status.
    ///
    /// # Errors
    ///
    /// Returns an error if polling fails or sprite never becomes ready.
    #[instrument(skip(self))]
    async fn wait_for_ready(&self, name: &str, timeout_secs: u64) -> anyhow::Result<()> {
        let token = self.get_token()?;
        let url = format!("{}/{}", self.base_url, name);
        let start = std::time::Instant::now();
        let timeout = Duration::from_secs(timeout_secs);

        tracing::info!(
            sprite_name = %name,
            timeout_secs = timeout_secs,
            "Waiting for sprite to be ready"
        );

        loop {
            if start.elapsed() > timeout {
                anyhow::bail!(
                    "Timeout waiting for sprite '{}' to be ready after {} seconds",
                    name,
                    timeout_secs
                );
            }

            let response = self
                .client
                .get(&url)
                .bearer_auth(&token)
                .send()
                .await
                .map_err(|e| anyhow::anyhow!("Failed to check sprite status: {}", e))?;

            if !response.status().is_success() {
                let status = response.status();
                let body = response.text().await.unwrap_or_default();
                anyhow::bail!(
                    "Failed to get sprite '{}' status (HTTP {}): {}",
                    name,
                    status,
                    body
                );
            }

            let sprite_info: SpriteInfo = response
                .json()
                .await
                .map_err(|e| anyhow::anyhow!("Failed to parse sprite status response: {}", e))?;

            tracing::debug!(
                sprite_name = %name,
                status = %sprite_info.status,
                "Sprite status check"
            );

            if sprite_info.status == "running" {
                tracing::info!(sprite_name = %name, "Sprite is ready");
                return Ok(());
            }

            if sprite_info.status == "failed" || sprite_info.status == "error" {
                anyhow::bail!("Sprite '{}' failed to start: {}", name, sprite_info.status);
            }

            // Wait before next poll
            tokio::time::sleep(Duration::from_secs(2)).await;
        }
    }

    /// Execute a command in a sprite
    ///
    /// # Errors
    ///
    /// Returns an error if the API request fails.
    #[instrument(skip(self, command))]
    async fn sprite_exec(&self, name: &str, command: Vec<String>) -> anyhow::Result<ExecResponse> {
        let token = self.get_token()?;
        let url = format!("{}/{}/exec", self.base_url, name);

        tracing::debug!(
            sprite_name = %name,
            command = ?command,
            "Executing command in sprite"
        );

        let body = serde_json::json!({
            "command": command,
        });

        let response = self
            .client
            .post(&url)
            .bearer_auth(token)
            .json(&body)
            .send()
            .await
            .map_err(|e| {
                anyhow::anyhow!("Failed to send exec request to sprite '{}': {}", name, e)
            })?;

        let status = response.status();
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            anyhow::bail!(
                "Failed to execute command in sprite '{}' (HTTP {}): {}",
                name,
                status,
                body
            );
        }

        let exec_response: ExecResponse = response.json().await.map_err(|e| {
            anyhow::anyhow!(
                "Failed to parse exec response from sprite '{}': {}",
                name,
                e
            )
        })?;

        tracing::debug!(
            sprite_name = %name,
            exit_code = exec_response.exit_code,
            "Command executed"
        );

        Ok(exec_response)
    }

    /// Get sprite information
    ///
    /// # Errors
    ///
    /// Returns an error if the API request fails.
    #[instrument(skip(self))]
    async fn get_sprite_info(&self, name: &str) -> anyhow::Result<SpriteInfo> {
        let token = self.get_token()?;
        let url = format!("{}/{}", self.base_url, name);

        let response = self
            .client
            .get(&url)
            .bearer_auth(token)
            .send()
            .await
            .map_err(|e| anyhow::anyhow!("Failed to get sprite '{}' info: {}", name, e))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            anyhow::bail!(
                "Failed to get sprite '{}' info (HTTP {}): {}",
                name,
                status,
                body
            );
        }

        let sprite_info: SpriteInfo = response
            .json()
            .await
            .map_err(|e| anyhow::anyhow!("Failed to parse sprite info for '{}': {}", name, e))?;

        Ok(sprite_info)
    }

    /// Detect git remote URL from local worktree
    ///
    /// # Errors
    ///
    /// Returns an error if git command fails or no remote is configured.
    #[instrument(skip(self))]
    async fn get_git_remote(&self, workdir: &Path) -> anyhow::Result<String> {
        tracing::debug!(workdir = %workdir.display(), "Detecting git remote URL");

        let output = Command::new("git")
            .args(["remote", "get-url", "origin"])
            .current_dir(workdir)
            .output()
            .await
            .map_err(|e| {
                anyhow::anyhow!(
                    "Failed to execute git command in {}: {}",
                    workdir.display(),
                    e
                )
            })?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            anyhow::bail!(
                "Failed to get git remote URL from {} (git exited with {}): {}",
                workdir.display(),
                output.status,
                stderr
            );
        }

        let url = String::from_utf8(output.stdout)
            .map_err(|e| anyhow::anyhow!("Invalid UTF-8 in git remote URL: {}", e))?
            .trim()
            .to_string();

        if url.is_empty() {
            anyhow::bail!("No git remote configured for {}", workdir.display());
        }

        tracing::info!(
            workdir = %workdir.display(),
            remote_url = %url,
            "Detected git remote"
        );

        Ok(url)
    }

    /// Get current branch from local worktree
    ///
    /// # Errors
    ///
    /// Returns an error if git command fails.
    #[instrument(skip(self))]
    async fn get_current_branch(&self, workdir: &Path) -> anyhow::Result<String> {
        let output = Command::new("git")
            .args(["rev-parse", "--abbrev-ref", "HEAD"])
            .current_dir(workdir)
            .output()
            .await
            .map_err(|e| {
                anyhow::anyhow!(
                    "Failed to execute git command in {}: {}",
                    workdir.display(),
                    e
                )
            })?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            anyhow::bail!(
                "Failed to get current branch from {}: {}",
                workdir.display(),
                stderr
            );
        }

        let branch = String::from_utf8(output.stdout)
            .map_err(|e| anyhow::anyhow!("Invalid UTF-8 in branch name: {}", e))?
            .trim()
            .to_string();

        Ok(branch)
    }

    /// Clone repositories into the sprite
    ///
    /// # Errors
    ///
    /// Returns an error if git clone fails for any repository.
    #[instrument(skip(self, repositories))]
    async fn setup_repositories(
        &self,
        sprite_name: &str,
        repositories: &[SessionRepository],
    ) -> anyhow::Result<()> {
        tracing::info!(
            sprite_name = %sprite_name,
            repo_count = repositories.len(),
            "Setting up repositories in sprite"
        );

        // Create base repos directory
        self.sprite_exec(
            sprite_name,
            vec![
                "mkdir".to_string(),
                "-p".to_string(),
                "/home/sprite/repos".to_string(),
            ],
        )
        .await
        .map_err(|e| anyhow::anyhow!("Failed to create repos directory in sprite: {}", e))?;

        for repo in repositories {
            tracing::info!(
                sprite_name = %sprite_name,
                mount_name = %repo.mount_name,
                branch = %repo.branch_name,
                is_primary = repo.is_primary,
                "Cloning repository"
            );

            // Get git remote URL from local worktree
            let remote_url = self
                .get_git_remote(&repo.worktree_path)
                .await
                .map_err(|e| {
                    anyhow::anyhow!(
                        "Failed to get git remote for {} ({}): {}. \
                    Sprites backend requires git repositories with configured remotes.",
                        repo.mount_name,
                        repo.repo_path.display(),
                        e
                    )
                })?;

            // Determine target path in sprite
            let target_path = if repo.is_primary {
                "/home/sprite/workspace".to_string()
            } else {
                format!("/home/sprite/repos/{}", repo.mount_name)
            };

            // Build clone command
            let mut clone_args = vec![
                "git".to_string(),
                "clone".to_string(),
                "--branch".to_string(),
                repo.branch_name.clone(),
                "--single-branch".to_string(),
            ];

            // Add shallow clone flags if configured
            if self.config.git.shallow_clone {
                clone_args.push("--depth".to_string());
                clone_args.push("1".to_string());
            }

            clone_args.push(remote_url.clone());
            clone_args.push(target_path.clone());

            // Clone the repository
            let clone_result = self.sprite_exec(sprite_name, clone_args).await?;

            if clone_result.exit_code != 0 {
                tracing::error!(
                    sprite_name = %sprite_name,
                    mount_name = %repo.mount_name,
                    remote_url = %remote_url,
                    branch = %repo.branch_name,
                    stderr = %clone_result.stderr,
                    "Failed to clone repository"
                );
                anyhow::bail!(
                    "Failed to clone repository '{}' (branch '{}') into sprite: {}",
                    repo.mount_name,
                    repo.branch_name,
                    clone_result.stderr
                );
            }

            tracing::info!(
                sprite_name = %sprite_name,
                mount_name = %repo.mount_name,
                target_path = %target_path,
                "Repository cloned successfully"
            );
        }

        Ok(())
    }

    /// Check if Claude Code is installed in the sprite
    ///
    /// # Errors
    ///
    /// Returns an error if exec command fails (not if Claude Code is missing).
    #[instrument(skip(self))]
    async fn is_claude_installed(&self, sprite_name: &str) -> anyhow::Result<bool> {
        let result = self
            .sprite_exec(sprite_name, vec!["which".to_string(), "claude".to_string()])
            .await?;

        Ok(result.exit_code == 0)
    }

    /// Install Claude Code in the sprite
    ///
    /// # Errors
    ///
    /// Returns an error if installation fails.
    #[instrument(skip(self))]
    async fn install_claude(&self, sprite_name: &str) -> anyhow::Result<()> {
        tracing::info!(sprite_name = %sprite_name, "Installing Claude Code");

        // Install dependencies first
        if !self.config.image.packages.is_empty() {
            tracing::info!(
                sprite_name = %sprite_name,
                packages = ?self.config.image.packages,
                "Installing additional packages"
            );

            let mut install_cmd = vec![
                "apt-get".to_string(),
                "update".to_string(),
                "&&".to_string(),
                "apt-get".to_string(),
                "install".to_string(),
                "-y".to_string(),
            ];
            install_cmd.extend(self.config.image.packages.iter().cloned());

            let result = self.sprite_exec(sprite_name, install_cmd).await?;
            if result.exit_code != 0 {
                tracing::warn!(
                    sprite_name = %sprite_name,
                    stderr = %result.stderr,
                    "Failed to install packages"
                );
            }
        }

        // Install Claude Code using the official installation script
        // Use configured installation URL
        let install_script = format!("curl -fsSL {} | sh", self.config.image.claude_install_url);

        let result = self
            .sprite_exec(
                sprite_name,
                vec!["sh".to_string(), "-c".to_string(), install_script],
            )
            .await?;

        if result.exit_code != 0 {
            tracing::error!(
                sprite_name = %sprite_name,
                stderr = %result.stderr,
                "Failed to install Claude Code"
            );
            anyhow::bail!(
                "Failed to install Claude Code in sprite '{}': {}",
                sprite_name,
                result.stderr
            );
        }

        tracing::info!(sprite_name = %sprite_name, "Claude Code installed successfully");
        Ok(())
    }

    /// Start the agent in a detached session (tmux or screen)
    ///
    /// # Errors
    ///
    /// Returns an error if agent startup fails.
    #[instrument(skip(self, initial_prompt))]
    async fn start_agent(
        &self,
        sprite_name: &str,
        agent: AgentType,
        initial_prompt: &str,
        workdir: &Path,
        dangerous_skip_checks: bool,
        images: &[String],
    ) -> anyhow::Result<()> {
        tracing::info!(
            sprite_name = %sprite_name,
            agent = ?agent,
            "Starting agent in sprite"
        );

        // Escape the prompt for shell
        let escaped_prompt = initial_prompt.replace('\'', "'\\''");

        // Build the agent command
        let agent_cmd = match agent {
            AgentType::ClaudeCode => {
                let mut cmd = format!("claude '{}'", escaped_prompt);
                if dangerous_skip_checks {
                    cmd.push_str(" --bypass-permissions");
                }
                for image in images {
                    use std::fmt::Write;
                    let _ = write!(cmd, " --image '{}'", image.replace('\'', "'\\''"));
                }
                cmd
            }
            AgentType::Codex => {
                format!("codex exec '{}'", escaped_prompt)
            }
            AgentType::Gemini => {
                format!("gemini '{}'", escaped_prompt)
            }
        };

        // Determine working directory
        let work_path = if workdir.as_os_str().is_empty() {
            "/home/sprite/workspace".to_string()
        } else {
            format!("/home/sprite/workspace/{}", workdir.display())
        };

        // Start agent in a tmux session for persistence
        let tmux_cmd = format!(
            "tmux new-session -d -s clauderon -c '{}' '{}'",
            work_path, agent_cmd
        );

        let result = self
            .sprite_exec(
                sprite_name,
                vec!["sh".to_string(), "-c".to_string(), tmux_cmd],
            )
            .await?;

        if result.exit_code != 0 {
            tracing::error!(
                sprite_name = %sprite_name,
                stderr = %result.stderr,
                "Failed to start agent"
            );
            anyhow::bail!(
                "Failed to start agent in sprite '{}': {}",
                sprite_name,
                result.stderr
            );
        }

        tracing::info!(
            sprite_name = %sprite_name,
            agent = ?agent,
            "Agent started successfully"
        );

        Ok(())
    }

    /// Generate a sprite name from session name
    ///
    /// Follows Docker convention: clauderon-{session-name}
    fn sprite_name_from_session(session_name: &str) -> String {
        format!("clauderon-{}", session_name)
    }
}

#[async_trait]
impl ExecutionBackend for SpritesBackend {
    #[instrument(skip(self, initial_prompt, options), fields(name = %name))]
    async fn create(
        &self,
        name: &str,
        workdir: &Path,
        initial_prompt: &str,
        options: CreateOptions,
    ) -> anyhow::Result<String> {
        let sprite_name = Self::sprite_name_from_session(name);

        tracing::info!(
            session_name = %name,
            sprite_name = %sprite_name,
            agent = ?options.agent,
            "Creating sprite session"
        );

        // Step 1: Create the sprite
        self.create_sprite(&sprite_name)
            .await
            .map_err(|e| anyhow::anyhow!("Failed to create sprite '{}': {}", sprite_name, e))?;

        // Step 2: Wait for sprite to be ready
        self.wait_for_ready(&sprite_name, 120).await.map_err(|e| {
            anyhow::anyhow!("Sprite '{}' failed to become ready: {}", sprite_name, e)
        })?;

        // Step 3: Setup repositories
        let repositories = if options.repositories.is_empty() {
            // Legacy single-repo mode: Create a SessionRepository from workdir
            let branch = self.get_current_branch(workdir).await.unwrap_or_else(|e| {
                tracing::warn!(
                    workdir = %workdir.display(),
                    error = %e,
                    "Failed to get current branch, using 'main'"
                );
                "main".to_string()
            });

            vec![SessionRepository {
                repo_path: workdir.to_path_buf(),
                subdirectory: options.initial_workdir.clone(),
                worktree_path: workdir.to_path_buf(),
                branch_name: branch,
                mount_name: "primary".to_string(),
                is_primary: true,
            }]
        } else {
            options.repositories
        };

        self.setup_repositories(&sprite_name, &repositories)
            .await
            .map_err(|e| {
                anyhow::anyhow!(
                    "Failed to setup repositories in sprite '{}': {}",
                    sprite_name,
                    e
                )
            })?;

        // Step 4: Install Claude Code if needed and configured
        if self.config.image.install_claude && options.agent == AgentType::ClaudeCode {
            let claude_installed = self
                .is_claude_installed(&sprite_name)
                .await
                .unwrap_or(false);

            if !claude_installed {
                tracing::info!(sprite_name = %sprite_name, "Claude Code not found, installing");
                self.install_claude(&sprite_name).await.map_err(|e| {
                    anyhow::anyhow!(
                        "Failed to install Claude Code in sprite '{}': {}",
                        sprite_name,
                        e
                    )
                })?;
            } else {
                tracing::info!(sprite_name = %sprite_name, "Claude Code already installed");
            }
        }

        // Step 5: Start the agent
        self.start_agent(
            &sprite_name,
            options.agent,
            initial_prompt,
            &options.initial_workdir,
            options.dangerous_skip_checks,
            &options.images,
        )
        .await
        .map_err(|e| anyhow::anyhow!("Failed to start agent in sprite '{}': {}", sprite_name, e))?;

        tracing::info!(
            session_name = %name,
            sprite_name = %sprite_name,
            "Sprite session created successfully"
        );

        Ok(sprite_name)
    }

    #[instrument(skip(self))]
    async fn exists(&self, id: &str) -> anyhow::Result<bool> {
        tracing::debug!(sprite_name = %id, "Checking if sprite exists");

        let token = self.get_token()?;
        let url = format!("{}/{}", self.base_url, id);

        let response = self
            .client
            .get(&url)
            .bearer_auth(token)
            .send()
            .await
            .map_err(|e| anyhow::anyhow!("Failed to check sprite '{}' existence: {}", id, e))?;

        let exists = response.status().is_success();
        tracing::debug!(sprite_name = %id, exists = exists, "Sprite existence check complete");
        Ok(exists)
    }

    #[instrument(skip(self))]
    async fn delete(&self, id: &str) -> anyhow::Result<()> {
        tracing::info!(
            sprite_name = %id,
            auto_destroy = self.config.lifecycle.auto_destroy,
            auto_checkpoint = self.config.lifecycle.auto_checkpoint,
            "Deleting sprite"
        );

        // Optionally checkpoint before deletion
        if self.config.lifecycle.auto_checkpoint {
            tracing::info!(sprite_name = %id, "Checkpointing sprite before deletion");
            // TODO: Implement checkpoint API call when available
            // For now, just log that we would checkpoint
            tracing::warn!(sprite_name = %id, "Checkpoint not yet implemented");
        }

        // Only delete if auto_destroy is enabled
        if !self.config.lifecycle.auto_destroy {
            tracing::info!(
                sprite_name = %id,
                "auto_destroy is false, sprite will persist for reuse (incurs storage costs)"
            );
            return Ok(());
        }

        let token = self.get_token()?;
        let url = format!("{}/{}", self.base_url, id);

        let response = self
            .client
            .delete(&url)
            .bearer_auth(token)
            .send()
            .await
            .map_err(|e| {
                anyhow::anyhow!("Failed to send delete request for sprite '{}': {}", id, e)
            })?;

        let status = response.status();
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            tracing::warn!(
                sprite_name = %id,
                status = %status,
                body = %body,
                "Failed to delete sprite"
            );
            anyhow::bail!(
                "Failed to delete sprite '{}' (HTTP {}): {}",
                id,
                status,
                body
            );
        }

        tracing::info!(sprite_name = %id, "Sprite deleted successfully");
        Ok(())
    }

    fn attach_command(&self, id: &str) -> Vec<String> {
        // Return the command to attach to a sprite using the sprites CLI
        // User must have `sprite` CLI installed
        vec!["sprite".to_string(), "console".to_string(), id.to_string()]
    }

    #[instrument(skip(self))]
    async fn get_output(&self, id: &str, lines: usize) -> anyhow::Result<String> {
        tracing::debug!(sprite_name = %id, lines = lines, "Getting output from sprite");

        // Get logs from the tmux session
        let result = self
            .sprite_exec(
                id,
                vec![
                    "tmux".to_string(),
                    "capture-pane".to_string(),
                    "-t".to_string(),
                    "clauderon".to_string(),
                    "-p".to_string(),
                    "-S".to_string(),
                    format!("-{}", lines),
                ],
            )
            .await
            .map_err(|e| anyhow::anyhow!("Failed to get output from sprite '{}': {}", id, e))?;

        if result.exit_code != 0 {
            tracing::warn!(
                sprite_name = %id,
                stderr = %result.stderr,
                "Failed to capture tmux pane"
            );
            // Return stderr as output if capture failed (tmux might not be running)
            return Ok(result.stderr);
        }

        Ok(result.stdout)
    }
}

impl Default for SpritesBackend {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::backends::sprites_config::{
        SpritesImage, SpritesLifecycle, SpritesNetwork, SpritesResources,
    };

    #[test]
    fn test_sprite_name_from_session() {
        assert_eq!(
            SpritesBackend::sprite_name_from_session("my-session"),
            "clauderon-my-session"
        );
    }

    #[test]
    fn test_new_backend_uses_default_config() {
        let backend = SpritesBackend::new();
        assert_eq!(backend.base_url, "https://api.sprites.dev/v1/sprites");
    }

    #[test]
    fn test_attach_command() {
        let backend = SpritesBackend::new();
        let cmd = backend.attach_command("clauderon-test");
        assert_eq!(cmd, vec!["sprite", "console", "clauderon-test"]);
    }

    #[test]
    fn test_with_config() {
        let config = SpritesConfig {
            resources: SpritesResources {
                cpu: Some(4),
                memory: Some(8),
            },
            lifecycle: SpritesLifecycle {
                auto_destroy: true,
                auto_checkpoint: true,
            },
            ..Default::default()
        };

        let backend = SpritesBackend::with_config(config);
        assert_eq!(backend.config.resources.cpu, Some(4));
        assert_eq!(backend.config.resources.memory, Some(8));
        assert!(backend.config.lifecycle.auto_destroy);
        assert!(backend.config.lifecycle.auto_checkpoint);
    }

    // Integration tests would go here but require SPRITES_TOKEN
    // and actual sprites.dev API access
}
