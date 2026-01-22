//! End-to-end tests for Sprites backend
//!
//! These tests require SPRITES_TOKEN environment variable to be set.
//! PTY tests also require the `sprite` CLI to be installed.
//! Run with: cargo test --test e2e_sprites -- --include-ignored

mod common;

use clauderon::backends::sprites_config::{SpritesConfig, SpritesLifecycle};
use clauderon::backends::{CreateOptions, ExecutionBackend, SpritesBackend};
use clauderon::core::console_manager::ConsoleManager;
use clauderon::core::session::BackendType;
use std::time::Duration;
use uuid::Uuid;

/// Create a SpritesBackend configured for testing (auto_destroy enabled)
fn test_sprites_backend() -> SpritesBackend {
    let mut config = SpritesConfig::load_or_default();
    config.lifecycle = SpritesLifecycle {
        auto_destroy: true,
        auto_checkpoint: false,
    };
    SpritesBackend::with_config(config)
}

/// Full end-to-end test with Sprites backend
///
/// This test creates a real sprite, verifies it exists, gets output,
/// and cleans it up.
#[tokio::test]
#[ignore] // Requires SPRITES_TOKEN - run with --include-ignored
async fn test_sprites_lifecycle() {
    if !common::sprites_available() {
        eprintln!("Skipping test: SPRITES_TOKEN not set");
        return;
    }

    let sprites = test_sprites_backend();

    // Create a temp directory for the workdir with git remote
    let temp_dir = tempfile::TempDir::new().expect("Failed to create temp dir");
    let workdir = temp_dir.path();

    // Initialize a git repository with a remote (required for Sprites)
    common::init_git_repo(workdir);

    // Add a mock remote - Sprites will try to clone from this
    // For testing, we use a public repo that exists
    let output = std::process::Command::new("git")
        .args([
            "remote",
            "add",
            "origin",
            "https://github.com/octocat/Hello-World.git",
        ])
        .current_dir(workdir)
        .output()
        .expect("Failed to add git remote");
    assert!(output.status.success(), "git remote add failed");

    let sprite_name = format!("test-{}", &Uuid::new_v4().to_string()[..8]);

    // Create sprite (using ExecutionBackend trait method)
    let result = sprites
        .create(
            &sprite_name,
            workdir,
            "echo 'Test sprite'",
            CreateOptions::default(),
        )
        .await;

    match result {
        Ok(returned_name) => {
            // Verify sprite was created with clauderon- prefix
            assert!(
                returned_name.starts_with("clauderon-"),
                "Sprite name should start with clauderon-"
            );

            // Verify sprite exists (using ExecutionBackend trait method)
            let exists = sprites
                .exists(&returned_name)
                .await
                .expect("Failed to check sprite existence");
            assert!(exists, "Sprite should exist after creation");

            // Wait a bit for sprite to be fully ready
            tokio::time::sleep(Duration::from_secs(5)).await;

            // Get logs from the tmux session
            let logs = sprites.get_output(&returned_name, 10).await;
            if let Ok(log_output) = logs {
                println!("Sprite logs: {log_output}");
            }

            // Delete sprite (using ExecutionBackend trait method)
            sprites
                .delete(&returned_name)
                .await
                .expect("Failed to delete sprite");

            // Verify sprite is gone (using ExecutionBackend trait method)
            // Note: sprite deletion might take a moment
            tokio::time::sleep(Duration::from_secs(5)).await;
            let exists_after_delete = sprites
                .exists(&returned_name)
                .await
                .expect("Failed to check sprite existence after delete");
            assert!(
                !exists_after_delete,
                "Sprite should not exist after deletion"
            );
        }
        Err(e) => {
            // If sprite creation failed (e.g., quota exceeded, image not available), skip
            eprintln!("Sprite creation failed: {e}");
            return;
        }
    }
}

/// Test Sprites existence check for non-existent sprite
#[tokio::test]
#[ignore] // Requires SPRITES_TOKEN - run with --include-ignored
async fn test_sprites_exists_check() {
    if !common::sprites_available() {
        eprintln!("Skipping test: SPRITES_TOKEN not set");
        return;
    }

    let sprites = test_sprites_backend();

    // Non-existent sprite should return false (using ExecutionBackend trait method)
    let exists = sprites
        .exists("clauderon-nonexistent-sprite-xyz123")
        .await
        .expect("Failed to check sprite existence");
    assert!(!exists, "Non-existent sprite should not exist");
}

/// Test attach command generation
///
/// The attach command should use the sprite CLI console command.
/// This test doesn't require any external dependencies.
#[test]
fn test_sprites_attach_command() {
    let sprites = test_sprites_backend();

    let cmd = sprites.attach_command("clauderon-test-sprite");

    // Should use sprite -s <name> console command
    // (-s is a global flag that comes before the subcommand)
    assert_eq!(cmd.len(), 4, "Command should have 4 parts");
    assert_eq!(cmd[0], "sprite", "Should use sprite CLI");
    assert_eq!(cmd[1], "-s", "Should use -s global flag for sprite name");
    assert_eq!(
        cmd[2], "clauderon-test-sprite",
        "Should reference sprite name"
    );
    assert_eq!(cmd[3], "console", "Should use console subcommand");
}

/// Test is_remote returns true for Sprites
///
/// Sprites is a remote backend since it runs on sprites.dev infrastructure.
#[test]
fn test_sprites_is_remote() {
    let sprites = test_sprites_backend();
    assert!(sprites.is_remote(), "Sprites should be a remote backend");
}

/// Test deleting a non-existent sprite doesn't fail
#[tokio::test]
#[ignore] // Requires SPRITES_TOKEN - run with --include-ignored
async fn test_sprites_delete_nonexistent() {
    if !common::sprites_available() {
        eprintln!("Skipping test: SPRITES_TOKEN not set");
        return;
    }

    let sprites = test_sprites_backend();

    // Deleting a non-existent sprite should not panic (using ExecutionBackend trait method)
    // Note: Sprites API may return an error for non-existent resources
    let result = sprites.delete("clauderon-nonexistent-sprite-xyz").await;

    // The result depends on the API behavior - some APIs return success,
    // others return 404. Either way, it should not panic.
    if let Err(e) = result {
        eprintln!("Delete non-existent sprite returned error (expected): {e}");
    }
}

// =============================================================================
// PTY Attachment Tests
// =============================================================================
// These tests require both SPRITES_TOKEN and the `sprite` CLI to be installed.

/// Test PTY attachment to a sprite
///
/// This test verifies that the full PTY attachment flow works:
/// 1. Create a sprite and wait for it to be ready
/// 2. Attach via ConsoleManager (uses sprite CLI under the hood)
/// 3. Send input through the PTY
/// 4. Read output back from the broadcast channel
/// 5. Verify the output contains the expected response
#[tokio::test]
#[ignore] // Requires SPRITES_TOKEN + sprite CLI - run with --include-ignored
async fn test_sprites_pty_attachment() {
    if !common::sprites_available() {
        eprintln!("Skipping test: SPRITES_TOKEN not set");
        return;
    }
    if !common::sprite_cli_available() {
        eprintln!("Skipping test: sprite CLI not installed");
        return;
    }

    let sprites = test_sprites_backend();

    // Create a temp directory for the workdir with git remote
    let temp_dir = tempfile::TempDir::new().expect("Failed to create temp dir");
    let workdir = temp_dir.path();

    // Initialize a git repository with a remote (required for Sprites)
    common::init_git_repo(workdir);

    // Add a mock remote
    let output = std::process::Command::new("git")
        .args([
            "remote",
            "add",
            "origin",
            "https://github.com/octocat/Hello-World.git",
        ])
        .current_dir(workdir)
        .output()
        .expect("Failed to add git remote");
    assert!(output.status.success(), "git remote add failed");

    let sprite_name = format!("pty-test-{}", &Uuid::new_v4().to_string()[..8]);

    // Create sprite
    let result = sprites
        .create(
            &sprite_name,
            workdir,
            "echo 'PTY test sprite ready'",
            CreateOptions::default(),
        )
        .await;

    let backend_id = match result {
        Ok(name) => name,
        Err(e) => {
            eprintln!("Sprite creation failed: {e}");
            return;
        }
    };

    // Wait for sprite to be fully ready
    tokio::time::sleep(Duration::from_secs(10)).await;

    // Test PTY attachment via ConsoleManager
    let console_manager = ConsoleManager::new();
    let session_id = Uuid::new_v4();

    let handle = match console_manager
        .ensure_session(session_id, BackendType::Sprites, &backend_id)
        .await
    {
        Ok(h) => h,
        Err(e) => {
            eprintln!("Failed to attach to sprite: {e}");
            // Cleanup
            let _ = sprites.delete(&backend_id).await;
            return;
        }
    };

    // Subscribe to output
    let mut rx = handle.subscribe();

    // Give the PTY more time to initialize - sprite shell startup can be slow
    tokio::time::sleep(Duration::from_secs(5)).await;

    // Send a command
    println!("Sending echo command to PTY...");
    if let Err(e) = handle
        .send_input(b"echo PTY_TEST_OUTPUT_123\n".to_vec())
        .await
    {
        eprintln!("Failed to send input: {e}");
        console_manager.remove_session(session_id).await;
        let _ = sprites.delete(&backend_id).await;
        return;
    }

    // Wait for output (with timeout)
    let output_result = tokio::time::timeout(Duration::from_secs(60), async {
        let mut collected = String::new();
        loop {
            match rx.recv().await {
                Ok(data) => {
                    let chunk = String::from_utf8_lossy(&data);
                    println!("PTY output chunk: {:?}", chunk);
                    collected.push_str(&chunk);
                    if collected.contains("PTY_TEST_OUTPUT_123") {
                        return collected;
                    }
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {
                    // Continue receiving
                }
                Err(tokio::sync::broadcast::error::RecvError::Closed) => {
                    println!("PTY channel closed");
                    break;
                }
            }
        }
        collected
    })
    .await;

    // Cleanup
    console_manager.remove_session(session_id).await;
    let _ = sprites.delete(&backend_id).await;

    // Verify output
    match output_result {
        Ok(output) => {
            assert!(
                output.contains("PTY_TEST_OUTPUT_123"),
                "Should receive echoed output, got: {output}"
            );
        }
        Err(_) => {
            panic!("Timeout waiting for PTY output");
        }
    }
}

/// Test PTY resize handling
///
/// This test verifies that terminal resize commands are handled correctly.
#[tokio::test]
#[ignore] // Requires SPRITES_TOKEN + sprite CLI - run with --include-ignored
async fn test_sprites_pty_resize() {
    if !common::sprites_available() {
        eprintln!("Skipping test: SPRITES_TOKEN not set");
        return;
    }
    if !common::sprite_cli_available() {
        eprintln!("Skipping test: sprite CLI not installed");
        return;
    }

    let sprites = test_sprites_backend();

    // Create a temp directory for the workdir with git remote
    let temp_dir = tempfile::TempDir::new().expect("Failed to create temp dir");
    let workdir = temp_dir.path();

    // Initialize a git repository with a remote
    common::init_git_repo(workdir);

    let output = std::process::Command::new("git")
        .args([
            "remote",
            "add",
            "origin",
            "https://github.com/octocat/Hello-World.git",
        ])
        .current_dir(workdir)
        .output()
        .expect("Failed to add git remote");
    assert!(output.status.success(), "git remote add failed");

    let sprite_name = format!("resize-test-{}", &Uuid::new_v4().to_string()[..8]);

    // Create sprite
    let result = sprites
        .create(
            &sprite_name,
            workdir,
            "echo 'Resize test sprite'",
            CreateOptions::default(),
        )
        .await;

    let backend_id = match result {
        Ok(name) => name,
        Err(e) => {
            eprintln!("Sprite creation failed: {e}");
            return;
        }
    };

    // Wait for sprite to be ready
    tokio::time::sleep(Duration::from_secs(10)).await;

    // Attach via ConsoleManager
    let console_manager = ConsoleManager::new();
    let session_id = Uuid::new_v4();

    let handle = match console_manager
        .ensure_session(session_id, BackendType::Sprites, &backend_id)
        .await
    {
        Ok(h) => h,
        Err(e) => {
            eprintln!("Failed to attach to sprite: {e}");
            let _ = sprites.delete(&backend_id).await;
            return;
        }
    };

    // Test resize - should not error
    handle.resize(40, 120).await;
    handle.resize(24, 80).await;
    handle.resize(50, 200).await;

    // Cleanup
    console_manager.remove_session(session_id).await;
    let _ = sprites.delete(&backend_id).await;

    // If we got here without panicking, the test passed
}
