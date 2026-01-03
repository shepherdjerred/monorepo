//! Auth injection rules for various services.
//!
//! This module defines rules for injecting authentication headers into HTTP requests
//! proxied through clauderon. Two authentication patterns are supported:
//!
//! ## Authentication Encoding Types
//!
//! ### 1. Simple (Direct Format Substitution)
//! Used for REST APIs that accept the token as-is in the Authorization header.
//! The token is substituted directly into the format string.
//!
//! Examples:
//! - `"Bearer {}"` → `"Bearer ghp_token123"`
//! - `"Token token={}"` → `"Token token=pdkey123"`
//!
//! ### 2. BasicAuthWithToken (HTTP Basic Auth with x-access-token)
//! Used for git operations over HTTPS. Produces HTTP Basic Authentication with
//! `x-access-token` as the username and the token as the password.
//!
//! Format: `Basic base64("x-access-token:{token}")`
//!
//! Example:
//! - Token: `ghp_abc123`
//! - Encoded: `Basic eC1hY2Nlc3MtdG9rZW46Z2hwX2FiYzEyMw==`
//!
//! This encoding is required for git push/pull/clone operations to work when
//! HTTPS_PROXY is set. GitHub and other git hosts accept this format for
//! authenticating git operations over HTTPS.

use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};

/// How to encode the credential into the header value.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AuthEncoding {
    /// Simple string replacement (e.g., "Bearer {token}").
    Simple,
    /// HTTP Basic Auth with x-access-token username (e.g., base64("x-access-token:{token}")).
    BasicAuthWithToken,
}

/// Auth injection rule for a service.
#[derive(Debug, Clone)]
pub struct Rule {
    /// Host pattern to match (e.g., "api.github.com").
    pub host_pattern: &'static str,

    /// HTTP header name to inject (e.g., "Authorization").
    pub header_name: &'static str,

    /// Format string for the header value (e.g., "Bearer {}").
    /// Only used when encoding is Simple.
    pub format: &'static str,

    /// Credential key used to look up the token.
    pub credential_key: &'static str,

    /// How to encode the credential.
    pub encoding: AuthEncoding,
}

impl Rule {
    /// Check if this rule matches the given host.
    ///
    /// Wildcard patterns like `*.example.com` match subdomains (e.g., `api.example.com`)
    /// but NOT the apex domain itself (`example.com`). This is intentional - the pattern
    /// `*.example.com` becomes `.example.com` suffix match, so `example.com` won't match
    /// because it doesn't contain a leading dot.
    ///
    /// If you need to match both apex and subdomains, add two rules:
    /// - `*.example.com` for subdomains
    /// - `example.com` for the apex
    pub fn matches(&self, host: &str) -> bool {
        if self.host_pattern.starts_with('*') {
            // Wildcard prefix match (e.g., "*.docker.io" -> ".docker.io" suffix)
            // Note: This intentionally does NOT match the apex domain.
            let suffix = &self.host_pattern[1..];
            host.ends_with(suffix)
        } else {
            // Exact match
            host == self.host_pattern
        }
    }

    /// Format the credential into the header value.
    pub fn format_header(&self, token: &str) -> String {
        match self.encoding {
            AuthEncoding::Simple => self.format.replace("{}", token),
            AuthEncoding::BasicAuthWithToken => {
                // HTTP Basic Auth: base64("x-access-token:{token}")
                let credentials = format!("x-access-token:{}", token);
                let encoded = BASE64.encode(credentials.as_bytes());
                format!("Basic {}", encoded)
            }
        }
    }
}

/// All auth injection rules.
pub static RULES: &[Rule] = &[
    // GitHub API
    Rule {
        host_pattern: "api.github.com",
        header_name: "Authorization",
        format: "Bearer {}",
        credential_key: "github",
        encoding: AuthEncoding::Simple,
    },
    // GitHub git operations (uses HTTP Basic Auth with token)
    Rule {
        host_pattern: "github.com",
        header_name: "Authorization",
        format: "Basic {}",
        credential_key: "github",
        encoding: AuthEncoding::BasicAuthWithToken,
    },
    // Anthropic API (OAuth tokens only - uses Bearer auth)
    Rule {
        host_pattern: "api.anthropic.com",
        header_name: "Authorization",
        format: "Bearer {}",
        credential_key: "anthropic",
        encoding: AuthEncoding::Simple,
    },
    // PagerDuty API (uses "Token token=" format)
    Rule {
        host_pattern: "api.pagerduty.com",
        header_name: "Authorization",
        format: "Token token={}",
        credential_key: "pagerduty",
        encoding: AuthEncoding::Simple,
    },
    // Sentry API
    Rule {
        host_pattern: "sentry.io",
        header_name: "Authorization",
        format: "Bearer {}",
        credential_key: "sentry",
        encoding: AuthEncoding::Simple,
    },
    // npm registry
    Rule {
        host_pattern: "registry.npmjs.org",
        header_name: "Authorization",
        format: "Bearer {}",
        credential_key: "npm",
        encoding: AuthEncoding::Simple,
    },
    // Docker Hub registry
    Rule {
        host_pattern: "registry-1.docker.io",
        header_name: "Authorization",
        format: "Bearer {}",
        credential_key: "docker",
        encoding: AuthEncoding::Simple,
    },
    // Docker auth endpoint
    Rule {
        host_pattern: "auth.docker.io",
        header_name: "Authorization",
        format: "Bearer {}",
        credential_key: "docker",
        encoding: AuthEncoding::Simple,
    },
    // Grafana (specific instance only - don't use wildcard!)
    Rule {
        host_pattern: "grafana.tailnet-1a49.ts.net",
        header_name: "Authorization",
        format: "Bearer {}",
        credential_key: "grafana",
        encoding: AuthEncoding::Simple,
    },
];

/// Find the matching rule for a given host.
pub fn find_matching_rule(host: &str) -> Option<&'static Rule> {
    RULES.iter().find(|rule| rule.matches(host))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_github_rule_matches() {
        let rule = find_matching_rule("api.github.com");
        assert!(rule.is_some());
        let rule = rule.unwrap();
        assert_eq!(rule.header_name, "Authorization");
        assert_eq!(rule.encoding, AuthEncoding::Simple);
        assert_eq!(rule.format_header("ghp_test"), "Bearer ghp_test");
    }

    #[test]
    fn test_anthropic_uses_bearer_auth() {
        let rule = find_matching_rule("api.anthropic.com");
        assert!(rule.is_some());
        let rule = rule.unwrap();
        assert_eq!(rule.header_name, "Authorization");
        assert_eq!(rule.encoding, AuthEncoding::Simple);
        assert_eq!(
            rule.format_header("sk-ant-oat01-test"),
            "Bearer sk-ant-oat01-test"
        );
    }

    #[test]
    fn test_pagerduty_uses_token_format() {
        let rule = find_matching_rule("api.pagerduty.com");
        assert!(rule.is_some());
        let rule = rule.unwrap();
        assert_eq!(rule.encoding, AuthEncoding::Simple);
        assert_eq!(rule.format_header("pdkey"), "Token token=pdkey");
    }

    #[test]
    fn test_unknown_host_returns_none() {
        let rule = find_matching_rule("example.com");
        assert!(rule.is_none());
    }

    #[test]
    fn test_sentry_rule() {
        let rule = find_matching_rule("sentry.io");
        assert!(rule.is_some());
        let rule = rule.unwrap();
        assert_eq!(rule.credential_key, "sentry");
        assert_eq!(rule.encoding, AuthEncoding::Simple);
    }

    #[test]
    fn test_github_git_uses_basic_auth() {
        // Test that github.com (git operations) uses BasicAuthWithToken encoding
        let rule = find_matching_rule("github.com");
        assert!(rule.is_some());
        let rule = rule.unwrap();
        assert_eq!(rule.host_pattern, "github.com");
        assert_eq!(rule.header_name, "Authorization");
        assert_eq!(rule.encoding, AuthEncoding::BasicAuthWithToken);

        // Test that the formatted header is correct Basic Auth
        // For token "test-token", the expected format is:
        // Basic base64("x-access-token:test-token")
        let header = rule.format_header("test-token");
        assert!(header.starts_with("Basic "));

        // Verify the base64 encoding is correct
        // Expected: "x-access-token:test-token" base64 encoded
        let expected = "Basic eC1hY2Nlc3MtdG9rZW46dGVzdC10b2tlbg==";
        assert_eq!(header, expected);
    }

    #[test]
    fn test_basic_auth_with_token_encoding() {
        // Test BasicAuthWithToken encoding directly
        let rule = Rule {
            host_pattern: "test.example.com",
            header_name: "Authorization",
            format: "unused",
            credential_key: "test",
            encoding: AuthEncoding::BasicAuthWithToken,
        };

        // Test with various token formats
        assert_eq!(
            rule.format_header("ghp_1234567890"),
            "Basic eC1hY2Nlc3MtdG9rZW46Z2hwXzEyMzQ1Njc4OTA="
        );

        // Test with token containing special characters
        assert_eq!(
            rule.format_header("token-with-dashes_and_underscores"),
            "Basic eC1hY2Nlc3MtdG9rZW46dG9rZW4td2l0aC1kYXNoZXNfYW5kX3VuZGVyc2NvcmVz"
        );
    }

    #[test]
    fn test_github_api_vs_git_operations() {
        // Verify that api.github.com uses Bearer auth (Simple)
        let api_rule = find_matching_rule("api.github.com");
        assert!(api_rule.is_some());
        assert_eq!(api_rule.unwrap().encoding, AuthEncoding::Simple);

        // Verify that github.com uses Basic auth (BasicAuthWithToken)
        let git_rule = find_matching_rule("github.com");
        assert!(git_rule.is_some());
        assert_eq!(git_rule.unwrap().encoding, AuthEncoding::BasicAuthWithToken);
    }

    #[test]
    fn test_wildcard_matches_subdomains_not_apex() {
        let rule = Rule {
            host_pattern: "*.docker.io",
            header_name: "Authorization",
            format: "Bearer {}",
            credential_key: "docker",
            encoding: AuthEncoding::Simple,
        };

        // Subdomains should match
        assert!(rule.matches("registry-1.docker.io"));
        assert!(rule.matches("auth.docker.io"));
        assert!(rule.matches("foo.bar.docker.io"));

        // Apex domain should NOT match (intentional behavior)
        assert!(!rule.matches("docker.io"));
    }
}
