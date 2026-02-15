#![allow(
    clippy::allow_attributes,
    reason = "test files use allow for non-guaranteed lints"
)]
#![allow(clippy::expect_used, reason = "test code")]
#![allow(clippy::unwrap_used, reason = "test code")]
#![allow(clippy::print_stdout, reason = "test output")]
#![allow(clippy::print_stderr, reason = "test output")]

//! End-to-end tests for CI poller GitHub API integration
//!
//! These tests require:
//! - `gh` CLI installed and authenticated
//! - Network access to GitHub API
//!
//! Run with: cargo test --test e2e_ci_poller -- --include-ignored

mod common;

use std::path::PathBuf;
use tokio::process::Command;

/// Get the monorepo root path (parent of packages/clauderon)
fn monorepo_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("packages/ directory")
        .parent()
        .expect("monorepo root")
        .to_path_buf()
}

// =============================================================================
// Unit tests for URL parsing (no network required)
// =============================================================================

#[test]
fn test_parse_github_repo_ssh_url() {
    let url = "git@github.com:shepherdjerred/monorepo.git";
    let repo = clauderon::utils::git::parse_github_repo_from_url(url).unwrap();
    assert_eq!(repo, "shepherdjerred/monorepo");
}

#[test]
fn test_parse_github_repo_https_url() {
    let url = "https://github.com/shepherdjerred/monorepo.git";
    let repo = clauderon::utils::git::parse_github_repo_from_url(url).unwrap();
    assert_eq!(repo, "shepherdjerred/monorepo");
}

#[test]
fn test_parse_github_repo_https_no_git_suffix() {
    let url = "https://github.com/shepherdjerred/monorepo";
    let repo = clauderon::utils::git::parse_github_repo_from_url(url).unwrap();
    assert_eq!(repo, "shepherdjerred/monorepo");
}

#[test]
fn test_parse_github_repo_invalid_url() {
    let url = "not-a-valid-url";
    let result = clauderon::utils::git::parse_github_repo_from_url(url);
    assert!(result.is_err(), "Should fail for invalid URL");
}

#[test]
fn test_parse_github_repo_non_github_url() {
    let url = "https://gitlab.com/owner/repo.git";
    let result = clauderon::utils::git::parse_github_repo_from_url(url);
    assert!(result.is_err(), "Should fail for non-GitHub URL");
}

// =============================================================================
// Integration tests (require gh CLI and network)
// =============================================================================

#[tokio::test]
#[ignore] // Requires gh CLI authenticated
async fn test_get_github_repo_from_monorepo() {
    if !common::gh_authenticated() {
        eprintln!("Skipping test: gh CLI not authenticated");
        return;
    }

    let repo_path = monorepo_path();
    let github_repo = clauderon::utils::git::get_github_repo(&repo_path)
        .await
        .expect("Should get GitHub repo from monorepo path");

    assert_eq!(github_repo, "shepherdjerred/monorepo");
}

#[tokio::test]
#[ignore]
async fn test_gh_pr_list_with_repo_flag() {
    if !common::gh_authenticated() {
        eprintln!("Skipping test: gh CLI not authenticated");
        return;
    }

    // Use monorepo - query PRs (should always work even if empty)
    let output = Command::new("gh")
        .args([
            "pr",
            "list",
            "--repo",
            "shepherdjerred/monorepo",
            "--state",
            "all",
            "--limit",
            "1",
            "--json",
            "number,url",
        ])
        .output()
        .await
        .expect("Failed to execute gh pr list");

    assert!(
        output.status.success(),
        "gh pr list should succeed. stderr: {}",
        String::from_utf8_lossy(&output.stderr)
    );

    // Output should be valid JSON (even if empty array)
    let stdout = String::from_utf8_lossy(&output.stdout);
    let _: Vec<serde_json::Value> =
        serde_json::from_str(&stdout).expect("Output should be valid JSON");
}

#[tokio::test]
#[ignore]
async fn test_gh_pr_view_with_repo_flag() {
    if !common::gh_authenticated() {
        eprintln!("Skipping test: gh CLI not authenticated");
        return;
    }

    // Find any merged PR to test view query
    let list_output = Command::new("gh")
        .args([
            "pr",
            "list",
            "--repo",
            "shepherdjerred/monorepo",
            "--state",
            "merged",
            "--limit",
            "1",
            "--json",
            "number",
        ])
        .output()
        .await
        .expect("Failed to list PRs");

    if !list_output.status.success() {
        eprintln!("Skipping: could not list PRs");
        return;
    }

    let prs: Vec<serde_json::Value> =
        serde_json::from_slice(&list_output.stdout).expect("Should parse PR list");

    if prs.is_empty() {
        eprintln!("Skipping: no merged PRs found in repo");
        return;
    }

    let pr_number = prs[0]["number"]
        .as_u64()
        .expect("PR should have number field");

    // Query mergeable status for this PR
    let view_output = Command::new("gh")
        .args([
            "pr",
            "view",
            &pr_number.to_string(),
            "--repo",
            "shepherdjerred/monorepo",
            "--json",
            "mergeable",
        ])
        .output()
        .await
        .expect("Failed to view PR");

    assert!(
        view_output.status.success(),
        "gh pr view should succeed for PR #{}. stderr: {}",
        pr_number,
        String::from_utf8_lossy(&view_output.stderr)
    );
}

#[tokio::test]
#[ignore]
async fn test_gh_pr_checks_with_repo_flag() {
    if !common::gh_authenticated() {
        eprintln!("Skipping test: gh CLI not authenticated");
        return;
    }

    // Find any merged PR to test checks query
    let list_output = Command::new("gh")
        .args([
            "pr",
            "list",
            "--repo",
            "shepherdjerred/monorepo",
            "--state",
            "merged",
            "--limit",
            "1",
            "--json",
            "number",
        ])
        .output()
        .await
        .expect("Failed to list PRs");

    if !list_output.status.success() {
        eprintln!("Skipping: could not list PRs");
        return;
    }

    let prs: Vec<serde_json::Value> =
        serde_json::from_slice(&list_output.stdout).expect("Should parse PR list");

    if prs.is_empty() {
        eprintln!("Skipping: no merged PRs found in repo");
        return;
    }

    let pr_number = prs[0]["number"]
        .as_u64()
        .expect("PR should have number field");

    // Query checks for this PR
    let checks_output = Command::new("gh")
        .args([
            "pr",
            "checks",
            &pr_number.to_string(),
            "--repo",
            "shepherdjerred/monorepo",
            "--json",
            "state",
        ])
        .output()
        .await
        .expect("Failed to get PR checks");

    assert!(
        checks_output.status.success(),
        "gh pr checks should succeed for PR #{}. stderr: {}",
        pr_number,
        String::from_utf8_lossy(&checks_output.stderr)
    );
}
