//! Platform-independent logical vault paths.

use crate::{Result, VaultError};

/// A validated, slash-separated path relative to a vault.
///
/// Case and Unicode spelling are preserved. Logical Sync replicas may contain
/// names unavailable on a host filesystem; folder adapters must additionally
/// validate their own platform's capabilities before writing.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, serde::Serialize)]
#[serde(transparent)]
pub struct VaultPath(String);

impl VaultPath {
    /// Validate an external path without silently normalizing its identity.
    ///
    /// # Errors
    /// Rejects absolute paths, traversal, empty components, Windows separators,
    /// control characters, and drive-qualified paths.
    pub fn parse(value: &str) -> Result<Self> {
        if value.is_empty()
            || value.contains('\\')
            || value.chars().any(char::is_control)
            || value
                .split('/')
                .any(|part| part.is_empty() || part == "." || part == "..")
            || value
                .split('/')
                .next()
                .is_some_and(|part| part.contains(':'))
        {
            return Err(VaultError::Path);
        }
        Ok(Self(value.to_owned()))
    }

    /// Borrow the exact logical path.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }

    /// Filename without its Markdown suffix, for upstream display-title rules.
    #[must_use]
    pub fn markdown_stem(&self) -> &str {
        let filename = self.0.rsplit('/').next().unwrap_or_default();
        filename.strip_suffix(".md").unwrap_or(filename)
    }
}

impl<'de> serde::Deserialize<'de> for VaultPath {
    fn deserialize<D: serde::Deserializer<'de>>(
        deserializer: D,
    ) -> std::result::Result<Self, D::Error> {
        let value = String::deserialize(deserializer)?;
        Self::parse(&value).map_err(serde::de::Error::custom)
    }
}
