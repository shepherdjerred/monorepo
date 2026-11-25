use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::path::PathBuf;
use std::sync::Arc;

use reqwest::Method;
use tempfile::TempDir;

use crate::config::{
    Config, DEFAULT_EVICT_INTERVAL_SECS, DEFAULT_FLUSH_INTERVAL_SECS, DEFAULT_GRADLE_TTL_SECS,
    DEFAULT_HIGH_WATERMARK_BYTES, DEFAULT_LOW_WATERMARK_BYTES, DEFAULT_QUOTA_BYTES,
    DEFAULT_SCCACHE_PR_TTL_SECS, DEFAULT_SCCACHE_TRUSTED_TTL_SECS, DEFAULT_TURBO_TTL_SECS,
    GRADLE_MAX_BODY_BYTES, SCCACHE_MAX_BODY_BYTES, TURBO_MAX_BODY_BYTES,
};
use crate::{AppState, build_router};

#[derive(Debug, thiserror::Error)]
pub enum SmokeError {
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("store error: {0}")]
    Store(#[from] crate::store::StoreError),
    #[error("http client error: {0}")]
    Http(#[from] reqwest::Error),
    #[error("invalid method: {0}")]
    InvalidMethod(#[from] http::method::InvalidMethod),
    #[error("smoke assertion failed: {0}")]
    Assertion(String),
}

fn ensure(cond: bool, msg: impl Into<String>) -> Result<(), SmokeError> {
    if cond {
        Ok(())
    } else {
        Err(SmokeError::Assertion(msg.into()))
    }
}

fn extract_first_js_asset(html: &str) -> Option<&str> {
    let needle = "src=\"";
    let mut rest = html;
    while let Some(pos) = rest.find(needle) {
        let after = &rest[pos + needle.len()..];
        if let Some(end) = after.find('"') {
            let candidate = &after[..end];
            if candidate.ends_with(".js") {
                return Some(candidate);
            }
            rest = &after[end + 1..];
        } else {
            break;
        }
    }
    None
}

pub async fn run_smoke(static_dir_override: Option<PathBuf>) -> Result<(), SmokeError> {
    let temp = TempDir::new()?;
    let static_dir = match static_dir_override {
        Some(dir) => dir,
        None => Config::from_env()
            .map(|cfg| cfg.static_dir)
            .unwrap_or_else(|_| PathBuf::from("dist/client")),
    };

    let config = Config {
        host: IpAddr::V4(Ipv4Addr::LOCALHOST),
        port: 0,
        data_dir: temp.path().to_path_buf(),
        static_dir,
        turbo_token: Some("smoke-turbo-token-0001".to_owned()),
        gradle_write_user: "ci-main".to_owned(),
        gradle_write_password: Some("smoke-write-pw-0001".to_owned()),
        gradle_read_user: "ci-pull-request".to_owned(),
        gradle_read_password: Some("smoke-read-pw-0001".to_owned()),
        sccache_write_user: "ci-main".to_owned(),
        sccache_write_password: Some("smoke-write-pw-0001".to_owned()),
        sccache_read_user: "ci-pull-request".to_owned(),
        sccache_read_password: Some("smoke-read-pw-0001".to_owned()),
        quota_bytes: DEFAULT_QUOTA_BYTES,
        high_watermark_bytes: DEFAULT_HIGH_WATERMARK_BYTES,
        low_watermark_bytes: DEFAULT_LOW_WATERMARK_BYTES,
        turbo_ttl_secs: DEFAULT_TURBO_TTL_SECS,
        gradle_ttl_secs: DEFAULT_GRADLE_TTL_SECS,
        sccache_trusted_ttl_secs: DEFAULT_SCCACHE_TRUSTED_TTL_SECS,
        sccache_pr_ttl_secs: DEFAULT_SCCACHE_PR_TTL_SECS,
        turbo_max_body_bytes: TURBO_MAX_BODY_BYTES,
        gradle_max_body_bytes: GRADLE_MAX_BODY_BYTES,
        sccache_max_body_bytes: SCCACHE_MAX_BODY_BYTES,
        flush_interval_secs: DEFAULT_FLUSH_INTERVAL_SECS,
        evict_interval_secs: DEFAULT_EVICT_INTERVAL_SECS,
    };

    let state = Arc::new(AppState::new(config)?);
    let app = build_router(Arc::clone(&state));
    let listener = tokio::net::TcpListener::bind(SocketAddr::from(([127, 0, 0, 1], 0))).await?;
    let addr = listener.local_addr()?;
    let base = format!("http://{addr}");

    let (shutdown_tx, shutdown_rx) = tokio::sync::watch::channel(false);
    let server_task = tokio::spawn(async move {
        let mut rx = shutdown_rx;
        let _ = axum::serve(listener, app)
            .with_graceful_shutdown(async move {
                let _ = rx.changed().await;
            })
            .await;
    });

    let client = reqwest::Client::builder().no_proxy().build()?;

    // 1. /healthz, /readyz, /v8/artifacts/status
    let health = client.get(format!("{base}/healthz")).send().await?;
    ensure(health.status().is_success(), "/healthz did not return 200")?;

    let ready = client.get(format!("{base}/readyz")).send().await?;
    ensure(ready.status().is_success(), "/readyz did not return 200")?;

    let status = client
        .get(format!("{base}/v8/artifacts/status"))
        .send()
        .await?;
    ensure(
        status.status().is_success(),
        "/v8/artifacts/status did not return 200",
    )?;
    let status_json: serde_json::Value = status.json().await?;
    ensure(
        status_json.get("status").and_then(|v| v.as_str()) == Some("enabled"),
        "unexpected /v8/artifacts/status payload",
    )?;

    // 2. SPA `/` + hashed `.js` asset
    let index_resp = client.get(format!("{base}/")).send().await?;
    ensure(index_resp.status().is_success(), "GET / did not return 200")?;
    let html = index_resp.text().await?;
    ensure(
        html.contains("<div id=\"root\"></div>"),
        "SPA index.html missing #root mount",
    )?;
    let asset_src = extract_first_js_asset(&html)
        .ok_or_else(|| SmokeError::Assertion("SPA index.html missing .js script asset".into()))?;
    let asset_url = if asset_src.starts_with('/') {
        format!("{base}{asset_src}")
    } else {
        format!("{base}/{asset_src}")
    };
    let asset_resp = client.get(asset_url).send().await?;
    ensure(
        asset_resp.status().is_success(),
        "hashed SPA .js asset did not return 200",
    )?;

    // 3. Turbo PUT / HEAD / GET (x-artifact-tag preserved) + /v8/clean
    let turbo_payload = b"smoke-turbo-artifact-bytes-payload";
    let put_turbo = client
        .put(format!("{base}/v8/artifacts/smoke_hash_01?slug=monorepo"))
        .bearer_auth("smoke-turbo-token-0001")
        .header("x-artifact-tag", "sig-trusted-main-v1")
        .header("x-artifact-duration", "420")
        .body(turbo_payload.to_vec())
        .send()
        .await?;
    ensure(
        put_turbo.status().as_u16() == 202,
        format!("Turbo PUT expected 202, got {}", put_turbo.status()),
    )?;

    let head_turbo = client
        .head(format!("{base}/v8/artifacts/smoke_hash_01?slug=monorepo"))
        .bearer_auth("smoke-turbo-token-0001")
        .send()
        .await?;
    ensure(head_turbo.status().is_success(), "Turbo HEAD failed")?;
    ensure(
        head_turbo
            .headers()
            .get("x-artifact-tag")
            .and_then(|v| v.to_str().ok())
            == Some("sig-trusted-main-v1"),
        "Turbo HEAD lost x-artifact-tag",
    )?;

    let get_turbo = client
        .get(format!("{base}/v8/artifacts/smoke_hash_01?slug=monorepo"))
        .bearer_auth("smoke-turbo-token-0001")
        .send()
        .await?;
    ensure(get_turbo.status().is_success(), "Turbo GET failed")?;
    ensure(
        get_turbo
            .headers()
            .get("x-artifact-tag")
            .and_then(|v| v.to_str().ok())
            == Some("sig-trusted-main-v1"),
        "Turbo GET lost x-artifact-tag",
    )?;
    let fetched_turbo = get_turbo.bytes().await?;
    ensure(
        fetched_turbo.as_ref() == turbo_payload,
        "Turbo GET payload mismatch",
    )?;

    let clean_resp = client
        .post(format!("{base}/v8/clean?slug=monorepo&olderThan=0"))
        .bearer_auth("smoke-turbo-token-0001")
        .send()
        .await?;
    ensure(clean_resp.status().is_success(), "Turbo /v8/clean failed")?;
    let clean_json: serde_json::Value = clean_resp.json().await?;
    ensure(
        clean_json
            .get("deleted")
            .and_then(serde_json::Value::as_u64)
            == Some(1)
            && clean_json
                .get("scanned")
                .and_then(serde_json::Value::as_u64)
                == Some(1),
        format!("unexpected /v8/clean response: {clean_json}"),
    )?;

    // 4. Gradle ci-main PUT + ci-pull-request GET (200) & PUT (403)
    let gradle_payload = b"gradle-build-cache-entry-0001";
    let put_gradle = client
        .put(format!("{base}/cache/abcdef0123456789"))
        .basic_auth("ci-main", Some("smoke-write-pw-0001"))
        .body(gradle_payload.to_vec())
        .send()
        .await?;
    ensure(
        put_gradle.status().as_u16() == 201,
        format!(
            "Gradle ci-main PUT expected 201, got {}",
            put_gradle.status()
        ),
    )?;

    let get_gradle_pr = client
        .get(format!("{base}/cache/abcdef0123456789"))
        .basic_auth("ci-pull-request", Some("smoke-read-pw-0001"))
        .send()
        .await?;
    ensure(
        get_gradle_pr.status().as_u16() == 200,
        "Gradle ci-pull-request GET expected 200",
    )?;
    ensure(
        get_gradle_pr.bytes().await?.as_ref() == gradle_payload,
        "Gradle payload mismatch",
    )?;

    let put_gradle_pr = client
        .put(format!("{base}/cache/poison_attempt"))
        .basic_auth("ci-pull-request", Some("smoke-read-pw-0001"))
        .body(b"untrusted".to_vec())
        .send()
        .await?;
    ensure(
        put_gradle_pr.status().as_u16() == 403,
        format!(
            "Gradle ci-pull-request PUT expected 403, got {}",
            put_gradle_pr.status()
        ),
    )?;

    // 5. sccache MKCOL + PR copy-on-write isolation
    let mkcol = Method::from_bytes(b"MKCOL")?;
    let mkcol_resp = client
        .request(mkcol, format!("{base}/sccache/a/b/"))
        .basic_auth("ci-pull-request", Some("smoke-read-pw-0001"))
        .send()
        .await?;
    ensure(
        mkcol_resp.status().as_u16() == 201,
        format!("sccache MKCOL expected 201, got {}", mkcol_resp.status()),
    )?;

    let put_sc_main = client
        .put(format!("{base}/sccache/a/b/main_rlib"))
        .basic_auth("ci-main", Some("smoke-write-pw-0001"))
        .body(b"trusted-main-rlib".to_vec())
        .send()
        .await?;
    ensure(
        put_sc_main.status().as_u16() == 201,
        "sccache ci-main PUT expected 201",
    )?;

    let get_sc_pr_warm = client
        .get(format!("{base}/sccache/a/b/main_rlib"))
        .basic_auth("ci-pull-request", Some("smoke-read-pw-0001"))
        .send()
        .await?;
    ensure(
        get_sc_pr_warm.status().as_u16() == 200
            && get_sc_pr_warm.bytes().await?.as_ref() == b"trusted-main-rlib",
        "sccache PR failed to warm-read trusted main entry",
    )?;

    let put_sc_pr = client
        .put(format!("{base}/sccache/a/b/pr_only_rlib"))
        .basic_auth("ci-pull-request", Some("smoke-read-pw-0001"))
        .body(b"pr-compiled-rlib".to_vec())
        .send()
        .await?;
    ensure(
        put_sc_pr.status().as_u16() == 201,
        "sccache PR PUT expected 201",
    )?;

    let get_sc_pr_self = client
        .get(format!("{base}/sccache/a/b/pr_only_rlib"))
        .basic_auth("ci-pull-request", Some("smoke-read-pw-0001"))
        .send()
        .await?;
    ensure(
        get_sc_pr_self.status().as_u16() == 200
            && get_sc_pr_self.bytes().await?.as_ref() == b"pr-compiled-rlib",
        "sccache PR failed to read its own overlay entry",
    )?;

    let get_sc_main_isolated = client
        .get(format!("{base}/sccache/a/b/pr_only_rlib"))
        .basic_auth("ci-main", Some("smoke-write-pw-0001"))
        .send()
        .await?;
    ensure(
        get_sc_main_isolated.status().as_u16() == 404,
        "sccache ci-main must not see PR-written entries",
    )?;

    // 6. /api/summary and /metrics
    let summary_resp = client.get(format!("{base}/api/summary")).send().await?;
    ensure(summary_resp.status().is_success(), "/api/summary failed")?;
    let metrics_resp = client.get(format!("{base}/metrics")).send().await?;
    ensure(metrics_resp.status().is_success(), "/metrics failed")?;
    let metrics_body = metrics_resp.text().await?;
    ensure(
        metrics_body.contains("ci_cache_requests_total"),
        "/metrics missing ci_cache_requests_total",
    )?;

    drop(client);
    state.store.flush_pending_deltas().await?;
    let _ = shutdown_tx.send(true);
    if let Ok(join_res) = tokio::time::timeout(std::time::Duration::from_secs(2), server_task).await
    {
        let _ = join_res;
    }
    Ok(())
}
