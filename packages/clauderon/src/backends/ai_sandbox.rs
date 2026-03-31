use anyhow::Context;
use async_trait::async_trait;
use std::path::Path;
use std::process::Stdio;
use std::sync::Arc;
use tokio::process::Command;

use super::traits::{ExecutionBackend, GitOperations};
use crate::core::AgentType;

/// AI Sandbox execution backend (Zellij + ai-sandbox)
///
/// Combines Zellij terminal multiplexer with ai-sandbox security sandbox.
/// The composition is: Zellij → ai-sandbox → agent.
///
/// ai-sandbox uses seatbelt on macOS and Docker on Linux to restrict
/// network, credentials, and filesystem access. It has its own proxy
/// infrastructure, so clauderon's zero-credential proxy is not needed.
///
/// This backend manages its own repository setup via local clones instead
/// of worktrees, with a pre-staged pool for fast session creation.
pub struct AiSandboxBackend {
    git: Arc<dyn GitOperations>,
}

impl AiSandboxBackend {
    /// Create a new AI Sandbox backend
    #[must_use]
    pub fn new(git: Arc<dyn GitOperations>) -> Self {
        Self { git }
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

    /// Build the args for running a sandboxed agent in a new pane (exposed for testing)
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

        // Wrap with ai-sandbox
        let sandboxed_cmd = format!("ai-sandbox {agent_cmd}");

        vec![
            "action".to_owned(),
            "new-pane".to_owned(),
            "--cwd".to_owned(),
            workdir.display().to_string(),
            "--".to_owned(),
            "bash".to_owned(),
            "-c".to_owned(),
            sandboxed_cmd,
        ]
    }

    /// Build the attach command arguments (exposed for testing)
    #[must_use]
    pub fn build_attach_args(name: &str) -> Vec<String> {
        vec!["zellij".to_owned(), "attach".to_owned(), name.to_owned()]
    }
}

impl std::fmt::Debug for AiSandboxBackend {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("AiSandboxBackend").finish_non_exhaustive()
    }
}

#[async_trait]
impl ExecutionBackend for AiSandboxBackend {
    /// Create a new AI Sandbox session (Zellij + ai-sandbox)
    ///
    /// 1. Sets up repository via local clone (claim_or_clone)
    /// 2. Creates Zellij background session
    /// 3. Runs sandboxed agent in new pane
    async fn create(
        &self,
        name: &str,
        workdir: &Path,
        initial_prompt: &str,
        options: crate::backends::CreateOptions,
    ) -> anyhow::Result<String> {
        // Multi-repository sessions are not supported
        if options.repositories.len() > 1 {
            anyhow::bail!(
                "Multi-repository sessions are not supported for AI Sandbox backend. \
                Please use Docker backend for multi-repo sessions, or use single-repository mode."
            );
        }

        // Set up repository via local clone
        // The workdir passed in is the worktree_path from the manager; we use it as our clone target.
        // The repo_path is derived from the parent context (passed via workdir for clone-managing backends).
        // For AI Sandbox, create() receives the worktree_path as workdir, and the manager
        // handles calling claim_or_clone before invoking create().

        // Create Zellij session in the background
        // Note: We use spawn()+wait_with_output() with all stdio set to null/piped carefully.
        // Using .output() alone would hang because zellij's background server inherits the
        // stdout/stderr pipes, keeping them open indefinitely.
        let args = Self::build_create_session_args(name);
        let timeout_duration = std::time::Duration::from_secs(30);
        let mut child = Command::new("zellij")
            .args(&args[..])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .context("Failed to spawn 'zellij attach --create-background'")?;

        let status = tokio::time::timeout(timeout_duration, child.wait())
            .await
            .map_err(|_| {
                // Kill the hung process before returning the error
                let _ = child.start_kill();
                anyhow::anyhow!("Timed out waiting for 'zellij attach --create-background' ({}s)", timeout_duration.as_secs())
            })?
            ?;

        if !status.success() {
            tracing::error!(
                session = name,
                workdir = %workdir.display(),
                exit_code = ?status.code(),
                "Failed to create Zellij session for AI Sandbox"
            );
            anyhow::bail!("Failed to create Zellij session (exit code: {:?})", status.code());
        }

        // Wait for session plugins to initialize before sending actions
        tokio::time::sleep(std::time::Duration::from_secs(1)).await;

        // Run sandboxed agent in the session
        let pane_args = Self::build_new_pane_args(
            workdir,
            initial_prompt,
            options.dangerous_skip_checks,
            &options.images,
            options.agent,
            options.session_id.as_ref(),
            options.model.as_deref(),
        );
        let output = tokio::time::timeout(
            timeout_duration,
            Command::new("zellij")
                .args(&pane_args[..])
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .env("ZELLIJ_SESSION_NAME", name)
                .env("COLORTERM", "truecolor")
                .output(),
        )
        .await
        .map_err(|_| anyhow::anyhow!("Timed out waiting for 'zellij action new-pane' ({}s)", timeout_duration.as_secs()))?
        ?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            tracing::error!(
                session = name,
                workdir = %workdir.display(),
                stderr = %stderr,
                "Failed to run sandboxed agent in Zellij session"
            );
            anyhow::bail!("Failed to run sandboxed agent in Zellij session: {stderr}");
        }

        tracing::info!(
            session = name,
            workdir = %workdir.display(),
            "Created AI Sandbox session (Zellij + ai-sandbox)"
        );

        Ok(name.to_owned())
    }

    async fn exists(&self, name: &str) -> anyhow::Result<bool> {
        let output = Command::new("zellij")
            .args(["list-sessions"])
            .output()
            .await?;

        if !output.status.success() {
            return Ok(false);
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        Ok(stdout.lines().any(|line| line.contains(name)))
    }

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

        tracing::info!(session = name, "Deleted AI Sandbox session");

        Ok(())
    }

    fn attach_command(&self, name: &str) -> Vec<String> {
        Self::build_attach_args(name)
    }

    async fn get_output(&self, name: &str, _lines: usize) -> anyhow::Result<String> {
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

    fn manages_own_repo(&self) -> bool {
        true
    }

    fn capabilities(&self) -> super::traits::BackendCapabilities {
        super::traits::BackendCapabilities {
            can_recreate: true,
            can_update_image: false,
            preserves_data_on_recreate: true,
            can_start: false,
            data_preservation_description: "Your code is safe (stored in local clone). Only terminal state (scrollback, running processes) will be lost.",
        }
    }

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

    #[test]
    fn test_create_uses_background_flag() {
        let args = AiSandboxBackend::build_create_session_args("test-session");

        assert!(
            args.contains(&"--create-background".to_owned()),
            "Expected --create-background flag: {args:?}"
        );
        assert!(
            args.contains(&"attach".to_owned()),
            "Expected 'attach' subcommand: {args:?}"
        );
    }

    #[test]
    fn test_new_pane_has_cwd() {
        let workdir = PathBuf::from("/my/work/dir");
        let args = AiSandboxBackend::build_new_pane_args(
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

        let cwd_idx = args.iter().position(|a| a == "--cwd").unwrap();
        assert_eq!(
            args[cwd_idx + 1],
            "/my/work/dir",
            "Expected workdir after --cwd"
        );
    }

    #[test]
    fn test_new_pane_has_ai_sandbox_prefix() {
        let args = AiSandboxBackend::build_new_pane_args(
            &PathBuf::from("/workspace"),
            "test prompt",
            true,
            &[],
            AgentType::ClaudeCode,
            None,
            None,
        );

        let cmd_arg = args.last().unwrap();
        assert!(
            cmd_arg.starts_with("ai-sandbox "),
            "Expected ai-sandbox prefix in command: {cmd_arg}"
        );
    }

    #[test]
    fn test_new_pane_uses_action() {
        let args = AiSandboxBackend::build_new_pane_args(
            &PathBuf::from("/workspace"),
            "test prompt",
            true,
            &[],
            AgentType::ClaudeCode,
            None,
            None,
        );

        assert_eq!(args[0], "action", "Expected 'action' as first arg");
        assert_eq!(args[1], "new-pane", "Expected 'new-pane' as second arg");
    }

    #[test]
    fn test_attach_command_format() {
        let args = AiSandboxBackend::build_attach_args("my-session");

        assert_eq!(args.len(), 3, "Expected 3 args: {args:?}");
        assert_eq!(args[0], "zellij");
        assert_eq!(args[1], "attach");
        assert_eq!(args[2], "my-session");
    }

    fn make_test_repo(mount_name: &str, is_primary: bool) -> crate::core::session::SessionRepository {
        crate::core::session::SessionRepository {
            repo_path: PathBuf::from("/tmp/repo"),
            subdirectory: PathBuf::new(),
            worktree_path: PathBuf::from("/tmp/worktree"),
            branch_name: "test-branch".to_owned(),
            mount_name: mount_name.to_owned(),
            is_primary,
            base_branch: None,
        }
    }

    /// Mirrors the multi-repo guard logic from AiSandboxBackend::create()
    fn would_reject_as_multi_repo(
        repos: &[crate::core::session::SessionRepository],
    ) -> Option<String> {
        if repos.len() > 1 {
            Some(
                "Multi-repository sessions are not supported for AI Sandbox backend.".to_owned(),
            )
        } else {
            None
        }
    }

    #[test]
    fn test_single_repo_not_rejected_as_multi_repo() {
        let repos = vec![make_test_repo("primary", true)];
        assert!(
            would_reject_as_multi_repo(&repos).is_none(),
            "Single-repo session should not be rejected as multi-repo"
        );
    }

    #[test]
    fn test_empty_repos_not_rejected_as_multi_repo() {
        assert!(
            would_reject_as_multi_repo(&[]).is_none(),
            "Empty repos should not be rejected as multi-repo"
        );
    }

    #[tokio::test]
    async fn test_multi_repo_rejected() {
        let git = Arc::new(crate::backends::MockGitBackend::new());
        let backend = AiSandboxBackend::new(git);
        let options = crate::backends::CreateOptions {
            repositories: vec![
                make_test_repo("primary", true),
                make_test_repo("secondary", false),
            ],
            ..Default::default()
        };
        let result = backend
            .create("test", Path::new("/tmp"), "prompt", options)
            .await;
        let err = result.expect_err("Multi-repo should be rejected");
        assert!(
            err.to_string()
                .contains("Multi-repository sessions are not supported"),
            "Expected multi-repo rejection error, got: {err}"
        );
    }

    #[test]
    fn test_prompt_escaping() {
        let prompt_with_quotes = "Say 'hello world'";
        let args = AiSandboxBackend::build_new_pane_args(
            &PathBuf::from("/workspace"),
            prompt_with_quotes,
            true,
            &[],
            AgentType::ClaudeCode,
            None,
            None,
        );

        let cmd_arg = args.last().unwrap();
        assert!(
            cmd_arg.contains("'\\''"),
            "Single quotes should be escaped: {cmd_arg}"
        );
    }
}
