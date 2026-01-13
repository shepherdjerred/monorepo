//! Client for interacting with Claude.ai APIs

use anyhow::{Context, Result};
use chrono::Utc;
use reqwest::Client;
use serde::Deserialize;
use std::time::Duration;
use tracing::instrument;

/// Response from Claude.ai organization info endpoint
#[derive(Debug, Deserialize)]
struct OrganizationInfo {
    uuid: String,
    name: Option<String>,
}

/// Response from Claude.ai current account endpoint
#[derive(Debug, Deserialize)]
struct CurrentAccountResponse {
    organization: Option<OrganizationInfo>,
}

/// Response from Claude.ai usage endpoint
#[derive(Debug, Deserialize)]
struct ClaudeUsageResponse {
    five_hour: Option<UsageData>,
    seven_day: Option<UsageData>,
    seven_day_sonnet: Option<UsageData>,
}

#[derive(Debug, Deserialize)]
struct UsageData {
    #[serde(default)]
    current: f64,
    #[serde(default = "default_limit")]
    limit: f64,
    #[serde(default)]
    utilization: f64,
    resets_at: Option<String>,
}

fn default_limit() -> f64 {
    100.0
}

/// Client for Claude.ai API operations
pub struct ClaudeApiClient {
    http_client: Client,
    base_url: String,
}

impl ClaudeApiClient {
    /// Create a new Claude.ai API client
    pub fn new() -> Self {
        let http_client = Client::builder()
            .timeout(Duration::from_secs(10))
            .build()
            .expect("Failed to create HTTP client");

        Self {
            http_client,
            base_url: "https://claude.ai".to_string(),
        }
    }

    /// Get current account and organization information
    #[instrument(skip(self, oauth_token))]
    pub async fn get_current_account(&self, oauth_token: &str) -> Result<(String, Option<String>)> {
        let url = format!("{}/api/auth/current_account", self.base_url);

        let response = self
            .http_client
            .get(&url)
            .header("Authorization", format!("Bearer {}", oauth_token))
            .header(
                "User-Agent",
                format!("Clauderon/{}", env!("CARGO_PKG_VERSION")),
            )
            .send()
            .await
            .context("Failed to fetch current account from Claude.ai")?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_else(|_| String::new());
            anyhow::bail!("Claude.ai API returned error: {} - {}", status, body);
        }

        let account: CurrentAccountResponse = response
            .json::<CurrentAccountResponse>()
            .await
            .context("Failed to parse current account response")?;

        let org = account
            .organization
            .ok_or_else(|| anyhow::anyhow!("No organization found in account response"))?;

        tracing::info!(
            org_id = %org.uuid,
            org_name = ?org.name,
            "Retrieved organization info from Claude.ai"
        );

        Ok((org.uuid, org.name))
    }

    /// Get Claude Code usage data for an organization
    #[instrument(skip(self, oauth_token), fields(org_id = %org_id))]
    pub async fn get_usage(
        &self,
        oauth_token: &str,
        org_id: &str,
    ) -> Result<crate::api::protocol::ClaudeUsage> {
        let url = format!("{}/api/organizations/{}/usage", self.base_url, org_id);

        let response = self
            .http_client
            .get(&url)
            .header("Authorization", format!("Bearer {}", oauth_token))
            .header(
                "User-Agent",
                format!("Clauderon/{}", env!("CARGO_PKG_VERSION")),
            )
            .send()
            .await
            .with_context(|| format!("Failed to fetch usage from Claude.ai for org {}", org_id))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_else(|_| String::new());
            anyhow::bail!("Claude.ai usage API returned error: {} - {}", status, body);
        }

        let usage_response: ClaudeUsageResponse = response
            .json::<ClaudeUsageResponse>()
            .await
            .context("Failed to parse usage response")?;

        let now = Utc::now().to_rfc3339();

        // Calculate utilization if not provided
        let five_hour = usage_response
            .five_hour
            .ok_or_else(|| anyhow::anyhow!("Missing five_hour usage data in API response"))?;

        let seven_day = usage_response
            .seven_day
            .ok_or_else(|| anyhow::anyhow!("Missing seven_day usage data in API response"))?;

        Ok(crate::api::protocol::ClaudeUsage {
            organization_id: org_id.to_string(),
            organization_name: None, // Will be filled by caller if available
            five_hour: crate::api::protocol::UsageWindow {
                current: five_hour.current,
                limit: five_hour.limit,
                utilization: if five_hour.utilization > 0.0 {
                    five_hour.utilization / 100.0 // API returns percentage, we want 0.0-1.0
                } else if five_hour.limit > 0.0 {
                    five_hour.current / five_hour.limit
                } else {
                    0.0
                },
                resets_at: five_hour.resets_at,
            },
            seven_day: crate::api::protocol::UsageWindow {
                current: seven_day.current,
                limit: seven_day.limit,
                utilization: if seven_day.utilization > 0.0 {
                    seven_day.utilization / 100.0 // API returns percentage, we want 0.0-1.0
                } else if seven_day.limit > 0.0 {
                    seven_day.current / seven_day.limit
                } else {
                    0.0
                },
                resets_at: seven_day.resets_at,
            },
            seven_day_sonnet: usage_response.seven_day_sonnet.map(|s| {
                crate::api::protocol::UsageWindow {
                    current: s.current,
                    limit: s.limit,
                    utilization: if s.utilization > 0.0 {
                        s.utilization / 100.0 // API returns percentage, we want 0.0-1.0
                    } else if s.limit > 0.0 {
                        s.current / s.limit
                    } else {
                        0.0
                    },
                    resets_at: s.resets_at,
                }
            }),
            fetched_at: now,
        })
    }
}

impl Default for ClaudeApiClient {
    fn default() -> Self {
        Self::new()
    }
}
