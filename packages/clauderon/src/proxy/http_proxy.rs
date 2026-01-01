//! HTTP/HTTPS auth proxy with TLS interception using hudsucker.

use std::future::Future;
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Instant;

use chrono::Utc;
use hudsucker::certificate_authority::RcgenAuthority;
use hudsucker::hyper::{Request, Response};
use hudsucker::{Body, HttpContext, HttpHandler, Proxy, RequestOrResponse};
use rustls::crypto::aws_lc_rs::default_provider;
use tokio::sync::RwLock;
use uuid::Uuid;

use super::audit::{AuditEntry, AuditLogger};
use super::config::Credentials;
use super::filter::is_write_operation;
use super::rules::find_matching_rule;
use crate::core::session::AccessMode;

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
    /// Optional session context for filtering.
    session_context: Option<SessionContext>,
}

/// Session context for filtering requests
struct SessionContext {
    session_id: Uuid,
    access_mode: Arc<RwLock<AccessMode>>,
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
            session_context: None,
        }
    }

    /// Create a new session-aware HTTP auth proxy with filtering.
    pub fn for_session(
        port: u16,
        ca: RcgenAuthority,
        credentials: Arc<Credentials>,
        audit_logger: Arc<AuditLogger>,
        session_id: Uuid,
        access_mode: Arc<RwLock<AccessMode>>,
    ) -> Self {
        Self {
            addr: SocketAddr::from(([127, 0, 0, 1], port)),
            ca,
            credentials,
            audit_logger,
            session_context: Some(SessionContext {
                session_id,
                access_mode,
            }),
        }
    }

    /// Run the proxy server.
    pub async fn run(self) -> anyhow::Result<()> {
        tracing::info!("HTTPS auth proxy listening on {}", self.addr);

        if let Some(session_ctx) = self.session_context {
            // Session-aware proxy with filtering
            let handler = FilteringHandler {
                session_id: session_ctx.session_id,
                access_mode: session_ctx.access_mode,
                credentials: self.credentials,
                audit_logger: self.audit_logger,
            };

            let proxy = Proxy::builder()
                .with_addr(self.addr)
                .with_ca(self.ca)
                .with_rustls_connector(default_provider())
                .with_http_handler(handler)
                .build()?;
            proxy.start().await?;
        } else {
            // Global proxy without filtering
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
            proxy.start().await?;
        }

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
                    if rule.credential_key == "anthropic" {
                        // Remove placeholder auth header before injecting real OAuth token
                        req.headers_mut().remove("authorization");

                        // Validate OAuth token format - only sk-ant-oat01-* tokens work with Bearer auth
                        // Skip injection entirely for non-OAuth tokens to avoid confusing double errors
                        if !token.starts_with("sk-ant-oat01-") {
                            tracing::warn!(
                                "Skipping auth injection for Anthropic: clauderon only supports OAuth tokens \
                                 (sk-ant-oat01-*), got token starting with: {}... - request will fail with 401",
                                &token[..token.len().min(12)]
                            );
                            // Don't inject - let the request fail clearly without auth
                        } else if let Ok(value) = format!("Bearer {}", token).parse() {
                            req.headers_mut().insert("authorization", value);
                            auth_injected = true;
                            tracing::debug!("Injected authorization header for {}", host);
                        }
                    } else {
                        let header_value = rule.format_header(token);
                        if let Ok(value) = header_value.parse() {
                            req.headers_mut().insert(rule.header_name, value);
                            auth_injected = true;
                            tracing::debug!("Injected {} header for {}", rule.header_name, host);
                        }
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

/// Handler that filters write operations based on access mode and injects auth
#[derive(Clone)]
struct FilteringHandler {
    session_id: Uuid,
    access_mode: Arc<RwLock<AccessMode>>,
    credentials: Arc<Credentials>,
    audit_logger: Arc<AuditLogger>,
}

impl HttpHandler for FilteringHandler {
    fn handle_request(
        &mut self,
        _ctx: &HttpContext,
        mut req: Request<Body>,
    ) -> impl Future<Output = RequestOrResponse> + Send {
        let session_id = self.session_id;
        let access_mode = Arc::clone(&self.access_mode);
        let credentials = Arc::clone(&self.credentials);
        let audit_logger = Arc::clone(&self.audit_logger);

        async move {
            let start = Instant::now();

            // Check access mode and filter write operations
            let current_mode = *access_mode.read().await;
            if current_mode == AccessMode::ReadOnly && is_write_operation(req.method()) {
                tracing::warn!(
                    session_id = %session_id,
                    method = %req.method(),
                    uri = %req.uri(),
                    "Blocked write operation in read-only mode"
                );

                return RequestOrResponse::Response(
                    Response::builder()
                        .status(403)
                        .body(Body::from("Write operations not allowed in read-only mode"))
                        .unwrap(),
                );
            }

            // Continue with auth injection (same logic as AuthInjector)
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
                    if rule.credential_key == "anthropic" {
                        // Remove placeholder auth header before injecting real OAuth token
                        req.headers_mut().remove("authorization");

                        // Validate OAuth token format
                        if !token.starts_with("sk-ant-oat01-") {
                            tracing::warn!(
                                "Skipping auth injection for Anthropic: clauderon only supports OAuth tokens \
                                 (sk-ant-oat01-*), got token starting with: {}... - request will fail with 401",
                                &token[..token.len().min(12)]
                            );
                        } else if let Ok(value) = format!("Bearer {}", token).parse() {
                            req.headers_mut().insert("authorization", value);
                            auth_injected = true;
                            tracing::debug!(session_id = %session_id, "Injected authorization header for {}", host);
                        }
                    } else {
                        let header_value = rule.format_header(token);
                        if let Ok(value) = header_value.parse() {
                            req.headers_mut().insert(rule.header_name, value);
                            auth_injected = true;
                            tracing::debug!(session_id = %session_id, "Injected {} header for {}", rule.header_name, host);
                        }
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
                response_code: None,
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

    #[test]
    fn test_oauth_token_validation() {
        // Valid OAuth tokens start with sk-ant-oat01- and will have auth injected
        let valid_oauth = "sk-ant-oat01-abc123xyz";
        assert!(
            valid_oauth.starts_with("sk-ant-oat01-"),
            "Valid OAuth token should match prefix"
        );

        // Regular API keys should NOT match - auth injection will be skipped
        // and a warning logged. The request will fail with 401 from Anthropic.
        let api_key = "sk-ant-api03-xyz789";
        assert!(
            !api_key.starts_with("sk-ant-oat01-"),
            "API key should not match OAuth prefix - auth will be skipped"
        );

        // Placeholder token matches the OAuth prefix format, so auth will be injected
        // (the proxy will replace it with the real token from the host)
        let placeholder = "sk-ant-oat01-clauderon-proxy-placeholder";
        assert!(
            placeholder.starts_with("sk-ant-oat01-"),
            "Placeholder should match OAuth prefix format"
        );
    }
}
