//! Native projection of immutable vault documents and configurable workflows.

use std::sync::Arc;

use tasknotes_vault::{
    VaultError,
    config::TaskNotesConfiguration,
    document::{DocumentWrite, PropertyEdit, TaskDocument},
    path::VaultPath,
};

/// Sanitized vault failures, distinct from the legacy server API errors.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error, uniffi::Error)]
pub enum VaultBoundaryError {
    /// The selected configuration is invalid or needs explicit approval.
    #[error("Invalid TaskNotes configuration: {message}")]
    Configuration {
        /// Safe configuration diagnostic, without vault contents.
        message: String,
    },
    /// A document or requested edit is invalid.
    #[error("Invalid task document: {message}")]
    Document {
        /// Safe document diagnostic, without document contents.
        message: String,
    },
    /// A path is not a safe vault-relative identity.
    #[error("Invalid vault-relative path")]
    Path,
    /// The current file differs from the version used to plan its edit.
    #[error("The document changed; reload before saving")]
    Conflict,
}

impl From<VaultError> for VaultBoundaryError {
    fn from(value: VaultError) -> Self {
        match value {
            VaultError::Configuration(message) => Self::Configuration { message },
            VaultError::Document(message) => Self::Document { message },
            VaultError::Path => Self::Path,
            VaultError::Conflict => Self::Conflict,
        }
    }
}

/// A complete conditional write; hosts supply journaling and atomic file I/O.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct VaultDocumentWrite {
    /// Logical vault-relative target, validated by Rust.
    pub path: String,
    /// SHA-256 of the exact prior bytes.
    pub expected_revision: String,
    /// Complete replacement document bytes.
    pub bytes: Vec<u8>,
    /// SHA-256 of the replacement bytes.
    pub revision: String,
}

impl From<DocumentWrite> for VaultDocumentWrite {
    fn from(write: DocumentWrite) -> Self {
        Self {
            path: write.path.as_str().to_owned(),
            expected_revision: write.expected_revision.as_str().to_owned(),
            bytes: write.bytes,
            revision: write.revision.as_str().to_owned(),
        }
    }
}

/// Immutable Rust-owned parsed document, with no filesystem access.
#[derive(Debug, uniffi::Object)]
pub struct FfiVaultDocument {
    inner: TaskDocument,
}

#[uniffi::export]
impl FfiVaultDocument {
    /// Parse a logical path and complete document bytes.
    ///
    /// # Errors
    /// Rejects unsafe paths and malformed Markdown/frontmatter.
    #[uniffi::constructor]
    pub fn new(path: &str, bytes: Vec<u8>) -> Result<Arc<Self>, VaultBoundaryError> {
        Ok(Arc::new(Self {
            inner: TaskDocument::from_bytes(VaultPath::parse(path)?, bytes)?,
        }))
    }

    /// Exact original Markdown body.
    #[must_use]
    pub fn body(&self) -> String {
        self.inner.body().to_owned()
    }

    /// Exact content hash to use as a concurrency precondition.
    #[must_use]
    pub fn revision(&self) -> String {
        self.inner.revision().as_str().to_owned()
    }

    /// Properties as an ordered JSON object, including unknown keys.
    ///
    /// # Errors
    /// Returns a typed boundary error if serialization fails.
    pub fn properties_json(&self) -> Result<String, VaultBoundaryError> {
        serde_json::to_string(self.inner.frontmatter()).map_err(|_| VaultBoundaryError::Document {
            message: "properties cannot be serialized".to_owned(),
        })
    }

    /// Plan physical property edits and an optional body replacement.
    /// `edits_json` is a list of tagged `set`/`remove` property edits.
    ///
    /// # Errors
    /// Rejects malformed edits and changes affecting properties outside the plan.
    pub fn plan(
        &self,
        edits_json: &str,
        body: &Option<String>,
    ) -> Result<VaultDocumentWrite, VaultBoundaryError> {
        let edits: Vec<PropertyEdit> =
            serde_json::from_str(edits_json).map_err(|_| VaultBoundaryError::Document {
                message: "property edits violate their schema".to_owned(),
            })?;
        self.inner
            .plan(&edits, body.as_deref())
            .map(VaultDocumentWrite::from)
            .map_err(VaultBoundaryError::from)
    }
}

/// Immutable Rust-owned configuration for a selected vault profile.
#[derive(Debug, uniffi::Object)]
pub struct FfiVaultConfiguration {
    inner: TaskNotesConfiguration,
}

#[uniffi::export]
impl FfiVaultConfiguration {
    /// Resolve the selected vault's settings using the documented precedence.
    ///
    /// # Errors
    /// Rejects invalid configuration and unapproved configuration-free vaults.
    #[uniffi::constructor]
    pub fn new(
        plugin: &Option<Vec<u8>>,
        portable: &Option<Vec<u8>>,
        approve_standard: bool,
    ) -> Result<Arc<Self>, VaultBoundaryError> {
        Ok(Arc::new(Self {
            inner: TaskNotesConfiguration::resolve(
                plugin.as_deref(),
                portable.as_deref(),
                approve_standard,
            )?,
        }))
    }

    /// Validated effective settings as JSON, including mapped field names.
    ///
    /// # Errors
    /// Returns a typed boundary error if serialization fails.
    pub fn configuration_json(&self) -> Result<String, VaultBoundaryError> {
        serde_json::to_string(&self.inner).map_err(|_| VaultBoundaryError::Configuration {
            message: "configuration cannot be serialized".to_owned(),
        })
    }

    /// Resolve completion using the configured workflow.
    ///
    /// # Errors
    /// Rejects status values absent from the workflow.
    pub fn is_completed(&self, status: &str) -> Result<bool, VaultBoundaryError> {
        self.inner
            .is_completed(status)
            .map_err(VaultBoundaryError::from)
    }

    /// Resolve the next status using the configured workflow.
    ///
    /// # Errors
    /// Rejects unknown values and workflows with no cycling participants.
    pub fn next_status(&self, status: &str) -> Result<String, VaultBoundaryError> {
        self.inner
            .next_status(status)
            .map(str::to_owned)
            .map_err(VaultBoundaryError::from)
    }
}

#[cfg(test)]
mod tests {
    use super::{FfiVaultConfiguration, FfiVaultDocument, VaultBoundaryError};
    use tasknotes_vault::VaultError;

    #[test]
    fn native_document_interface_preserves_bytes_and_hashes()
    -> Result<(), Box<dyn std::error::Error>> {
        let bytes = b"---\nstatus: open\ncustom: '001'\n---\nbody".to_vec();
        let document = FfiVaultDocument::new("Tasks/a.md", bytes.clone())?;
        assert_eq!(document.body(), "body");
        assert_eq!(
            document.properties_json()?,
            r#"{"status":"open","custom":"001"}"#
        );
        let write = document.plan(r#"[{"kind":"set","key":"status","value":"done"}]"#, &None)?;
        assert_eq!(write.path, "Tasks/a.md");
        assert_eq!(write.expected_revision, document.revision());
        assert_ne!(write.revision, write.expected_revision);
        let updated = FfiVaultDocument::new(&write.path, write.bytes)?;
        assert_eq!(updated.revision(), write.revision);
        assert_eq!(updated.body(), "body");
        assert_eq!(document.plan("[]", &None)?.bytes, bytes);
        assert!(document.plan("invalid", &None).is_err());
        assert!(
            document
                .plan(r#"[{"kind":"remove","key":""}]"#, &None)
                .is_err()
        );
        assert_eq!(
            FfiVaultDocument::new("../escape", Vec::new()).err(),
            Some(VaultBoundaryError::Path)
        );
        Ok(())
    }

    #[test]
    fn native_configuration_interface_keeps_workflow_validation()
    -> Result<(), Box<dyn std::error::Error>> {
        assert!(FfiVaultConfiguration::new(&None, &None, false).is_err());
        let configuration = FfiVaultConfiguration::new(&None, &None, true)?;
        let json: serde_json::Value = serde_json::from_str(&configuration.configuration_json()?)?;
        assert_eq!(json.get("source"), Some(&serde_json::json!("standard")));
        assert!(configuration.is_completed("done")?);
        assert_eq!(configuration.next_status("open")?, "in-progress");
        assert!(configuration.is_completed("unknown").is_err());
        assert!(configuration.next_status("unknown").is_err());
        for error in [
            VaultError::Configuration("safe".to_owned()),
            VaultError::Document("safe".to_owned()),
            VaultError::Path,
            VaultError::Conflict,
        ] {
            assert_eq!(
                VaultBoundaryError::from(error.clone()).to_string(),
                error.to_string()
            );
        }
        Ok(())
    }
}
