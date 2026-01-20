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
use clauderon::store::{SqliteStore, Store};
use tempfile::TempDir;

/// Initialize a directory as a git repository with an initial commit.
fn init_git_repo(path: &Path) {
    std::process::Command::new("git")
        .args(["init"])
        .current_dir(path)
        .output()
        .expect("Failed to run git init");

    std::process::Command::new("git")
        .args(["config", "user.email", "test@test.com"])
        .current_dir(path)
        .output()
        .expect("Failed to configure git email");

    std::process::Command::new("git")
        .args(["config", "user.name", "Test User"])
        .current_dir(path)
        .output()
        .expect("Failed to configure git name");

    std::fs::write(path.join("README.md"), "# Test Repo").expect("Failed to create README");

    std::process::Command::new("git")
        .args(["add", "."])
        .current_dir(path)
        .output()
        .expect("Failed to run git add");

    std::process::Command::new("git")
        .args(["commit", "-m", "Initial commit"])
        .current_dir(path)
        .output()
        .expect("Failed to run git commit");
}

/// Helper to create a test environment with a real temp directory for repos
async fn create_test_manager() -> (SessionManager, TempDir, TempDir) {
    let temp_dir = TempDir::new().expect("Failed to create temp dir for DB");
    let repos_dir = TempDir::new().expect("Failed to create temp dir for repos");

    let db_path = temp_dir.path().join("test.db");
    let store = Arc::new(
        SqliteStore::new(&db_path)
            .await
            .expect("Failed to create store"),
    );

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
            "Test prompt".to_string(),
            BackendType::Zellij,
            AgentType::ClaudeCode,
            None,                  // model
            true,                  // dangerous_skip_checks
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
    let (manager, _temp_dir, repos_dir) = create_test_manager().await;

    // Create a repo directory with git initialized
    let repo_path = repos_dir.path().join("test-repo");
    std::fs::create_dir_all(&repo_path).expect("Failed to create repo dir");
    init_git_repo(&repo_path);

    // Create sessions with different representations of the same path
    let canonical = repo_path.canonicalize().expect("Failed to canonicalize");

    // Session 1: Use canonical path
    manager
        .create_session(
            canonical.to_string_lossy().to_string(),
            None,
            "Prompt 1".to_string(),
            BackendType::Zellij,
            AgentType::ClaudeCode,
            None,
            true,
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
        .await
        .expect("Failed to create session 1");

    // Session 2: Use path with /./
    let path_with_dot = format!("{}/.", canonical.to_string_lossy());
    manager
        .create_session(
            path_with_dot,
            None,
            "Prompt 2".to_string(),
            BackendType::Zellij,
            AgentType::ClaudeCode,
            None,
            true,
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
        .await
        .expect("Failed to create session 2");

    // Should only have 1 recent repo (same path)
    let recent = manager
        .get_recent_repos()
        .await
        .expect("Failed to get recent repos");
    assert_eq!(recent.len(), 1, "Should deduplicate canonicalized paths");
    assert_eq!(recent[0].repo_path, canonical);
}

#[tokio::test]
async fn test_limit_enforcement_removes_oldest() {
    let (manager, _temp_dir, repos_dir) = create_test_manager().await;

    // Create 21 different repos to exceed the limit of 20
    for i in 0..21 {
        let repo_path = repos_dir.path().join(format!("repo-{i}"));
        std::fs::create_dir_all(&repo_path).expect("Failed to create repo dir");
        init_git_repo(&repo_path);

        manager
            .create_session(
                repo_path.to_string_lossy().to_string(),
                None,
                format!("Prompt {i}"),
                BackendType::Zellij,
                AgentType::ClaudeCode,
                None,
                true,
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
            .await
            .expect("Failed to create session");
    }

    // Should only have 20 repos (the limit)
    let recent = manager
        .get_recent_repos()
        .await
        .expect("Failed to get recent repos");
    assert_eq!(recent.len(), 20, "Should enforce limit of 20 repos");

    // The first repo (repo-0) should not be in the list
    let first_repo = repos_dir.path().join("repo-0").canonicalize().unwrap();
    assert!(
        !recent.iter().any(|r| r.repo_path == first_repo),
        "Oldest repo should have been removed"
    );

    // The last repo (repo-10) should be in the list
    let last_repo = repos_dir.path().join("repo-10").canonicalize().unwrap();
    assert!(
        recent.iter().any(|r| r.repo_path == last_repo),
        "Newest repo should be in the list"
    );
}

#[tokio::test]
async fn test_upsert_behavior_updates_timestamp() {
    let (manager, _temp_dir, repos_dir) = create_test_manager().await;

    let repo_path = repos_dir.path().join("test-repo");
    std::fs::create_dir_all(&repo_path).expect("Failed to create repo dir");
    init_git_repo(&repo_path);

    // Create first session
    manager
        .create_session(
            repo_path.to_string_lossy().to_string(),
            None,
            "Prompt 1".to_string(),
            BackendType::Zellij,
            AgentType::ClaudeCode,
            None,
            true,
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
        .await
        .expect("Failed to create session 1");

    let recent1 = manager
        .get_recent_repos()
        .await
        .expect("Failed to get recent repos");
    assert_eq!(recent1.len(), 1);
    let timestamp1 = recent1[0].last_used;

    // Wait a bit to ensure timestamp will be different
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;

    // Create second session with same repo
    manager
        .create_session(
            repo_path.to_string_lossy().to_string(),
            None,
            "Prompt 2".to_string(),
            BackendType::Zellij,
            AgentType::ClaudeCode,
            None,
            true,
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
        .await
        .expect("Failed to create session 2");

    // Should still have only 1 repo, but timestamp should be updated
    let recent2 = manager
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
    let (manager, _temp_dir, repos_dir) = create_test_manager().await;

    // Create 3 repos in order
    for i in 0..3 {
        let repo_path = repos_dir.path().join(format!("repo-{i}"));
        std::fs::create_dir_all(&repo_path).expect("Failed to create repo dir");
        init_git_repo(&repo_path);

        manager
            .create_session(
                repo_path.to_string_lossy().to_string(),
                None,
                format!("Prompt {i}"),
                BackendType::Zellij,
                AgentType::ClaudeCode,
                None,
                true,
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
            .await
            .expect("Failed to create session");

        // Small delay to ensure different timestamps
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }

    let recent = manager
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
            "/nonexistent/repo/path".to_string(),
            None,
            "Prompt".to_string(),
            BackendType::Zellij,
            AgentType::ClaudeCode,
            None,
            true,
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
    let (manager, _temp_dir, repos_dir) = create_test_manager().await;

    // Create a monorepo with subdirectories
    let repo_path = repos_dir.path().join("monorepo");
    std::fs::create_dir_all(&repo_path).expect("Failed to create repo dir");
    init_git_repo(&repo_path);

    // Create subdirectories
    let packages_foo = repo_path.join("packages/foo");
    let packages_bar = repo_path.join("packages/bar");
    std::fs::create_dir_all(&packages_foo).expect("Failed to create packages/foo");
    std::fs::create_dir_all(&packages_bar).expect("Failed to create packages/bar");

    // Create session in packages/foo
    manager
        .create_session(
            packages_foo.to_string_lossy().to_string(),
            None,
            "Prompt 1".to_string(),
            BackendType::Zellij,
            AgentType::ClaudeCode,
            None,
            true,
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
        .await
        .expect("Failed to create session in packages/foo");

    // Small delay to ensure different timestamps
    tokio::time::sleep(std::time::Duration::from_millis(50)).await;

    // Create session in packages/bar
    manager
        .create_session(
            packages_bar.to_string_lossy().to_string(),
            None,
            "Prompt 2".to_string(),
            BackendType::Zellij,
            AgentType::ClaudeCode,
            None,
            true,
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
        .await
        .expect("Failed to create session in packages/bar");

    // Should have 2 separate entries
    let recent = manager
        .get_recent_repos()
        .await
        .expect("Failed to get recent repos");
    assert_eq!(
        recent.len(),
        2,
        "Should have 2 separate entries for different subdirectories"
    );

    // Both should have the same repo_path (git root)
    let canonical_repo = repo_path.canonicalize().expect("Failed to canonicalize");
    assert_eq!(recent[0].repo_path, canonical_repo);
    assert_eq!(recent[1].repo_path, canonical_repo);

    // But different subdirectories
    let subdirs: Vec<String> = recent
        .iter()
        .map(|r| r.subdirectory.to_string_lossy().to_string())
        .collect();
    assert!(
        subdirs.contains(&"packages/bar".to_string()),
        "Should have packages/bar subdirectory"
    );
    assert!(
        subdirs.contains(&"packages/foo".to_string()),
        "Should have packages/foo subdirectory"
    );
}

#[tokio::test]
async fn test_same_subdir_updates_timestamp() {
    let (manager, _temp_dir, repos_dir) = create_test_manager().await;

    let repo_path = repos_dir.path().join("monorepo");
    std::fs::create_dir_all(&repo_path).expect("Failed to create repo dir");
    init_git_repo(&repo_path);

    let packages_foo = repo_path.join("packages/foo");
    std::fs::create_dir_all(&packages_foo).expect("Failed to create packages/foo");

    // Create first session in packages/foo
    manager
        .create_session(
            packages_foo.to_string_lossy().to_string(),
            None,
            "Prompt 1".to_string(),
            BackendType::Zellij,
            AgentType::ClaudeCode,
            None,
            true,
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
        .await
        .expect("Failed to create session 1");

    let recent1 = manager
        .get_recent_repos()
        .await
        .expect("Failed to get recent repos");
    assert_eq!(recent1.len(), 1);
    let timestamp1 = recent1[0].last_used;

    // Wait to ensure different timestamp
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;

    // Create second session in same subdirectory
    manager
        .create_session(
            packages_foo.to_string_lossy().to_string(),
            None,
            "Prompt 2".to_string(),
            BackendType::Zellij,
            AgentType::ClaudeCode,
            None, // model
            true,
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
        .await
        .expect("Failed to create session 2");

    // Should still have only 1 entry (same repo + subdir)
    let recent2 = manager
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
    let (manager, _temp_dir, repos_dir) = create_test_manager().await;

    // Create a monorepo
    let repo_path = repos_dir.path().join("monorepo");
    std::fs::create_dir_all(&repo_path).expect("Failed to create repo dir");
    init_git_repo(&repo_path);

    // Create 22 different subdirectories to exceed the 20 limit
    for i in 0..22 {
        let subdir = repo_path.join(format!("package-{i}"));
        std::fs::create_dir_all(&subdir).expect("Failed to create subdir");

        manager
            .create_session(
                subdir.to_string_lossy().to_string(),
                None,
                format!("Prompt {i}"),
                BackendType::Zellij,
                AgentType::ClaudeCode,
                None,
                true,
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
            .await
            .expect("Failed to create session");

        // Small delay to ensure different timestamps
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }

    // Should only have 20 entries (the limit)
    let recent = manager
        .get_recent_repos()
        .await
        .expect("Failed to get recent repos");
    assert_eq!(
        recent.len(),
        20,
        "Should enforce limit of 20 entries even with subdirectories"
    );

    // The oldest subdirectories should not be in the list
    let subdirs: Vec<String> = recent
        .iter()
        .map(|r| r.subdirectory.to_string_lossy().to_string())
        .collect();

    assert!(
        !subdirs.contains(&"package-0".to_string()),
        "Oldest subdirectory should have been removed"
    );
    assert!(
        !subdirs.contains(&"package-1".to_string()),
        "Second oldest subdirectory should have been removed"
    );

    // The newest subdirectories should be in the list
    assert!(
        subdirs.contains(&"package-21".to_string()),
        "Newest subdirectory should be in the list"
    );
    assert!(
        subdirs.contains(&"package-20".to_string()),
        "Second newest subdirectory should be in the list"
    );
}
