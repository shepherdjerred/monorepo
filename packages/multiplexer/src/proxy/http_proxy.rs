//! HTTP/HTTPS auth proxy with header injection.

use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Instant;

use chrono::Utc;
use http_body_util::{combinators::BoxBody, BodyExt, Empty, Full};
use hyper::body::Bytes;
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper::{Method, Request, Response, StatusCode};
use hyper_util::rt::TokioIo;
use tokio::net::{TcpListener, TcpStream};

use super::audit::{AuditEntry, AuditLogger};
use super::ca::ProxyCa;
use super::config::Credentials;
use super::rules::find_matching_rule;

/// HTTP auth proxy that intercepts HTTPS and injects auth headers.
pub struct HttpAuthProxy {
    /// Listen address.
    addr: SocketAddr,
    /// Proxy CA for generating certs.
    ca: Arc<ProxyCa>,
    /// Credentials for auth injection.
    credentials: Arc<Credentials>,
    /// Audit logger.
    audit_logger: Arc<AuditLogger>,
}

impl HttpAuthProxy {
    /// Create a new HTTP auth proxy.
    pub fn new(
        port: u16,
        ca: Arc<ProxyCa>,
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
    pub async fn run(&self) -> anyhow::Result<()> {
        let listener = TcpListener::bind(self.addr).await?;
        tracing::info!("HTTP auth proxy listening on {}", self.addr);

        loop {
            let (stream, client_addr) = listener.accept().await?;
            let ca = Arc::clone(&self.ca);
            let credentials = Arc::clone(&self.credentials);
            let audit_logger = Arc::clone(&self.audit_logger);

            tokio::spawn(async move {
                if let Err(e) =
                    handle_connection(stream, client_addr, ca, credentials, audit_logger).await
                {
                    tracing::error!("Connection error from {}: {}", client_addr, e);
                }
            });
        }
    }

    /// Get the listen address.
    pub fn addr(&self) -> SocketAddr {
        self.addr
    }
}

/// Handle a single connection.
async fn handle_connection(
    stream: TcpStream,
    _client_addr: SocketAddr,
    ca: Arc<ProxyCa>,
    credentials: Arc<Credentials>,
    audit_logger: Arc<AuditLogger>,
) -> anyhow::Result<()> {
    let io = TokioIo::new(stream);

    let service = service_fn(move |req: Request<hyper::body::Incoming>| {
        let ca = Arc::clone(&ca);
        let credentials = Arc::clone(&credentials);
        let audit_logger = Arc::clone(&audit_logger);

        async move {
            if req.method() == Method::CONNECT {
                // HTTPS tunnel request
                handle_connect(req, ca, credentials, audit_logger).await
            } else {
                // Plain HTTP request (rare)
                handle_http(req, credentials, audit_logger).await
            }
        }
    });

    http1::Builder::new()
        .preserve_header_case(true)
        .title_case_headers(true)
        .serve_connection(io, service)
        .with_upgrades()
        .await?;

    Ok(())
}

/// Handle HTTPS CONNECT tunnel.
async fn handle_connect(
    req: Request<hyper::body::Incoming>,
    _ca: Arc<ProxyCa>,
    _credentials: Arc<Credentials>,
    _audit_logger: Arc<AuditLogger>,
) -> Result<Response<BoxBody<Bytes, hyper::Error>>, hyper::Error> {
    let host = req.uri().authority().map(|a| a.host().to_string());

    if let Some(host) = host {
        tracing::debug!("CONNECT tunnel to {}", host);

        // Spawn a task to handle the tunnel
        tokio::spawn(async move {
            // This is where we'd do TLS interception
            // For now, just establish a direct tunnel
            // TODO: Full TLS interception with cert generation
        });

        // Return 200 Connection Established
        Ok(Response::builder()
            .status(StatusCode::OK)
            .body(empty_body())
            .unwrap())
    } else {
        Ok(Response::builder()
            .status(StatusCode::BAD_REQUEST)
            .body(full_body("Invalid CONNECT request"))
            .unwrap())
    }
}

/// Handle plain HTTP request (proxy without TLS interception).
async fn handle_http(
    mut req: Request<hyper::body::Incoming>,
    credentials: Arc<Credentials>,
    audit_logger: Arc<AuditLogger>,
) -> Result<Response<BoxBody<Bytes, hyper::Error>>, hyper::Error> {
    let start = Instant::now();
    let host = req
        .uri()
        .host()
        .or_else(|| req.headers().get("host").and_then(|h| h.to_str().ok()))
        .unwrap_or("")
        .to_string();

    let method = req.method().to_string();
    let path = req.uri().path().to_string();

    // Check for matching rule
    let mut auth_injected = false;
    if let Some(rule) = find_matching_rule(&host) {
        if let Some(token) = credentials.get(rule.credential_key) {
            let header_value = rule.format_header(token);
            req.headers_mut()
                .insert(rule.header_name, header_value.parse().unwrap());
            auth_injected = true;
            tracing::debug!("Injected {} header for {}", rule.header_name, host);
        }
    }

    // Forward request to upstream
    let client = hyper_util::client::legacy::Client::builder(hyper_util::rt::TokioExecutor::new())
        .build_http();

    match client.request(req).await {
        Ok(resp) => {
            let status = resp.status().as_u16();
            let duration = start.elapsed().as_millis() as u64;

            // Log the request
            let entry = AuditEntry {
                timestamp: Utc::now(),
                service: host.clone(),
                method,
                path,
                auth_injected,
                response_code: Some(status),
                duration_ms: duration,
            };
            let _ = audit_logger.log(&entry);

            Ok(resp.map(|b| b.boxed()))
        }
        Err(e) => {
            tracing::error!("Upstream request failed: {}", e);
            Ok(Response::builder()
                .status(StatusCode::BAD_GATEWAY)
                .body(full_body(format!("Upstream error: {}", e)))
                .unwrap())
        }
    }
}

fn empty_body() -> BoxBody<Bytes, hyper::Error> {
    Empty::<Bytes>::new()
        .map_err(|never| match never {})
        .boxed()
}

fn full_body(s: impl Into<Bytes>) -> BoxBody<Bytes, hyper::Error> {
    Full::new(s.into())
        .map_err(|never| match never {})
        .boxed()
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn test_proxy_creation() {
        let dir = tempdir().unwrap();
        let ca = Arc::new(ProxyCa::load_or_generate(&dir.path().to_path_buf()).unwrap());
        let credentials = Arc::new(Credentials::default());
        let audit_logger = Arc::new(AuditLogger::noop());

        let proxy = HttpAuthProxy::new(18080, ca, credentials, audit_logger);
        assert_eq!(proxy.addr().port(), 18080);
    }
}
