//! HTTP/HTTPS auth proxy with TLS interception using hudsucker.

use std::future::Future;
use std::net::SocketAddr;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Instant;

use chrono::{DateTime, Utc};
use http_body_util::BodyExt;
use hudsucker::certificate_authority::RcgenAuthority;
use hudsucker::hyper::{Method, Request, Response};
use hudsucker::hyper_util::client::legacy::Error as ClientError;
use hudsucker::{Body, HttpContext, HttpHandler, Proxy, RequestOrResponse};
use rustls::crypto::aws_lc_rs::default_provider;
use serde::Deserialize;
use serde_json::Value;
use tokio::sync::RwLock;
use uuid::Uuid;

use super::audit::{AuditEntry, AuditLogger};
use super::config::{CodexTokenUpdate, Credentials};
use super::filter::is_write_operation;
use super::rules::find_matching_rule;
use crate::core::session::AccessMode;
use crate::proxy::codex::{DUMMY_ACCESS_TOKEN, DUMMY_REFRESH_TOKEN, dummy_id_token};

/// Check if a request is to a Kubernetes API based on host pattern.
fn is_k8s_request(host: &str) -> bool {
    // Match kubernetes API hosts
    host.contains("kubernetes")
        || host.contains("k8s.io")
        || host == "kubernetes.default.svc"
        || host.ends_with(".svc.cluster.local")
}

/// Check if a K8s API request is a write operation based on HTTP method.
/// K8s write operations include POST, PUT, PATCH, DELETE.
fn is_k8s_write_operation(method: &hyper::Method) -> bool {
    matches!(
        *method,
        hyper::Method::POST | hyper::Method::PUT | hyper::Method::PATCH | hyper::Method::DELETE
    )
}

fn normalize_host(host: &str) -> &str {
    host.split(':').next().unwrap_or(host)
}

fn is_chatgpt_host(host: &str) -> bool {
    let host = normalize_host(host);
    host == "chatgpt.com"
        || host.ends_with(".chatgpt.com")
        || host == "chat.openai.com"
        || host.ends_with(".chat.openai.com")
}

fn is_refresh_request(host: &str, path: &str, method: &Method) -> bool {
    normalize_host(host) == "auth.openai.com" && path == "/oauth/token" && *method == Method::POST
}

#[derive(Deserialize)]
struct RefreshResponse {
    id_token: Option<String>,
    access_token: Option<String>,
    refresh_token: Option<String>,
}

async fn rewrite_refresh_request(
    req: &mut Request<Body>,
    credentials: &Credentials,
) -> Result<(), Response<Body>> {
    let Some(refresh_token) = credentials.codex_refresh_token() else {
        return Err(build_error_response("MISSING_CODEX_REFRESH_TOKEN"));
    };

    let body = std::mem::replace(req.body_mut(), Body::empty());
    let collected = body
        .collect()
        .await
        .map_err(|_| build_error_response("INVALID_REFRESH_BODY"))?;
    let body_bytes = collected.to_bytes();
    let mut json: Value = serde_json::from_slice(&body_bytes)
        .map_err(|_| build_error_response("INVALID_REFRESH_PAYLOAD"))?;

    let Some(token_value) = json.get_mut("refresh_token") else {
        return Err(build_error_response("MISSING_REFRESH_TOKEN_FIELD"));
    };
    *token_value = Value::String(refresh_token);

    let updated_body =
        serde_json::to_vec(&json).map_err(|_| build_error_response("INVALID_REFRESH_PAYLOAD"))?;
    let updated_body = String::from_utf8(updated_body).unwrap_or_default();
    *req.body_mut() = Body::from(updated_body);
    Ok(())
}

async fn rewrite_refresh_response(
    res: Response<Body>,
    credentials: &Credentials,
) -> Response<Body> {
    let (parts, body) = res.into_parts();
    let collected = match body.collect().await {
        Ok(collected) => collected,
        Err(_) => return Response::from_parts(parts, Body::from("")),
    };
    let body_bytes = collected.to_bytes();

    if !parts.status.is_success() {
        let body_string = String::from_utf8_lossy(&body_bytes).into_owned();
        return Response::from_parts(parts, Body::from(body_string));
    }

    let parsed: RefreshResponse = match serde_json::from_slice(&body_bytes) {
        Ok(parsed) => parsed,
        Err(_) => {
            let body_string = String::from_utf8_lossy(&body_bytes).into_owned();
            return Response::from_parts(parts, Body::from(body_string));
        }
    };

    credentials.update_codex_tokens(CodexTokenUpdate {
        access_token: parsed.access_token,
        refresh_token: parsed.refresh_token,
        id_token: parsed.id_token,
        account_id: None,
    });

    let dummy_body = serde_json::json!({
        "access_token": DUMMY_ACCESS_TOKEN,
        "refresh_token": DUMMY_REFRESH_TOKEN,
        "id_token": dummy_id_token(credentials.codex_account_id().as_deref()),
    });
    let dummy_bytes = serde_json::to_vec(&dummy_body).unwrap_or_else(|_| b"{}".to_vec());
    let dummy_body = String::from_utf8(dummy_bytes).unwrap_or_else(|_| "{}".to_string());

    // Remove Content-Length header since we've replaced the body
    let mut parts = parts;
    parts.headers.remove(hyper::header::CONTENT_LENGTH);

    Response::from_parts(parts, Body::from(dummy_body))
}

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
                pending_request: None,
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
                pending_request: None,
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
    #[must_use]
    pub fn addr(&self) -> SocketAddr {
        self.addr
    }
}

/// Pending request data for timing correlation.
#[derive(Debug, Clone)]
struct PendingRequest {
    request_id: Uuid,
    start_time: Instant,
    timestamp: DateTime<Utc>,
    service: String,
    method: String,
    path: String,
    /// Shared atomic flag that can be updated from async block and read from response handler.
    auth_injected: Arc<AtomicBool>,
    auth_refresh: bool,
}

/// Classify client errors into specific types for debugging.
fn classify_client_error(err: &ClientError) -> &'static str {
    let error_str = err.to_string().to_lowercase();

    if error_str.contains("dns") || error_str.contains("resolve") {
        "DNS_RESOLUTION_FAILURE"
    } else if error_str.contains("connect") || error_str.contains("connection refused") {
        "CONNECTION_REFUSED"
    } else if error_str.contains("timeout") {
        "CONNECTION_TIMEOUT"
    } else if error_str.contains("certificate") || error_str.contains("tls") {
        "TLS_CERTIFICATE_ERROR"
    } else {
        "UNKNOWN_ERROR"
    }
}

/// Build an error response with proper fallback handling.
fn build_error_response(error_type: &'static str) -> Response<Body> {
    Response::builder()
        .status(502)
        .header("X-Proxy-Error-Type", error_type)
        .body(Body::from(format!(
            "Proxy error: {}",
            error_type.replace('_', " ").to_lowercase()
        )))
        .expect("Failed to build error response")
}

/// Handler that injects authentication headers into requests.
/// Each handler instance handles exactly one request-response pair.
#[derive(Clone)]
struct AuthInjector {
    credentials: Arc<Credentials>,
    audit_logger: Arc<AuditLogger>,
    pending_request: Option<PendingRequest>,
}

impl HttpHandler for AuthInjector {
    fn handle_request(
        &mut self,
        _ctx: &HttpContext,
        mut req: Request<Body>,
    ) -> impl Future<Output = RequestOrResponse> + Send {
        let credentials = Arc::clone(&self.credentials);

        // Capture timing and request metadata synchronously before async work
        let request_id = Uuid::new_v4();
        let start_time = Instant::now();
        let timestamp = Utc::now();

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
        let version = req.version();
        let host_match = normalize_host(&host).to_string();

        // Determine if this is a refresh request (needed for response rewriting)
        let auth_refresh = is_refresh_request(&host_match, &path, req.method());

        tracing::debug!(
            request_id = %request_id,
            host = %host_match,
            method = %method,
            path = %path,
            version = ?version,
            "Proxying request"
        );

        // Create shared atomic flag for auth_injected that can be updated from async block
        let auth_injected_flag = Arc::new(AtomicBool::new(false));
        let auth_injected_for_async = Arc::clone(&auth_injected_flag);

        // Store pending request for correlation with response
        self.pending_request = Some(PendingRequest {
            request_id,
            start_time,
            timestamp,
            service: host_match.clone(),
            method,
            path,
            auth_injected: auth_injected_flag,
            auth_refresh,
        });

        async move {
            // Check for matching rule and inject auth
            if auth_refresh {
                match rewrite_refresh_request(&mut req, &credentials).await {
                    Ok(()) => {
                        auth_injected_for_async.store(true, Ordering::SeqCst);
                    }
                    Err(response) => return RequestOrResponse::Response(response),
                }
            }

            if let Some(rule) = find_matching_rule(&host_match) {
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
                        } else if let Ok(value) = format!("Bearer {token}").parse() {
                            req.headers_mut().insert("authorization", value);
                            auth_injected_for_async.store(true, Ordering::SeqCst);
                            tracing::debug!("Injected authorization header for {}", host);
                        }
                    } else {
                        let header_value = rule.format_header(&token);
                        if let Ok(value) = header_value.parse() {
                            req.headers_mut().insert(rule.header_name, value);
                            auth_injected_for_async.store(true, Ordering::SeqCst);
                            tracing::debug!(
                                "Injected {} header for {}",
                                rule.header_name,
                                host_match
                            );
                        }
                    }
                } else {
                    tracing::debug!(
                        "Rule matched for {} but credential '{}' is missing",
                        host_match,
                        rule.credential_key
                    );
                }
            }

            if is_chatgpt_host(&host_match) {
                if let Some(account_id) = credentials.codex_account_id() {
                    if let Ok(value) = account_id.parse() {
                        req.headers_mut().insert("ChatGPT-Account-ID", value);
                        auth_injected_for_async.store(true, Ordering::SeqCst);
                    }
                }
            }

            RequestOrResponse::Request(req)
        }
    }

    fn handle_response(
        &mut self,
        _ctx: &HttpContext,
        res: Response<Body>,
    ) -> impl Future<Output = Response<Body>> + Send {
        // Take pending request synchronously - guaranteed to exist since same handler
        // instance handles both request and response
        let pending = self.pending_request.take();
        let audit_logger = Arc::clone(&self.audit_logger);
        let credentials = Arc::clone(&self.credentials);

        async move {
            let status = res.status();
            let mut should_rewrite_refresh = false;

            if let Some(pending) = pending {
                let duration_ms = pending.start_time.elapsed().as_millis() as u64;
                should_rewrite_refresh = pending.auth_refresh;

                tracing::debug!(
                    request_id = %pending.request_id,
                    host = %pending.service,
                    status = %status,
                    duration_ms = duration_ms,
                    "Response received from upstream"
                );

                // Log complete audit entry with timing
                let entry = AuditEntry {
                    timestamp: pending.timestamp,
                    correlation_id: Some(pending.request_id),
                    session_id: None,
                    service: pending.service,
                    method: pending.method,
                    path: pending.path,
                    auth_injected: pending.auth_injected.load(Ordering::SeqCst),
                    response_code: Some(status.as_u16()),
                    duration_ms,
                };

                if let Err(e) = audit_logger.log(&entry) {
                    tracing::warn!("Failed to write audit log entry: {}", e);
                }

                // Log warning for server errors
                if status.is_server_error() {
                    tracing::warn!(
                        status = %status,
                        "Upstream server error (5xx)"
                    );
                }
            } else {
                // This shouldn't happen - same handler instance handles request and response
                tracing::debug!(
                    status = %status,
                    "Response received but no pending request (handler may have been cloned)"
                );
            }

            if should_rewrite_refresh {
                return rewrite_refresh_response(res, &credentials).await;
            }

            res
        }
    }

    fn handle_error(
        &mut self,
        _ctx: &HttpContext,
        err: ClientError,
    ) -> impl Future<Output = Response<Body>> + Send {
        // Take pending request synchronously
        let pending = self.pending_request.take();
        let audit_logger = Arc::clone(&self.audit_logger);

        async move {
            let error_type = classify_client_error(&err);

            if let Some(pending) = pending {
                let duration_ms = pending.start_time.elapsed().as_millis() as u64;

                // Log full error details for debugging (not sent to client)
                tracing::error!(
                    request_id = %pending.request_id,
                    host = %pending.service,
                    method = %pending.method,
                    error_type = error_type,
                    duration_ms = duration_ms,
                    error = %err,
                    "Proxy error while handling request"
                );

                // Log audit entry for failed request
                let entry = AuditEntry {
                    timestamp: pending.timestamp,
                    correlation_id: Some(pending.request_id),
                    session_id: None,
                    service: pending.service,
                    method: pending.method,
                    path: pending.path,
                    auth_injected: pending.auth_injected.load(Ordering::SeqCst),
                    response_code: Some(502), // Proxy error
                    duration_ms,
                };

                if let Err(e) = audit_logger.log(&entry) {
                    tracing::warn!("Failed to write audit log entry: {}", e);
                }
            } else {
                // This shouldn't happen - same handler instance handles request and error
                tracing::error!(
                    error_type = error_type,
                    error = %err,
                    "Proxy error while handling request (no pending request)"
                );
            }

            // Return error response (only error_type, not full error details)
            build_error_response(error_type)
        }
    }
}

/// Handler that filters write operations based on access mode and injects auth.
/// Each handler instance handles exactly one request-response pair.
#[derive(Clone)]
struct FilteringHandler {
    session_id: Uuid,
    access_mode: Arc<RwLock<AccessMode>>,
    credentials: Arc<Credentials>,
    audit_logger: Arc<AuditLogger>,
    pending_request: Option<PendingRequest>,
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

        // Capture timing and request metadata synchronously before async work
        let request_id = Uuid::new_v4();
        let start_time = Instant::now();
        let timestamp = Utc::now();

        // Get host early for both filtering and auth injection
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
        let version = req.version();
        let host_match = normalize_host(&host).to_string();

        // Determine if this is a refresh request (needed for response rewriting)
        let auth_refresh = is_refresh_request(&host_match, &path, req.method());

        tracing::debug!(
            request_id = %request_id,
            session_id = %session_id,
            host = %host,
            method = %method,
            path = %path,
            version = ?version,
            "Proxying request"
        );

        // Create shared atomic flag for auth_injected that can be updated from async block
        let auth_injected_flag = Arc::new(AtomicBool::new(false));
        let auth_injected_for_async = Arc::clone(&auth_injected_flag);

        // Store pending request for correlation with response
        self.pending_request = Some(PendingRequest {
            request_id,
            start_time,
            timestamp,
            service: host_match.clone(),
            method,
            path,
            auth_injected: auth_injected_flag,
            auth_refresh,
        });

        async move {
            // Check access mode and filter write operations
            let current_mode = *access_mode.read().await;
            if current_mode == AccessMode::ReadOnly {
                // Check for K8s API write operations
                if is_k8s_request(&host) && is_k8s_write_operation(req.method()) {
                    tracing::warn!(
                        session_id = %session_id,
                        method = %req.method(),
                        uri = %req.uri(),
                        host = %host,
                        "Blocked Kubernetes API write operation in read-only mode"
                    );

                    return RequestOrResponse::Response(
                        Response::builder()
                            .status(403)
                            .body(Body::from(
                                "Kubernetes write operations not allowed in read-only mode",
                            ))
                            .unwrap(),
                    );
                }

                // Check for general HTTP write operations
                if is_write_operation(req.method()) {
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
            }

            // Check for matching rule and inject auth
            if auth_refresh {
                match rewrite_refresh_request(&mut req, &credentials).await {
                    Ok(()) => {
                        auth_injected_for_async.store(true, Ordering::SeqCst);
                    }
                    Err(response) => return RequestOrResponse::Response(response),
                }
            }

            if let Some(rule) = find_matching_rule(&host_match) {
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
                        } else if let Ok(value) = format!("Bearer {token}").parse() {
                            req.headers_mut().insert("authorization", value);
                            auth_injected_for_async.store(true, Ordering::SeqCst);
                            tracing::debug!(
                                session_id = %session_id,
                                "Injected authorization header for {}",
                                host_match
                            );
                        }
                    } else {
                        let header_value = rule.format_header(&token);
                        if let Ok(value) = header_value.parse() {
                            req.headers_mut().insert(rule.header_name, value);
                            auth_injected_for_async.store(true, Ordering::SeqCst);
                            tracing::debug!(
                                session_id = %session_id,
                                "Injected {} header for {}",
                                rule.header_name,
                                host_match
                            );
                        }
                    }
                } else {
                    tracing::debug!(
                        "Rule matched for {} but credential '{}' is missing",
                        host_match,
                        rule.credential_key
                    );
                }
            }

            if is_chatgpt_host(&host_match) {
                if let Some(account_id) = credentials.codex_account_id() {
                    if let Ok(value) = account_id.parse() {
                        req.headers_mut().insert("ChatGPT-Account-ID", value);
                        auth_injected_for_async.store(true, Ordering::SeqCst);
                    }
                }
            }

            RequestOrResponse::Request(req)
        }
    }

    fn handle_response(
        &mut self,
        _ctx: &HttpContext,
        res: Response<Body>,
    ) -> impl Future<Output = Response<Body>> + Send {
        let session_id = self.session_id;
        // Take pending request synchronously - guaranteed to exist since same handler
        // instance handles both request and response
        let pending = self.pending_request.take();
        let audit_logger = Arc::clone(&self.audit_logger);
        let credentials = Arc::clone(&self.credentials);

        async move {
            let status = res.status();
            let mut should_rewrite_refresh = false;

            if let Some(pending) = pending {
                let duration_ms = pending.start_time.elapsed().as_millis() as u64;
                should_rewrite_refresh = pending.auth_refresh;

                tracing::debug!(
                    request_id = %pending.request_id,
                    session_id = %session_id,
                    host = %pending.service,
                    status = %status,
                    duration_ms = duration_ms,
                    "Response received from upstream"
                );

                // Log complete audit entry with timing
                let entry = AuditEntry {
                    timestamp: pending.timestamp,
                    correlation_id: Some(pending.request_id),
                    session_id: Some(session_id),
                    service: pending.service,
                    method: pending.method,
                    path: pending.path,
                    auth_injected: pending.auth_injected.load(Ordering::SeqCst),
                    response_code: Some(status.as_u16()),
                    duration_ms,
                };

                if let Err(e) = audit_logger.log(&entry) {
                    tracing::warn!("Failed to write audit log entry: {}", e);
                }

                // Log warning for server errors
                if status.is_server_error() {
                    tracing::warn!(
                        session_id = %session_id,
                        status = %status,
                        "Upstream server error (5xx)"
                    );
                }
            } else {
                // This shouldn't happen - same handler instance handles request and response
                tracing::debug!(
                    session_id = %session_id,
                    status = %status,
                    "Response received but no pending request (handler may have been cloned)"
                );
            }

            if should_rewrite_refresh {
                return rewrite_refresh_response(res, &credentials).await;
            }

            res
        }
    }

    fn handle_error(
        &mut self,
        _ctx: &HttpContext,
        err: ClientError,
    ) -> impl Future<Output = Response<Body>> + Send {
        let session_id = self.session_id;
        // Take pending request synchronously
        let pending = self.pending_request.take();
        let audit_logger = Arc::clone(&self.audit_logger);

        async move {
            let error_type = classify_client_error(&err);

            if let Some(pending) = pending {
                let duration_ms = pending.start_time.elapsed().as_millis() as u64;

                // Log full error details for debugging (not sent to client)
                tracing::error!(
                    request_id = %pending.request_id,
                    session_id = %session_id,
                    host = %pending.service,
                    method = %pending.method,
                    error_type = error_type,
                    duration_ms = duration_ms,
                    error = %err,
                    "Proxy error while handling request"
                );

                // Log audit entry for failed request
                let entry = AuditEntry {
                    timestamp: pending.timestamp,
                    correlation_id: Some(pending.request_id),
                    session_id: Some(session_id),
                    service: pending.service,
                    method: pending.method,
                    path: pending.path,
                    auth_injected: pending.auth_injected.load(Ordering::SeqCst),
                    response_code: Some(502), // Proxy error
                    duration_ms,
                };

                if let Err(e) = audit_logger.log(&entry) {
                    tracing::warn!("Failed to write audit log entry: {}", e);
                }
            } else {
                // This shouldn't happen - same handler instance handles request and error
                tracing::error!(
                    session_id = %session_id,
                    error_type = error_type,
                    error = %err,
                    "Proxy error while handling request (no pending request)"
                );
            }

            // Return error response (only error_type, not full error details)
            build_error_response(error_type)
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
            pending_request: None,
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
