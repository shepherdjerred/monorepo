use std::path::Path;
use std::time::{Duration, SystemTime};
use tracing::{info, warn};

const DEFAULT_MAX_AGE_DAYS: u64 = 7;

/// Clean up old log files from the logs directory.
///
/// Removes log files older than `max_age_days` (default: 7 days).
/// Symlinks and non-clauderon files are skipped.
///
/// # Arguments
///
/// * `logs_dir` - Path to the logs directory
/// * `max_age_days` - Maximum age in days before files are deleted (None = 7 days)
///
/// # Returns
///
/// The number of files removed, or an error if the directory couldn't be read.
pub fn cleanup_old_logs(logs_dir: &Path, max_age_days: Option<u64>) -> anyhow::Result<usize> {
    let max_age = Duration::from_secs(max_age_days.unwrap_or(DEFAULT_MAX_AGE_DAYS) * 24 * 60 * 60);
    let now = SystemTime::now();
    let mut removed = 0;

    let entries = std::fs::read_dir(logs_dir)?;
    for entry in entries.flatten() {
        let path = entry.path();
        let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");

        // Skip symlinks and non-log files
        if path.is_symlink() || (!name.starts_with("clauderon.") && !name.starts_with("audit.")) {
            continue;
        }

        // Skip "latest" symlinks by name pattern
        if name.starts_with("latest.") {
            continue;
        }

        // Check file age
        if let Ok(metadata) = entry.metadata() {
            if let Ok(modified) = metadata.modified() {
                if let Ok(age) = now.duration_since(modified) {
                    if age > max_age {
                        if std::fs::remove_file(&path).is_ok() {
                            info!(file = %name, "Removed old log file");
                            removed += 1;
                        } else {
                            warn!(file = %name, "Failed to remove old log file");
                        }
                    }
                }
            }
        }
    }

    Ok(removed)
}
