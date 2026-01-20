use async_trait::async_trait;
use std::path::Path;
use tokio::process::Command;
use tracing::instrument;

use super::sprites_config::SpritesConfig;
use super::traits::{CreateOptions, ExecutionBackend};
use crate::core::session::{AgentType, SessionRepository};

/// Result from running a command in a sprite
#[derive(Debug)]
struct CommandResult {
    stdout: String,
    stderr: String,
    exit_code: i32,
}

/// Sprites.dev backend implementation
///
/// Uses the `sprite` CLI to create hardware-isolated Firecracker containers
/// with persistent ext4 filesystems. Unlike Docker/Kubernetes, sprites cannot mount
/// local directories, so this backend clones git repositories from remotes.
///
/// The sprite CLI must be installed and authenticated via `sprite login` or
/// the SPRITES_TOKEN environment variable.
pub struct SpritesBackend {
    config: SpritesConfig,
}

impl SpritesBackend {
    /// Create a new Sprites backend.
    ///
    /// Loads configuration from `~/.clauderon/sprites-config.toml` if present,
    /// otherwise uses default configuration.
    ///
    /// Requires the `sprite` CLI to be installed and authenticated.
    #[must_use]
    pub fn new() -> Self {
        let config = SpritesConfig::load_or_default();
        Self { config }
    }

    /// Create a Sprites backend with custom configuration (for testing).
    #[cfg(test)]
    #[must_use]
    pub fn with_config(config: SpritesConfig) -> Self {
        Self { config }
    }

    /// Create a sprite via CLI
    ///
    /// Uses `sprite create {name}` to create a new sprite.
    ///
    /// # Errors
    ///
    /// Returns an error if the CLI command fails.
    #[instrument(skip(self))]
    async fn create_sprite(&self, name: &str) -> anyhow::Result<()> {
        tracing::info!(sprite_name = %name, "Creating sprite via CLI");

        let output = Command::new("sprite")
            .args(["create", name])
            .output()
            .await
            .map_err(|e| {
                anyhow::anyhow!(
                    "Failed to run 'sprite create' command: {}. Is the sprite CLI installed?",
                    e
                )
            })?;

        if !output.status.success() {
            use std::fmt::Write;
            let stderr = String::from_utf8_lossy(&output.stderr);
            let stdout = String::from_utf8_lossy(&output.stdout);
            let mut error_msg = format!("Failed to create sprite '{}'", name);
            if !stderr.is_empty() {
                let _ = write!(error_msg, "\nstderr: {}", stderr.trim());
            }
            if !stdout.is_empty() {
                let _ = write!(error_msg, "\nstdout: {}", stdout.trim());
            }
            anyhow::bail!("{}", error_msg);
        }

        tracing::info!(sprite_name = %name, "Sprite created successfully");
        Ok(())
    }

    /// Run a command in a sprite via CLI
    ///
    /// Uses `sprite run -s {name} -- {command...}` to run commands.
    ///
    /// # Errors
    ///
    /// Returns an error if the CLI command fails.
    #[instrument(skip(self, command))]
    async fn sprite_run(&self, name: &str, command: &[&str]) -> anyhow::Result<CommandResult> {
        tracing::debug!(
            sprite_name = %name,
            command = ?command,
            "Running command in sprite"
        );

        let mut args = vec!["run", "-s", name, "--"];
        args.extend(command);

        let output = Command::new("sprite")
            .args(&args)
            .output()
            .await
            .map_err(|e| {
                anyhow::anyhow!(
                    "Failed to run 'sprite run' command: {}. Is the sprite CLI installed?",
                    e
                )
            })?;

        let result = CommandResult {
            stdout: String::from_utf8_lossy(&output.stdout).to_string(),
            stderr: String::from_utf8_lossy(&output.stderr).to_string(),
            exit_code: output.status.code().unwrap_or(-1),
        };

        tracing::debug!(
            sprite_name = %name,
            exit_code = result.exit_code,
            "Command completed"
        );

        Ok(result)
    }

    /// Run a shell command string in a sprite
    ///
    /// Wraps the command in `sh -c` for shell interpretation.
    #[instrument(skip(self, shell_command))]
    async fn sprite_shell_run(
        &self,
        name: &str,
        shell_command: &str,
    ) -> anyhow::Result<CommandResult> {
        self.sprite_run(name, &["sh", "-c", shell_command]).await
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
                anyhow::anyhow!("Failed to run git command in {}: {}", workdir.display(), e)
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
                anyhow::anyhow!("Failed to run git command in {}: {}", workdir.display(), e)
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
        let result = self
            .sprite_run(sprite_name, &["mkdir", "-p", "/home/sprite/repos"])
            .await
            .map_err(|e| anyhow::anyhow!("Failed to create repos directory in sprite: {}", e))?;

        if result.exit_code != 0 {
            anyhow::bail!(
                "Failed to create repos directory in sprite: {}",
                result.stderr
            );
        }

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

            // Build clone command with explicit arguments (avoids shell injection)
            let mut clone_args = vec![
                "git",
                "clone",
                "--branch",
                &repo.branch_name,
                "--single-branch",
            ];

            // Add shallow clone flags if configured
            if self.config.git.shallow_clone {
                clone_args.push("--depth");
                clone_args.push("1");
            }

            clone_args.push(&remote_url);
            clone_args.push(&target_path);

            // Clone the repository using explicit args (not shell interpolation)
            let clone_result = self.sprite_run(sprite_name, &clone_args).await?;

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
    /// Returns an error if the command fails (not if Claude Code is missing).
    #[instrument(skip(self))]
    async fn is_claude_installed(&self, sprite_name: &str) -> anyhow::Result<bool> {
        let result = self.sprite_run(sprite_name, &["which", "claude"]).await?;

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

        // Install Claude Code using the official installation script
        let install_script = "curl -fsSL https://claude.ai/install.sh | sh";

        let result = self.sprite_shell_run(sprite_name, install_script).await?;

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
                format!("codex '{}'", escaped_prompt)
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

        let result = self.sprite_shell_run(sprite_name, &tmux_cmd).await?;

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

        // Step 1: Create the sprite (CLI blocks until ready)
        self.create_sprite(&sprite_name)
            .await
            .map_err(|e| anyhow::anyhow!("Failed to create sprite '{}': {}", sprite_name, e))?;

        // Step 2: Setup repositories
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

        // Step 3: Install Claude Code if needed
        if options.agent == AgentType::ClaudeCode {
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

        // Step 4: Start the agent
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

        let output = Command::new("sprite")
            .args(["list"])
            .output()
            .await
            .map_err(|e| {
                anyhow::anyhow!(
                    "Failed to run 'sprite list' command: {}. Is the sprite CLI installed?",
                    e
                )
            })?;

        let stdout = String::from_utf8_lossy(&output.stdout);
        // Use exact matching on first whitespace-delimited word to avoid false positives
        // (e.g., "test" should not match "test-session" or "my-test")
        let exists = stdout.lines().any(|line| {
            line.split_whitespace()
                .next()
                .is_some_and(|name| name == id)
        });

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

        let output = Command::new("sprite")
            .args(["destroy", "--yes", id])
            .output()
            .await
            .map_err(|e| {
                anyhow::anyhow!(
                    "Failed to run 'sprite destroy' command: {}. Is the sprite CLI installed?",
                    e
                )
            })?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            tracing::warn!(
                sprite_name = %id,
                stderr = %stderr,
                "Failed to destroy sprite"
            );
            anyhow::bail!("Failed to destroy sprite '{}': {}", id, stderr);
        }

        tracing::info!(sprite_name = %id, "Sprite destroyed successfully");
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
        let tmux_cmd = format!("tmux capture-pane -t clauderon -p -S -{}", lines);

        let result = self
            .sprite_shell_run(id, &tmux_cmd)
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
    use crate::backends::sprites_config::{SpritesGit, SpritesLifecycle};

    #[test]
    fn test_sprite_name_from_session() {
        assert_eq!(
            SpritesBackend::sprite_name_from_session("my-session"),
            "clauderon-my-session"
        );
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
            lifecycle: SpritesLifecycle {
                auto_destroy: true,
                auto_checkpoint: true,
            },
            git: SpritesGit {
                shallow_clone: false,
            },
        };

        let backend = SpritesBackend::with_config(config);
        assert!(backend.config.lifecycle.auto_destroy);
        assert!(backend.config.lifecycle.auto_checkpoint);
        assert!(!backend.config.git.shallow_clone);
    }

    #[test]
    fn test_default_backend() {
        let backend = SpritesBackend::default();
        // Default config should have shallow_clone enabled
        assert!(backend.config.git.shallow_clone);
        // Default config should have auto_destroy disabled
        assert!(!backend.config.lifecycle.auto_destroy);
    }

    // Integration tests would go here but require sprite CLI
    // and actual sprites.dev account access
}
