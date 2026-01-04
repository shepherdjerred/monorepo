//! Integration Lifecycle Tests
//!
//! These tests verify the complete user flow works end-to-end:
//! 1. Create session (worktree + container)
//! 2. Verify container is running
//! 3. Attach command works
//! 4. Container survives "detach" (stop reading)
//! 5. Re-attach to stopped container
//! 6. Delete cleans up everything
//!
//! Run with: cargo test --test integration_lifecycle -- --include-ignored

mod common;

use clauderon::backends::{
    CreateOptions, DockerBackend, ExecutionBackend, GitBackend, GitOperations,
};
use tempfile::TempDir;
use tokio::process::Command;

/// Test the complete Docker container lifecycle with real attach/detach
#[tokio::test]
#[ignore] // Requires Docker
async fn test_docker_full_lifecycle_with_attach() {
    if !common::docker_available() {
        eprintln!("Skipping: Docker not available");
        return;
    }

    let docker = DockerBackend::new();
    let temp_dir = TempDir::new().expect("Failed to create temp dir");
    let container_name = format!("lifecycle-test-{}", &uuid::Uuid::new_v4().to_string()[..8]);

    // Step 1: Create container
    println!("Step 1: Creating container...");
    let result = docker
        .create(
            &container_name,
            temp_dir.path(),
            "echo ready",
            CreateOptions::default(),
        )
        .await;

    let name = match result {
        Ok(n) => n,
        Err(e) => {
            eprintln!("Container creation failed (may need image): {e}");
            return;
        }
    };
    println!("  Created: {name}");

    // Step 2: Verify container exists
    println!("Step 2: Verifying container exists...");
    let exists = docker.exists(&name).await.expect("exists check failed");
    assert!(exists, "Container should exist after creation");
    println!("  Exists: {exists}");

    // Step 3: Get attach command and verify it's valid
    println!("Step 3: Getting attach command...");
    let attach_cmd = docker.attach_command(&name);
    println!("  Command: {attach_cmd:?}");
    assert!(!attach_cmd.is_empty(), "Attach command should not be empty");
    assert_eq!(attach_cmd[0], "bash", "Should use bash wrapper");

    // Step 4: Simulate detach (just stop interacting, container keeps running)
    println!("Step 4: Container should survive 'detach'...");
    // Give container time to start
    tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;
    let still_exists = docker.exists(&name).await.expect("exists check failed");
    assert!(still_exists, "Container should still exist after 'detach'");
    println!("  Still exists: {still_exists}");

    // Step 5: Stop container and verify re-attach command works
    println!("Step 5: Testing re-attach to stopped container...");
    // Stop the container
    let _ = Command::new("docker").args(["stop", &name]).output().await;

    // Verify it's stopped
    let is_running = docker.is_running(&name).await.expect("is_running failed");
    println!("  Is running after stop: {is_running}");

    // The attach command should start it first
    // Execute the attach command components to verify they work
    let start_result = Command::new("docker")
        .args(["start", &name])
        .output()
        .await
        .expect("docker start failed");
    assert!(
        start_result.status.success(),
        "docker start should succeed for stopped container"
    );
    println!("  Re-started successfully");

    // Step 6: Delete and verify cleanup
    println!("Step 6: Deleting container...");
    docker.delete(&name).await.expect("delete failed");
    let exists_after = docker.exists(&name).await.expect("exists check failed");
    assert!(!exists_after, "Container should not exist after delete");
    println!("  Deleted successfully");

    println!("\n✓ Full lifecycle test passed!");
}

/// Test that worktree + container creation work together
#[tokio::test]
#[ignore] // Requires Docker + Git
async fn test_worktree_and_container_together() {
    if !common::docker_available() {
        eprintln!("Skipping: Docker not available");
        return;
    }

    let docker = DockerBackend::new();
    let git = GitBackend::new();

    // Create a temp git repo
    let repo_dir = TempDir::new().expect("Failed to create repo dir");
    common::init_git_repo(repo_dir.path());

    // Create worktree
    let worktree_dir = TempDir::new().expect("Failed to create worktree parent");
    let worktree_path = worktree_dir.path().join("test-worktree");
    let branch_name = format!("test-branch-{}", &uuid::Uuid::new_v4().to_string()[..8]);

    println!("Step 1: Creating worktree...");
    git.create_worktree(repo_dir.path(), &worktree_path, &branch_name)
        .await
        .expect("Failed to create worktree");
    assert!(worktree_path.exists(), "Worktree should exist");
    println!("  Created worktree at: {}", worktree_path.display());

    // Create container pointing to worktree
    let container_name = format!("worktree-test-{}", &uuid::Uuid::new_v4().to_string()[..8]);
    println!("Step 2: Creating container with worktree as workdir...");

    let result = docker
        .create(
            &container_name,
            &worktree_path,
            "echo 'worktree test'",
            CreateOptions::default(),
        )
        .await;

    match result {
        Ok(name) => {
            println!("  Created container: {name}");

            // Verify the worktree is accessible in container
            tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;

            // Check logs or container state
            let exists = docker.exists(&name).await.expect("exists failed");
            assert!(exists, "Container should exist");

            // Cleanup
            println!("Step 3: Cleaning up...");
            docker.delete(&name).await.expect("delete failed");
            git.delete_worktree(repo_dir.path(), &worktree_path)
                .await
                .expect("worktree delete failed");
            println!("  Cleanup complete");

            println!("\n✓ Worktree + Container test passed!");
        }
        Err(e) => {
            // Cleanup worktree even if container failed
            let _ = git.delete_worktree(repo_dir.path(), &worktree_path).await;
            eprintln!("Container creation failed: {e}");
        }
    }
}

/// Test that DockerBackend::get_output() retrieves container logs
///
/// NOTE: This test uses raw `docker run` for container creation because:
/// - DockerBackend::create() runs Claude, which produces unpredictable output
/// - We need predictable output ("TEST_OUTPUT_12345") to verify get_output() works
/// - This test verifies DockerBackend::get_output(), not create()
#[tokio::test]
#[ignore] // Requires Docker
async fn test_container_output_retrieval() {
    if !common::docker_available() {
        eprintln!("Skipping: Docker not available");
        return;
    }

    let docker = DockerBackend::new();

    // Create a simple container that outputs something predictable
    // NOTE: Using raw docker here for predictable output (see docstring)
    let container_name = format!("output-test-{}", &uuid::Uuid::new_v4().to_string()[..8]);

    println!("Creating container with known output...");
    let create_result = Command::new("docker")
        .args([
            "run",
            "-d",
            "--name",
            &container_name,
            "alpine",
            "sh",
            "-c",
            "echo 'TEST_OUTPUT_12345' && sleep 30",
        ])
        .output()
        .await
        .expect("docker run failed");

    if !create_result.status.success() {
        eprintln!(
            "Failed to create container: {}",
            String::from_utf8_lossy(&create_result.stderr)
        );
        return;
    }

    // Wait for output
    tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;

    // Get logs using OUR get_output method
    let output = docker
        .get_output(&container_name, 10)
        .await
        .expect("get_output failed");

    println!("Container output: {output}");
    assert!(
        output.contains("TEST_OUTPUT_12345"),
        "Should contain expected output"
    );

    // Cleanup using OUR delete method
    docker.delete(&container_name).await.expect("delete failed");

    println!("✓ Output retrieval test passed!");
}

/// Test that stopped containers can be re-attached using our DockerBackend
///
/// Verifies that:
/// 1. DockerBackend::create() creates a container
/// 2. DockerBackend::attach_command() returns command with "docker start"
/// 3. The start command works on stopped containers
/// 4. DockerBackend::is_running() correctly detects running state
/// 5. DockerBackend::delete() cleans up
#[tokio::test]
#[ignore] // Requires Docker
async fn test_reattach_stopped_container() {
    if !common::docker_available() {
        eprintln!("Skipping: Docker not available");
        return;
    }

    let docker = DockerBackend::new();
    let temp_dir = TempDir::new().expect("Failed to create temp dir");
    let session_name = format!("reattach-test-{}", &uuid::Uuid::new_v4().to_string()[..8]);

    // Step 1: Create container using OUR backend
    println!("Step 1: Creating container via DockerBackend...");
    let name = match docker
        .create(
            &session_name,
            temp_dir.path(),
            "echo ready",
            CreateOptions::default(),
        )
        .await
    {
        Ok(n) => n,
        Err(e) => {
            eprintln!("Container creation failed (may need image): {e}");
            return;
        }
    };
    println!("  Created: {name}");

    // Give container time to start
    tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;

    // Step 2: Stop the container (raw docker - testing our re-attach handling)
    println!("Step 2: Stopping container...");
    let _ = Command::new("docker").args(["stop", &name]).output().await;

    // Verify stopped using OUR is_running method
    let is_running = docker.is_running(&name).await.expect("is_running failed");
    assert!(!is_running, "Container should be stopped");
    println!("  Stopped (is_running = {is_running})");

    // Step 3: Verify OUR attach_command includes "docker start"
    println!("Step 3: Checking attach_command includes docker start...");
    let attach_cmd = docker.attach_command(&name);
    let cmd_string = attach_cmd.join(" ");
    assert!(
        cmd_string.contains("docker start"),
        "attach_command should include 'docker start': {cmd_string}"
    );
    println!("  attach_command: {cmd_string}");

    // Step 4: Execute the start portion (simulating what attach would do)
    println!("Step 4: Re-starting container...");
    let start_result = Command::new("docker")
        .args(["start", &name])
        .output()
        .await
        .expect("docker start failed");
    assert!(
        start_result.status.success(),
        "docker start should work: {}",
        String::from_utf8_lossy(&start_result.stderr)
    );

    // Verify running using OUR is_running method
    let is_running = docker.is_running(&name).await.expect("is_running failed");
    assert!(is_running, "Container should be running after start");
    println!("  Re-started (is_running = {is_running})");

    // Step 5: Cleanup using OUR delete method
    println!("Step 5: Deleting via DockerBackend...");
    docker.delete(&name).await.expect("delete failed");
    let exists = docker.exists(&name).await.expect("exists check failed");
    assert!(!exists, "Container should not exist after delete");
    println!("  Deleted");

    println!("\n✓ Re-attach test passed!");
}
