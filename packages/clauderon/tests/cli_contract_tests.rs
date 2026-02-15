#![allow(clippy::allow_attributes, reason = "test files use allow for non-guaranteed lints")]
#![allow(clippy::expect_used, reason = "test code")]
#![allow(clippy::unwrap_used, reason = "test code")]

//! CLI Contract Tests (Tier 2)
//!
//! These tests validate that generated CLI commands follow the expected
//! structure and schemas for Docker and Zellij. They verify argument order,
//! required flags, and format constraints without executing any commands.

use clauderon::backends::{DockerBackend, ZellijBackend};
use clauderon::core::AgentType;
use std::path::PathBuf;

/// Validate git user configuration is injected as environment variables
#[test]
fn test_git_config_env_vars() {
    let args = DockerBackend::build_create_args(
        "test-session",
        &PathBuf::from("/workspace"),
        &PathBuf::new(), // initial_workdir
        "test prompt",
        1000,
        None,
        AgentType::ClaudeCode,
        false,
        false,
        &[],
        Some("John Doe"),
        Some("john@example.com"),
        None, // session_id
        None, // http_port
        &clauderon::backends::DockerConfig::default(),
        None,
        None,
        None, // model
        &[],
        false, // volume_mode
        None,  // workspace_volume
    )
    .expect("Failed to build args");

    // Verify GIT_AUTHOR_NAME is set
    assert!(
        args.iter().any(|a| a == "GIT_AUTHOR_NAME=John Doe"),
        "Expected GIT_AUTHOR_NAME env var"
    );

    // Verify GIT_COMMITTER_NAME is set
    assert!(
        args.iter().any(|a| a == "GIT_COMMITTER_NAME=John Doe"),
        "Expected GIT_COMMITTER_NAME env var"
    );

    // Verify GIT_AUTHOR_EMAIL is set
    assert!(
        args.iter()
            .any(|a| a == "GIT_AUTHOR_EMAIL=john@example.com"),
        "Expected GIT_AUTHOR_EMAIL env var"
    );

    // Verify GIT_COMMITTER_EMAIL is set
    assert!(
        args.iter()
            .any(|a| a == "GIT_COMMITTER_EMAIL=john@example.com"),
        "Expected GIT_COMMITTER_EMAIL env var"
    );
}

/// Validate git config is omitted when None
#[test]
fn test_git_config_omitted_when_none() {
    let args = DockerBackend::build_create_args(
        "test-session",
        &PathBuf::from("/workspace"),
        &PathBuf::new(),
        "test prompt",
        1000,
        None,
        AgentType::ClaudeCode,
        false,
        false,
        &[],
        None,
        None,
        None,
        None, // http_port
        &clauderon::backends::DockerConfig::default(),
        None,
        None,
        None, // model
        &[],
        false, // volume_mode
        None,  // workspace_volume
    )
    .expect("Failed to build args");

    // Verify no GIT_* environment variables are set
    assert!(
        !args.iter().any(|a| a.starts_with("GIT_AUTHOR_")),
        "Should not have GIT_AUTHOR_ env vars when config is None"
    );
    assert!(
        !args.iter().any(|a| a.starts_with("GIT_COMMITTER_")),
        "Should not have GIT_COMMITTER_ env vars when config is None"
    );
}

/// Validate docker run argument structure follows correct order:
/// docker run [OPTIONS] IMAGE [COMMAND] [ARG...]
#[test]
fn test_docker_run_arg_order() {
    let args = DockerBackend::build_create_args(
        "test-session",
        &PathBuf::from("/workspace"),
        &PathBuf::new(),
        "test prompt",
        1000,
        None,
        AgentType::ClaudeCode,
        false, // print mode
        false, // dangerous_skip_checks
        &[],   // images
        None,  // git user name
        None,  // git user email
        None,  // session_id
        None,  // http_port
        &clauderon::backends::DockerConfig::default(),
        None,
        None,
        None, // model
        &[],
        false, // volume_mode
        None,  // workspace_volume
    )
    .expect("Failed to build args");

    // First arg must be "run"
    assert_eq!(args[0], "run", "First arg must be 'run'");

    // Find the image position (ghcr.io/...)
    let image_idx = args
        .iter()
        .position(|a| a.starts_with("ghcr.io/"))
        .expect("Expected image name in args");

    // Verify options come before image
    let name_idx = args.iter().position(|a| a == "--name").unwrap();
    let user_idx = args.iter().position(|a| a == "--user").unwrap();
    let workdir_idx = args.iter().position(|a| a == "-w").unwrap();

    assert!(name_idx < image_idx, "--name must come before image");
    assert!(user_idx < image_idx, "--user must come before image");
    assert!(workdir_idx < image_idx, "-w must come before image");

    // Verify command comes after image
    let bash_idx = args.iter().position(|a| a == "bash").unwrap();
    assert!(bash_idx > image_idx, "bash command must come after image");
}

/// Validate environment variables are set correctly
#[test]
fn test_docker_env_vars() {
    let args = DockerBackend::build_create_args(
        "test-session",
        &PathBuf::from("/workspace"),
        &PathBuf::new(),
        "test prompt",
        1000,
        None,
        AgentType::ClaudeCode,
        false, // print mode
        false, // dangerous_skip_checks
        &[],   // images
        None,  // git user name
        None,  // git user email
        None,  // session_id
        None,  // http_port
        &clauderon::backends::DockerConfig::default(),
        None,
        None,
        None, // model
        &[],
        false, // volume_mode
        None,  // workspace_volume
    )
    .expect("Failed to build args");

    // Find all -e flags and their values
    let env_vars: Vec<&str> = args
        .iter()
        .enumerate()
        .filter(|(_, a)| *a == "-e")
        .map(|(i, _)| args[i + 1].as_str())
        .collect();

    // Must have TERM set
    assert!(
        env_vars.iter().any(|v| v.starts_with("TERM=")),
        "Expected TERM environment variable: {env_vars:?}"
    );

    // Must have HOME set
    assert!(
        env_vars.iter().any(|v| v.starts_with("HOME=")),
        "Expected HOME environment variable: {env_vars:?}"
    );

    // TERM should be xterm-256color for proper terminal support
    assert!(
        env_vars.contains(&"TERM=xterm-256color"),
        "TERM should be xterm-256color: {env_vars:?}"
    );

    // HOME should be /workspace
    assert!(
        env_vars.contains(&"HOME=/workspace"),
        "HOME should be /workspace: {env_vars:?}"
    );
}

/// Validate zellij attach schema: zellij attach [OPTIONS] <session-name>
#[test]
fn test_zellij_attach_schema() {
    let args = ZellijBackend::build_attach_args("my-session");

    // Must start with zellij
    assert_eq!(args[0], "zellij", "First arg must be 'zellij'");

    // Second must be attach
    assert_eq!(args[1], "attach", "Second arg must be 'attach'");

    // Session name must be last
    assert_eq!(
        args.last().unwrap(),
        "my-session",
        "Session name must be last"
    );
}

/// Validate zellij create-background schema
#[test]
fn test_zellij_create_background_schema() {
    let args = ZellijBackend::build_create_session_args("my-session");

    // Must start with attach (not create-session)
    assert_eq!(args[0], "attach", "First arg must be 'attach'");

    // Must have --create-background flag
    assert!(
        args.contains(&"--create-background".to_owned()),
        "Must have --create-background flag: {args:?}"
    );

    // Session name must be last
    assert_eq!(
        args.last().unwrap(),
        "my-session",
        "Session name must be last"
    );
}

/// Validate zellij action schema: zellij action <action> [OPTIONS]
#[test]
fn test_zellij_action_schema() {
    let args = ZellijBackend::build_new_pane_args(
        &PathBuf::from("/workspace"),
        "test prompt",
        false,
        &[],
        AgentType::ClaudeCode,
        None,
        None, // model
    );

    // Must start with action
    assert_eq!(args[0], "action", "First arg must be 'action'");

    // Second must be the action name (new-pane)
    assert_eq!(args[1], "new-pane", "Second arg must be 'new-pane'");

    // Options come after action name
    let cwd_idx = args.iter().position(|a| a == "--cwd").unwrap();
    assert!(cwd_idx > 1, "--cwd must come after action name");
}

/// Validate volume mount format: host:container[:mode]
#[test]
fn test_volume_mount_format() {
    let args = DockerBackend::build_create_args(
        "test-session",
        &PathBuf::from("/my/workspace"),
        &PathBuf::new(),
        "test prompt",
        1000,
        None,
        AgentType::ClaudeCode,
        false, // print mode
        false, // dangerous_skip_checks
        &[],   // images
        None,  // git user name
        None,  // git user email
        None,  // session_id
        None,  // http_port
        &clauderon::backends::DockerConfig::default(),
        None,
        None,
        None, // model
        &[],
        false, // volume_mode
        None,  // workspace_volume
    )
    .expect("Failed to build args");

    // Find all -v flags and their values
    let volume_mounts: Vec<&str> = args
        .iter()
        .enumerate()
        .filter(|(_, a)| *a == "-v")
        .map(|(i, _)| args[i + 1].as_str())
        .collect();

    // Should have at least 1 volume mount (workspace)
    assert!(
        !volume_mounts.is_empty(),
        "Expected at least 1 volume mount: {volume_mounts:?}"
    );

    for mount in &volume_mounts {
        // Each mount should have at least one colon
        let parts: Vec<&str> = mount.split(':').collect();
        assert!(
            parts.len() >= 2,
            "Volume mount must have format host:container[:mode]: {mount}"
        );

        // Host path should be absolute or a named volume
        let is_absolute = parts[0].starts_with('/');
        let is_named_volume = parts[0].starts_with("clauderon-");
        assert!(
            is_absolute || is_named_volume,
            "Host path should be absolute or a named volume: {mount}"
        );

        // Container path should be absolute
        assert!(
            parts[1].starts_with('/'),
            "Container path should be absolute: {mount}"
        );
    }
}

/// Validate workspace volume mount maps to /workspace
#[test]
fn test_workspace_mount_destination() {
    let args = DockerBackend::build_create_args(
        "test-session",
        &PathBuf::from("/my/source/dir"),
        &PathBuf::new(),
        "test prompt",
        1000,
        None,
        AgentType::ClaudeCode,
        false, // print mode
        false, // dangerous_skip_checks
        &[],   // images
        None,  // git user name
        None,  // git user email
        None,  // session_id
        None,  // http_port
        &clauderon::backends::DockerConfig::default(),
        None,
        None,
        None, // model
        &[],
        false, // volume_mode
        None,  // workspace_volume
    )
    .expect("Failed to build args");

    // Find workspace volume mount
    let volume_mounts: Vec<&str> = args
        .iter()
        .enumerate()
        .filter(|(_, a)| *a == "-v")
        .map(|(i, _)| args[i + 1].as_str())
        .collect();

    let workspace_mount = volume_mounts
        .iter()
        .find(|m| m.contains("/my/source/dir"))
        .expect("Expected workspace mount");

    assert!(
        workspace_mount.contains(":/workspace"),
        "Workspace should mount to /workspace: {workspace_mount}"
    );
}

/// Validate that the final command contains claude with the prompt
#[test]
fn test_final_command_format() {
    let prompt = "implement feature X";
    let args = DockerBackend::build_create_args(
        "test-session",
        &PathBuf::from("/workspace"),
        &PathBuf::new(),
        prompt,
        1000,
        None,
        AgentType::ClaudeCode,
        false, // print mode
        true,  // dangerous_skip_checks - pass true to get --dangerously-skip-permissions
        &[],   // images
        None,  // git user name
        None,  // git user email
        None,  // session_id
        None,  // http_port
        &clauderon::backends::DockerConfig::default(),
        None,
        None,
        None, // model
        &[],
        false, // volume_mode
        None,  // workspace_volume
    )
    .expect("Failed to build args");

    let final_cmd = args.last().unwrap();

    // Should start with claude
    assert!(
        final_cmd.starts_with("claude"),
        "Final command should start with claude: {final_cmd}"
    );

    // Should have --dangerously-skip-permissions
    assert!(
        final_cmd.contains("--dangerously-skip-permissions"),
        "Should have dangerous flag: {final_cmd}"
    );

    // Should contain the prompt
    assert!(
        final_cmd.contains(prompt),
        "Should contain the prompt: {final_cmd}"
    );

    // Prompt should be quoted
    assert!(
        final_cmd.contains(&format!("'{prompt}'")),
        "Prompt should be single-quoted: {final_cmd}"
    );
}
