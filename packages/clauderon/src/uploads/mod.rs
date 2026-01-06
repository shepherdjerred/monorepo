//! Image upload management for Clauderon sessions
//!
//! This module handles:
//! - Validation of uploaded image files (size, type, MIME)
//! - Upload directory structure: `~/.clauderon/uploads/{session-id}/`
//! - Cleanup on session deletion

use anyhow::{Context, Result};
use std::path::PathBuf;
use tracing::{debug, info, warn};
use uuid::Uuid;

/// Maximum file size for uploads (10MB)
pub const MAX_FILE_SIZE: usize = 10 * 1024 * 1024;

/// Allowed image file extensions
pub const ALLOWED_EXTENSIONS: &[&str] = &["jpg", "jpeg", "png", "gif", "webp"];

/// Get the upload directory for a specific session
///
/// Returns: `~/.clauderon/uploads/{session-id}/`
pub fn upload_dir_for_session(session_id: Uuid) -> PathBuf {
    crate::utils::paths::clauderon_dir()
        .join("uploads")
        .join(session_id.to_string())
}

/// Validate an image file for upload
///
/// Checks:
/// - File size <= 10MB
/// - Extension is in allowed list
/// - MIME type is image/* (if provided)
pub fn validate_image_file(file_name: &str, content_type: Option<&str>, size: usize) -> Result<()> {
    // Check size
    if size > MAX_FILE_SIZE {
        anyhow::bail!(
            "File size {} exceeds maximum of {} bytes",
            size,
            MAX_FILE_SIZE
        );
    }

    // Check extension
    let path = std::path::Path::new(file_name);
    let extension = path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|s| s.to_lowercase())
        .context("File has no extension")?;

    if !ALLOWED_EXTENSIONS.contains(&extension.as_str()) {
        anyhow::bail!(
            "File extension '{}' not allowed. Allowed: {}",
            extension,
            ALLOWED_EXTENSIONS.join(", ")
        );
    }

    // Check MIME type if provided
    if let Some(content_type) = content_type {
        if !content_type.starts_with("image/") {
            anyhow::bail!("Content-Type '{}' is not an image type", content_type);
        }
    }

    debug!(
        file_name = %file_name,
        size = size,
        content_type = ?content_type,
        "Image file validation passed"
    );

    Ok(())
}

/// Clean up uploaded files for a session
///
/// Removes the entire upload directory: `~/.clauderon/uploads/{session-id}/`
pub fn cleanup_session_uploads(session_id: Uuid) -> Result<()> {
    let upload_dir = upload_dir_for_session(session_id);

    if !upload_dir.exists() {
        debug!(
            session_id = %session_id,
            path = %upload_dir.display(),
            "Upload directory does not exist, skipping cleanup"
        );
        return Ok(());
    }

    std::fs::remove_dir_all(&upload_dir).with_context(|| {
        format!(
            "Failed to remove upload directory: {}",
            upload_dir.display()
        )
    })?;

    info!(
        session_id = %session_id,
        path = %upload_dir.display(),
        "Cleaned up session upload directory"
    );

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validate_image_file_success() {
        assert!(validate_image_file("test.jpg", Some("image/jpeg"), 1000).is_ok());
        assert!(validate_image_file("test.png", Some("image/png"), 5000).is_ok());
        assert!(validate_image_file("test.gif", Some("image/gif"), 10000).is_ok());
        assert!(validate_image_file("test.webp", Some("image/webp"), 50000).is_ok());
    }

    #[test]
    fn test_validate_image_file_too_large() {
        let result = validate_image_file("test.jpg", Some("image/jpeg"), MAX_FILE_SIZE + 1);
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("exceeds maximum"));
    }

    #[test]
    fn test_validate_image_file_invalid_extension() {
        let result = validate_image_file("test.exe", Some("application/exe"), 1000);
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("not allowed"));
    }

    #[test]
    fn test_validate_image_file_invalid_mime() {
        let result = validate_image_file("test.jpg", Some("application/pdf"), 1000);
        assert!(result.is_err());
        assert!(
            result
                .unwrap_err()
                .to_string()
                .contains("not an image type")
        );
    }

    #[test]
    fn test_upload_dir_for_session() {
        let session_id = Uuid::new_v4();
        let dir = upload_dir_for_session(session_id);
        assert!(dir.to_string_lossy().contains("uploads"));
        assert!(dir.to_string_lossy().contains(&session_id.to_string()));
    }
}
