use anyhow::Context;
use std::path::{Path, PathBuf};

/// Result of git root detection
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GitRootInfo {
    /// Absolute path to the git repository root (where .git exists)
    pub git_root: PathBuf,
    /// Relative path from git root to the original subdirectory
    /// Empty if the input was the git root itself
    pub subdirectory: PathBuf,
}

/// Find the git repository root from any path within the repo
///
/// Traverses upward from the given path until it finds a `.git` directory or file.
/// Handles both regular repositories (`.git` is a directory) and worktrees
/// (`.git` is a file containing a gitdir reference).
///
/// # Arguments
///
/// * `path` - Any path within a git repository (can be the root or a subdirectory)
///
/// # Returns
///
/// Returns `GitRootInfo` containing the git root and the relative subdirectory path.
///
/// # Errors
///
/// Returns an error if:
/// - The path does not exist
/// - The path is not within a git repository
/// - The git root cannot be accessed
/// - A worktree's `.git` file is malformed
///
/// # Examples
///
/// ```no_run
/// use std::path::PathBuf;
/// use clauderon::utils::git::find_git_root;
///
/// let info = find_git_root(&PathBuf::from("/repo/packages/foo"))?;
/// assert_eq!(info.git_root, PathBuf::from("/repo"));
/// assert_eq!(info.subdirectory, PathBuf::from("packages/foo"));
/// # Ok::<(), anyhow::Error>(())
/// ```
pub fn find_git_root(path: &Path) -> anyhow::Result<GitRootInfo> {
    // Canonicalize the input path to handle symlinks and get absolute path
    let canonical_path = path.canonicalize().with_context(|| {
        format!(
            "Path does not exist or is not accessible: {}",
            path.display()
        )
    })?;

    // Check if the path is a directory
    if !canonical_path.is_dir() {
        anyhow::bail!("Path is not a directory: {}", canonical_path.display());
    }

    let mut current = canonical_path.as_path();

    // Walk up the directory tree looking for .git
    loop {
        let git_path = current.join(".git");

        if git_path.exists() {
            // Found .git - determine if it's a directory (regular repo) or file (worktree)
            let git_root = if git_path.is_dir() {
                // Regular repository - current directory is the git root
                current.to_path_buf()
            } else if git_path.is_file() {
                // Worktree - need to find the parent repository
                let parent_git = parse_worktree_git_file(&git_path, current)?;
                // The parent_git is the .git directory, we need the repo root (its parent)
                parent_git
                    .parent()
                    .ok_or_else(|| {
                        anyhow::anyhow!(
                            "Invalid git directory: no parent for {}",
                            parent_git.display()
                        )
                    })?
                    .to_path_buf()
            } else {
                // .git exists but is neither file nor directory (symlink, etc.)
                anyhow::bail!(
                    "Invalid .git entry at {}: not a regular file or directory",
                    git_path.display()
                );
            };

            // Calculate relative path from git root to original path
            let subdirectory = canonical_path
                .strip_prefix(&git_root)
                .map(|p| p.to_path_buf())
                .unwrap_or_else(|_| PathBuf::new());

            return Ok(GitRootInfo {
                git_root,
                subdirectory,
            });
        }

        // Move up to parent directory
        match current.parent() {
            Some(parent) => current = parent,
            None => {
                // Reached filesystem root without finding .git
                anyhow::bail!(
                    "Path is not within a git repository: {}",
                    canonical_path.display()
                );
            }
        }
    }
}

/// Detect if a directory is a git worktree and return the parent .git directory path
///
/// This function checks if the given path contains a `.git` file (indicating a worktree)
/// and returns the parent repository's `.git` directory if found.
///
/// # Arguments
///
/// * `path` - Path to check for worktree status
///
/// # Returns
///
/// - `Ok(Some(PathBuf))` - Path to the parent `.git` directory
/// - `Ok(None)` - Not a worktree (no `.git` file or is a regular repo)
/// - `Err(_)` - Error reading or parsing the `.git` file
///
/// # Errors
///
/// Returns an error if the `.git` file exists but cannot be read or is malformed.
pub fn detect_worktree_parent_git_dir(path: &Path) -> anyhow::Result<Option<PathBuf>> {
    let git_file = path.join(".git");

    // Check if .git exists and is a file (not a directory)
    if !git_file.exists() || !git_file.is_file() {
        return Ok(None);
    }

    // Parse the worktree .git file to get parent .git directory
    let parent_git = parse_worktree_git_file(&git_file, path)?;
    Ok(Some(parent_git))
}

/// Parse a worktree's `.git` file to find the parent repository's `.git` directory
///
/// Reads the `.git` file which contains a `gitdir:` reference pointing to
/// `.git/worktrees/<name>` in the parent repository, then traverses up to
/// find the parent `.git` directory.
///
/// # Arguments
///
/// * `git_file` - Path to the `.git` file in the worktree
/// * `worktree_path` - Path to the worktree directory (for error messages)
///
/// # Errors
///
/// Returns an error if the `.git` file is malformed or the parent repo cannot be found.
fn parse_worktree_git_file(git_file: &Path, worktree_path: &Path) -> anyhow::Result<PathBuf> {
    // Read the gitdir reference from .git file
    let contents = std::fs::read_to_string(git_file)
        .with_context(|| format!("Failed to read .git file: {}", git_file.display()))?;

    let gitdir_line = contents
        .lines()
        .find(|line| line.starts_with("gitdir: "))
        .ok_or_else(|| {
            anyhow::anyhow!(
                "Invalid .git file format: missing 'gitdir:' line in {}",
                git_file.display()
            )
        })?;

    // Extract the path after "gitdir: "
    let gitdir = gitdir_line.strip_prefix("gitdir: ").unwrap().trim();

    // Resolve the gitdir path (can be absolute or relative)
    let gitdir_path = if Path::new(gitdir).is_absolute() {
        PathBuf::from(gitdir)
    } else {
        // Relative path - resolve from the worktree directory
        worktree_path.join(gitdir)
    };

    // Canonicalize to resolve symlinks and get absolute path
    let canonical_gitdir = gitdir_path.canonicalize().with_context(|| {
        format!(
            "Failed to resolve gitdir path {} from worktree {}",
            gitdir_path.display(),
            worktree_path.display()
        )
    })?;

    // The gitdir points to something like /path/to/repo/.git/worktrees/name
    // We need to navigate up to /path/to/repo
    let worktrees_dir = canonical_gitdir.parent().ok_or_else(|| {
        anyhow::anyhow!(
            "Invalid worktree gitdir: no parent directory for {}",
            canonical_gitdir.display()
        )
    })?;

    let git_dir = worktrees_dir.parent().ok_or_else(|| {
        anyhow::anyhow!(
            "Invalid worktree structure: expected .git/worktrees/<name>, got {}",
            canonical_gitdir.display()
        )
    })?;

    let repo_root = git_dir.parent().ok_or_else(|| {
        anyhow::anyhow!(
            "Invalid git directory structure: no parent for {}",
            git_dir.display()
        )
    })?;

    // Validate that the parent .git directory exists and is valid
    if !git_dir.exists() {
        anyhow::bail!(
            "Parent .git directory does not exist: {}. \
            The worktree may be corrupted or the parent repository may have been moved/deleted.",
            git_dir.display()
        );
    }

    if !git_dir.join("HEAD").exists() {
        anyhow::bail!(
            "Parent directory exists but doesn't appear to be a valid git repository: {}",
            git_dir.display()
        );
    }

    Ok(repo_root.to_path_buf())
}

/// Validate that a path is within a git repository
///
/// This is a convenience function that calls `find_git_root` and discards the result.
/// Useful when you only need to validate, not retrieve the git root information.
///
/// # Arguments
///
/// * `path` - Path to validate
///
/// # Errors
///
/// Returns an error if the path is not within a git repository or cannot be accessed.
pub fn validate_git_repository(path: &Path) -> anyhow::Result<()> {
    find_git_root(path)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    /// Create a temporary git repository for testing
    fn create_test_repo() -> anyhow::Result<TempDir> {
        let temp_dir = TempDir::new()?;
        let git_dir = temp_dir.path().join(".git");
        fs::create_dir(&git_dir)?;
        fs::write(git_dir.join("HEAD"), "ref: refs/heads/main")?;
        Ok(temp_dir)
    }

    #[test]
    fn test_find_git_root_at_repo_root() -> anyhow::Result<()> {
        let repo = create_test_repo()?;
        let info = find_git_root(repo.path())?;

        assert_eq!(info.git_root, repo.path().canonicalize()?);
        assert_eq!(info.subdirectory, PathBuf::new());

        Ok(())
    }

    #[test]
    fn test_find_git_root_in_subdirectory() -> anyhow::Result<()> {
        let repo = create_test_repo()?;
        let subdir = repo.path().join("packages").join("foo");
        fs::create_dir_all(&subdir)?;

        let info = find_git_root(&subdir)?;

        assert_eq!(info.git_root, repo.path().canonicalize()?);
        assert_eq!(info.subdirectory, PathBuf::from("packages/foo"));

        Ok(())
    }

    #[test]
    fn test_find_git_root_in_nested_subdirectory() -> anyhow::Result<()> {
        let repo = create_test_repo()?;
        let subdir = repo.path().join("a").join("b").join("c");
        fs::create_dir_all(&subdir)?;

        let info = find_git_root(&subdir)?;

        assert_eq!(info.git_root, repo.path().canonicalize()?);
        assert_eq!(info.subdirectory, PathBuf::from("a/b/c"));

        Ok(())
    }

    #[test]
    fn test_find_git_root_non_git_directory() {
        let temp_dir = TempDir::new().unwrap();
        let result = find_git_root(temp_dir.path());

        assert!(result.is_err());
        assert!(
            result
                .unwrap_err()
                .to_string()
                .contains("not within a git repository")
        );
    }

    #[test]
    fn test_find_git_root_nonexistent_path() {
        let result = find_git_root(Path::new("/nonexistent/path/that/does/not/exist"));

        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("does not exist"));
    }

    #[test]
    fn test_validate_git_repository_success() -> anyhow::Result<()> {
        let repo = create_test_repo()?;
        let subdir = repo.path().join("src");
        fs::create_dir(&subdir)?;

        assert!(validate_git_repository(&subdir).is_ok());

        Ok(())
    }

    #[test]
    fn test_validate_git_repository_failure() {
        let temp_dir = TempDir::new().unwrap();
        assert!(validate_git_repository(temp_dir.path()).is_err());
    }

    #[test]
    fn test_find_git_root_file_path() {
        let temp_dir = TempDir::new().unwrap();
        let file = temp_dir.path().join("file.txt");
        fs::write(&file, "content").unwrap();

        let result = find_git_root(&file);
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("not a directory"));
    }
}
