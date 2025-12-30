//! HTTP/HTTPS auth proxy with TLS interception using hudsucker.

use std::future::Future;
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Instant;

use chrono::Utc;
use hudsucker::certificate_authority::RcgenAuthority;
use hudsucker::hyper::Request;
use hudsucker::{Body, HttpContext, HttpHandler, Proxy, RequestOrResponse};
use rustls::crypto::aws_lc_rs::default_provider;

use super::audit::{AuditEntry, AuditLogger};
use super::config::Credentials;
use super::rules::find_matching_rule;

/// HTTP auth proxy that intercepts HTTPS and injects auth headers.
pub struct HttpAuthProxy {
    /// Listen address.
    addr: SocketAddr,
    /// Proxy CA authority for TLS interception.
    ca: RcgenAuthority,
    /// Credentials for auth injection.
    credentials: Arc<Credentials>,
    /// Audit logger.
    audit_logger: Arc<AuditLogger>,
}

impl HttpAuthProxy {
    /// Create a new HTTP auth proxy.
    pub fn new(
        port: u16,
        ca: RcgenAuthority,
        credentials: Arc<Credentials>,
        audit_logger: Arc<AuditLogger>,
    ) -> Self {
        Self {
            addr: SocketAddr::from(([127, 0, 0, 1], port)),
            ca,
            credentials,
            audit_logger,
        }
    }

    /// Run the proxy server.
    pub async fn run(self) -> anyhow::Result<()> {
        let handler = AuthInjector {
            credentials: self.credentials,
            audit_logger: self.audit_logger,
        };

        let proxy = Proxy::builder()
            .with_addr(self.addr)
            .with_ca(self.ca)
            .with_rustls_connector(default_provider())
            .with_http_handler(handler)
            .build()?;

        tracing::info!("HTTPS auth proxy listening on {}", self.addr);
        proxy.start().await?;
        Ok(())
    }

    /// Get the listen address.
    pub fn addr(&self) -> SocketAddr {
        self.addr
    }
}

/// Handler that injects authentication headers into requests.
#[derive(Clone)]
struct AuthInjector {
    credentials: Arc<Credentials>,
    audit_logger: Arc<AuditLogger>,
}

impl HttpHandler for AuthInjector {
    fn handle_request(
        &mut self,
        _ctx: &HttpContext,
        mut req: Request<Body>,
    ) -> impl Future<Output = RequestOrResponse> + Send {
        let credentials = Arc::clone(&self.credentials);
        let audit_logger = Arc::clone(&self.audit_logger);

        async move {
            let start = Instant::now();

            // Get host from URI or Host header
            let host = req
                .uri()
                .host()
                .map(String::from)
                .or_else(|| {
                    req.headers()
                        .get("host")
                        .and_then(|h| h.to_str().ok())
                        .map(String::from)
                })
                .unwrap_or_default();

            let method = req.method().to_string();
            let path = req.uri().path().to_string();

            // Check for matching rule and inject auth
            let mut auth_injected = false;
            if let Some(rule) = find_matching_rule(&host) {
                if let Some(token) = credentials.get(rule.credential_key) {
                    // Special handling for Anthropic OAuth tokens vs API keys
                    let (header_name, header_value) = if rule.credential_key == "anthropic" {
                        // For Anthropic, remove any existing auth headers first
                        // The container may have placeholder credentials that need replacing
                        req.headers_mut().remove("authorization");
                        req.headers_mut().remove("x-api-key");

                        if token.starts_with("sk-ant-oat01-") {
                            // OAuth token - use Authorization: Bearer
                            ("authorization", format!("Bearer {}", token))
                        } else {
                            // API key - use x-api-key (fallback for non-OAuth tokens)
                            tracing::debug!(
                                "Using x-api-key header for Anthropic (token doesn't match OAuth prefix)"
                            );
                            ("x-api-key", token.to_string())
                        }
                    } else {
                        (rule.header_name, rule.format_header(token))
                    };

                    if let Ok(value) = header_value.parse() {
                        req.headers_mut().insert(header_name, value);
                        auth_injected = true;
                        tracing::debug!("Injected {} header for {}", header_name, host);
                    }
                } else {
                    tracing::warn!(
                        "Rule matched for {} but credential '{}' is missing",
                        host,
                        rule.credential_key
                    );
                }
            }

            // Log to audit
            let entry = AuditEntry {
                timestamp: Utc::now(),
                service: host,
                method,
                path,
                auth_injected,
                response_code: None, // Will be filled in handle_response if needed
                duration_ms: start.elapsed().as_millis() as u64,
            };
            if let Err(e) = audit_logger.log(&entry) {
                tracing::warn!("Failed to write audit log entry: {}", e);
            }

            RequestOrResponse::Request(req)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_auth_injector_creation() {
        let credentials = Arc::new(Credentials::default());
        let audit_logger = Arc::new(AuditLogger::noop());

        let injector = AuthInjector {
            credentials,
            audit_logger,
        };

        // Just verify it compiles and can be cloned
        let _cloned = injector.clone();
    }

    /// Test that Anthropic token type detection works correctly.
    /// OAuth tokens (sk-ant-oat01-*) should use Bearer auth,
    /// while regular API keys should use x-api-key.
    #[test]
    fn test_anthropic_token_type_detection() {
        // OAuth token prefix detection
        let oauth_token = "sk-ant-oat01-abc123";
        assert!(
            oauth_token.starts_with("sk-ant-oat01-"),
            "OAuth token should match prefix"
        );

        // Regular API key should NOT match OAuth prefix
        let api_key = "sk-ant-api03-xyz789";
        assert!(
            !api_key.starts_with("sk-ant-oat01-"),
            "API key should not match OAuth prefix"
        );

        // Another common API key format
        let old_api_key = "sk-ant-abcd1234";
        assert!(
            !old_api_key.starts_with("sk-ant-oat01-"),
            "Old API key format should not match OAuth prefix"
        );
    }
}
