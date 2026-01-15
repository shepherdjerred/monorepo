//! 1Password CLI integration for secure credential retrieval.

use std::collections::HashMap;
use std::process::Stdio;

use anyhow::Context;
use serde::{Deserialize, Serialize};
use tracing::instrument;

/// Represents a parsed 1Password secret reference (op://vault/item/field).
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct OpReference {
    pub vault: String,
    pub item: String,
    pub field: String,
}

impl OpReference {
    /// Parse an op:// reference string.
    ///
    /// Expected format: `op://vault/item/field`
    ///
    /// # Examples
    ///
    /// ```
    /// # use clauderon::proxy::onepassword::OpReference;
    /// let op_ref = OpReference::parse("op://Production/GitHub/token").unwrap();
    /// assert_eq!(op_ref.vault, "Production");
    /// assert_eq!(op_ref.item, "GitHub");
    /// assert_eq!(op_ref.field, "token");
    /// ```
    pub fn parse(reference: &str) -> anyhow::Result<Self> {
        let reference = reference.trim();

        // Check prefix
        if !reference.starts_with("op://") {
            anyhow::bail!("Reference must start with 'op://': {reference}");
        }

        // Remove prefix
        let path = &reference[5..];

        // Split into parts
        let parts: Vec<&str> = path.split('/').collect();

        if parts.len() != 3 {
            anyhow::bail!("Reference must have format 'op://vault/item/field', got: {reference}");
        }

        // Validate parts are not empty
        if parts[0].is_empty() || parts[1].is_empty() || parts[2].is_empty() {
            anyhow::bail!("Vault, item, and field must not be empty: {reference}");
        }

        Ok(Self {
            vault: parts[0].to_string(),
            item: parts[1].to_string(),
            field: parts[2].to_string(),
        })
    }

    /// Convert to CLI arguments for `op item get`.
    ///
    /// Generates: `["item", "get", "vault/item", "--fields", "field", "--reveal"]`
    pub fn to_cli_args(&self) -> Vec<String> {
        vec![
            "item".to_string(),
            "get".to_string(),
            format!("{}/{}", self.vault, self.item),
            "--fields".to_string(),
            self.field.clone(),
            "--reveal".to_string(),
        ]
    }
}

/// Client for interacting with 1Password CLI.
pub struct OnePasswordClient {
    op_path: String,
}

impl OnePasswordClient {
    /// Create a new 1Password client.
    ///
    /// # Arguments
    ///
    /// * `op_path` - Path to the `op` CLI executable (usually just "op")
    pub fn new(op_path: String) -> Self {
        Self { op_path }
    }

    /// Check if `op` CLI is available.
    ///
    /// This runs `op --version` to verify the CLI is installed and executable.
    #[instrument(skip(self))]
    pub async fn is_available(&self) -> bool {
        let result = tokio::process::Command::new(&self.op_path)
            .arg("--version")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .await;

        match result {
            Ok(status) => {
                let available = status.success();
                tracing::debug!(available, "1Password CLI availability check");
                available
            }
            Err(e) => {
                tracing::debug!(error = %e, "1Password CLI not found");
                false
            }
        }
    }

    /// Fetch a single credential value from 1Password.
    ///
    /// This executes: `op item get vault/item --fields field --reveal`
    #[instrument(skip(self), fields(vault = %op_ref.vault, item = %op_ref.item, field = %op_ref.field))]
    pub async fn fetch_credential(&self, op_ref: &OpReference) -> anyhow::Result<String> {
        let args = op_ref.to_cli_args();

        tracing::debug!(command = ?args, "Fetching credential from 1Password");

        let output = tokio::process::Command::new(&self.op_path)
            .args(&args)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
            .await
            .with_context(|| {
                format!(
                    "Failed to execute op CLI command for {}/{}",
                    op_ref.vault, op_ref.item
                )
            })?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            anyhow::bail!(
                "Failed to fetch credential from 1Password: {}/{}:{} - {}",
                op_ref.vault,
                op_ref.item,
                op_ref.field,
                stderr.trim()
            );
        }

        let value = String::from_utf8(output.stdout)
            .context("Failed to parse op CLI output as UTF-8")?
            .trim()
            .to_string();

        if value.is_empty() {
            anyhow::bail!(
                "Credential value is empty for {}/{}:{}",
                op_ref.vault,
                op_ref.item,
                op_ref.field
            );
        }

        tracing::debug!("Successfully fetched credential from 1Password");
        Ok(value)
    }

    /// Batch fetch multiple credentials (pre-load at startup).
    ///
    /// This fetches all credentials in parallel for better performance.
    /// Errors for individual credentials are returned in the result map.
    #[instrument(skip(self, credentials), fields(credential_count = credentials.len()))]
    pub async fn fetch_all_credentials(
        &self,
        credentials: &HashMap<String, OpReference>,
    ) -> HashMap<String, anyhow::Result<String>> {
        tracing::info!("Fetching {} credentials from 1Password", credentials.len());

        let mut tasks = Vec::new();

        for (name, op_ref) in credentials {
            let name = name.clone();
            let op_ref = op_ref.clone();
            let client_path = self.op_path.clone();

            // Spawn a task for each credential fetch
            let task = tokio::spawn(async move {
                let client = OnePasswordClient::new(client_path);
                let result = client.fetch_credential(&op_ref).await;

                match &result {
                    Ok(_) => {
                        tracing::debug!(credential = %name, "Successfully loaded credential");
                    }
                    Err(e) => {
                        tracing::warn!(
                            credential = %name,
                            reference = %format!("op://{}/{}/{}", op_ref.vault, op_ref.item, op_ref.field),
                            error = %e,
                            "Failed to fetch credential from 1Password"
                        );
                    }
                }

                (name, result)
            });

            tasks.push(task);
        }

        // Wait for all tasks to complete
        let mut results = HashMap::new();
        for task in tasks {
            match task.await {
                Ok((name, result)) => {
                    results.insert(name, result);
                }
                Err(join_error) => {
                    tracing::error!(
                        error = %join_error,
                        "Task panicked while fetching credential from 1Password"
                    );
                }
            }
        }

        tracing::info!(
            "Fetched {}/{} credentials successfully",
            results.values().filter(|r| r.is_ok()).count(),
            results.len()
        );

        results
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_valid_op_reference() {
        let ref_str = "op://Production/GitHub/token";
        let op_ref = OpReference::parse(ref_str).unwrap();
        assert_eq!(op_ref.vault, "Production");
        assert_eq!(op_ref.item, "GitHub");
        assert_eq!(op_ref.field, "token");
    }

    #[test]
    fn test_parse_valid_op_reference_with_complex_names() {
        let ref_str = "op://My-Vault/My Item Name/my_field_123";
        let op_ref = OpReference::parse(ref_str).unwrap();
        assert_eq!(op_ref.vault, "My-Vault");
        assert_eq!(op_ref.item, "My Item Name");
        assert_eq!(op_ref.field, "my_field_123");
    }

    #[test]
    fn test_parse_valid_op_reference_with_whitespace() {
        let ref_str = "  op://Production/GitHub/token  ";
        let op_ref = OpReference::parse(ref_str).unwrap();
        assert_eq!(op_ref.vault, "Production");
        assert_eq!(op_ref.item, "GitHub");
        assert_eq!(op_ref.field, "token");
    }

    #[test]
    fn test_parse_invalid_op_reference_no_prefix() {
        let result = OpReference::parse("Production/GitHub/token");
        assert!(result.is_err());
        assert!(
            result
                .unwrap_err()
                .to_string()
                .contains("must start with 'op://'")
        );
    }

    #[test]
    fn test_parse_invalid_op_reference_wrong_prefix() {
        let result = OpReference::parse("http://Production/GitHub/token");
        assert!(result.is_err());
    }

    #[test]
    fn test_parse_invalid_op_reference_too_few_parts() {
        let result = OpReference::parse("op://Production/GitHub");
        assert!(result.is_err());
        assert!(
            result
                .unwrap_err()
                .to_string()
                .contains("must have format 'op://vault/item/field'")
        );
    }

    #[test]
    fn test_parse_invalid_op_reference_too_many_parts() {
        let result = OpReference::parse("op://Production/GitHub/token/extra");
        assert!(result.is_err());
    }

    #[test]
    fn test_parse_invalid_op_reference_empty_vault() {
        let result = OpReference::parse("op:///GitHub/token");
        assert!(result.is_err());
        assert!(
            result
                .unwrap_err()
                .to_string()
                .contains("must not be empty")
        );
    }

    #[test]
    fn test_parse_invalid_op_reference_empty_item() {
        let result = OpReference::parse("op://Production//token");
        assert!(result.is_err());
    }

    #[test]
    fn test_parse_invalid_op_reference_empty_field() {
        let result = OpReference::parse("op://Production/GitHub/");
        assert!(result.is_err());
    }

    #[test]
    fn test_to_cli_args() {
        let op_ref = OpReference {
            vault: "Production".to_string(),
            item: "GitHub".to_string(),
            field: "token".to_string(),
        };
        let args = op_ref.to_cli_args();
        assert_eq!(
            args,
            vec![
                "item",
                "get",
                "Production/GitHub",
                "--fields",
                "token",
                "--reveal"
            ]
        );
    }

    #[test]
    fn test_to_cli_args_with_spaces() {
        let op_ref = OpReference {
            vault: "My Vault".to_string(),
            item: "My Item".to_string(),
            field: "my_field".to_string(),
        };
        let args = op_ref.to_cli_args();
        assert_eq!(
            args,
            vec![
                "item",
                "get",
                "My Vault/My Item",
                "--fields",
                "my_field",
                "--reveal"
            ]
        );
    }

    #[test]
    fn test_op_reference_equality() {
        let ref1 = OpReference::parse("op://Production/GitHub/token").unwrap();
        let ref2 = OpReference::parse("op://Production/GitHub/token").unwrap();
        let ref3 = OpReference::parse("op://Production/GitHub/other").unwrap();

        assert_eq!(ref1, ref2);
        assert_ne!(ref1, ref3);
    }
}
