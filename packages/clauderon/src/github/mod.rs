// GitHub integration module
pub mod issues;

pub use issues::{GitHubIssue, IssueState, fetch_issues};
