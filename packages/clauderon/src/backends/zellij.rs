use async_trait::async_trait;
use std::path::Path;
use tokio::process::Command;

use super::traits::ExecutionBackend;
use crate::core::AgentType;

/// Zellij terminal multiplexer backend
///
/// Note on plugin inheritance: Zellij sessions run directly on the host system,
/// not in containers. This means Claude Code plugins are automatically available
/// at ~/.claude/plugins/ without any special configuration or mounting.
/// No plugin-specific handling is needed for this backend.
#[derive(Debug, Copy, Clone)]
pub struct ZellijBackend;

impl ZellijBackend {
    /// Create a new Zellij backend
    #[must_use]
    pub const fn new() -> Self {
        Self
    }

    /// Build the args for creating a Zellij session in the background (exposed for testing)
    #[must_use]
    pub fn build_create_session_args(name: &str) -> Vec<String> {
        vec![
            "attach".to_owned(),
            "--create-background".to_owned(),
            name.to_owned(),
        ]
    }

    /// Build the args for running Claude in a new pane (exposed for testing)
    #[must_use]
    pub fn build_new_pane_args(
        workdir: &Path,
        initial_prompt: &str,
        dangerous_skip_checks: bool,
        images: &[String],
        agent: AgentType,
        session_id: Option<&uuid::Uuid>,
        model: Option<&str>,
    ) -> Vec<String> {
        use crate::agents::traits::Agent;
        use crate::agents::{ClaudeCodeAgent, CodexAgent, GeminiCodeAgent};

        let escaped_prompt = initial_prompt.replace('\'', "'\\''");

        // Build agent command
        let cmd_vec = match agent {
            AgentType::ClaudeCode => ClaudeCodeAgent::new().start_command(
                &escaped_prompt,
                images,
                dangerous_skip_checks,
                session_id,
                model,
            ),
            AgentType::Codex => CodexAgent::new().start_command(
                &escaped_prompt,
                images,
                dangerous_skip_checks,
                session_id,
                model,
            ),
            AgentType::Gemini => GeminiCodeAgent::new().start_command(
                &escaped_prompt,
                images,
                dangerous_skip_checks,
                session_id,
                model,
            ),
        };

        // Join all arguments into a shell command, properly quoting each argument
        let agent_cmd = cmd_vec
            .iter()
            .map(|arg| {
                // Always quote arguments that contain special characters or spaces
                if arg.contains('\'')
                    || arg.contains(' ')
                    || arg.contains('\n')
                    || arg.contains('&')
                    || arg.contains('|')
                {
                    format!("'{escaped}'", escaped = arg.replace('\'', "'\\''"))
                } else {
                    arg.clone()
                }
            })
            .collect::<Vec<_>>()
            .join(" ");

        vec![
            "action".to_owned(),
            "new-pane".to_owned(),
            "--cwd".to_owned(),
            workdir.display().to_string(),
            "--".to_owned(),
            "bash".to_owned(),
            "-c".to_owned(),
            agent_cmd,
        ]
    }

    /// Build the attach command arguments (exposed for testing)
    #[must_use]
    pub fn build_attach_args(name: &str) -> Vec<String> {
        vec!["zellij".to_owned(), "attach".to_owned(), name.to_owned()]
    }

    // Legacy method names for backward compatibility during migration

    /// Create a new Zellij session (legacy name)
    ///
    /// # Errors
    ///
    /// Returns an error if the session creation fails.
    #[deprecated(note = "Use ExecutionBackend::create instead")]
    pub async fn create_session(
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
                model: None, // Use default model
                print_mode: false,
                plan_mode: true, // Default to plan mode
                session_proxy_port: None,
                images: vec![],
                dangerous_skip_checks: false,
                dangerous_copy_creds: false, // Zellij is local, no copy-creds needed
                session_id: None,
                initial_workdir: std::path::PathBuf::new(),
                http_port: None,
                container_image: None,
                container_resources: None,
                repositories: vec![], // Legacy single-repo mode
                storage_class_override: None,
                volume_mode: false,
            },
        )
        .await
    }

    /// Check if a Zellij session exists (legacy name)
    ///
    /// # Errors
    ///
    /// Returns an error if the Zellij command fails.
    #[deprecated(note = "Use ExecutionBackend::exists instead")]
    pub async fn session_exists(&self, name: &str) -> anyhow::Result<bool> {
        self.exists(name).await
    }

    /// Delete a Zellij session (legacy name)
    ///
    /// # Errors
    ///
    /// Returns an error if the Zellij command fails.
    #[deprecated(note = "Use ExecutionBackend::delete instead")]
    pub async fn delete_session(&self, name: &str) -> anyhow::Result<()> {
        self.delete(name).await
    }
}

impl Default for ZellijBackend {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl ExecutionBackend for ZellijBackend {
    /// Create a new Zellij session with Claude Code
    ///
    /// Note: `options.print_mode` is ignored for Zellij - it's always interactive.
    ///
    /// # Errors
    ///
    /// Returns an error if the zellij command fails.
    async fn create(
        &self,
        name: &str,
        workdir: &Path,
        initial_prompt: &str,
        options: super::traits::CreateOptions,
    ) -> anyhow::Result<String> {
        // Multi-repository sessions are not supported in Zellij backend
        if !options.repositories.is_empty() {
            anyhow::bail!(
                "Multi-repository sessions are not supported for Zellij backend. \
                Please use Docker backend for multi-repo sessions, or use single-repository mode."
            );
        }

        // Create a new Zellij session in the background
        let args = Self::build_create_session_args(name);
        let output = Command::new("zellij").args(&args[..]).output().await?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            tracing::error!(
                session = name,
                workdir = %workdir.display(),
                stderr = %stderr,
                "Failed to create Zellij session"
            );
            anyhow::bail!("Failed to create Zellij session: {stderr}");
        }

        // Run Claude in the session
        // Note: Unlike Docker backend, Zellij doesn't create .claude.json config files.
        // Zellij sessions run in the host environment with the user's existing Claude config,
        // so there's no need to mount or create additional config files. The bypass permissions
        // flag is controlled purely through the --dangerously-skip-permissions command-line argument.
        let pane_args = Self::build_new_pane_args(
            workdir,
            initial_prompt,
            options.dangerous_skip_checks,
            &options.images,
            options.agent,
            options.session_id.as_ref(),
            options.model.as_deref(),
        );
        let output = Command::new("zellij")
            .args(&pane_args[..])
            .env("ZELLIJ_SESSION_NAME", name)
            .env("COLORTERM", "truecolor")
            .output()
            .await?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            tracing::error!(
                session = name,
                workdir = %workdir.display(),
                stderr = %stderr,
                "Failed to run Claude in Zellij session"
            );
            anyhow::bail!("Failed to run Claude in Zellij session: {stderr}");
        }

        tracing::info!(
            session = name,
            workdir = %workdir.display(),
            "Created Zellij session"
        );

        Ok(name.to_owned())
    }

    /// Check if a Zellij session exists
    ///
    /// # Errors
    ///
    /// Returns an error if the zellij command fails to execute.
    async fn exists(&self, name: &str) -> anyhow::Result<bool> {
        let output = Command::new("zellij")
            .args(["list-sessions"])
            .output()
            .await?;

        if !output.status.success() {
            // If zellij isn't running, there are no sessions
            return Ok(false);
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        Ok(stdout.lines().any(|line| line.contains(name)))
    }

    /// Delete a Zellij session
    ///
    /// # Errors
    ///
    /// Returns an error if the zellij command fails to execute.
    async fn delete(&self, name: &str) -> anyhow::Result<()> {
        let output = Command::new("zellij")
            .args(["kill-session", name])
            .output()
            .await?;

        if !output.status.success() {
            tracing::warn!(
                session = name,
                exit_code = ?output.status.code(),
                stderr = %String::from_utf8_lossy(&output.stderr).trim(),
                stdout = %String::from_utf8_lossy(&output.stdout).trim(),
                "Failed to kill Zellij session"
            );
        }

        tracing::info!(session = name, "Deleted Zellij session");

        Ok(())
    }

    /// Get the command to attach to a Zellij session
    fn attach_command(&self, name: &str) -> Vec<String> {
        Self::build_attach_args(name)
    }

    /// Get recent output from a Zellij session by dumping the screen
    ///
    /// # Errors
    ///
    /// Returns an error if the zellij dump command fails.
    async fn get_output(&self, name: &str, _lines: usize) -> anyhow::Result<String> {
        // Attach to the session briefly to dump the screen
        let output = Command::new("zellij")
            .args(["action", "dump-screen", "/dev/stdout"])
            .env("ZELLIJ_SESSION_NAME", name)
            .output()
            .await?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            anyhow::bail!("Failed to dump Zellij screen: {stderr}");
        }

        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    }

    /// Get Zellij backend capabilities
    ///
    /// Zellij preserves data because sessions run directly on the host filesystem.
    fn capabilities(&self) -> super::traits::BackendCapabilities {
        super::traits::BackendCapabilities {
            can_recreate: true,
            can_update_image: false, // No container image for Zellij
            preserves_data_on_recreate: true,
            can_start: false, // Zellij sessions can't be "started" in the same way
            can_wake: false,
            data_preservation_description: "Your code is safe (stored in local git worktree). Only terminal state (scrollback, running processes) will be lost.",
        }
    }

    /// Check the health of a Zellij session
    ///
    /// Zellij sessions are either running or not found - there's no intermediate state.
    async fn check_health(
        &self,
        name: &str,
    ) -> anyhow::Result<super::traits::BackendResourceHealth> {
        if self.exists(name).await? {
            Ok(super::traits::BackendResourceHealth::Running)
        } else {
            Ok(super::traits::BackendResourceHealth::NotFound)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    /// Test that session creation uses --create-background flag
    #[test]
    fn test_create_uses_background_flag() {
        let args = ZellijBackend::build_create_session_args("test-session");

        assert!(
            args.contains(&"--create-background".to_owned()),
            "Expected --create-background flag: {args:?}"
        );
        assert!(
            args.contains(&"attach".to_owned()),
            "Expected 'attach' subcommand: {args:?}"
        );
    }

    /// Test that new-pane command includes --cwd flag
    #[test]
    fn test_new_pane_has_cwd() {
        let workdir = PathBuf::from("/my/work/dir");
        let args = ZellijBackend::build_new_pane_args(
            &workdir,
            "test prompt",
            true,
            &[],
            AgentType::ClaudeCode,
            None,
            None,
        );

        assert!(
            args.contains(&"--cwd".to_owned()),
            "Expected --cwd flag: {args:?}"
        );

        // Find --cwd and verify the next arg is the workdir
        let cwd_idx = args.iter().position(|a| a == "--cwd").unwrap();
        assert_eq!(
            args[cwd_idx + 1],
            "/my/work/dir",
            "Expected workdir after --cwd"
        );
    }

    /// Test that new-pane uses action subcommand
    #[test]
    fn test_new_pane_uses_action() {
        let args = ZellijBackend::build_new_pane_args(
            &PathBuf::from("/workspace"),
            "test prompt",
            true,
            &[],
            AgentType::ClaudeCode,
            None,
            None, // model
        );

        assert_eq!(args[0], "action", "Expected 'action' as first arg");
        assert_eq!(args[1], "new-pane", "Expected 'new-pane' as second arg");
    }

    /// Test that single quotes in prompts are properly escaped
    #[test]
    fn test_prompt_escaping() {
        let prompt_with_quotes = "Say 'hello world'";
        let args = ZellijBackend::build_new_pane_args(
            &PathBuf::from("/workspace"),
            prompt_with_quotes,
            true,
            &[],
            AgentType::ClaudeCode,
            None,
            None, // model
        );

        // Find the command argument (last one containing the prompt)
        let cmd_arg = args.last().unwrap();

        // Single quotes should be escaped as '\'' for shell safety
        assert!(
            cmd_arg.contains("'\\''"),
            "Single quotes should be escaped as '\\'': {cmd_arg}"
        );
    }

    /// Test that attach command produces valid zellij attach format
    #[test]
    fn test_attach_command_format() {
        let args = ZellijBackend::build_attach_args("my-session");

        assert_eq!(args.len(), 3, "Expected 3 args: {args:?}");
        assert_eq!(args[0], "zellij");
        assert_eq!(args[1], "attach");
        assert_eq!(args[2], "my-session");
    }

    /// Test that new-pane command uses bash shell
    #[test]
    fn test_new_pane_uses_bash() {
        let args = ZellijBackend::build_new_pane_args(
            &PathBuf::from("/workspace"),
            "test prompt",
            true,
            &[],
            AgentType::ClaudeCode,
            None,
            None, // model
        );

        assert!(
            args.contains(&"bash".to_owned()),
            "Expected bash shell: {args:?}"
        );
    }

    /// Test that new-pane includes -- separator before command
    #[test]
    fn test_new_pane_has_separator() {
        let args = ZellijBackend::build_new_pane_args(
            &PathBuf::from("/workspace"),
            "test prompt",
            true,
            &[],
            AgentType::ClaudeCode,
            None,
            None, // model
        );

        assert!(
            args.contains(&"--".to_owned()),
            "Expected '--' separator before shell command: {args:?}"
        );

        // -- should come before bash
        let sep_idx = args.iter().position(|a| a == "--").unwrap();
        let bash_idx = args.iter().position(|a| a == "bash").unwrap();
        assert!(sep_idx < bash_idx, "'--' should come before 'bash'");
    }

    /// Test that command includes claude with --dangerously-skip-permissions
    #[test]
    fn test_command_includes_dangerous_flag() {
        let args = ZellijBackend::build_new_pane_args(
            &PathBuf::from("/workspace"),
            "test prompt",
            true,
            &[],
            AgentType::ClaudeCode,
            None,
            None, // model
        );

        let cmd_arg = args.last().unwrap();
        assert!(
            cmd_arg.contains("--dangerously-skip-permissions"),
            "Expected --dangerously-skip-permissions flag: {cmd_arg}"
        );
    }

    /// Test that images are properly included in command
    #[test]
    fn test_command_includes_images() {
        let images = vec![
            "/path/to/image1.png".to_owned(),
            "/path/to/image2.jpg".to_owned(),
        ];
        let args = ZellijBackend::build_new_pane_args(
            &PathBuf::from("/workspace"),
            "test prompt",
            true,
            &images,
            AgentType::ClaudeCode,
            None,
            None, // model
        );

        let cmd_arg = args.last().unwrap();
        // Image paths without special characters are not quoted
        assert!(
            cmd_arg.contains("--image /path/to/image1.png"),
            "Expected first image in command: {cmd_arg}"
        );
        assert!(
            cmd_arg.contains("--image /path/to/image2.jpg"),
            "Expected second image in command: {cmd_arg}"
        );
    }

    /// Test that image paths with single quotes are properly escaped
    #[test]
    fn test_image_path_escaping() {
        let images = vec!["/path/with'quote/image.png".to_owned()];
        let args = ZellijBackend::build_new_pane_args(
            &PathBuf::from("/workspace"),
            "test prompt",
            true,
            &images,
            AgentType::ClaudeCode,
            None,
            None, // model
        );

        let cmd_arg = args.last().unwrap();
        // Single quotes should be escaped as '\'' for shell safety (end string, escaped quote, start string)
        assert!(
            cmd_arg.contains("'\\''"),
            "Image path with single quote should be escaped: {cmd_arg}"
        );
    }

    /// Test that command works with no images
    #[test]
    fn test_command_with_no_images() {
        let args = ZellijBackend::build_new_pane_args(
            &PathBuf::from("/workspace"),
            "test prompt",
            true,
            &[],
            AgentType::ClaudeCode,
            None,
            None, // model
        );

        let cmd_arg = args.last().unwrap();
        assert!(
            !cmd_arg.contains("--image"),
            "Should not contain --image flag when no images provided: {cmd_arg}"
        );
        assert!(
            cmd_arg.contains("'test prompt'"),
            "Should still contain the prompt: {cmd_arg}"
        );
    }
}
