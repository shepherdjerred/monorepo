//! Auth injection rules for various services.

/// Auth injection rule for a service.
#[derive(Debug, Clone)]
pub struct Rule {
    /// Host pattern to match (e.g., "api.github.com").
    pub host_pattern: &'static str,

    /// HTTP header name to inject (e.g., "Authorization").
    pub header_name: &'static str,

    /// Format string for the header value (e.g., "Bearer {}").
    pub format: &'static str,

    /// Credential key used to look up the token.
    pub credential_key: &'static str,
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
        self.format.replace("{}", token)
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
    },
    // Anthropic API
    // NOTE: This rule's header_name and format are OVERRIDDEN at runtime in http_proxy.rs
    // for Anthropic specifically. The proxy detects OAuth tokens (sk-ant-oat01-*) and uses
    // Authorization: Bearer, while regular API keys use x-api-key header instead.
    // This rule exists primarily for host matching and credential_key lookup.
    Rule {
        host_pattern: "api.anthropic.com",
        header_name: "Authorization",
        format: "Bearer {}",
        credential_key: "anthropic",
    },
    // Anthropic Console (OAuth validation - uses Bearer)
    Rule {
        host_pattern: "console.anthropic.com",
        header_name: "Authorization",
        format: "Bearer {}",
        credential_key: "anthropic",
    },
    // PagerDuty API (uses "Token token=" format)
    Rule {
        host_pattern: "api.pagerduty.com",
        header_name: "Authorization",
        format: "Token token={}",
        credential_key: "pagerduty",
    },
    // Sentry API
    Rule {
        host_pattern: "sentry.io",
        header_name: "Authorization",
        format: "Bearer {}",
        credential_key: "sentry",
    },
    // npm registry
    Rule {
        host_pattern: "registry.npmjs.org",
        header_name: "Authorization",
        format: "Bearer {}",
        credential_key: "npm",
    },
    // Docker Hub registry
    Rule {
        host_pattern: "registry-1.docker.io",
        header_name: "Authorization",
        format: "Bearer {}",
        credential_key: "docker",
    },
    // Docker auth endpoint
    Rule {
        host_pattern: "auth.docker.io",
        header_name: "Authorization",
        format: "Bearer {}",
        credential_key: "docker",
    },
    // Grafana (specific instance only - don't use wildcard!)
    Rule {
        host_pattern: "grafana.tailnet-1a49.ts.net",
        header_name: "Authorization",
        format: "Bearer {}",
        credential_key: "grafana",
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
        assert_eq!(rule.format_header("ghp_test"), "Bearer ghp_test");
    }

    #[test]
    fn test_anthropic_uses_bearer_auth() {
        let rule = find_matching_rule("api.anthropic.com");
        assert!(rule.is_some());
        let rule = rule.unwrap();
        assert_eq!(rule.header_name, "Authorization");
        assert_eq!(rule.format_header("sk-ant-oat01-test"), "Bearer sk-ant-oat01-test");
    }

    #[test]
    fn test_pagerduty_uses_token_format() {
        let rule = find_matching_rule("api.pagerduty.com");
        assert!(rule.is_some());
        let rule = rule.unwrap();
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
    }

    #[test]
    fn test_wildcard_matches_subdomains_not_apex() {
        let rule = Rule {
            host_pattern: "*.docker.io",
            header_name: "Authorization",
            format: "Bearer {}",
            credential_key: "docker",
        };

        // Subdomains should match
        assert!(rule.matches("registry-1.docker.io"));
        assert!(rule.matches("auth.docker.io"));
        assert!(rule.matches("foo.bar.docker.io"));

        // Apex domain should NOT match (intentional behavior)
        assert!(!rule.matches("docker.io"));
    }
}
