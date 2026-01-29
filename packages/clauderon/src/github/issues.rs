use anyhow::Context;
use serde::{Deserialize, Serialize};
use std::path::Path;
use tracing::instrument;

/// GitHub issue state filter
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum IssueState {
    /// Only open issues
    Open,
    /// Only closed issues
    Closed,
    /// All issues
    All,
}

impl std::fmt::Display for IssueState {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Open => write!(f, "open"),
            Self::Closed => write!(f, "closed"),
            Self::All => write!(f, "all"),
        }
    }
}

/// A GitHub issue with essential metadata
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitHubIssue {
    /// Issue number
    pub number: u32,
    /// Issue title
    pub title: String,
    /// Issue body (description)
    pub body: String,
    /// Issue URL
    pub url: String,
    /// Issue labels
    pub labels: Vec<String>,
}

/// Fetch GitHub issues for a repository using gh CLI
///
/// # Errors
/// Returns an error if:
/// - gh CLI is not installed
/// - Not in a git repository
/// - GitHub API returns an error
/// - JSON parsing fails
#[instrument(skip(repo_path), fields(repo_path = %repo_path.display(), state = %state))]
pub async fn fetch_issues(repo_path: &Path, state: IssueState) -> anyhow::Result<Vec<GitHubIssue>> {
    tracing::debug!("Fetching GitHub issues");

    let output = tokio::process::Command::new("gh")
        .current_dir(repo_path)
        .args([
            "issue",
            "list",
            "--state",
            &state.to_string(),
            "--json",
            "number,title,body,url,labels",
            "--limit",
            "50",
        ])
        .output()
        .await
        .context("Failed to execute gh command - is gh CLI installed?")?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(anyhow::anyhow!("gh issue list failed: {}", stderr));
    }

    let json_output = String::from_utf8_lossy(&output.stdout);

    // Handle empty response
    if json_output.trim().is_empty() || json_output.trim() == "[]" {
        tracing::debug!("No issues found");
        return Ok(vec![]);
    }

    // Parse JSON response from gh CLI
    let raw_issues: Vec<RawGitHubIssue> = serde_json::from_str(&json_output)
        .with_context(|| format!("Failed to parse gh issue list JSON: {}", json_output))?;

    // Convert to our issue format
    let issues = raw_issues
        .into_iter()
        .map(|raw| GitHubIssue {
            number: raw.number,
            title: raw.title,
            body: raw.body.unwrap_or_default(),
            url: raw.url,
            labels: raw.labels.into_iter().map(|l| l.name).collect(),
        })
        .collect();

    tracing::info!("Fetched {} GitHub issues", issues.len());
    Ok(issues)
}

/// Raw GitHub issue JSON structure from gh CLI
#[derive(Debug, Deserialize)]
struct RawGitHubIssue {
    number: u32,
    title: String,
    body: Option<String>,
    url: String,
    labels: Vec<RawLabel>,
}

/// Raw GitHub label JSON structure
#[derive(Debug, Deserialize)]
struct RawLabel {
    name: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_issue_list_json() {
        let json = r#"[
            {
                "number": 42,
                "title": "Fix authentication bug",
                "body": "Users cannot log in with special characters in password",
                "url": "https://github.com/org/repo/issues/42",
                "labels": [
                    {"name": "bug"},
                    {"name": "high-priority"}
                ]
            },
            {
                "number": 43,
                "title": "Add dark mode",
                "body": null,
                "url": "https://github.com/org/repo/issues/43",
                "labels": []
            }
        ]"#;

        let raw_issues: Vec<RawGitHubIssue> = serde_json::from_str(json).unwrap();
        assert_eq!(raw_issues.len(), 2);
        assert_eq!(raw_issues[0].number, 42);
        assert_eq!(raw_issues[0].title, "Fix authentication bug");
        assert_eq!(raw_issues[0].labels.len(), 2);
        assert_eq!(raw_issues[1].body, None);
    }

    #[test]
    fn test_parse_empty_issue_list() {
        let json = "[]";
        let raw_issues: Vec<RawGitHubIssue> = serde_json::from_str(json).unwrap();
        assert_eq!(raw_issues.len(), 0);
    }

    #[test]
    fn test_issue_state_display() {
        assert_eq!(IssueState::Open.to_string(), "open");
        assert_eq!(IssueState::Closed.to_string(), "closed");
        assert_eq!(IssueState::All.to_string(), "all");
    }
}
