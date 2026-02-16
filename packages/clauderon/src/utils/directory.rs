use std::fs;
use std::path::{Path, PathBuf};

/// Read directories from a path, returning only directories (no files)
///
/// # Errors
///
/// Returns an error if the directory cannot be read or permission is denied.
pub fn read_directories(path: &Path) -> Result<Vec<PathBuf>, std::io::Error> {
    let mut dirs = Vec::new();

    for entry in fs::read_dir(path)? {
        let entry = entry?;
        let path = entry.path();

        // Only include directories, skip files
        if path.is_dir() {
            dirs.push(path);
        }
    }

    // Sort alphabetically by name (case-insensitive)
    dirs.sort_by(|a, b| {
        let a_name = a
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_lowercase();
        let b_name = b
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_lowercase();
        a_name.cmp(&b_name)
    });

    Ok(dirs)
}

/// Expand tilde (~) in paths to home directory
#[must_use]
pub fn expand_tilde(path: &str) -> PathBuf {
    if path.starts_with('~') {
        if let Some(home) = dirs::home_dir() {
            // Handle "~/foo" -> join "foo" to home
            if path.len() > 1 && path.starts_with("~/") {
                return home.join(&path[2..]);
            }
            // Handle just "~" -> return home
            return home;
        }
    }
    PathBuf::from(path)
}

/// Normalize a path (resolve .., ., canonicalize)
///
/// # Errors
///
/// Returns an error if the path cannot be canonicalized.
pub fn normalize_path(path: &Path) -> Result<PathBuf, std::io::Error> {
    path.canonicalize()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::File;
    use tempfile::TempDir;

    #[test]
    fn test_read_directories_only_dirs() {
        let temp_dir = TempDir::new().unwrap();
        let temp_path = temp_dir.path();

        // Create some dirs and files
        fs::create_dir_all(temp_path.join("dir1")).unwrap();
        fs::create_dir_all(temp_path.join("dir2")).unwrap();
        fs::create_dir_all(temp_path.join("aaa_first")).unwrap();
        File::create(temp_path.join("file.txt")).unwrap();
        File::create(temp_path.join("another.txt")).unwrap();

        let dirs = read_directories(temp_path).unwrap();

        // Should only have 3 directories, sorted alphabetically
        assert_eq!(dirs.len(), 3);
        assert!(dirs.iter().all(|d| d.is_dir()));

        // Check alphabetical sorting
        let names: Vec<String> = dirs
            .iter()
            .map(|d| d.file_name().unwrap().to_string_lossy().to_string())
            .collect();
        assert_eq!(names, vec!["aaa_first", "dir1", "dir2"]);
    }

    #[test]
    fn test_read_directories_empty() {
        let temp_dir = TempDir::new().unwrap();
        let dirs = read_directories(temp_dir.path()).unwrap();
        assert!(dirs.is_empty());
    }

    #[test]
    fn test_expand_tilde() {
        // Test ~/path expansion
        let expanded = expand_tilde("~/test");
        assert!(!expanded.to_string_lossy().contains('~'));
        assert!(expanded.to_string_lossy().ends_with("test"));

        // Test just ~ expansion
        let expanded = expand_tilde("~");
        assert!(!expanded.to_string_lossy().contains('~'));

        // Test non-tilde path
        let expanded = expand_tilde("/absolute/path");
        assert_eq!(expanded, PathBuf::from("/absolute/path"));
    }

    #[test]
    fn test_normalize_path() {
        let temp_dir = TempDir::new().unwrap();
        let normalized = normalize_path(temp_dir.path()).unwrap();
        assert!(normalized.is_absolute());
    }
}
