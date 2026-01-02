//! External editor utilities for editing text in $EDITOR

use anyhow::{Context, Result};
use std::path::PathBuf;
use std::time::SystemTime;

/// Get the editor command from environment variables
///
/// Checks $VISUAL, then $EDITOR, then falls back to vim/nano/vi/notepad
pub fn get_editor() -> String {
    // Check VISUAL first (preferred for full-screen editors)
    if let Ok(visual) = std::env::var("VISUAL") {
        if !visual.is_empty() {
            return visual;
        }
    }

    // Check EDITOR
    if let Ok(editor) = std::env::var("EDITOR") {
        if !editor.is_empty() {
            return editor;
        }
    }

    // Platform-specific fallbacks
    if cfg!(target_os = "windows") {
        "notepad".to_string()
    } else {
        // Try to find vim, nano, or vi
        for editor in &["vim", "nano", "vi"] {
            if which(editor) {
                return editor.to_string();
            }
        }
        // Last resort fallback
        "vi".to_string()
    }
}

/// Check if a command exists in PATH
fn which(command: &str) -> bool {
    std::process::Command::new("which")
        .arg(command)
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

/// Create a temporary file with the given content
///
/// Returns the path to the temp file
pub fn create_temp_file(content: &str) -> Result<PathBuf> {
    // Use system temp directory
    let temp_dir = std::env::temp_dir();

    // Create unique filename using timestamp + PID to avoid collisions
    let timestamp = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .context("Failed to get system time")?
        .as_millis();

    let pid = std::process::id();
    let filename = format!("clauderon-prompt-{timestamp}-{pid}.txt");
    let temp_path = temp_dir.join(filename);

    // Write content to file
    std::fs::write(&temp_path, content)
        .with_context(|| format!("Failed to write temp file: {}", temp_path.display()))?;

    Ok(temp_path)
}

/// Read the content from a file
pub fn read_file_content(path: &PathBuf) -> Result<String> {
    std::fs::read_to_string(path)
        .with_context(|| format!("Failed to read file: {}", path.display()))
}

/// Clean up (delete) a temporary file
///
/// Logs errors but doesn't fail to avoid disrupting the workflow
pub fn cleanup_temp_file(path: &PathBuf) {
    if let Err(e) = std::fs::remove_file(path) {
        // Log the error but don't fail - temp files will eventually be cleaned by OS
        tracing::warn!("Failed to cleanup temp file {}: {}", path.display(), e);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // NOTE: Tests for environment variable reading are removed because they require
    // unsafe code (std::env::set_var/remove_var) which is forbidden by -F unsafe-code.
    // The get_editor() function is simple enough that manual testing is sufficient.

    #[test]
    fn test_temp_file_roundtrip() {
        let content = "Hello, world!\nLine 2\nLine 3";

        let path = create_temp_file(content).expect("Failed to create temp file");
        assert!(path.exists());

        let read_content = read_file_content(&path).expect("Failed to read temp file");
        assert_eq!(read_content, content);

        cleanup_temp_file(&path);
        assert!(!path.exists());
    }

    #[test]
    fn test_temp_file_emoji() {
        let content = "Hello 😀 emoji 🎉 test";

        let path = create_temp_file(content).expect("Failed to create temp file");
        let read_content = read_file_content(&path).expect("Failed to read temp file");
        assert_eq!(read_content, content);

        cleanup_temp_file(&path);
    }
}
