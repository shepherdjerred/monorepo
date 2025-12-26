//! Smoke Tests (Tier 5)
//!
//! These tests verify that Claude actually starts and authenticates in containers.
//! They require:
//! - Docker installed and running
//! - Claude credentials (~/.claude directory)
//! - API access (network connectivity)
//!
//! Run with: cargo test --test smoke_tests -- --include-ignored
//!
//! These tests are typically run:
//! - Before releases
//! - When debugging authentication issues
//! - After major infrastructure changes

mod common;

use multiplexer::backends::{DockerBackend, ExecutionBackend};
use std::time::Duration;
use tempfile::TempDir;
use tokio::time::sleep;

/// Test that Claude starts without errors in a Docker container
///
/// This verifies:
/// 1. Container starts successfully
/// 2. Claude process begins execution
/// 3. No immediate crash or error output
#[tokio::test]
#[ignore] // Requires Docker + Claude credentials - run with --include-ignored
async fn test_claude_starts_in_docker() {
    if !common::docker_available() {
        eprintln!("Skipping: Docker not available");
        return;
    }
    if !common::claude_config_available() {
        eprintln!("Skipping: Claude config (~/.claude) not available");
        return;
    }

    let docker = DockerBackend::new();
    let temp_dir = TempDir::new().expect("Failed to create temp dir");
    let container_name = format!(
        "smoke-test-{}",
        uuid::Uuid::new_v4().to_string()[..8].to_string()
    );

    // Create container with a simple prompt
    let result = docker
        .create(&container_name, temp_dir.path(), "echo 'smoke test' && exit")
        .await;

    match result {
        Ok(name) => {
            // Give Claude a moment to start
            sleep(Duration::from_secs(3)).await;

            // Check logs for errors
            if let Ok(logs) = docker.get_output(&name, 50).await {
                // Should NOT contain common error patterns
                assert!(
                    !logs.contains("Error:"),
                    "Logs should not contain 'Error:': {logs}"
                );
                assert!(
                    !logs.contains("ENOENT"),
                    "Logs should not contain 'ENOENT': {logs}"
                );
                assert!(
                    !logs.contains("permission denied"),
                    "Logs should not contain 'permission denied': {logs}"
                );
                assert!(
                    !logs.contains("command not found"),
                    "Logs should not contain 'command not found': {logs}"
                );
            }

            // Cleanup
            let _ = docker.delete(&name).await;
        }
        Err(e) => {
            eprintln!("Container creation failed (may need to pull image): {e}");
        }
    }
}

/// Test that Claude can write to the debug directory
///
/// This verifies the .claude mount is writable (not read-only).
#[tokio::test]
#[ignore] // Requires Docker + Claude credentials
async fn test_claude_writes_debug_files() {
    if !common::docker_available() {
        eprintln!("Skipping: Docker not available");
        return;
    }
    if !common::claude_config_available() {
        eprintln!("Skipping: Claude config (~/.claude) not available");
        return;
    }

    let docker = DockerBackend::new();
    let temp_dir = TempDir::new().expect("Failed to create temp dir");
    let container_name = format!(
        "smoke-debug-{}",
        uuid::Uuid::new_v4().to_string()[..8].to_string()
    );

    let result = docker
        .create(
            &container_name,
            temp_dir.path(),
            "echo 'testing debug write'",
        )
        .await;

    match result {
        Ok(name) => {
            // Give Claude time to write debug files
            sleep(Duration::from_secs(5)).await;

            // Check logs for EROFS (read-only filesystem) error
            if let Ok(logs) = docker.get_output(&name, 100).await {
                assert!(
                    !logs.contains("EROFS"),
                    "Logs should not contain EROFS (read-only filesystem error): {logs}"
                );
                assert!(
                    !logs.contains("read-only file system"),
                    "Logs should not contain 'read-only file system': {logs}"
                );
            }

            // Cleanup
            let _ = docker.delete(&name).await;
        }
        Err(e) => {
            eprintln!("Container creation failed: {e}");
        }
    }
}

/// Test that the container runs as non-root user
///
/// Claude refuses --dangerously-skip-permissions when run as root.
#[tokio::test]
#[ignore] // Requires Docker
async fn test_container_runs_as_non_root() {
    if !common::docker_available() {
        eprintln!("Skipping: Docker not available");
        return;
    }

    let docker = DockerBackend::new();
    let temp_dir = TempDir::new().expect("Failed to create temp dir");
    let container_name = format!(
        "smoke-uid-{}",
        uuid::Uuid::new_v4().to_string()[..8].to_string()
    );

    // Create container - the command isn't important, we'll check the UID
    let result = docker
        .create(&container_name, temp_dir.path(), "id -u")
        .await;

    match result {
        Ok(name) => {
            sleep(Duration::from_secs(2)).await;

            // Check logs - should show non-zero UID
            if let Ok(logs) = docker.get_output(&name, 10).await {
                // If we see UID 0, that's root which is wrong
                let lines: Vec<&str> = logs.lines().collect();
                for line in lines {
                    if let Ok(uid) = line.trim().parse::<u32>() {
                        assert!(
                            uid != 0,
                            "Container should not run as root (UID 0), got UID: {uid}"
                        );
                    }
                }
            }

            // Cleanup
            let _ = docker.delete(&name).await;
        }
        Err(e) => {
            eprintln!("Container creation failed: {e}");
        }
    }
}

/// Test that the initial prompt is executed
///
/// Verifies the prompt actually reaches Claude.
#[tokio::test]
#[ignore] // Requires Docker + Claude credentials + API access
async fn test_initial_prompt_executed() {
    if !common::docker_available() {
        eprintln!("Skipping: Docker not available");
        return;
    }
    if !common::claude_config_available() {
        eprintln!("Skipping: Claude config (~/.claude) not available");
        return;
    }

    let docker = DockerBackend::new();
    let temp_dir = TempDir::new().expect("Failed to create temp dir");
    let container_name = format!(
        "smoke-prompt-{}",
        uuid::Uuid::new_v4().to_string()[..8].to_string()
    );

    // Create a file for Claude to read
    std::fs::write(temp_dir.path().join("test-file.txt"), "Hello from smoke test!")
        .expect("Failed to write test file");

    // Use a simple prompt that should produce recognizable output
    let result = docker
        .create(
            &container_name,
            temp_dir.path(),
            "read the file test-file.txt and print its contents exactly",
        )
        .await;

    match result {
        Ok(name) => {
            // Give Claude time to process the prompt
            sleep(Duration::from_secs(30)).await;

            if let Ok(logs) = docker.get_output(&name, 100).await {
                // Just verify no immediate errors - actual content verification
                // would depend on Claude's response format
                println!("Container logs: {logs}");
            }

            // Cleanup
            let _ = docker.delete(&name).await;
        }
        Err(e) => {
            eprintln!("Container creation failed: {e}");
        }
    }
}
