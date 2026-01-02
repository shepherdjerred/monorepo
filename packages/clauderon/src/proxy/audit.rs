//! Audit logging for proxied requests.

use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;

use chrono::{DateTime, Utc};
use serde::Serialize;

/// An audit log entry for a proxied request.
#[derive(Debug, Clone, Serialize, serde::Deserialize)]
pub struct AuditEntry {
    /// Timestamp of the request.
    pub timestamp: DateTime<Utc>,

    /// Service name (e.g., "github", "anthropic").
    pub service: String,

    /// HTTP method (e.g., "GET", "POST").
    pub method: String,

    /// Request path.
    pub path: String,

    /// Whether auth was injected.
    pub auth_injected: bool,

    /// HTTP response status code.
    pub response_code: Option<u16>,

    /// Request duration in milliseconds.
    pub duration_ms: u64,
}

/// Audit logger that writes JSON lines to a file.
pub struct AuditLogger {
    file: Mutex<Option<File>>,
    path: PathBuf,
}

impl AuditLogger {
    /// Create a new audit logger.
    pub fn new(path: PathBuf) -> anyhow::Result<Self> {
        // Ensure parent directory exists
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }

        let file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)?;

        Ok(Self {
            file: Mutex::new(Some(file)),
            path,
        })
    }

    /// Create a no-op logger (for when audit is disabled).
    pub fn noop() -> Self {
        Self {
            file: Mutex::new(None),
            path: PathBuf::new(),
        }
    }

    /// Log an audit entry.
    pub fn log(&self, entry: &AuditEntry) -> anyhow::Result<()> {
        let mut guard = self.file.lock().map_err(|e| anyhow::anyhow!("lock error: {e}"))?;

        if let Some(file) = guard.as_mut() {
            let json = serde_json::to_string(entry)?;
            writeln!(file, "{json}")?;
        }

        Ok(())
    }

    /// Flush the audit log to disk.
    pub fn flush(&self) -> anyhow::Result<()> {
        let mut guard = self.file.lock().map_err(|e| anyhow::anyhow!("lock error: {e}"))?;

        if let Some(file) = guard.as_mut() {
            file.flush()?;
        }

        Ok(())
    }

    /// Get the audit log path.
    pub fn path(&self) -> &PathBuf {
        &self.path
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn test_audit_entry_serializes() {
        let entry = AuditEntry {
            timestamp: Utc::now(),
            service: "github".to_string(),
            method: "GET".to_string(),
            path: "/user".to_string(),
            auth_injected: true,
            response_code: Some(200),
            duration_ms: 150,
        };

        let json = serde_json::to_string(&entry).unwrap();
        assert!(json.contains("\"service\":\"github\""));
        assert!(json.contains("\"auth_injected\":true"));
    }

    #[test]
    fn test_audit_logger_writes() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("audit.jsonl");

        let logger = AuditLogger::new(path.clone()).unwrap();

        let entry = AuditEntry {
            timestamp: Utc::now(),
            service: "anthropic".to_string(),
            method: "POST".to_string(),
            path: "/v1/messages".to_string(),
            auth_injected: true,
            response_code: Some(200),
            duration_ms: 500,
        };

        logger.log(&entry).unwrap();
        logger.flush().unwrap();

        let content = std::fs::read_to_string(&path).unwrap();
        assert!(content.contains("anthropic"));
    }
}
