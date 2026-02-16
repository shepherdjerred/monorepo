#![allow(
    clippy::expect_used,
    clippy::unwrap_used,
    reason = "integration tests use expect/unwrap for simplicity"
)]
//! Integration tests for recent repositories tracking.
//!
//! These tests verify that:
//! - Repositories are tracked when sessions are created
//! - Path canonicalization prevents duplicates
//! - The limit of 20 repos is enforced
//! - Non-existent paths are filtered
//! - UPSERT behavior updates timestamps correctly
//! - Subdirectories are tracked separately (subpath specificity)

use std::path::{Path, PathBuf};
use std::sync::Arc;

use clauderon::backends::{ExecutionBackend, GitOperations, MockExecutionBackend, MockGitBackend};
use clauderon::core::{AccessMode, AgentType, BackendType, SessionManager};
use clauderon::feature_flags::FeatureFlags;
use clauderon::store::{SqliteStore, Store};
use tempfile::TempDir;

/// Initialize a directory as a git repository with an initial commit.
/// Uses a single shell command for efficiency (5x faster than separate commands).
fn init_git_repo(path: &Path) {
    let output = std::process::Command::new("sh")
        .args([
            "-c",
            r##"
            git init -q &&
            git config user.email "test@test.com" &&
            git config user.name "Test User" &&
            echo "# Test Repo" > README.md &&
            git add -A &&
            git commit -q -m "Initial commit"
            "##,
        ])
        .current_dir(path)
        .output()
        .expect("Failed to init git repo");

    assert!(
        output.status.success(),
        "Failed to init git repo at {}: {}",
        path.display(),
        String::from_utf8_lossy(&output.stderr)
    );
}

/// Helper to create a test environment with a real temp directory for repos
async fn create_test_manager() -> (SessionManager, TempDir, TempDir) {
    create_test_manager_with_limit(None).await
}

/// Helper to create a test environment with a configurable recent repos limit.
/// Use a smaller limit (e.g., 5) for limit enforcement tests to speed them up.
async fn create_test_manager_with_limit(
    max_recent_repos: Option<usize>,
) -> (SessionManager, TempDir, TempDir) {
    let temp_dir = TempDir::new().expect("Failed to create temp dir for DB");
    let repos_dir = TempDir::new().expect("Failed to create temp dir for repos");

    let db_path = temp_dir.path().join("test.db");
    let mut store = SqliteStore::new(&db_path)
        .await
        .expect("Failed to create store");

    if let Some(limit) = max_recent_repos {
        store = store.with_max_recent_repos(limit);
    }
    let store = Arc::new(store);

    let git = Arc::new(MockGitBackend::new());
    let zellij = Arc::new(MockExecutionBackend::zellij());
    let docker = Arc::new(MockExecutionBackend::docker());
    let kubernetes = Arc::new(MockExecutionBackend::kubernetes());
    let sprites = Arc::new(MockExecutionBackend::sprites());
    #[cfg(target_os = "macos")]
    let apple_container = Arc::new(MockExecutionBackend::apple_container());

    fn to_git_ops(arc: Arc<MockGitBackend>) -> Arc<dyn GitOperations> {
        arc
    }
    fn to_exec_backend(arc: Arc<MockExecutionBackend>) -> Arc<dyn ExecutionBackend> {
        arc
    }

    let manager = SessionManager::new(
        store,
        to_git_ops(git),
        to_exec_backend(zellij),
        to_exec_backend(docker),
        to_exec_backend(kubernetes),
        None,
        #[cfg(target_os = "macos")]
        to_exec_backend(apple_container),
        to_exec_backend(sprites),
        Arc::new(clauderon::feature_flags::FeatureFlags::default()),
    )
    .await
    .expect("Failed to create manager");

    (manager, temp_dir, repos_dir)
}

#[tokio::test]
async fn test_recent_repo_tracked_on_session_create() {
    let (manager, _temp_dir, repos_dir) = create_test_manager().await;

    // Create a real repo directory with git initialized
    let repo_path = repos_dir.path().join("test-repo");
    std::fs::create_dir_all(&repo_path).expect("Failed to create repo dir");
    init_git_repo(&repo_path);

    // Create a session - this should track the repo
    let (_session, _warnings) = manager
        .create_session(
            repo_path.to_string_lossy().to_string(),
            None,
            "Test prompt".to_owned(),
            BackendType::Zellij,
            AgentType::ClaudeCode,
            None,                  // model
            true,                  // dangerous_skip_checks
            false,                 // dangerous_copy_creds
            false,                 // print_mode
            false,                 // plan_mode
            AccessMode::default(), // access_mode
            vec![],                // images
            None,                  // container_image
            None,                  // pull_policy
            None,                  // cpu_limit
            None,                  // memory_limit
            None,                  // storage_class
        )
        .await
        .expect("Failed to create session");

    // Verify repo was tracked
    let recent = manager
        .get_recent_repos()
        .await
        .expect("Failed to get recent repos");
    assert_eq!(recent.len(), 1, "Should have tracked 1 repo");

    // Path should be canonicalized
    let canonical = repo_path.canonicalize().expect("Failed to canonicalize");
    assert_eq!(
        recent[0].repo_path, canonical,
        "Should store canonical path"
    );
}

#[tokio::test]
async fn test_path_canonicalization_prevents_duplicates() {
    // Test canonicalization directly at store level (fast)
    let temp_dir = TempDir::new().expect("Failed to create temp dir");
    let repos_dir = TempDir::new().expect("Failed to create repos dir");

    let db_path = temp_dir.path().join("test.db");
    let store = SqliteStore::new(&db_path)
        .await
        .expect("Failed to create store");

    // Create a repo directory
    let repo_path = repos_dir.path().join("test-repo");
    std::fs::create_dir_all(&repo_path).expect("Failed to create repo dir");

    let canonical = repo_path.canonicalize().expect("Failed to canonicalize");

    // Add using canonical path
    store
        .add_recent_repo(canonical.clone(), PathBuf::new())
        .await
        .expect("Failed to add canonical path");

    // Add using path with /./  (will canonicalize to same path)
    let path_with_dot = PathBuf::from(format!("{}/.", canonical.display()));
    store
        .add_recent_repo(path_with_dot, PathBuf::new())
        .await
        .expect("Failed to add path with dot");

    // Should only have 1 recent repo (same canonical path)
    let recent = store
        .get_recent_repos()
        .await
        .expect("Failed to get recent repos");
    assert_eq!(recent.len(), 1, "Should deduplicate canonicalized paths");
    assert_eq!(recent[0].repo_path, canonical);
}

#[tokio::test]
async fn test_limit_enforcement_removes_oldest() {
    // Test limit enforcement directly at the store level (fast, no session creation)
    let temp_dir = TempDir::new().expect("Failed to create temp dir");
    let repos_dir = TempDir::new().expect("Failed to create repos dir");

    let db_path = temp_dir.path().join("test.db");
    let store = SqliteStore::new(&db_path)
        .await
        .expect("Failed to create store")
        .with_max_recent_repos(5);

    // Create 6 repo directories to exceed the limit of 5
    for i in 0..6 {
        let repo_path = repos_dir.path().join(format!("repo-{i}"));
        std::fs::create_dir_all(&repo_path).expect("Failed to create repo dir");

        store
            .add_recent_repo(repo_path, PathBuf::new())
            .await
            .expect("Failed to add recent repo");
    }

    // Should only have 5 repos (the limit)
    let recent = store
        .get_recent_repos()
        .await
        .expect("Failed to get recent repos");
    assert_eq!(recent.len(), 5, "Should enforce limit of 5 repos");

    // The first repo (repo-0) should not be in the list
    let first_repo = repos_dir.path().join("repo-0").canonicalize().unwrap();
    assert!(
        !recent.iter().any(|r| r.repo_path == first_repo),
        "Oldest repo should have been removed"
    );

    // The last repo (repo-5) should be in the list
    let last_repo = repos_dir.path().join("repo-5").canonicalize().unwrap();
    assert!(
        recent.iter().any(|r| r.repo_path == last_repo),
        "Newest repo should be in the list"
    );
}

#[tokio::test]
async fn test_upsert_behavior_updates_timestamp() {
    // Test upsert directly at store level (fast)
    let temp_dir = TempDir::new().expect("Failed to create temp dir");
    let repos_dir = TempDir::new().expect("Failed to create repos dir");

    let db_path = temp_dir.path().join("test.db");
    let store = SqliteStore::new(&db_path)
        .await
        .expect("Failed to create store");

    let repo_path = repos_dir.path().join("test-repo");
    std::fs::create_dir_all(&repo_path).expect("Failed to create repo dir");

    // Add repo first time
    store
        .add_recent_repo(repo_path.clone(), PathBuf::new())
        .await
        .expect("Failed to add repo");

    let recent1 = store
        .get_recent_repos()
        .await
        .expect("Failed to get recent repos");
    assert_eq!(recent1.len(), 1);
    let timestamp1 = recent1[0].last_used;

    // Wait a bit to ensure timestamp will be different
    tokio::time::sleep(std::time::Duration::from_millis(10)).await;

    // Add same repo again (upsert)
    store
        .add_recent_repo(repo_path, PathBuf::new())
        .await
        .expect("Failed to add repo again");

    // Should still have only 1 repo, but timestamp should be updated
    let recent2 = store
        .get_recent_repos()
        .await
        .expect("Failed to get recent repos");
    assert_eq!(recent2.len(), 1, "Should still have only 1 repo");

    let timestamp2 = recent2[0].last_used;
    assert!(
        timestamp2 > timestamp1,
        "Timestamp should be updated: {timestamp2} > {timestamp1}"
    );
}

#[tokio::test]
async fn test_recent_repos_ordered_by_most_recent() {
    // Test ordering directly at store level (fast)
    let temp_dir = TempDir::new().expect("Failed to create temp dir");
    let repos_dir = TempDir::new().expect("Failed to create repos dir");

    let db_path = temp_dir.path().join("test.db");
    let store = SqliteStore::new(&db_path)
        .await
        .expect("Failed to create store");

    // Create 3 repos in order with small delays for different timestamps
    for i in 0..3 {
        let repo_path = repos_dir.path().join(format!("repo-{i}"));
        std::fs::create_dir_all(&repo_path).expect("Failed to create repo dir");

        store
            .add_recent_repo(repo_path, PathBuf::new())
            .await
            .expect("Failed to add repo");

        // Small delay to ensure different timestamps
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }

    let recent = store
        .get_recent_repos()
        .await
        .expect("Failed to get recent repos");
    assert_eq!(recent.len(), 3);

    // Should be ordered newest to oldest
    let repo2 = repos_dir.path().join("repo-2").canonicalize().unwrap();
    let repo1 = repos_dir.path().join("repo-1").canonicalize().unwrap();
    let repo0 = repos_dir.path().join("repo-0").canonicalize().unwrap();

    assert_eq!(recent[0].repo_path, repo2, "Most recent should be first");
    assert_eq!(recent[1].repo_path, repo1, "Second most recent");
    assert_eq!(recent[2].repo_path, repo0, "Oldest should be last");
}

#[tokio::test]
async fn test_nonexistent_repo_handles_gracefully() {
    let (manager, _temp_dir, _repos_dir) = create_test_manager().await;

    // Try to create session with non-existent repo
    // The manager should fail since the path doesn't exist
    let result = manager
        .create_session(
            "/nonexistent/repo/path".to_owned(),
            None,
            "Prompt".to_owned(),
            BackendType::Zellij,
            AgentType::ClaudeCode,
            None,
            true,
            false, // dangerous_copy_creds
            false,
            false,
            AccessMode::default(),
            vec![],
            None,
            None,
            None,
            None,
            None, // storage_class
        )
        .await;

    // Session creation should fail for non-existent path
    assert!(result.is_err(), "Should fail for non-existent repo path");

    // This test verifies the store layer doesn't crash on nonexistent paths
    let store = Arc::new(
        SqliteStore::new(&_temp_dir.path().join("test2.db"))
            .await
            .expect("Failed to create store"),
    );

    // Directly add a nonexistent repo to the store - this should not crash
    // but will not store the path since it can't be canonicalized
    let nonexistent = PathBuf::from("/definitely/does/not/exist");
    store
        .add_recent_repo(nonexistent.clone(), PathBuf::new())
        .await
        .expect("Should handle nonexistent paths gracefully");

    // Non-existent paths are filtered out (can't be canonicalized)
    let recent = store
        .get_recent_repos()
        .await
        .expect("Failed to get recent repos");
    assert_eq!(recent.len(), 0, "Non-existent paths should not be stored");
}

#[tokio::test]
async fn test_subdirectories_tracked_separately() {
    // Test subdirectory tracking directly at store level (fast)
    let temp_dir = TempDir::new().expect("Failed to create temp dir");
    let repos_dir = TempDir::new().expect("Failed to create repos dir");

    let db_path = temp_dir.path().join("test.db");
    let store = SqliteStore::new(&db_path)
        .await
        .expect("Failed to create store");

    // Create a monorepo directory
    let repo_path = repos_dir.path().join("monorepo");
    std::fs::create_dir_all(&repo_path).expect("Failed to create repo dir");

    // Add two different subdirectories
    store
        .add_recent_repo(repo_path.clone(), PathBuf::from("packages/foo"))
        .await
        .expect("Failed to add packages/foo");

    store
        .add_recent_repo(repo_path.clone(), PathBuf::from("packages/bar"))
        .await
        .expect("Failed to add packages/bar");

    // Should have 2 separate entries
    let recent = store
        .get_recent_repos()
        .await
        .expect("Failed to get recent repos");
    assert_eq!(
        recent.len(),
        2,
        "Should have 2 separate entries for different subdirectories"
    );

    // Both should have the same repo_path
    let canonical_repo = repo_path.canonicalize().expect("Failed to canonicalize");
    assert_eq!(recent[0].repo_path, canonical_repo);
    assert_eq!(recent[1].repo_path, canonical_repo);

    // But different subdirectories
    let subdirs: Vec<String> = recent
        .iter()
        .map(|r| r.subdirectory.to_string_lossy().to_string())
        .collect();
    assert!(
        subdirs.contains(&"packages/bar".to_owned()),
        "Should have packages/bar subdirectory"
    );
    assert!(
        subdirs.contains(&"packages/foo".to_owned()),
        "Should have packages/foo subdirectory"
    );
}

#[tokio::test]
async fn test_same_subdir_updates_timestamp() {
    // Test timestamp update for same subdirectory at store level (fast)
    let temp_dir = TempDir::new().expect("Failed to create temp dir");
    let repos_dir = TempDir::new().expect("Failed to create repos dir");

    let db_path = temp_dir.path().join("test.db");
    let store = SqliteStore::new(&db_path)
        .await
        .expect("Failed to create store");

    let repo_path = repos_dir.path().join("monorepo");
    std::fs::create_dir_all(&repo_path).expect("Failed to create repo dir");

    // Add subdirectory first time
    store
        .add_recent_repo(repo_path.clone(), PathBuf::from("packages/foo"))
        .await
        .expect("Failed to add subdirectory");

    let recent1 = store
        .get_recent_repos()
        .await
        .expect("Failed to get recent repos");
    assert_eq!(recent1.len(), 1);
    let timestamp1 = recent1[0].last_used;

    // Wait to ensure different timestamp
    tokio::time::sleep(std::time::Duration::from_millis(10)).await;

    // Add same subdirectory again (upsert)
    store
        .add_recent_repo(repo_path, PathBuf::from("packages/foo"))
        .await
        .expect("Failed to add subdirectory again");

    // Should still have only 1 entry (same repo + subdir)
    let recent2 = store
        .get_recent_repos()
        .await
        .expect("Failed to get recent repos");
    assert_eq!(
        recent2.len(),
        1,
        "Should deduplicate same repo+subdirectory"
    );

    // But timestamp should be updated
    let timestamp2 = recent2[0].last_used;
    assert!(
        timestamp2 > timestamp1,
        "Timestamp should be updated: {timestamp2} > {timestamp1}"
    );
}

#[tokio::test]
async fn test_subdirectories_respect_limit() {
    // Test subdirectory limit enforcement directly at the store level (fast)
    let temp_dir = TempDir::new().expect("Failed to create temp dir");
    let repos_dir = TempDir::new().expect("Failed to create repos dir");

    let db_path = temp_dir.path().join("test.db");
    let store = SqliteStore::new(&db_path)
        .await
        .expect("Failed to create store")
        .with_max_recent_repos(5);

    // Create a monorepo directory
    let repo_path = repos_dir.path().join("monorepo");
    std::fs::create_dir_all(&repo_path).expect("Failed to create repo dir");

    // Add 6 different subdirectories to exceed the limit of 5
    for i in 0..6 {
        store
            .add_recent_repo(repo_path.clone(), PathBuf::from(format!("package-{i}")))
            .await
            .expect("Failed to add recent repo");
    }

    // Should only have 5 entries (the limit)
    let recent = store
        .get_recent_repos()
        .await
        .expect("Failed to get recent repos");
    assert_eq!(
        recent.len(),
        5,
        "Should enforce limit of 5 entries even with subdirectories"
    );

    // The oldest subdirectory should not be in the list
    let subdirs: Vec<String> = recent
        .iter()
        .map(|r| r.subdirectory.to_string_lossy().to_string())
        .collect();

    assert!(
        !subdirs.contains(&"package-0".to_owned()),
        "Oldest subdirectory should have been removed"
    );

    // The newest subdirectories should be in the list
    assert!(
        subdirs.contains(&"package-5".to_owned()),
        "Newest subdirectory should be in the list"
    );
    assert!(
        subdirs.contains(&"package-4".to_owned()),
        "Second newest subdirectory should be in the list"
    );
}
