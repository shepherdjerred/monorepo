use std::time::Duration;

/// Generate a session name using the Claude CLI
///
/// This function invokes the `claude` CLI tool with structured JSON output
/// to generate a contextual git branch name based on the repository path
/// and initial prompt.
///
/// # Arguments
/// * `repo_path` - Path to the repository
/// * `initial_prompt` - The user's initial prompt/task description
///
/// # Returns
/// Returns a sanitized base name (without random suffix). Falls back to "session"
/// if the CLI is not available, fails to execute, or returns invalid output.
///
/// # Example
/// ```
/// let name = generate_session_name_ai("/home/user/my-repo", "Fix login bug").await;
/// // Returns something like "fix-login-bug" (will get suffix added later)
/// ```
pub async fn generate_session_name_ai(repo_path: &str, initial_prompt: &str) -> String {
    match generate_with_timeout(repo_path, initial_prompt).await {
        Ok(name) => {
            tracing::info!(
                repo = %repo_path,
                generated_name = %name,
                "AI-generated session name"
            );
            name
        }
        Err(e) => {
            tracing::warn!(
                error = %e,
                "Failed to generate AI name, using fallback"
            );
            "session".to_string()
        }
    }
}

async fn generate_with_timeout(repo_path: &str, initial_prompt: &str) -> anyhow::Result<String> {
    // 30 second timeout for CLI execution to account for network latency,
    // CLI startup time, OAuth validation, and potential API throttling
    tokio::time::timeout(
        Duration::from_secs(30),
        call_claude_cli(repo_path, initial_prompt),
    )
    .await
    .map_err(|_| anyhow::anyhow!("Claude CLI call timed out"))?
}

async fn call_claude_cli(repo_path: &str, initial_prompt: &str) -> anyhow::Result<String> {
    // Build the prompt
    let prompt = build_prompt(repo_path, initial_prompt);

    // Build JSON schema for structured output with title, description, and branch name
    let json_schema = r#"{
        "type": "object",
        "properties": {
            "title": {"type": "string"},
            "description": {"type": "string"},
            "branch_name": {"type": "string"}
        },
        "required": ["title", "description", "branch_name"]
    }"#;

    // Build command arguments
    let mut cmd = tokio::process::Command::new("claude");
    cmd.arg("--print")
        .arg("--no-session-persistence")
        .arg("--output-format")
        .arg("json")
        .arg("--json-schema")
        .arg(json_schema)
        .arg("--model")
        .arg("haiku")
        .arg("--dangerously-skip-permissions")
        .arg(&prompt);

    // Execute CLI
    tracing::debug!("Invoking Claude CLI for name generation");
    let output = cmd.output().await.map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            anyhow::anyhow!("Claude CLI not found in PATH")
        } else {
            anyhow::anyhow!("Failed to execute Claude CLI: {}", e)
        }
    })?;

    // Check exit status
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        anyhow::bail!(
            "Claude CLI failed with exit code {:?}: {}",
            output.status.code(),
            stderr
        );
    }

    // Parse JSON output
    let stdout = String::from_utf8_lossy(&output.stdout);
    let json: serde_json::Value = serde_json::from_str(&stdout)
        .map_err(|e| anyhow::anyhow!("Failed to parse JSON output: {}", e))?;

    // Extract all three fields from JSON
    let title = json
        .get("title")
        .and_then(|v| v.as_str())
        .ok_or_else(|| anyhow::anyhow!("Missing 'title' field in JSON response"))?;

    let description = json
        .get("description")
        .and_then(|v| v.as_str())
        .ok_or_else(|| anyhow::anyhow!("Missing 'description' field in JSON response"))?;

    let branch_name = json
        .get("branch_name")
        .and_then(|v| v.as_str())
        .ok_or_else(|| anyhow::anyhow!("Missing 'branch_name' field in JSON response"))?;

    // Log the AI-generated metadata
    tracing::info!(
        title = %title,
        description = %description,
        branch_name = %branch_name,
        "AI generated session metadata"
    );

    // Sanitize the branch name
    let sanitized = crate::utils::random::sanitize_branch_name(branch_name);

    // Validate not empty after sanitization
    if sanitized.is_empty() {
        anyhow::bail!("Empty branch name after sanitization");
    }

    Ok(sanitized)
}

fn build_prompt(repo_path: &str, initial_prompt: &str) -> String {
    // Extract repository name from path
    let repo_name = std::path::Path::new(repo_path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("unknown");

    // Truncate initial prompt to avoid excessive tokens (keep first 200 chars)
    let truncated_prompt: String = initial_prompt.chars().take(200).collect();

    format!(
        "Analyze this task and generate session metadata:\n\
        Task: {}\n\
        Repository: {}\n\n\
        Generate three fields:\n\
        - title: A short title under 10 words describing what will be done\n\
        - description: A brief description in 1-2 sentences explaining the task\n\
        - branch_name: A git branch name with 2-4 words in kebab-case\n\n\
        Be concise and specific.",
        truncated_prompt, repo_name
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_prompt() {
        let prompt = build_prompt("/home/user/my-awesome-project", "Fix the login bug");
        assert!(prompt.contains("my-awesome-project"));
        assert!(prompt.contains("Fix the login bug"));
        assert!(prompt.contains("kebab-case"));
    }

    #[test]
    fn test_build_prompt_truncates_long_input() {
        let long_prompt = "a".repeat(500);
        let prompt = build_prompt("/path/to/repo", &long_prompt);
        // Should be truncated to ~200 chars plus template text
        assert!(prompt.len() < 300);
    }

    #[tokio::test]
    async fn test_fallback_when_cli_not_found() {
        // This test will use fallback if claude CLI is not in PATH
        let name = generate_session_name_ai("/tmp/test-repo", "Test prompt").await;
        // Should return "session" or a valid AI-generated name
        assert!(!name.is_empty());
    }
}
