//! Token usage parsing and calculation from Claude CLI history files
//!
//! This module parses `.jsonl` history files created by Claude CLI to extract
//! token usage information from API responses. Each line in the history file
//! represents a turn in the conversation, and responses contain usage data.

use crate::pricing::{UsageData, calculate_cost};
use anyhow::{Context, Result};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::path::Path;
use tokio::fs;
use tokio::io::{AsyncBufReadExt, BufReader};
use typeshare::typeshare;

/// Token usage information for a single turn in a conversation
#[typeshare]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UsageTurn {
    pub turn_number: u32,
    pub model: String,
    pub input_tokens: u32,
    pub output_tokens: u32,
    pub cache_creation_tokens: u32,
    pub cache_read_tokens: u32,
    pub cost_usd: f64,
    pub timestamp: String,
}

/// Aggregated usage data for an entire session
#[derive(Debug, Clone, Default)]
pub struct SessionUsage {
    pub total_input_tokens: u32,
    pub total_output_tokens: u32,
    pub total_cached_input_tokens: u32,
    pub total_cost_usd: f64,
    pub turns: Vec<UsageTurn>,
}

/// Claude API response usage data structure
#[derive(Debug, Deserialize)]
struct ApiUsage {
    input_tokens: u64,
    output_tokens: u64,
    #[serde(default)]
    cache_creation_input_tokens: u64,
    #[serde(default)]
    cache_read_input_tokens: u64,
}

/// Claude API response structure (partial, only fields we need)
#[derive(Debug, Deserialize)]
struct ApiResponse {
    #[serde(rename = "type")]
    response_type: String,
    #[serde(default)]
    model: Option<String>,
    #[serde(default)]
    usage: Option<ApiUsage>,
}

/// History file line structure
#[derive(Debug, Deserialize)]
struct HistoryLine {
    #[serde(default)]
    result: Option<serde_json::Value>,
    #[serde(default)]
    timestamp: Option<String>,
}

/// Parse a Claude CLI history file and extract usage information
///
/// # Arguments
///
/// * `path` - Path to the `.jsonl` history file
///
/// # Returns
///
/// `SessionUsage` containing aggregated totals and per-turn breakdown
///
/// # Errors
///
/// Returns an error if:
/// - File cannot be read
/// - File size exceeds 50MB (safety limit)
/// - JSON parsing fails critically
pub async fn parse_history_file(path: &Path) -> Result<SessionUsage> {
    // Check if file exists
    if !path.exists() {
        tracing::debug!("History file does not exist: {}", path.display());
        return Ok(SessionUsage::default());
    }

    // Check file size (safety check for very large files)
    let metadata = fs::metadata(path)
        .await
        .context("Failed to read history file metadata")?;
    let file_size = metadata.len();

    if file_size > 50 * 1024 * 1024 {
        // 50MB limit
        tracing::warn!(
            file_size = file_size,
            path = %path.display(),
            "History file is very large (>50MB), this may take a while"
        );
    }

    if file_size == 0 {
        tracing::debug!("History file is empty: {}", path.display());
        return Ok(SessionUsage::default());
    }

    tracing::debug!(
        file_size = file_size,
        path = %path.display(),
        "Parsing history file"
    );

    let file = fs::File::open(path)
        .await
        .with_context(|| format!("Failed to open history file: {}", path.display()))?;
    let reader = BufReader::new(file);
    let mut lines = reader.lines();

    let mut turns = Vec::new();
    let mut turn_number = 0;
    let mut parse_errors = 0;
    const MAX_PARSE_ERRORS: usize = 10;

    while let Some(line) = lines.next_line().await? {
        if line.trim().is_empty() {
            continue;
        }

        turn_number += 1;

        // Parse the line as a history entry
        let history_line: HistoryLine = match serde_json::from_str(&line) {
            Ok(hl) => hl,
            Err(e) => {
                parse_errors += 1;
                if parse_errors <= MAX_PARSE_ERRORS {
                    tracing::debug!(
                        turn = turn_number,
                        error = %e,
                        "Failed to parse history line, skipping"
                    );
                }
                continue;
            }
        };

        // Extract the result field which contains the API response
        let result = match history_line.result {
            Some(r) => r,
            None => continue,
        };

        // Parse the API response
        let api_response: ApiResponse = match serde_json::from_value(result) {
            Ok(resp) => resp,
            Err(e) => {
                parse_errors += 1;
                if parse_errors <= MAX_PARSE_ERRORS {
                    tracing::debug!(
                        turn = turn_number,
                        error = %e,
                        "Failed to parse API response, skipping"
                    );
                }
                continue;
            }
        };

        // Only process "result" type responses (successful API calls)
        if api_response.response_type != "result" {
            continue;
        }

        // Extract usage data
        let usage = match api_response.usage {
            Some(u) => u,
            None => {
                tracing::trace!(turn = turn_number, "No usage data in response");
                continue;
            }
        };

        // Determine the model name
        let model = api_response.model.unwrap_or_else(|| "unknown".to_string());

        // Parse timestamp
        let timestamp = match history_line.timestamp {
            Some(ts) => DateTime::parse_from_rfc3339(&ts)
                .map(|dt| dt.with_timezone(&Utc).to_rfc3339())
                .unwrap_or_else(|_| Utc::now().to_rfc3339()),
            None => Utc::now().to_rfc3339(),
        };

        // Calculate cost for this turn
        let usage_data = UsageData {
            input_tokens: usage.input_tokens,
            output_tokens: usage.output_tokens,
            cache_creation_tokens: usage.cache_creation_input_tokens,
            cache_read_tokens: usage.cache_read_input_tokens,
        };
        let cost = calculate_cost(&model, &usage_data);

        turns.push(UsageTurn {
            turn_number,
            model,
            input_tokens: usage.input_tokens as u32,
            output_tokens: usage.output_tokens as u32,
            cache_creation_tokens: usage.cache_creation_input_tokens as u32,
            cache_read_tokens: usage.cache_read_input_tokens as u32,
            cost_usd: cost,
            timestamp,
        });
    }

    if parse_errors > MAX_PARSE_ERRORS {
        tracing::warn!(
            total_errors = parse_errors,
            shown_errors = MAX_PARSE_ERRORS,
            "Multiple parse errors occurred (showing first {} errors)",
            MAX_PARSE_ERRORS
        );
    }

    // Calculate aggregated totals
    let total_input_tokens = turns.iter().map(|t| t.input_tokens).sum();
    let total_output_tokens = turns.iter().map(|t| t.output_tokens).sum();
    let total_cached_input_tokens = turns
        .iter()
        .map(|t| t.cache_creation_tokens + t.cache_read_tokens)
        .sum();
    let total_cost_usd = turns.iter().map(|t| t.cost_usd).sum();

    tracing::info!(
        turn_count = turns.len(),
        total_input_tokens = total_input_tokens,
        total_output_tokens = total_output_tokens,
        total_cost_usd = %format!("{:.4}", total_cost_usd),
        "Parsed usage from history file"
    );

    Ok(SessionUsage {
        total_input_tokens,
        total_output_tokens,
        total_cached_input_tokens,
        total_cost_usd,
        turns,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::NamedTempFile;

    #[tokio::test]
    async fn test_parse_empty_file() {
        let temp_file = NamedTempFile::new().unwrap();
        let result = parse_history_file(temp_file.path()).await.unwrap();

        assert_eq!(result.total_input_tokens, 0);
        assert_eq!(result.total_output_tokens, 0);
        assert_eq!(result.total_cost_usd, 0.0);
        assert_eq!(result.turns.len(), 0);
    }

    #[tokio::test]
    async fn test_parse_nonexistent_file() {
        let result = parse_history_file(Path::new("/nonexistent/file.jsonl"))
            .await
            .unwrap();

        assert_eq!(result.total_input_tokens, 0);
        assert_eq!(result.turns.len(), 0);
    }

    #[tokio::test]
    async fn test_parse_single_turn() {
        let mut temp_file = NamedTempFile::new().unwrap();
        let history_data = r#"{"result":{"type":"result","model":"claude-sonnet-4-5","usage":{"input_tokens":1500,"output_tokens":800,"cache_creation_input_tokens":0,"cache_read_input_tokens":0}},"timestamp":"2026-01-18T10:00:00Z"}"#;
        writeln!(temp_file, "{}", history_data).unwrap();

        let result = parse_history_file(temp_file.path()).await.unwrap();

        assert_eq!(result.turns.len(), 1);
        assert_eq!(result.total_input_tokens, 1500);
        assert_eq!(result.total_output_tokens, 800);
        assert!(result.total_cost_usd > 0.0);

        let turn = &result.turns[0];
        assert_eq!(turn.turn_number, 1);
        assert_eq!(turn.model, "claude-sonnet-4-5");
        assert_eq!(turn.input_tokens, 1500);
        assert_eq!(turn.output_tokens, 800);
    }
}
