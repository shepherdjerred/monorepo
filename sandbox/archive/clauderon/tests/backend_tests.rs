//! Backend integration tests

use clauderon::backends::git::GitBackend;

#[test]
fn test_git_backend_new() {
    let _git = GitBackend::new();
    // GitBackend::new() should succeed - if we get here, it passed
}

#[test]
fn test_worktree_path_generation() {
    use clauderon::utils::worktree_path;

    let path = worktree_path("test-session");
    assert!(path.to_string_lossy().contains("test-session"));
    assert!(path.to_string_lossy().contains(".clauderon"));
}

#[test]
fn test_session_name_generation() {
    use clauderon::utils::generate_session_name;

    let name1 = generate_session_name("test");
    let name2 = generate_session_name("test");

    // Both should start with the base name
    assert!(name1.starts_with("test-"));
    assert!(name2.starts_with("test-"));

    // Should have a 4-character suffix
    assert_eq!(name1.len(), "test-".len() + 4);
    assert_eq!(name2.len(), "test-".len() + 4);

    // Should be different (with very high probability)
    assert_ne!(name1, name2);
}

#[test]
fn test_database_path() {
    use clauderon::utils::database_path;

    let path = database_path();
    assert!(path.to_string_lossy().contains("db.sqlite"));
    assert!(path.to_string_lossy().contains(".clauderon"));
}

#[test]
fn test_socket_path() {
    use clauderon::utils::socket_path;

    let path = socket_path();
    assert!(path.to_string_lossy().contains("clauderon.sock"));
    assert!(path.to_string_lossy().contains(".clauderon"));
}
