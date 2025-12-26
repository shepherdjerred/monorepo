//! End-to-end tests for Git worktree operations
//!
//! These tests use real git commands but don't require Docker or Zellij.
//! They can run in any CI environment with git installed.

mod common;

use multiplexer::backends::{GitBackend, GitOperations};
use tempfile::TempDir;

#[tokio::test]
async fn test_git_worktree_create_and_delete() {
    if !common::git_available() {
        eprintln!("Skipping test: Git not available");
        return;
    }

    // Create a temp git repository
    let temp_repo = TempDir::new().expect("Failed to create temp repo dir");
    common::init_git_repo(temp_repo.path());

    // Create a temp directory for the worktree (outside the repo)
    let worktree_parent = TempDir::new().expect("Failed to create worktree parent dir");
    let worktree_path = worktree_parent.path().join("test-worktree");
    let branch_name = "test-branch-xyz";

    let git = GitBackend::new();

    // Create worktree
    git.create_worktree(temp_repo.path(), &worktree_path, branch_name)
        .await
        .expect("Failed to create worktree");

    // Verify worktree exists
    assert!(worktree_path.exists(), "Worktree directory should exist");
    assert!(
        git.worktree_exists(&worktree_path),
        "GitBackend should report worktree exists"
    );

    // Verify the branch was created
    let branch = git
        .get_branch(&worktree_path)
        .await
        .expect("Failed to get branch");
    assert_eq!(branch, branch_name, "Branch name should match");

    // Verify README exists in worktree
    assert!(
        worktree_path.join("README.md").exists(),
        "README.md should exist in worktree"
    );

    // Delete worktree
    git.delete_worktree(&worktree_path)
        .await
        .expect("Failed to delete worktree");

    // Verify worktree is gone
    assert!(
        !worktree_path.exists(),
        "Worktree directory should be deleted"
    );
}

#[tokio::test]
async fn test_git_worktree_with_modifications() {
    if !common::git_available() {
        eprintln!("Skipping test: Git not available");
        return;
    }

    let temp_repo = TempDir::new().expect("Failed to create temp repo dir");
    common::init_git_repo(temp_repo.path());

    let worktree_parent = TempDir::new().expect("Failed to create worktree parent dir");
    let worktree_path = worktree_parent.path().join("modified-worktree");

    let git = GitBackend::new();

    // Create worktree
    git.create_worktree(temp_repo.path(), &worktree_path, "feature-branch")
        .await
        .expect("Failed to create worktree");

    // Create a new file in the worktree
    let new_file = worktree_path.join("new_file.txt");
    std::fs::write(&new_file, "New content").expect("Failed to write new file");

    // Verify the file exists
    assert!(new_file.exists(), "New file should exist in worktree");

    // Delete worktree (should handle uncommitted changes)
    git.delete_worktree(&worktree_path)
        .await
        .expect("Failed to delete worktree with modifications");

    assert!(
        !worktree_path.exists(),
        "Worktree should be deleted even with modifications"
    );
}

#[tokio::test]
async fn test_multiple_worktrees() {
    if !common::git_available() {
        eprintln!("Skipping test: Git not available");
        return;
    }

    let temp_repo = TempDir::new().expect("Failed to create temp repo dir");
    common::init_git_repo(temp_repo.path());

    let worktree_parent = TempDir::new().expect("Failed to create worktree parent dir");
    let worktree1 = worktree_parent.path().join("worktree-1");
    let worktree2 = worktree_parent.path().join("worktree-2");
    let worktree3 = worktree_parent.path().join("worktree-3");

    let git = GitBackend::new();

    // Create multiple worktrees
    git.create_worktree(temp_repo.path(), &worktree1, "branch-1")
        .await
        .expect("Failed to create worktree 1");
    git.create_worktree(temp_repo.path(), &worktree2, "branch-2")
        .await
        .expect("Failed to create worktree 2");
    git.create_worktree(temp_repo.path(), &worktree3, "branch-3")
        .await
        .expect("Failed to create worktree 3");

    // Verify all exist
    assert!(worktree1.exists());
    assert!(worktree2.exists());
    assert!(worktree3.exists());

    // Verify they're on different branches
    assert_eq!(git.get_branch(&worktree1).await.unwrap(), "branch-1");
    assert_eq!(git.get_branch(&worktree2).await.unwrap(), "branch-2");
    assert_eq!(git.get_branch(&worktree3).await.unwrap(), "branch-3");

    // Delete all
    git.delete_worktree(&worktree1).await.unwrap();
    git.delete_worktree(&worktree2).await.unwrap();
    git.delete_worktree(&worktree3).await.unwrap();

    assert!(!worktree1.exists());
    assert!(!worktree2.exists());
    assert!(!worktree3.exists());
}

#[tokio::test]
async fn test_worktree_exists_check() {
    if !common::git_available() {
        eprintln!("Skipping test: Git not available");
        return;
    }

    let git = GitBackend::new();

    // Non-existent path should return false
    let nonexistent = std::path::Path::new("/nonexistent/path/that/doesnt/exist");
    assert!(
        !git.worktree_exists(nonexistent),
        "Non-existent path should not be reported as worktree"
    );

    // Create a real worktree and check
    let temp_repo = TempDir::new().expect("Failed to create temp repo dir");
    common::init_git_repo(temp_repo.path());

    let worktree_parent = TempDir::new().expect("Failed to create worktree parent dir");
    let worktree_path = worktree_parent.path().join("exists-test");

    git.create_worktree(temp_repo.path(), &worktree_path, "exists-branch")
        .await
        .expect("Failed to create worktree");

    assert!(
        git.worktree_exists(&worktree_path),
        "Created worktree should exist"
    );

    git.delete_worktree(&worktree_path).await.unwrap();

    assert!(
        !git.worktree_exists(&worktree_path),
        "Deleted worktree should not exist"
    );
}

#[tokio::test]
async fn test_worktree_delete_nonexistent() {
    if !common::git_available() {
        eprintln!("Skipping test: Git not available");
        return;
    }

    let git = GitBackend::new();

    // Deleting a non-existent worktree should not panic
    // (it logs a warning but doesn't fail)
    let nonexistent = std::path::Path::new("/tmp/nonexistent-worktree-path-xyz");
    let result = git.delete_worktree(nonexistent).await;

    // Should not error (it handles missing worktrees gracefully)
    assert!(result.is_ok(), "Deleting non-existent worktree should not fail");
}
