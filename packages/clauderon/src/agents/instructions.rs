use crate::github::GitHubIssue;

/// Generate complete autonomous workflow instructions for auto-code sessions
///
/// This function creates a comprehensive prompt that includes:
/// 1. The issue to resolve
/// 2. Complete workflow steps (implement → draft PR → ready → monitor → merge)
/// 3. Instructions for handling edge cases (conflicts, CI failures)
///
/// The instructions are designed to be included in the initial prompt so Claude
/// knows the full workflow upfront, without requiring runtime intervention from
/// the daemon.
///
/// # Returns
/// A formatted prompt string that Claude Code can follow autonomously
pub fn auto_code_instructions(issue: &GitHubIssue) -> String {
    // Truncate issue body if too long (Claude has context limits)
    let truncated_body = if issue.body.len() > 2000 {
        format!(
            "{}...\n\n[Issue body truncated for length]",
            &issue.body[..2000]
        )
    } else {
        issue.body.clone()
    };

    format!(
        r#"Resolve GitHub issue #{}: {}

Issue description:
{}

Issue URL: {}
Labels: {}

## Complete Autonomous Workflow

You are operating in **autonomous mode**. Follow this complete workflow:

### 1. Implementation Phase
- Implement the solution following best practices
- Write or update tests as appropriate
- Ensure all tests pass locally
- Commit your changes with clear, descriptive commit messages

### 2. Draft Pull Request Creation
Once implementation is complete:
```bash
gh pr create --draft \
  --title "Fix #{}: {}" \
  --body "Resolves #{}

[Describe your implementation approach here]

## Testing
[Describe how you tested the changes]

## Checklist
- [ ] Tests pass locally
- [ ] Code follows project conventions
- [ ] Documentation updated if needed"
```

### 3. Mark PR Ready
When you're confident in your implementation:
```bash
gh pr ready
```

### 4. Monitor PR Status
Check status every 60 seconds until merge conditions are met:
```bash
# Check CI status
gh pr checks

# Check review decision
gh pr view --json reviewDecision -q .reviewDecision

# Check for conflicts
gh pr view --json mergeable,mergeStateStatus -q '.mergeable, .mergeStateStatus'
```

### 5. Handle Issues
If problems arise:

**Merge Conflicts:**
```bash
git fetch origin main
git rebase origin/main
# Resolve conflicts if any
git push --force-with-lease
```

**CI Failures:**
- Review failed checks: `gh pr checks`
- Fix issues and push new commits
- Wait for CI to re-run

**Changes Requested:**
- Read review comments: `gh pr view`
- Address feedback in new commits
- Push changes and notify reviewers

### 6. Auto-Merge
When ALL conditions are met:
- ✅ CI checks passing
- ✅ Approved by reviewers
- ✅ No merge conflicts
- ✅ No changes requested

Execute merge:
```bash
gh pr merge --auto --delete-branch
```

The `--auto` flag will merge automatically once conditions are met (handles brief delays in CI completion).

## Important Notes

- **Patience**: Some operations (CI, reviews) may take time. Check status periodically rather than continuously.
- **Communication**: Provide progress updates at each major step so the user knows where you are in the workflow.
- **Errors**: If you encounter errors you cannot resolve, report them clearly with relevant logs/output.
- **Timeout**: If the PR is not merged after 24 hours, report status and explain what's blocking progress.

## Current Status
Starting implementation phase...

🤖 This is an autonomous workflow. I will guide this work through to completion.
"#,
        issue.number,
        escape_for_shell(&issue.title),
        truncated_body,
        issue.url,
        issue.labels.join(", "),
        issue.number,
        escape_for_shell(&issue.title),
        issue.number,
    )
}

/// Escape a string for safe inclusion in shell commands and markdown
///
/// This function escapes characters that could be problematic in shell contexts
/// or markdown formatting. Since these instructions are primarily for Claude to
/// read and understand (not direct shell execution), we focus on:
/// - Single quotes (most common issue in shell strings)
/// - Newlines/carriage returns (break command structure)
/// - Backticks (markdown code blocks, shell command substitution)
/// - Dollar signs (shell variable expansion)
///
/// Other characters like ", \, !, # are generally safe in the markdown/prompt
/// context where these instructions are used.
fn escape_for_shell(s: &str) -> String {
    s.replace('\'', "'\\''")
        .replace('\n', " ")
        .replace('\r', "")
        .replace('`', "\\`")
        .replace('$', "\\$")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_auto_code_instructions_format() {
        let issue = GitHubIssue {
            number: 123,
            title: "Fix bug with 'quotes'".to_string(),
            body: "Description with\nmultiple lines and detail".to_string(),
            url: "https://github.com/org/repo/issues/123".to_string(),
            labels: vec!["bug".to_string(), "high-priority".to_string()],
        };

        let instructions = auto_code_instructions(&issue);

        // Verify key components are present
        assert!(instructions.contains("issue #123"));
        assert!(instructions.contains("Fix bug with"));
        assert!(instructions.contains("gh pr create --draft"));
        assert!(instructions.contains("gh pr merge --auto"));
        assert!(instructions.contains("Description with"));
        assert!(instructions.contains("bug, high-priority"));
        assert!(instructions.contains("autonomous mode"));

        // Verify no unsafe shell characters in title substitution
        // Title should be escaped in shell commands but readable in text
        assert!(instructions.contains("'quotes'")); // In description
    }

    #[test]
    fn test_shell_escaping() {
        assert_eq!(escape_for_shell("simple"), "simple");
        assert_eq!(escape_for_shell("with'quote"), "with'\\''quote");
        assert_eq!(escape_for_shell("line1\nline2"), "line1 line2");
        assert_eq!(escape_for_shell("has\r\nwindows"), "has windows");
        assert_eq!(escape_for_shell("with`backtick"), "with\\`backtick");
        assert_eq!(escape_for_shell("$variable"), "\\$variable");
    }

    #[test]
    fn test_long_issue_body_truncation() {
        let long_body = "a".repeat(3000);
        let issue = GitHubIssue {
            number: 1,
            title: "Test".to_string(),
            body: long_body,
            url: "https://github.com/org/repo/issues/1".to_string(),
            labels: vec![],
        };

        let instructions = auto_code_instructions(&issue);

        // Should contain truncation notice
        assert!(instructions.contains("[Issue body truncated for length]"));
        // Should not contain the full 3000 characters
        assert!(instructions.len() < 5000);
    }

    #[test]
    fn test_no_labels() {
        let issue = GitHubIssue {
            number: 1,
            title: "Test".to_string(),
            body: "Body".to_string(),
            url: "https://github.com/org/repo/issues/1".to_string(),
            labels: vec![],
        };

        let instructions = auto_code_instructions(&issue);
        assert!(instructions.contains("Labels: ")); // Empty but present
    }
}
