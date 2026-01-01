use rand::Rng;

/// Characters used for generating random suffixes
const CHARSET: &[u8] = b"abcdefghijklmnopqrstuvwxyz0123456789";

/// Length of the random suffix
const SUFFIX_LENGTH: usize = 4;

/// Sanitize a string to be valid as a git branch name.
///
/// Git branch names cannot contain:
/// - Spaces, ~, ^, :, ?, *, [, \, @, {, }
/// - Two consecutive dots (..)
/// - Leading or trailing dots, slashes, or hyphens
/// - The suffix `.lock` (reserved by git)
///
/// Also enforces a maximum length to prevent DoS via extremely long names.
///
/// See `git check-ref-format` for full rules.
#[must_use]
pub fn sanitize_branch_name(name: &str) -> String {
    // Limit length to prevent DoS (git has a ~4096 byte limit for refs)
    const MAX_LENGTH: usize = 200;
    let name = if name.len() > MAX_LENGTH {
        &name[..MAX_LENGTH]
    } else {
        name
    };

    let sanitized: String = name
        .chars()
        .map(|c| match c {
            ' ' | '~' | '^' | ':' | '?' | '*' | '[' | '\\' | '@' | '{' | '}' => '-',
            c if c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '/' || c == '.' => c,
            _ => '-',
        })
        .collect();

    // Collapse runs of 2+ dots to a single hyphen
    let mut result = String::new();
    let mut dot_count = 0;
    for c in sanitized.chars() {
        if c == '.' {
            dot_count += 1;
        } else {
            if dot_count == 1 {
                result.push('.');
            } else if dot_count > 1 {
                result.push('-');
            }
            dot_count = 0;
            result.push(c);
        }
    }
    // Handle trailing dots
    if dot_count == 1 {
        result.push('.');
    } else if dot_count > 1 {
        result.push('-');
    }
    let sanitized = result;

    // Remove leading/trailing special characters
    let mut sanitized = sanitized
        .trim_matches(|c| c == '-' || c == '.' || c == '/')
        .to_string();

    // Remove .lock suffix (reserved by git)
    while sanitized.ends_with(".lock") {
        sanitized = sanitized.trim_end_matches(".lock").to_string();
    }

    // Final trim in case .lock removal left trailing special chars
    let result = sanitized
        .trim_matches(|c| c == '-' || c == '.' || c == '/')
        .to_string();

    // Handle empty result (e.g., input was all special chars like "..." or "@@@")
    if result.is_empty() {
        "session".to_string()
    } else {
        result
    }
}

/// Generate a session name with a random suffix
///
/// The base name is sanitized to be a valid git branch name before
/// the suffix is appended.
///
/// # Example
/// ```
/// use clauderon::utils::generate_session_name;
/// let name = generate_session_name("fix-bug");
/// // Returns something like "fix-bug-a3x9"
///
/// // Names with spaces are sanitized:
/// let name = generate_session_name("my feature");
/// // Returns something like "my-feature-b2k7"
/// ```
#[must_use]
pub fn generate_session_name(base_name: &str) -> String {
    let sanitized = sanitize_branch_name(base_name);
    let mut rng = rand::thread_rng();
    let suffix: String = (0..SUFFIX_LENGTH)
        .map(|_| {
            let idx = rng.gen_range(0..CHARSET.len());
            CHARSET[idx] as char
        })
        .collect();

    format!("{sanitized}-{suffix}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_generate_session_name() {
        let name = generate_session_name("test");
        assert!(name.starts_with("test-"));
        assert_eq!(name.len(), "test-".len() + SUFFIX_LENGTH);
    }

    #[test]
    fn test_unique_names() {
        let name1 = generate_session_name("test");
        let name2 = generate_session_name("test");
        // Should be different (with very high probability)
        assert_ne!(name1, name2);
    }

    #[test]
    fn test_sanitize_spaces() {
        assert_eq!(sanitize_branch_name("my feature"), "my-feature");
        assert_eq!(sanitize_branch_name("clauderon automatic daemon"), "clauderon-automatic-daemon");
    }

    #[test]
    fn test_sanitize_special_chars() {
        assert_eq!(sanitize_branch_name("test~branch"), "test-branch");
        assert_eq!(sanitize_branch_name("test^branch"), "test-branch");
        assert_eq!(sanitize_branch_name("test:branch"), "test-branch");
        assert_eq!(sanitize_branch_name("test?branch"), "test-branch");
        assert_eq!(sanitize_branch_name("test*branch"), "test-branch");
        assert_eq!(sanitize_branch_name("test[branch"), "test-branch");
        assert_eq!(sanitize_branch_name("test\\branch"), "test-branch");
        assert_eq!(sanitize_branch_name("test@branch"), "test-branch");
    }

    #[test]
    fn test_sanitize_consecutive_dots() {
        assert_eq!(sanitize_branch_name("test..branch"), "test-branch");
        // Now iteratively replaces all consecutive dots
        assert_eq!(sanitize_branch_name("test...branch"), "test-branch");
        assert_eq!(sanitize_branch_name("test....branch"), "test-branch");
    }

    #[test]
    fn test_sanitize_lock_suffix() {
        assert_eq!(sanitize_branch_name("branch.lock"), "branch");
        assert_eq!(sanitize_branch_name("branch.lock.lock"), "branch");
        assert_eq!(sanitize_branch_name("my-branch.lock"), "my-branch");
    }

    #[test]
    fn test_sanitize_curly_braces() {
        // Trailing special chars are trimmed
        assert_eq!(sanitize_branch_name("test@{branch}"), "test--branch");
        assert_eq!(sanitize_branch_name("ref@{1}"), "ref--1");
    }

    #[test]
    fn test_sanitize_max_length() {
        let long_name = "a".repeat(300);
        let sanitized = sanitize_branch_name(&long_name);
        assert!(sanitized.len() <= 200);
    }

    #[test]
    fn test_sanitize_leading_trailing() {
        assert_eq!(sanitize_branch_name("-test-"), "test");
        assert_eq!(sanitize_branch_name(".test."), "test");
        assert_eq!(sanitize_branch_name("/test/"), "test");
        assert_eq!(sanitize_branch_name("---test---"), "test");
    }

    #[test]
    fn test_sanitize_preserves_valid() {
        assert_eq!(sanitize_branch_name("valid-name"), "valid-name");
        assert_eq!(sanitize_branch_name("valid_name"), "valid_name");
        assert_eq!(sanitize_branch_name("feature/branch"), "feature/branch");
        assert_eq!(sanitize_branch_name("v1.2.3"), "v1.2.3");
    }

    #[test]
    fn test_sanitize_empty_result() {
        // Input that becomes empty after sanitization should return "session"
        assert_eq!(sanitize_branch_name("..."), "session");
        assert_eq!(sanitize_branch_name("@@@"), "session");
        assert_eq!(sanitize_branch_name(""), "session");
        assert_eq!(sanitize_branch_name("---"), "session");
    }

    #[test]
    fn test_generate_session_name_with_spaces() {
        let name = generate_session_name("clauderon automatic daemon");
        assert!(name.starts_with("clauderon-automatic-daemon-"));
        // Verify no spaces in generated name
        assert!(!name.contains(' '));
    }
}
