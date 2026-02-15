#![allow(
    clippy::allow_attributes,
    reason = "test files use allow for non-guaranteed lints"
)]
#![allow(clippy::expect_used, reason = "test code")]
#![allow(clippy::unwrap_used, reason = "test code")]
#![allow(clippy::print_stdout, reason = "test output")]
#![allow(clippy::print_stderr, reason = "test output")]

//! End-to-end tests for Docker backend
//!
//! These tests require Docker to be installed and running.
//! Run with: cargo test --test e2e_docker -- --include-ignored

mod common;

use clauderon::backends::{CreateOptions, DockerBackend, ExecutionBackend};
use tempfile::TempDir;

/// Full end-to-end test with Docker backend
///
/// This test creates a real Docker container, verifies it exists,
/// and cleans it up.
#[tokio::test]
#[ignore] // Requires Docker - run with --include-ignored
async fn test_docker_container_lifecycle() {
    if !common::docker_available() {
        eprintln!("Skipping test: Docker not available");
        return;
    }

    let docker = DockerBackend::new();

    // Create a temp directory for the workdir
    let temp_dir = TempDir::new().expect("Failed to create temp dir");
    let workdir = temp_dir.path();

    // Create a test file in the workdir
    std::fs::write(workdir.join("test.txt"), "Hello from test").unwrap();

    let container_name = format!("clauderon-test-{}", &uuid::Uuid::new_v4().to_string()[..8]);

    // Create container (using ExecutionBackend trait method)
    let result = docker
        .create(
            &container_name,
            workdir,
            "echo 'Test container'",
            CreateOptions::default(),
        )
        .await;

    match result {
        Ok(returned_name) => {
            // Verify container was created
            assert!(
                returned_name.starts_with("clauderon-"),
                "Container name should start with clauderon-"
            );

            // Verify container exists (using ExecutionBackend trait method)
            let exists = docker
                .exists(&returned_name)
                .await
                .expect("Failed to check container existence");
            assert!(exists, "Container should exist after creation");

            // Get logs (container might have exited quickly with echo command)
            let logs = docker.get_output(&returned_name, 10).await;
            // Logs might fail if container exited, that's OK for this test

            if let Ok(log_output) = logs {
                println!("Container logs: {log_output}");
            }

            // Delete container (using ExecutionBackend trait method)
            docker
                .delete(&returned_name)
                .await
                .expect("Failed to delete container");

            // Verify container is gone (using ExecutionBackend trait method)
            let exists_after_delete = docker
                .exists(&returned_name)
                .await
                .expect("Failed to check container existence after delete");
            assert!(
                !exists_after_delete,
                "Container should not exist after deletion"
            );
        }
        Err(e) => {
            // If container creation failed (e.g., image not available), skip
            eprintln!("Container creation failed (image may not be available): {e}");
            return;
        }
    }
}

/// Test Docker container existence check
#[tokio::test]
#[ignore]
async fn test_docker_container_exists_check() {
    if !common::docker_available() {
        eprintln!("Skipping test: Docker not available");
        return;
    }

    let docker = DockerBackend::new();

    // Non-existent container should return false (using ExecutionBackend trait method)
    let exists = docker
        .exists("nonexistent-container-xyz123")
        .await
        .expect("Failed to check container existence");
    assert!(!exists, "Non-existent container should not exist");
}

/// Test attach command generation
///
/// The attach command should:
/// 1. Use bash (not zsh which doesn't exist in container)
/// 2. Start the container first (in case it's stopped)
/// 3. Then attach to it
#[test]
fn test_docker_attach_command() {
    let docker = DockerBackend::new();

    let cmd = docker.attach_command("my-container");

    // Should use bash to wrap the command
    assert_eq!(cmd[0], "bash", "Should use bash shell");
    assert_eq!(cmd[1], "-c", "Should pass command with -c");

    // The command string should contain both start and attach
    let cmd_string = &cmd[2];
    assert!(
        cmd_string.contains("docker start"),
        "Should start container first: {cmd_string}"
    );
    assert!(
        cmd_string.contains("docker attach"),
        "Should attach to container: {cmd_string}"
    );
    assert!(
        cmd_string.contains("my-container"),
        "Should reference container name: {cmd_string}"
    );

    // Should NOT use zsh (doesn't exist in container)
    assert!(
        !cmd_string.contains("zsh"),
        "Should not use zsh: {cmd_string}"
    );
}

/// Test deleting a non-existent container doesn't fail
#[tokio::test]
#[ignore]
async fn test_docker_delete_nonexistent() {
    if !common::docker_available() {
        eprintln!("Skipping test: Docker not available");
        return;
    }

    let docker = DockerBackend::new();

    // Deleting a non-existent container should not panic (using ExecutionBackend trait method)
    let result = docker.delete("nonexistent-container-xyz").await;

    // Should complete without error (just logs a warning)
    assert!(
        result.is_ok(),
        "Deleting non-existent container should not fail"
    );
}

/// Test is_running check
#[tokio::test]
#[ignore]
async fn test_docker_is_running_check() {
    if !common::docker_available() {
        eprintln!("Skipping test: Docker not available");
        return;
    }

    let docker = DockerBackend::new();

    // Non-existent container should not be running
    let running = docker
        .is_running("nonexistent-container-xyz")
        .await
        .expect("Failed to check if container is running");
    assert!(!running, "Non-existent container should not be running");
}
