use rand::Rng;

/// Characters used for generating random suffixes
const CHARSET: &[u8] = b"abcdefghijklmnopqrstuvwxyz0123456789";

/// Length of the random suffix
const SUFFIX_LENGTH: usize = 4;

/// Generate a session name with a random suffix
///
/// # Example
/// ```
/// use multiplexer::utils::generate_session_name;
/// let name = generate_session_name("fix-bug");
/// // Returns something like "fix-bug-a3x9"
/// ```
#[must_use]
pub fn generate_session_name(base_name: &str) -> String {
    let mut rng = rand::thread_rng();
    let suffix: String = (0..SUFFIX_LENGTH)
        .map(|_| {
            let idx = rng.gen_range(0..CHARSET.len());
            CHARSET[idx] as char
        })
        .collect();

    format!("{base_name}-{suffix}")
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
}
