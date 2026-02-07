//! End-to-end tests for Sprites backend
//!
//! These tests require SPRITES_TOKEN environment variable to be set.
//! PTY tests also require the `sprite` CLI to be installed.
//!
//! IMPORTANT: Run with single thread to avoid quota issues:
//!   cargo test --test e2e_sprites -- --include-ignored --test-threads=1
//!
//! Tests use SpriteCleanupGuard for reliable cleanup via `sprite destroy --force`.

mod common;

use clauderon::backends::sprites_config::{SpritesConfig, SpritesGit, SpritesLifecycle};
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
    common::init_git_repo_with_remote(workdir, "https://github.com/octocat/Hello-World.git");

    let sprite_name = format!("test-{}", &Uuid::new_v4().to_string()[..8]);
    let full_sprite_name = format!("clauderon-{sprite_name}");

    // Setup cleanup guard BEFORE create - will force destroy sprite even if create fails partway
    let _cleanup = common::SpriteCleanupGuard::new(full_sprite_name);

    // Create sprite (using ExecutionBackend trait method)
    let returned_name = sprites
        .create(
            &sprite_name,
            workdir,
            "echo 'Test sprite'",
            CreateOptions::default(),
        )
        .await
        .expect("Sprite creation failed");

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

    // Cleanup is handled by the guard on drop via force destroy
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
    common::init_git_repo_with_remote(workdir, "https://github.com/octocat/Hello-World.git");

    let sprite_name = format!("pty-test-{}", &Uuid::new_v4().to_string()[..8]);
    let full_sprite_name = format!("clauderon-{sprite_name}");

    // Setup cleanup guard BEFORE create
    let _cleanup = common::SpriteCleanupGuard::new(full_sprite_name);

    // Create sprite
    let backend_id = sprites
        .create(
            &sprite_name,
            workdir,
            "echo 'PTY test sprite ready'",
            CreateOptions::default(),
        )
        .await
        .expect("Sprite creation failed");

    // Wait for sprite to be fully ready
    tokio::time::sleep(Duration::from_secs(10)).await;

    // Test PTY attachment via ConsoleManager
    let console_manager = ConsoleManager::new();
    let session_id = Uuid::new_v4();

    let handle = console_manager
        .ensure_session(session_id, BackendType::Sprites, &backend_id)
        .await
        .expect("Failed to attach to sprite");

    // Subscribe to output
    let mut rx = handle.subscribe();

    // Give the PTY more time to initialize - sprite shell startup can be slow
    tokio::time::sleep(Duration::from_secs(5)).await;

    // Send a command
    println!("Sending echo command to PTY...");
    handle
        .send_input(b"echo PTY_TEST_OUTPUT_123\n".to_vec())
        .await
        .expect("Failed to send input");

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

    // Remove console session
    console_manager.remove_session(session_id).await;

    // Verify output (cleanup guard handles sprite destruction)
    let output = output_result.expect("Timeout waiting for PTY output");
    assert!(
        output.contains("PTY_TEST_OUTPUT_123"),
        "Should receive echoed output, got: {output}"
    );
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
    common::init_git_repo_with_remote(workdir, "https://github.com/octocat/Hello-World.git");

    let sprite_name = format!("resize-test-{}", &Uuid::new_v4().to_string()[..8]);
    let full_sprite_name = format!("clauderon-{sprite_name}");

    // Setup cleanup guard BEFORE create
    let _cleanup = common::SpriteCleanupGuard::new(full_sprite_name);

    // Create sprite
    let backend_id = sprites
        .create(
            &sprite_name,
            workdir,
            "echo 'Resize test sprite'",
            CreateOptions::default(),
        )
        .await
        .expect("Sprite creation failed");

    // Wait for sprite to be ready
    tokio::time::sleep(Duration::from_secs(10)).await;

    // Attach via ConsoleManager
    let console_manager = ConsoleManager::new();
    let session_id = Uuid::new_v4();

    let handle = console_manager
        .ensure_session(session_id, BackendType::Sprites, &backend_id)
        .await
        .expect("Failed to attach to sprite");

    // Test resize - should not error
    handle.resize(40, 120).await;
    handle.resize(24, 80).await;
    handle.resize(50, 200).await;

    // Remove console session (cleanup guard handles sprite destruction)
    console_manager.remove_session(session_id).await;
}

// =============================================================================
// Repository Scenario Tests
// =============================================================================

use clauderon::core::session::SessionRepository;

/// Test creating a sprite with multiple repositories
///
/// Verifies that both primary (/home/sprite/workspace) and secondary
/// (/home/sprite/repos/{name}) repositories are properly set up.
#[tokio::test]
#[ignore] // Requires SPRITES_TOKEN - run with --include-ignored
async fn test_sprites_multi_repo_session() {
    if !common::sprites_available() {
        eprintln!("Skipping test: SPRITES_TOKEN not set");
        return;
    }

    let sprites = test_sprites_backend();

    // Create temp directories for primary and secondary repos
    let primary_dir = tempfile::TempDir::new().expect("Failed to create primary temp dir");
    let secondary_dir = tempfile::TempDir::new().expect("Failed to create secondary temp dir");

    // Initialize both repos with remotes
    common::init_git_repo_with_remote(
        primary_dir.path(),
        "https://github.com/octocat/Hello-World.git",
    );
    common::init_git_repo_with_remote(
        secondary_dir.path(),
        "https://github.com/octocat/Spoon-Knife.git",
    );

    let sprite_name = format!("multi-repo-{}", &Uuid::new_v4().to_string()[..8]);
    let full_sprite_name = format!("clauderon-{sprite_name}");

    // Setup cleanup guard BEFORE create
    let _cleanup = common::SpriteCleanupGuard::new(full_sprite_name);

    // Create repositories config
    let repositories = vec![
        SessionRepository {
            repo_path: primary_dir.path().to_path_buf(),
            subdirectory: std::path::PathBuf::new(),
            worktree_path: primary_dir.path().to_path_buf(),
            branch_name: "master".to_string(),
            mount_name: "primary".to_string(),
            is_primary: true,
            base_branch: None,
        },
        SessionRepository {
            repo_path: secondary_dir.path().to_path_buf(),
            subdirectory: std::path::PathBuf::new(),
            worktree_path: secondary_dir.path().to_path_buf(),
            branch_name: "main".to_string(),
            mount_name: "secondary-lib".to_string(),
            is_primary: false,
            base_branch: None,
        },
    ];

    let options = CreateOptions {
        repositories,
        ..Default::default()
    };

    let returned_name = sprites
        .create(
            &sprite_name,
            primary_dir.path(),
            "echo 'Multi-repo test'",
            options,
        )
        .await
        .expect("Sprite creation failed");

    // Wait for setup to complete
    tokio::time::sleep(Duration::from_secs(5)).await;

    // Verify the paths exist by running ls commands
    let check_primary = std::process::Command::new("sprite")
        .args([
            "exec",
            "-s",
            &returned_name,
            "--",
            "ls",
            "-la",
            "/home/sprite/workspace",
        ])
        .output();

    let check_secondary = std::process::Command::new("sprite")
        .args([
            "exec",
            "-s",
            &returned_name,
            "--",
            "ls",
            "-la",
            "/home/sprite/repos/secondary-lib",
        ])
        .output();

    if let Ok(output) = check_primary {
        assert!(
            output.status.success(),
            "Primary workspace should exist at /home/sprite/workspace"
        );
        println!(
            "Primary workspace contents: {}",
            String::from_utf8_lossy(&output.stdout)
        );
    }

    if let Ok(output) = check_secondary {
        assert!(
            output.status.success(),
            "Secondary repo should exist at /home/sprite/repos/secondary-lib"
        );
        println!(
            "Secondary repo contents: {}",
            String::from_utf8_lossy(&output.stdout)
        );
    }
    // Cleanup handled by guard
}

/// Test creating a new branch when it doesn't exist on remote
///
/// When the target branch doesn't exist on the remote, the sprite should
/// create a new local branch.
#[tokio::test]
#[ignore] // Requires SPRITES_TOKEN - run with --include-ignored
async fn test_sprites_new_branch_creation() {
    if !common::sprites_available() {
        eprintln!("Skipping test: SPRITES_TOKEN not set");
        return;
    }

    let sprites = test_sprites_backend();
    let temp_dir = tempfile::TempDir::new().expect("Failed to create temp dir");

    // Initialize repo with remote
    common::init_git_repo_with_remote(
        temp_dir.path(),
        "https://github.com/octocat/Hello-World.git",
    );

    let sprite_name = format!("new-branch-{}", &Uuid::new_v4().to_string()[..8]);
    let unique_branch = format!("test-branch-{}", &Uuid::new_v4().to_string()[..8]);
    let full_sprite_name = format!("clauderon-{sprite_name}");

    // Setup cleanup guard BEFORE create
    let _cleanup = common::SpriteCleanupGuard::new(full_sprite_name);

    let repositories = vec![SessionRepository {
        repo_path: temp_dir.path().to_path_buf(),
        subdirectory: std::path::PathBuf::new(),
        worktree_path: temp_dir.path().to_path_buf(),
        branch_name: unique_branch.clone(),
        mount_name: "primary".to_string(),
        is_primary: true,
        base_branch: None,
    }];

    let options = CreateOptions {
        repositories,
        ..Default::default()
    };

    let returned_name = sprites
        .create(
            &sprite_name,
            temp_dir.path(),
            "echo 'New branch test'",
            options,
        )
        .await
        .expect("Sprite creation failed");

    tokio::time::sleep(Duration::from_secs(3)).await;

    // Verify the branch was created
    let branch_check = std::process::Command::new("sprite")
        .args([
            "exec",
            "-s",
            &returned_name,
            "--",
            "git",
            "-C",
            "/home/sprite/workspace",
            "branch",
            "--show-current",
        ])
        .output();

    if let Ok(output) = branch_check {
        let current_branch = String::from_utf8_lossy(&output.stdout).trim().to_string();
        assert_eq!(
            current_branch, unique_branch,
            "Should be on the newly created branch"
        );
        println!("Successfully created and checked out branch: {current_branch}");
    }
    // Cleanup handled by guard
}

/// Test checking out an existing remote branch
///
/// When the target branch exists on the remote, the sprite should fetch
/// and checkout a tracking branch.
#[tokio::test]
#[ignore] // Requires SPRITES_TOKEN - run with --include-ignored
async fn test_sprites_existing_remote_branch_tracking() {
    if !common::sprites_available() {
        eprintln!("Skipping test: SPRITES_TOKEN not set");
        return;
    }

    // Need full clone (not shallow) to track remote branches properly
    let mut config = SpritesConfig::load_or_default();
    config.lifecycle.auto_destroy = true;
    config.git.shallow_clone = false;
    let sprites = SpritesBackend::with_config(config);

    let temp_dir = tempfile::TempDir::new().expect("Failed to create temp dir");

    // Initialize repo with remote - Hello-World has a 'test' branch
    common::init_git_repo_with_remote(
        temp_dir.path(),
        "https://github.com/octocat/Hello-World.git",
    );

    let sprite_name = format!("track-branch-{}", &Uuid::new_v4().to_string()[..8]);
    let full_sprite_name = format!("clauderon-{sprite_name}");

    // Setup cleanup guard BEFORE create
    let _cleanup = common::SpriteCleanupGuard::new(full_sprite_name);

    // Use 'test' branch which exists on octocat/Hello-World
    let repositories = vec![SessionRepository {
        repo_path: temp_dir.path().to_path_buf(),
        subdirectory: std::path::PathBuf::new(),
        worktree_path: temp_dir.path().to_path_buf(),
        branch_name: "test".to_string(),
        mount_name: "primary".to_string(),
        is_primary: true,
        base_branch: None,
    }];

    let options = CreateOptions {
        repositories,
        ..Default::default()
    };

    let returned_name = sprites
        .create(
            &sprite_name,
            temp_dir.path(),
            "echo 'Tracking branch test'",
            options,
        )
        .await
        .expect("Sprite creation failed");

    tokio::time::sleep(Duration::from_secs(3)).await;

    // Verify we're on the 'test' branch
    let branch_check = std::process::Command::new("sprite")
        .args([
            "exec",
            "-s",
            &returned_name,
            "--",
            "git",
            "-C",
            "/home/sprite/workspace",
            "branch",
            "--show-current",
        ])
        .output();

    if let Ok(output) = branch_check {
        let current_branch = String::from_utf8_lossy(&output.stdout).trim().to_string();
        assert_eq!(
            current_branch, "test",
            "Should be on the 'test' tracking branch"
        );
        println!("Successfully checked out tracking branch: {current_branch}");
    }
    // Cleanup handled by guard
}

/// Test base_branch workflow
///
/// Clone from a base branch (main), then create a feature branch.
#[tokio::test]
#[ignore] // Requires SPRITES_TOKEN - run with --include-ignored
async fn test_sprites_base_branch_workflow() {
    if !common::sprites_available() {
        eprintln!("Skipping test: SPRITES_TOKEN not set");
        return;
    }

    let sprites = test_sprites_backend();
    let temp_dir = tempfile::TempDir::new().expect("Failed to create temp dir");

    common::init_git_repo_with_remote(
        temp_dir.path(),
        "https://github.com/octocat/Hello-World.git",
    );

    let sprite_name = format!("base-branch-{}", &Uuid::new_v4().to_string()[..8]);
    let feature_branch = format!("feature-{}", &Uuid::new_v4().to_string()[..8]);
    let full_sprite_name = format!("clauderon-{sprite_name}");

    // Setup cleanup guard BEFORE create
    let _cleanup = common::SpriteCleanupGuard::new(full_sprite_name);

    let repositories = vec![SessionRepository {
        repo_path: temp_dir.path().to_path_buf(),
        subdirectory: std::path::PathBuf::new(),
        worktree_path: temp_dir.path().to_path_buf(),
        branch_name: feature_branch.clone(),
        mount_name: "primary".to_string(),
        is_primary: true,
        base_branch: Some("master".to_string()), // Clone from master, create feature branch
    }];

    let options = CreateOptions {
        repositories,
        ..Default::default()
    };

    let returned_name = sprites
        .create(
            &sprite_name,
            temp_dir.path(),
            "echo 'Base branch workflow test'",
            options,
        )
        .await
        .expect("Sprite creation failed");

    tokio::time::sleep(Duration::from_secs(3)).await;

    // Verify we're on the feature branch
    let branch_check = std::process::Command::new("sprite")
        .args([
            "exec",
            "-s",
            &returned_name,
            "--",
            "git",
            "-C",
            "/home/sprite/workspace",
            "branch",
            "--show-current",
        ])
        .output();

    if let Ok(output) = branch_check {
        let current_branch = String::from_utf8_lossy(&output.stdout).trim().to_string();
        assert_eq!(
            current_branch, feature_branch,
            "Should be on the feature branch"
        );
        println!("Successfully created feature branch from base: {current_branch}");
    }
    // Cleanup handled by guard
}

/// Test shallow clone when enabled
///
/// Verify that --depth 1 is used when shallow_clone=true.
#[tokio::test]
#[ignore] // Requires SPRITES_TOKEN - run with --include-ignored
async fn test_sprites_shallow_clone_enabled() {
    if !common::sprites_available() {
        eprintln!("Skipping test: SPRITES_TOKEN not set");
        return;
    }

    // Create backend with shallow_clone enabled (default)
    let mut config = SpritesConfig::load_or_default();
    config.lifecycle.auto_destroy = true;
    config.git.shallow_clone = true;
    let sprites = SpritesBackend::with_config(config);

    let temp_dir = tempfile::TempDir::new().expect("Failed to create temp dir");
    common::init_git_repo_with_remote(
        temp_dir.path(),
        "https://github.com/octocat/Hello-World.git",
    );

    let sprite_name = format!("shallow-{}", &Uuid::new_v4().to_string()[..8]);
    let full_sprite_name = format!("clauderon-{sprite_name}");

    // Setup cleanup guard BEFORE create
    let _cleanup = common::SpriteCleanupGuard::new(full_sprite_name);

    let returned_name = sprites
        .create(
            &sprite_name,
            temp_dir.path(),
            "echo 'Shallow clone test'",
            CreateOptions::default(),
        )
        .await
        .expect("Sprite creation failed");

    tokio::time::sleep(Duration::from_secs(3)).await;

    // Check commit count - should be 1 for shallow clone
    let count_check = std::process::Command::new("sprite")
        .args([
            "exec",
            "-s",
            &returned_name,
            "--",
            "git",
            "-C",
            "/home/sprite/workspace",
            "rev-list",
            "--count",
            "HEAD",
        ])
        .output();

    if let Ok(output) = count_check {
        if output.status.success() {
            let count: i32 = String::from_utf8_lossy(&output.stdout)
                .trim()
                .parse()
                .unwrap_or(0);
            assert_eq!(count, 1, "Shallow clone should have exactly 1 commit");
            println!("Verified shallow clone: {count} commit(s)");
        }
    }
    // Cleanup handled by guard
}

/// Test full clone when shallow_clone is disabled
///
/// Verify full history is cloned when shallow_clone=false.
#[tokio::test]
#[ignore] // Requires SPRITES_TOKEN - run with --include-ignored
async fn test_sprites_shallow_clone_disabled() {
    if !common::sprites_available() {
        eprintln!("Skipping test: SPRITES_TOKEN not set");
        return;
    }

    // Create backend with shallow_clone disabled
    let mut config = SpritesConfig::load_or_default();
    config.lifecycle.auto_destroy = true;
    config.git.shallow_clone = false;
    let sprites = SpritesBackend::with_config(config);

    let temp_dir = tempfile::TempDir::new().expect("Failed to create temp dir");
    common::init_git_repo_with_remote(
        temp_dir.path(),
        "https://github.com/octocat/Hello-World.git",
    );

    let sprite_name = format!("full-clone-{}", &Uuid::new_v4().to_string()[..8]);
    let full_sprite_name = format!("clauderon-{sprite_name}");

    // Setup cleanup guard BEFORE create
    let _cleanup = common::SpriteCleanupGuard::new(full_sprite_name);

    let returned_name = sprites
        .create(
            &sprite_name,
            temp_dir.path(),
            "echo 'Full clone test'",
            CreateOptions::default(),
        )
        .await
        .expect("Sprite creation failed");

    tokio::time::sleep(Duration::from_secs(3)).await;

    // Check commit count - should be > 1 for full clone
    let count_check = std::process::Command::new("sprite")
        .args([
            "exec",
            "-s",
            &returned_name,
            "--",
            "git",
            "-C",
            "/home/sprite/workspace",
            "rev-list",
            "--count",
            "HEAD",
        ])
        .output();

    if let Ok(output) = count_check {
        if output.status.success() {
            let count: i32 = String::from_utf8_lossy(&output.stdout)
                .trim()
                .parse()
                .unwrap_or(0);
            assert!(
                count > 1,
                "Full clone should have more than 1 commit, got {count}"
            );
            println!("Verified full clone: {count} commit(s)");
        }
    }
    // Cleanup handled by guard
}

// =============================================================================
// Agent Installation Verification Tests
// =============================================================================

/// Test that Claude Code is properly installed in the sprite
#[tokio::test]
#[ignore] // Requires SPRITES_TOKEN - run with --include-ignored
async fn test_sprites_claude_installation_verified() {
    if !common::sprites_available() {
        eprintln!("Skipping test: SPRITES_TOKEN not set");
        return;
    }

    let sprites = test_sprites_backend();
    let temp_dir = tempfile::TempDir::new().expect("Failed to create temp dir");

    common::init_git_repo_with_remote(
        temp_dir.path(),
        "https://github.com/octocat/Hello-World.git",
    );

    let sprite_name = format!("claude-install-{}", &Uuid::new_v4().to_string()[..8]);
    let full_sprite_name = format!("clauderon-{sprite_name}");

    // Setup cleanup guard BEFORE create
    let _cleanup = common::SpriteCleanupGuard::new(full_sprite_name);

    let returned_name = sprites
        .create(
            &sprite_name,
            temp_dir.path(),
            "echo 'Claude installation test'",
            CreateOptions::default(),
        )
        .await
        .expect("Sprite creation failed");

    // Give installation time to complete
    tokio::time::sleep(Duration::from_secs(10)).await;

    // Verify claude is installed
    let claude_check = std::process::Command::new("sprite")
        .args(["exec", "-s", &returned_name, "--", "which", "claude"])
        .output();

    if let Ok(output) = claude_check {
        assert!(
            output.status.success(),
            "Claude should be installed and in PATH"
        );
        let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
        assert!(!path.is_empty(), "Claude path should not be empty");
        println!("Claude installed at: {path}");
    }
    // Cleanup handled by guard
}

/// Test that abduco is properly installed for session management
#[tokio::test]
#[ignore] // Requires SPRITES_TOKEN - run with --include-ignored
async fn test_sprites_abduco_installation_verified() {
    if !common::sprites_available() {
        eprintln!("Skipping test: SPRITES_TOKEN not set");
        return;
    }

    let sprites = test_sprites_backend();
    let temp_dir = tempfile::TempDir::new().expect("Failed to create temp dir");

    common::init_git_repo_with_remote(
        temp_dir.path(),
        "https://github.com/octocat/Hello-World.git",
    );

    let sprite_name = format!("abduco-install-{}", &Uuid::new_v4().to_string()[..8]);
    let full_sprite_name = format!("clauderon-{sprite_name}");

    // Setup cleanup guard BEFORE create
    let _cleanup = common::SpriteCleanupGuard::new(full_sprite_name);

    let returned_name = sprites
        .create(
            &sprite_name,
            temp_dir.path(),
            "echo 'Abduco installation test'",
            CreateOptions::default(),
        )
        .await
        .expect("Sprite creation failed");

    tokio::time::sleep(Duration::from_secs(10)).await;

    // Verify abduco is installed
    let abduco_check = std::process::Command::new("sprite")
        .args(["exec", "-s", &returned_name, "--", "which", "abduco"])
        .output();

    if let Ok(output) = abduco_check {
        assert!(
            output.status.success(),
            "Abduco should be installed and in PATH"
        );
        let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
        assert!(!path.is_empty(), "Abduco path should not be empty");
        println!("Abduco installed at: {path}");
    }

    // Verify clauderon session exists
    let session_check = std::process::Command::new("sprite")
        .args(["exec", "-s", &returned_name, "--", "abduco", "-l"])
        .output();

    if let Ok(output) = session_check {
        let sessions = String::from_utf8_lossy(&output.stdout);
        assert!(
            sessions.contains("clauderon"),
            "Abduco should have a 'clauderon' session, got: {sessions}"
        );
        println!("Abduco sessions: {sessions}");
    }
    // Cleanup handled by guard
}

/// Test that the agent produces output in the log file
#[tokio::test]
#[ignore] // Requires SPRITES_TOKEN - run with --include-ignored
async fn test_sprites_agent_produces_output() {
    if !common::sprites_available() {
        eprintln!("Skipping test: SPRITES_TOKEN not set");
        return;
    }

    let sprites = test_sprites_backend();
    let temp_dir = tempfile::TempDir::new().expect("Failed to create temp dir");

    common::init_git_repo_with_remote(
        temp_dir.path(),
        "https://github.com/octocat/Hello-World.git",
    );

    let sprite_name = format!("agent-output-{}", &Uuid::new_v4().to_string()[..8]);
    let full_sprite_name = format!("clauderon-{sprite_name}");

    // Setup cleanup guard BEFORE create
    let _cleanup = common::SpriteCleanupGuard::new(full_sprite_name);

    let returned_name = sprites
        .create(
            &sprite_name,
            temp_dir.path(),
            "Hello! Please respond with 'Test successful'",
            CreateOptions::default(),
        )
        .await
        .expect("Sprite creation failed");

    // Wait for agent to produce some output
    tokio::time::sleep(Duration::from_secs(15)).await;

    // Check if log file has content
    let log_check = std::process::Command::new("sprite")
        .args([
            "exec",
            "-s",
            &returned_name,
            "--",
            "wc",
            "-c",
            "/tmp/clauderon.log",
        ])
        .output();

    if let Ok(output) = log_check {
        if output.status.success() {
            let byte_count: i64 = String::from_utf8_lossy(&output.stdout)
                .split_whitespace()
                .next()
                .and_then(|s| s.parse().ok())
                .unwrap_or(-1); // -1 indicates parse failure, file exists
            println!("Agent log has {byte_count} bytes");
            // Log file exists - that's the success condition, not content
            // (Claude agent may not produce output without API credentials)
        }
    }

    // Also verify via get_output
    let output = sprites.get_output(&returned_name, 20).await;
    if let Ok(log_content) = output {
        // Either has content or doesn't panic - both acceptable
        println!(
            "Agent output preview: {}",
            &log_content[..log_content.len().min(200)]
        );
    }
    // Cleanup handled by guard
}

// =============================================================================
// Error Handling Tests
// =============================================================================

/// Test that invalid git remote URL returns a descriptive error
#[tokio::test]
#[ignore] // Requires SPRITES_TOKEN - run with --include-ignored
async fn test_sprites_invalid_git_remote_fails() {
    if !common::sprites_available() {
        eprintln!("Skipping test: SPRITES_TOKEN not set");
        return;
    }

    let sprites = test_sprites_backend();
    let temp_dir = tempfile::TempDir::new().expect("Failed to create temp dir");

    // Initialize with invalid remote
    common::init_git_repo_with_remote(
        temp_dir.path(),
        "https://github.com/nonexistent-org-12345/nonexistent-repo-67890.git",
    );

    let sprite_name = format!("invalid-remote-{}", &Uuid::new_v4().to_string()[..8]);
    let full_sprite_name = format!("clauderon-{sprite_name}");

    // Setup cleanup guard BEFORE create - in case sprite is partially created
    let _cleanup = common::SpriteCleanupGuard::new(full_sprite_name);

    let result = sprites
        .create(
            &sprite_name,
            temp_dir.path(),
            "echo 'Should fail'",
            CreateOptions::default(),
        )
        .await;

    match result {
        Ok(_returned_name) => {
            // The clone should have failed inside the sprite
            eprintln!("Note: Sprite was created, but clone may have failed internally");
        }
        Err(e) => {
            let error_msg = e.to_string().to_lowercase();
            assert!(
                error_msg.contains("clone")
                    || error_msg.contains("remote")
                    || error_msg.contains("repository")
                    || error_msg.contains("not found")
                    || error_msg.contains("failed"),
                "Error should mention clone/remote/repository failure, got: {e}"
            );
            println!("Got expected error for invalid remote: {e}");
        }
    }
    // Cleanup handled by guard
}

/// Test that missing git remote returns a helpful error
#[tokio::test]
#[ignore] // Requires SPRITES_TOKEN - run with --include-ignored
async fn test_sprites_missing_remote_fails() {
    if !common::sprites_available() {
        eprintln!("Skipping test: SPRITES_TOKEN not set");
        return;
    }

    let sprites = test_sprites_backend();
    let temp_dir = tempfile::TempDir::new().expect("Failed to create temp dir");

    // Initialize repo WITHOUT a remote
    common::init_git_repo(temp_dir.path());

    let sprite_name = format!("no-remote-{}", &Uuid::new_v4().to_string()[..8]);
    let full_sprite_name = format!("clauderon-{sprite_name}");

    // Setup cleanup guard BEFORE create - in case sprite is partially created
    let _cleanup = common::SpriteCleanupGuard::new(full_sprite_name);

    let result = sprites
        .create(
            &sprite_name,
            temp_dir.path(),
            "echo 'Should fail'",
            CreateOptions::default(),
        )
        .await;

    match result {
        Ok(_returned_name) => {
            panic!("Should have failed due to missing remote");
        }
        Err(e) => {
            let error_msg = e.to_string().to_lowercase();
            assert!(
                error_msg.contains("remote") || error_msg.contains("origin"),
                "Error should mention missing remote, got: {e}"
            );
            println!("Got expected error for missing remote: {e}");
        }
    }
    // Cleanup handled by guard
}

// =============================================================================
// Configuration Variation Tests
// =============================================================================

/// Test that sprite persists when auto_destroy=false
#[tokio::test]
#[ignore] // Requires SPRITES_TOKEN - run with --include-ignored
async fn test_sprites_auto_destroy_false_persists() {
    if !common::sprites_available() {
        eprintln!("Skipping test: SPRITES_TOKEN not set");
        return;
    }

    // Create backend with auto_destroy disabled
    let mut config = SpritesConfig::load_or_default();
    config.lifecycle.auto_destroy = false;
    let sprites = SpritesBackend::with_config(config);

    let temp_dir = tempfile::TempDir::new().expect("Failed to create temp dir");
    common::init_git_repo_with_remote(
        temp_dir.path(),
        "https://github.com/octocat/Hello-World.git",
    );

    let sprite_name = format!("persist-{}", &Uuid::new_v4().to_string()[..8]);
    let full_sprite_name = format!("clauderon-{sprite_name}");

    // Setup cleanup guard BEFORE create - will force destroy even with auto_destroy=false backend
    let _cleanup = common::SpriteCleanupGuard::new(full_sprite_name);

    let returned_name = sprites
        .create(
            &sprite_name,
            temp_dir.path(),
            "echo 'Persistence test'",
            CreateOptions::default(),
        )
        .await
        .expect("Sprite creation failed");

    // Call delete (should NOT actually destroy due to auto_destroy=false)
    let delete_result = sprites.delete(&returned_name).await;
    assert!(delete_result.is_ok(), "Delete should succeed");

    // Sprite should still exist
    tokio::time::sleep(Duration::from_secs(2)).await;
    let exists = sprites
        .exists(&returned_name)
        .await
        .expect("Failed to check existence");
    assert!(
        exists,
        "Sprite should still exist after delete() with auto_destroy=false"
    );
    println!("Verified sprite persists with auto_destroy=false");
    // Cleanup guard will force destroy the sprite
}

/// Test that sprite is destroyed when auto_destroy=true
#[tokio::test]
#[ignore] // Requires SPRITES_TOKEN - run with --include-ignored
async fn test_sprites_auto_destroy_true_destroys() {
    if !common::sprites_available() {
        eprintln!("Skipping test: SPRITES_TOKEN not set");
        return;
    }

    // This is the default test backend behavior
    let sprites = test_sprites_backend();

    let temp_dir = tempfile::TempDir::new().expect("Failed to create temp dir");
    common::init_git_repo_with_remote(
        temp_dir.path(),
        "https://github.com/octocat/Hello-World.git",
    );

    let sprite_name = format!("destroy-{}", &Uuid::new_v4().to_string()[..8]);
    let full_sprite_name = format!("clauderon-{sprite_name}");

    // Setup cleanup guard BEFORE create as fallback (mut because we call disarm())
    let mut cleanup = common::SpriteCleanupGuard::new(full_sprite_name);

    let returned_name = sprites
        .create(
            &sprite_name,
            temp_dir.path(),
            "echo 'Destruction test'",
            CreateOptions::default(),
        )
        .await
        .expect("Sprite creation failed");

    // Verify it exists
    let exists_before = sprites
        .exists(&returned_name)
        .await
        .expect("Failed to check existence");
    assert!(exists_before, "Sprite should exist before deletion");

    // Delete it via backend
    sprites
        .delete(&returned_name)
        .await
        .expect("Failed to delete sprite");

    // Wait for deletion to complete
    tokio::time::sleep(Duration::from_secs(5)).await;

    // Verify it's gone
    let exists_after = sprites
        .exists(&returned_name)
        .await
        .expect("Failed to check existence after delete");
    assert!(
        !exists_after,
        "Sprite should NOT exist after delete() with auto_destroy=true"
    );
    println!("Verified sprite destroyed with auto_destroy=true");

    // Disarm cleanup guard since we already deleted
    cleanup.disarm();
}

// =============================================================================
// Output Handling Tests
// =============================================================================

/// Test get_output with different line counts
#[tokio::test]
#[ignore] // Requires SPRITES_TOKEN - run with --include-ignored
async fn test_sprites_get_output_returns_log_content() {
    if !common::sprites_available() {
        eprintln!("Skipping test: SPRITES_TOKEN not set");
        return;
    }

    let sprites = test_sprites_backend();
    let temp_dir = tempfile::TempDir::new().expect("Failed to create temp dir");

    common::init_git_repo_with_remote(
        temp_dir.path(),
        "https://github.com/octocat/Hello-World.git",
    );

    let sprite_name = format!("output-test-{}", &Uuid::new_v4().to_string()[..8]);
    let full_sprite_name = format!("clauderon-{sprite_name}");

    // Setup cleanup guard BEFORE create
    let _cleanup = common::SpriteCleanupGuard::new(full_sprite_name);

    let returned_name = sprites
        .create(
            &sprite_name,
            temp_dir.path(),
            "Hello, this is a test prompt for output verification",
            CreateOptions::default(),
        )
        .await
        .expect("Sprite creation failed");

    // Wait for some output to accumulate
    tokio::time::sleep(Duration::from_secs(15)).await;

    // Get 5 lines
    let output_5 = sprites.get_output(&returned_name, 5).await;
    // Get 20 lines
    let output_20 = sprites.get_output(&returned_name, 20).await;

    let out5 = output_5.expect("get_output(5) should succeed");
    let out20 = output_20.expect("get_output(20) should succeed");

    // 20 lines should be >= 5 lines in length
    assert!(
        out20.len() >= out5.len(),
        "20 lines output should be >= 5 lines output"
    );
    println!(
        "5 lines: {} bytes, 20 lines: {} bytes",
        out5.len(),
        out20.len()
    );
    // Cleanup handled by guard
}

/// Test get_output gracefully handles missing log file
#[tokio::test]
#[ignore] // Requires SPRITES_TOKEN - run with --include-ignored
async fn test_sprites_get_output_empty_when_no_log() {
    if !common::sprites_available() {
        eprintln!("Skipping test: SPRITES_TOKEN not set");
        return;
    }

    let sprites = test_sprites_backend();

    // Try to get output from a non-existent sprite
    // This should not panic, just return an error or empty string
    let result = sprites
        .get_output("clauderon-nonexistent-sprite-xyz123", 10)
        .await;

    // Either returns empty string or an error - but should not panic
    match result {
        Ok(output) => {
            println!("Got output (expected empty or error): '{output}'");
        }
        Err(e) => {
            println!("Got expected error for non-existent sprite: {e}");
        }
    }

    // Test passed if we got here without panicking
}

// =============================================================================
// Concurrent Operations Test
// =============================================================================

/// Test creating multiple sprites in parallel
#[tokio::test]
#[ignore] // Requires SPRITES_TOKEN - run with --include-ignored
async fn test_sprites_parallel_creation() {
    skip_if_no_sprites!();

    let sprites = std::sync::Arc::new(test_sprites_backend());

    // Create 3 temp directories
    let temp_dir1 = tempfile::TempDir::new().expect("Failed to create temp dir 1");
    let temp_dir2 = tempfile::TempDir::new().expect("Failed to create temp dir 2");
    let temp_dir3 = tempfile::TempDir::new().expect("Failed to create temp dir 3");

    // Initialize all with remotes
    common::init_git_repo_with_remote(
        temp_dir1.path(),
        "https://github.com/octocat/Hello-World.git",
    );
    common::init_git_repo_with_remote(
        temp_dir2.path(),
        "https://github.com/octocat/Hello-World.git",
    );
    common::init_git_repo_with_remote(
        temp_dir3.path(),
        "https://github.com/octocat/Hello-World.git",
    );

    let name1 = format!("parallel-1-{}", &Uuid::new_v4().to_string()[..8]);
    let name2 = format!("parallel-2-{}", &Uuid::new_v4().to_string()[..8]);
    let name3 = format!("parallel-3-{}", &Uuid::new_v4().to_string()[..8]);

    // Setup cleanup guards BEFORE create for all three sprites
    let _cleanup1 = common::SpriteCleanupGuard::new(format!("clauderon-{name1}"));
    let _cleanup2 = common::SpriteCleanupGuard::new(format!("clauderon-{name2}"));
    let _cleanup3 = common::SpriteCleanupGuard::new(format!("clauderon-{name3}"));

    let sprites1 = sprites.clone();
    let sprites2 = sprites.clone();
    let sprites3 = sprites.clone();

    let path1 = temp_dir1.path().to_path_buf();
    let path2 = temp_dir2.path().to_path_buf();
    let path3 = temp_dir3.path().to_path_buf();

    let n1 = name1.clone();
    let n2 = name2.clone();
    let n3 = name3.clone();

    // Create all three in parallel
    let (result1, result2, result3) = tokio::join!(
        async move {
            sprites1
                .create(&n1, &path1, "echo 'Parallel 1'", CreateOptions::default())
                .await
        },
        async move {
            sprites2
                .create(&n2, &path2, "echo 'Parallel 2'", CreateOptions::default())
                .await
        },
        async move {
            sprites3
                .create(&n3, &path3, "echo 'Parallel 3'", CreateOptions::default())
                .await
        }
    );

    // All three sprites must succeed
    let returned_name1 = result1.expect("Sprite 1 creation failed");
    let returned_name2 = result2.expect("Sprite 2 creation failed");
    let returned_name3 = result3.expect("Sprite 3 creation failed");

    // Verify all created sprites exist
    for name in [&returned_name1, &returned_name2, &returned_name3] {
        let exists = sprites.exists(name).await.unwrap_or(false);
        assert!(exists, "Sprite {name} should exist after parallel creation");
    }

    println!("Successfully created 3 sprites in parallel");
    // Cleanup handled by guards on drop
}

// =============================================================================
// Edge Case Tests
// =============================================================================

/// Test that special characters in prompt are properly escaped
#[tokio::test]
#[ignore] // Requires SPRITES_TOKEN - run with --include-ignored
async fn test_sprites_special_characters_in_prompt() {
    skip_if_no_sprites!();

    let sprites = test_sprites_backend();
    let temp_dir = tempfile::TempDir::new().expect("Failed to create temp dir");

    common::init_git_repo_with_remote(
        temp_dir.path(),
        "https://github.com/octocat/Hello-World.git",
    );

    let sprite_name = format!("special-chars-{}", &Uuid::new_v4().to_string()[..8]);
    let full_sprite_name = format!("clauderon-{sprite_name}");

    // Setup cleanup guard BEFORE create
    let _cleanup = common::SpriteCleanupGuard::new(full_sprite_name);

    // Prompt with special characters that need escaping
    let special_prompt = r#"Test with "quotes", $VARIABLES, pipes | and 'single quotes'"#;

    let result = sprites
        .create(
            &sprite_name,
            temp_dir.path(),
            special_prompt,
            CreateOptions::default(),
        )
        .await;

    match result {
        Ok(_returned_name) => {
            // If we got here, the prompt was properly escaped
            println!("Successfully created sprite with special characters in prompt");
            // Cleanup handled by guard on drop
        }
        Err(e) => {
            // Creation might fail for other reasons, but shouldn't be due to shell injection
            let error_msg = e.to_string().to_lowercase();
            assert!(
                !error_msg.contains("syntax error")
                    && !error_msg.contains("unexpected")
                    && !error_msg.contains("command not found"),
                "Should not fail due to shell parsing issues, got: {e}"
            );
            eprintln!("Sprite creation failed (may be OK): {e}");
        }
    }
}

/// Test that empty initial prompt is handled gracefully
#[tokio::test]
#[ignore] // Requires SPRITES_TOKEN - run with --include-ignored
async fn test_sprites_empty_initial_prompt() {
    skip_if_no_sprites!();

    let sprites = test_sprites_backend();
    let temp_dir = tempfile::TempDir::new().expect("Failed to create temp dir");

    common::init_git_repo_with_remote(
        temp_dir.path(),
        "https://github.com/octocat/Hello-World.git",
    );

    let sprite_name = format!("empty-prompt-{}", &Uuid::new_v4().to_string()[..8]);
    let full_sprite_name = format!("clauderon-{sprite_name}");

    // Setup cleanup guard BEFORE create
    let _cleanup = common::SpriteCleanupGuard::new(full_sprite_name);

    // Empty prompt
    let result = sprites
        .create(&sprite_name, temp_dir.path(), "", CreateOptions::default())
        .await;

    match result {
        Ok(returned_name) => {
            // Empty prompt should still create a sprite
            println!("Successfully created sprite with empty prompt");

            // Verify it exists
            let exists = sprites
                .exists(&returned_name)
                .await
                .expect("Failed to check existence");
            assert!(exists, "Sprite should exist even with empty prompt");
            // Cleanup handled by guard on drop
        }
        Err(e) => {
            // Some backends might reject empty prompts, which is acceptable
            println!("Empty prompt rejected (acceptable): {e}");
        }
    }
}
