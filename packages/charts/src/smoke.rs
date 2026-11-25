use std::collections::BTreeMap;
use std::net::SocketAddr;
use std::path::Path;

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD;
use sha2::{Digest as _, Sha256};
use tokio::io::{AsyncReadExt as _, AsyncWriteExt as _};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::oneshot;

use crate::archive::build_chart_tgz;
use crate::auth::BasicAuthCredentials;
use crate::config::DEFAULT_QUOTA_BYTES;
use crate::index_yaml::ChartReleaseView;
use crate::metrics::AppMetrics;
use crate::routes::{AppState, build_router};
use crate::storage::ChartStore;

struct RawHttpResponse {
    status: u16,
    headers: BTreeMap<String, String>,
    body: Vec<u8>,
}

/// Runs the self-contained production smoke suite against a real loopback listener.
pub async fn run_smoke(static_dir: &Path) -> Result<(), String> {
    let temp_dir =
        tempfile::TempDir::new().map_err(|err| format!("failed creating smoke tempdir: {err}"))?;

    let effective_static_dir = if static_dir.join("index.html").is_file() {
        static_dir.to_path_buf()
    } else {
        let synthetic_client = temp_dir.path().join("synthetic-client");
        let assets_dir = synthetic_client.join("assets");
        std::fs::create_dir_all(&assets_dir)
            .map_err(|err| format!("failed creating synthetic assets dir: {err}"))?;
        std::fs::write(
            assets_dir.join("index-smoke1234.js"),
            b"console.log('charts smoke bundle');\n",
        )
        .map_err(|err| format!("failed writing synthetic js asset: {err}"))?;
        std::fs::write(
            synthetic_client.join("index.html"),
            b"<!doctype html><html><head><script type=\"module\" crossorigin src=\"/assets/index-smoke1234.js\"></script></head><body><div id=\"root\"></div></body></html>",
        )
        .map_err(|err| format!("failed writing synthetic index.html: {err}"))?;
        synthetic_client
    };

    let data_dir = temp_dir.path().join("data");
    let store = ChartStore::open(&data_dir, DEFAULT_QUOTA_BYTES)
        .map_err(|err| format!("smoke store open failed: {err}"))?;
    let metrics = AppMetrics::new(DEFAULT_QUOTA_BYTES);
    let basic_auth = Some(BasicAuthCredentials::new("smoke-user", "smoke-pass"));

    let app = build_router(AppState {
        store,
        metrics,
        basic_auth,
        static_dir: effective_static_dir,
    });

    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|err| format!("smoke listener bind failed: {err}"))?;
    let addr = listener
        .local_addr()
        .map_err(|err| format!("smoke local_addr failed: {err}"))?;

    let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();
    let server_handle = tokio::spawn(async move {
        axum::serve(listener, app)
            .with_graceful_shutdown(async {
                let _ = shutdown_rx.await;
            })
            .await
    });

    let result = exercise_endpoints(addr).await;

    let _ = shutdown_tx.send(());
    let join_res = server_handle
        .await
        .map_err(|err| format!("smoke server join failed: {err}"))?;
    join_res.map_err(|err| format!("smoke server exited with error: {err}"))?;

    result
}

async fn exercise_endpoints(addr: SocketAddr) -> Result<(), String> {
    let health = http_request(addr, "GET", "/healthz", &[], &[]).await?;
    ensure_eq(&health.status, &200, "GET /healthz status")?;
    ensure_eq(
        std::str::from_utf8(&health.body).unwrap_or(""),
        "ok",
        "GET /healthz body",
    )?;

    let ready = http_request(addr, "GET", "/readyz", &[], &[]).await?;
    ensure_eq(&ready.status, &200, "GET /readyz status")?;
    ensure_eq(
        std::str::from_utf8(&ready.body).unwrap_or(""),
        "ok",
        "GET /readyz body",
    )?;

    let root = http_request(addr, "GET", "/", &[], &[]).await?;
    ensure_eq(&root.status, &200, "GET / status")?;
    let html =
        std::str::from_utf8(&root.body).map_err(|err| format!("GET / body is not UTF-8: {err}"))?;
    if !html.contains("<div id=\"root\"></div>") {
        return Err("GET / HTML missing <div id=\"root\"></div>".to_owned());
    }
    let js_path = extract_script_src(html)
        .ok_or_else(|| format!("GET / HTML did not reference a .js bundle: {html}"))?;
    let asset = http_request(addr, "GET", &js_path, &[], &[]).await?;
    ensure_eq(&asset.status, &200, "GET hashed .js asset status")?;
    if asset.body.is_empty() {
        return Err("GET hashed .js asset returned empty body".to_owned());
    }

    let tgz_bytes = build_chart_tgz(
        "arcade",
        "2.0.0-100042",
        "2.0.0-100042",
        "Arcade homelab chart",
        Some("sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"),
        "replicas: 1\n",
    )
    .map_err(|err| format!("build_chart_tgz failed: {err}"))?;
    let expected_digest = hex::encode(Sha256::digest(&tgz_bytes));

    let unauth = http_request(
        addr,
        "POST",
        "/api/charts",
        &[("Content-Type", "application/octet-stream")],
        &tgz_bytes,
    )
    .await?;
    ensure_eq(&unauth.status, &401, "POST /api/charts without auth")?;

    let auth_header = format!("Basic {}", STANDARD.encode("smoke-user:smoke-pass"));

    let created = http_request(
        addr,
        "POST",
        "/api/charts",
        &[
            ("Authorization", &auth_header),
            ("Content-Type", "application/octet-stream"),
        ],
        &tgz_bytes,
    )
    .await?;
    ensure_eq(&created.status, &201, "POST /api/charts initial upload")?;

    let idempotent = http_request(
        addr,
        "POST",
        "/api/charts",
        &[
            ("Authorization", &auth_header),
            ("Content-Type", "application/octet-stream"),
        ],
        &tgz_bytes,
    )
    .await?;
    ensure_eq(
        &idempotent.status,
        &200,
        "POST /api/charts idempotent retry",
    )?;

    let mutated_bytes = build_chart_tgz(
        "arcade",
        "2.0.0-100042",
        "2.0.0-100042",
        "Arcade homelab chart",
        Some("sha256:fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210"),
        "replicas: 2\n",
    )
    .map_err(|err| format!("build mutated chart failed: {err}"))?;
    let conflict = http_request(
        addr,
        "POST",
        "/api/charts",
        &[
            ("Authorization", &auth_header),
            ("Content-Type", "application/octet-stream"),
        ],
        &mutated_bytes,
    )
    .await?;
    ensure_eq(
        &conflict.status,
        &409,
        "POST /api/charts mutated bytes conflict",
    )?;

    let index_resp = http_request(addr, "GET", "/index.yaml", &[], &[]).await?;
    ensure_eq(&index_resp.status, &200, "GET /index.yaml status")?;
    let etag = index_resp
        .headers
        .get("etag")
        .cloned()
        .ok_or_else(|| "GET /index.yaml missing ETag header".to_owned())?;
    let index_text = std::str::from_utf8(&index_resp.body)
        .map_err(|err| format!("index.yaml not UTF-8: {err}"))?;
    if !index_text.contains(&expected_digest) {
        return Err("index.yaml missing expected 64-hex digest".to_owned());
    }

    let not_modified =
        http_request(addr, "GET", "/index.yaml", &[("If-None-Match", &etag)], &[]).await?;
    ensure_eq(&not_modified.status, &304, "GET /index.yaml If-None-Match")?;

    let all_charts = http_request(addr, "GET", "/api/charts", &[], &[]).await?;
    ensure_eq(&all_charts.status, &200, "GET /api/charts status")?;
    let parsed_all: BTreeMap<String, Vec<ChartReleaseView>> =
        serde_json::from_slice(&all_charts.body)
            .map_err(|err| format!("GET /api/charts invalid JSON: {err}"))?;
    if !parsed_all.contains_key("arcade") {
        return Err("GET /api/charts missing 'arcade'".to_owned());
    }

    let named = http_request(addr, "GET", "/api/charts/arcade", &[], &[]).await?;
    ensure_eq(&named.status, &200, "GET /api/charts/arcade status")?;
    let parsed_named: Vec<ChartReleaseView> = serde_json::from_slice(&named.body)
        .map_err(|err| format!("GET /api/charts/arcade invalid JSON: {err}"))?;
    ensure_eq(&parsed_named.len(), &1, "GET /api/charts/arcade length")?;

    let single = http_request(addr, "GET", "/api/charts/arcade/2.0.0-100042", &[], &[]).await?;
    ensure_eq(
        &single.status,
        &200,
        "GET /api/charts/arcade/2.0.0-100042 status",
    )?;
    let parsed_single: ChartReleaseView = serde_json::from_slice(&single.body)
        .map_err(|err| format!("GET /api/charts/arcade/2.0.0-100042 invalid JSON: {err}"))?;
    ensure_eq(
        parsed_single.digest.as_str(),
        expected_digest.as_str(),
        "single release digest",
    )?;

    let downloaded = http_request(addr, "GET", "/charts/arcade-2.0.0-100042.tgz", &[], &[]).await?;
    ensure_eq(
        &downloaded.status,
        &200,
        "GET /charts/arcade-2.0.0-100042.tgz status",
    )?;
    if downloaded.body != tgz_bytes {
        return Err("downloaded .tgz bytes differ from uploaded bytes".to_owned());
    }
    let roundtrip_digest = hex::encode(Sha256::digest(&downloaded.body));
    ensure_eq(
        roundtrip_digest.as_str(),
        expected_digest.as_str(),
        "downloaded .tgz digest",
    )?;

    let metrics_resp = http_request(addr, "GET", "/metrics", &[], &[]).await?;
    ensure_eq(&metrics_resp.status, &200, "GET /metrics status")?;
    let metrics_text = std::str::from_utf8(&metrics_resp.body)
        .map_err(|err| format!("/metrics not UTF-8: {err}"))?;
    for metric_name in [
        "charts_releases_total",
        "charts_charts_total",
        "charts_storage_bytes",
        "charts_quota_bytes",
        "charts_catalog_revision",
        "charts_http_requests_total",
    ] {
        if !metrics_text.contains(metric_name) {
            return Err(format!("/metrics missing '{metric_name}'"));
        }
    }

    Ok(())
}

fn extract_script_src(html: &str) -> Option<String> {
    let mut rest = html;
    while let Some(idx) = rest.find("src=\"") {
        let after = &rest[idx + 5..];
        let end = after.find('"')?;
        let candidate = &after[..end];
        if candidate.ends_with(".js") {
            return Some(if candidate.starts_with('/') {
                candidate.to_owned()
            } else {
                format!("/{candidate}")
            });
        }
        rest = &after[end + 1..];
    }
    None
}

fn ensure_eq<T: PartialEq + std::fmt::Debug + ?Sized>(
    actual: &T,
    expected: &T,
    context: &str,
) -> Result<(), String> {
    if actual == expected {
        Ok(())
    } else {
        Err(format!("{context}: expected {expected:?}, got {actual:?}"))
    }
}

async fn http_request(
    addr: SocketAddr,
    method: &str,
    path: &str,
    headers: &[(&str, &str)],
    body: &[u8],
) -> Result<RawHttpResponse, String> {
    let mut stream = TcpStream::connect(addr)
        .await
        .map_err(|err| format!("connect {addr} failed: {err}"))?;

    let mut head = format!(
        "{method} {path} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\nContent-Length: {}\r\n",
        body.len()
    );
    for (k, v) in headers {
        head.push_str(&format!("{k}: {v}\r\n"));
    }
    head.push_str("\r\n");

    stream
        .write_all(head.as_bytes())
        .await
        .map_err(|err| format!("write request head failed: {err}"))?;
    if !body.is_empty() {
        stream
            .write_all(body)
            .await
            .map_err(|err| format!("write request body failed: {err}"))?;
    }
    stream
        .flush()
        .await
        .map_err(|err| format!("flush request failed: {err}"))?;

    let mut raw = Vec::new();
    stream
        .read_to_end(&mut raw)
        .await
        .map_err(|err| format!("read response failed: {err}"))?;

    parse_raw_http_response(&raw)
}

fn parse_raw_http_response(raw: &[u8]) -> Result<RawHttpResponse, String> {
    let split_pos = raw
        .windows(4)
        .position(|w| w == b"\r\n\r\n")
        .ok_or_else(|| "malformed HTTP response: missing header terminator".to_owned())?;
    let head_str = std::str::from_utf8(&raw[..split_pos])
        .map_err(|err| format!("HTTP response headers not UTF-8: {err}"))?;
    let raw_body = &raw[split_pos + 4..];

    let mut lines = head_str.split("\r\n");
    let status_line = lines
        .next()
        .ok_or_else(|| "empty HTTP status line".to_owned())?;
    let status = status_line
        .split_whitespace()
        .nth(1)
        .ok_or_else(|| format!("invalid HTTP status line '{status_line}'"))?
        .parse::<u16>()
        .map_err(|err| format!("invalid HTTP status code in '{status_line}': {err}"))?;

    let mut headers = BTreeMap::new();
    for line in lines {
        if let Some((name, value)) = line.split_once(':') {
            headers.insert(name.trim().to_ascii_lowercase(), value.trim().to_owned());
        }
    }

    let body = if headers
        .get("transfer-encoding")
        .is_some_and(|te| te.eq_ignore_ascii_case("chunked"))
    {
        decode_chunked_body(raw_body)?
    } else {
        raw_body.to_vec()
    };

    Ok(RawHttpResponse {
        status,
        headers,
        body,
    })
}

fn decode_chunked_body(mut input: &[u8]) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    loop {
        let line_end = input
            .windows(2)
            .position(|w| w == b"\r\n")
            .ok_or_else(|| "malformed chunked response: missing chunk size CRLF".to_owned())?;
        let size_hex = std::str::from_utf8(&input[..line_end])
            .map_err(|err| format!("invalid chunk size UTF-8: {err}"))?
            .split(';')
            .next()
            .unwrap_or("")
            .trim();
        let chunk_len = usize::from_str_radix(size_hex, 16)
            .map_err(|err| format!("invalid chunk size '{size_hex}': {err}"))?;
        input = &input[line_end + 2..];
        if chunk_len == 0 {
            break;
        }
        if input.len() < chunk_len + 2 {
            return Err("truncated chunk body".to_owned());
        }
        out.extend_from_slice(&input[..chunk_len]);
        input = &input[chunk_len + 2..];
    }
    Ok(out)
}
