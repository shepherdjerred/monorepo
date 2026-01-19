//! Token pricing and cost calculation
//!
//! This module handles token pricing for different Claude models.
//! Prices are hardcoded with version tracking to detect staleness.

use std::collections::HashMap;

pub const PRICING_VERSION: &str = "2026-01";
pub const PRICING_EFFECTIVE_DATE: &str = "2026-01-01";

/// Pricing for a single model (per million tokens)
#[derive(Debug, Clone)]
pub struct ModelPricing {
    /// Input cost per million tokens
    pub input_per_mtok: f64,
    /// Output cost per million tokens
    pub output_per_mtok: f64,
    /// Cache write cost per million tokens (usually 25% of input)
    pub cache_write_per_mtok: f64,
    /// Cache read cost per million tokens (usually 10% of input, 90% discount)
    pub cache_read_per_mtok: f64,
}

/// Token usage data for cost calculation
#[derive(Debug, Clone)]
pub struct UsageData {
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_creation_tokens: u64,
    pub cache_read_tokens: u64,
}

/// Get pricing for a specific model
pub fn get_model_pricing(model: &str) -> Option<&'static ModelPricing> {
    PRICING_TABLE.get(model)
}

/// Calculate cost for a model and usage data
pub fn calculate_cost(model: &str, usage: &UsageData) -> f64 {
    match get_model_pricing(model) {
        Some(pricing) => {
            let input_cost = (usage.input_tokens as f64 / 1_000_000.0) * pricing.input_per_mtok;
            let output_cost = (usage.output_tokens as f64 / 1_000_000.0) * pricing.output_per_mtok;
            let cache_write_cost =
                (usage.cache_creation_tokens as f64 / 1_000_000.0) * pricing.cache_write_per_mtok;
            let cache_read_cost =
                (usage.cache_read_tokens as f64 / 1_000_000.0) * pricing.cache_read_per_mtok;

            input_cost + output_cost + cache_write_cost + cache_read_cost
        }
        None => 0.0, // Unknown models cost nothing (graceful degradation)
    }
}

lazy_static::lazy_static! {
    static ref PRICING_TABLE: HashMap<&'static str, ModelPricing> = {
        let mut m = HashMap::new();

        // Claude Opus 4.5 - $5 input / $25 output
        m.insert(
            "claude-opus-4-5",
            ModelPricing {
                input_per_mtok: 5.0,
                output_per_mtok: 25.0,
                cache_write_per_mtok: 1.25,    // 25% of input
                cache_read_per_mtok: 0.5,      // 10% of input (90% discount)
            },
        );

        // Claude Sonnet 4.5 - $3 input / $15 output
        m.insert(
            "claude-sonnet-4-5",
            ModelPricing {
                input_per_mtok: 3.0,
                output_per_mtok: 15.0,
                cache_write_per_mtok: 0.75,    // 25% of input
                cache_read_per_mtok: 0.3,      // 10% of input
            },
        );

        // Claude Haiku 4.5 - $1 input / $5 output
        m.insert(
            "claude-haiku-4-5",
            ModelPricing {
                input_per_mtok: 1.0,
                output_per_mtok: 5.0,
                cache_write_per_mtok: 0.25,    // 25% of input
                cache_read_per_mtok: 0.1,      // 10% of input
            },
        );

        // Legacy names
        m.insert(
            "claude-opus-4",
            ModelPricing {
                input_per_mtok: 5.0,
                output_per_mtok: 25.0,
                cache_write_per_mtok: 1.25,
                cache_read_per_mtok: 0.5,
            },
        );

        m.insert(
            "claude-sonnet-4",
            ModelPricing {
                input_per_mtok: 3.0,
                output_per_mtok: 15.0,
                cache_write_per_mtok: 0.75,
                cache_read_per_mtok: 0.3,
            },
        );

        m
    };
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_calculate_cost_sonnet() {
        let usage = UsageData {
            input_tokens: 1_000_000,
            output_tokens: 500_000,
            cache_creation_tokens: 0,
            cache_read_tokens: 0,
        };

        let cost = calculate_cost("claude-sonnet-4-5", &usage);
        // 1M input @ $3/M + 0.5M output @ $15/M = $3 + $7.50 = $10.50
        assert!((cost - 10.5).abs() < 0.01);
    }

    #[test]
    fn test_calculate_cost_with_cache() {
        let usage = UsageData {
            input_tokens: 1_000_000,
            output_tokens: 500_000,
            cache_creation_tokens: 500_000,
            cache_read_tokens: 2_000_000,
        };

        let cost = calculate_cost("claude-sonnet-4-5", &usage);
        // input: $3, output: $7.50, cache_write: $0.375, cache_read: $0.60 = $11.475
        assert!((cost - 11.475).abs() < 0.01);
    }

    #[test]
    fn test_unknown_model_costs_nothing() {
        let usage = UsageData {
            input_tokens: 1_000_000,
            output_tokens: 500_000,
            cache_creation_tokens: 0,
            cache_read_tokens: 0,
        };

        let cost = calculate_cost("unknown-model-xyz", &usage);
        assert_eq!(cost, 0.0);
    }
}
