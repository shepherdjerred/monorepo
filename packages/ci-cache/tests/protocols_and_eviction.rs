use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::path::PathBuf;
use std::sync::Arc;

use bytes::Bytes;
use ci_cache::config::{
    Config, DEFAULT_EVICT_INTERVAL_SECS, DEFAULT_FLUSH_INTERVAL_SECS, DEFAULT_GRADLE_TTL_SECS,
    DEFAULT_HIGH_WATERMARK_BYTES, DEFAULT_LOW_WATERMARK_BYTES, DEFAULT_QUOTA_BYTES,
    DEFAULT_SCCACHE_PR_TTL_SECS, DEFAULT_SCCACHE_TRUSTED_TTL_SECS, DEFAULT_TURBO_TTL_SECS,
    GRADLE_MAX_BODY_BYTES, MIB, SCCACHE_MAX_BODY_BYTES, TURBO_MAX_BODY_BYTES,
};
use ci_cache::evictor::run_eviction_pass;
use ci_cache::store::now_unix_secs;
use ci_cache::{AppState, build_router, smoke};
use futures_util::stream;
use reqwest::Method;
use sha2::{Digest, Sha256};
use tempfile::TempDir;

type TestResult = Result<(), Box<dyn std::error::Error>>;

struct TestServer {
    base_url: String,
    state: Arc<AppState>,
    _temp: TempDir,
    shutdown_tx: tokio::sync::watch::Sender<bool>,
    join_handle: tokio::task::JoinHandle<()>,
}

impl TestServer {
    async fn start_with(
        customize: impl FnOnce(&mut Config),
    ) -> Result<Self, Box<dyn std::error::Error>> {
        let temp = TempDir::new()?;
        let static_dir = temp.path().join("static");
        let assets_dir = static_dir.join("assets");
        std::fs::create_dir_all(&assets_dir)?;
        std::fs::write(
            static_dir.join("index.html"),
            "<!doctype html><html><body><div id=\"root\"></div><script type=\"module\" src=\"/assets/app-demo123.js\"></script></body></html>",
        )?;
        std::fs::write(
            assets_dir.join("app-demo123.js"),
            "console.log('ci-cache');",
        )?;

        let mut config = Config {
            host: IpAddr::V4(Ipv4Addr::LOCALHOST),
            port: 0,
            data_dir: temp.path().join("data"),
            static_dir,
            turbo_token: Some("test-turbo-token-secret".to_owned()),
            gradle_write_user: "ci-main".to_owned(),
            gradle_write_password: Some("gradle-write-pw".to_owned()),
            gradle_read_user: "ci-pull-request".to_owned(),
            gradle_read_password: Some("gradle-read-pw".to_owned()),
            sccache_write_user: "ci-main".to_owned(),
            sccache_write_password: Some("gradle-write-pw".to_owned()),
            sccache_read_user: "ci-pull-request".to_owned(),
            sccache_read_password: Some("gradle-read-pw".to_owned()),
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
        customize(&mut config);

        let state = Arc::new(AppState::new(config)?);
        let router = build_router(Arc::clone(&state));
        let listener = tokio::net::TcpListener::bind(SocketAddr::from(([127, 0, 0, 1], 0))).await?;
        let addr = listener.local_addr()?;
        let (shutdown_tx, mut shutdown_rx) = tokio::sync::watch::channel(false);
        let join_handle = tokio::spawn(async move {
            let _ = axum::serve(listener, router)
                .with_graceful_shutdown(async move {
                    let _ = shutdown_rx.changed().await;
                })
                .await;
        });

        Ok(Self {
            base_url: format!("http://{addr}"),
            state,
            _temp: temp,
            shutdown_tx,
            join_handle,
        })
    }

    async fn stop(self) {
        let _ = self.shutdown_tx.send(true);
        if tokio::time::timeout(std::time::Duration::from_millis(500), self.join_handle)
            .await
            .is_err()
        {
            // Idle HTTP/1.1 keep-alive sockets in reqwest's pool close on drop.
        }
    }
}

fn deterministic_payload(size: usize, seed: u8) -> Vec<u8> {
    let mut out = vec![0_u8; size];
    let mut state: u32 = u32::from(seed).wrapping_mul(2654435761).wrapping_add(17);
    for byte in &mut out {
        state = state.wrapping_mul(1664525).wrapping_add(1013904223);
        *byte = (state >> 24) as u8;
    }
    out
}

#[tokio::test]
async fn streams_multi_megabyte_turbo_and_gradle_artifacts_and_enforces_limits() -> TestResult {
    let server = TestServer::start_with(|cfg| {
        cfg.turbo_max_body_bytes = 6 * MIB;
        cfg.gradle_max_body_bytes = 5 * MIB;
    })
    .await?;
    let client = reqwest::Client::builder().no_proxy().build()?;

    // Unauthenticated /v8/artifacts/status succeeds; authenticated route without token 401s.
    let status_resp = client
        .get(format!("{}/v8/artifacts/status", server.base_url))
        .send()
        .await?;
    assert_eq!(status_resp.status().as_u16(), 200);

    let unauth_resp = client
        .get(format!(
            "{}/v8/artifacts/abc123?slug=monorepo",
            server.base_url
        ))
        .send()
        .await?;
    assert_eq!(unauth_resp.status().as_u16(), 401);

    // Stream a 4.5 MiB payload in 128 KiB chunks without Content-Length to prove chunked streaming.
    let total_size = 4 * 1024 * 1024 + 512 * 1024;
    let payload = deterministic_payload(total_size, 7);
    let expected_sha = hex::encode(Sha256::digest(&payload));

    let chunks: Vec<Result<Bytes, std::io::Error>> = payload
        .chunks(128 * 1024)
        .map(|slice| Ok(Bytes::copy_from_slice(slice)))
        .collect();
    let put_resp = client
        .put(format!(
            "{}/v8/artifacts/hash_4_5_mib?slug=monorepo",
            server.base_url
        ))
        .bearer_auth("test-turbo-token-secret")
        .header("x-artifact-tag", "sig-main-ed25519-xyz")
        .header("x-artifact-duration", "2450")
        .body(reqwest::Body::wrap_stream(stream::iter(chunks)))
        .send()
        .await?;
    assert_eq!(put_resp.status().as_u16(), 202);

    // Staging directory must contain zero leftover .part files.
    let staging_entries: Vec<_> =
        std::fs::read_dir(server.state.store.data_dir().join("staging"))?.collect();
    assert!(staging_entries.is_empty());

    // Sharded blob path must exist on disk.
    let blob_path = server
        .state
        .store
        .blob_path("turbo:monorepo", "hash_4_5_mib");
    assert!(blob_path.exists());

    // HEAD replays x-artifact-tag and exact Content-Length.
    let head_resp = client
        .head(format!(
            "{}/v8/artifacts/hash_4_5_mib?slug=monorepo",
            server.base_url
        ))
        .bearer_auth("test-turbo-token-secret")
        .send()
        .await?;
    assert_eq!(head_resp.status().as_u16(), 200);
    assert_eq!(
        head_resp
            .headers()
            .get("x-artifact-tag")
            .and_then(|v| v.to_str().ok()),
        Some("sig-main-ed25519-xyz")
    );
    assert_eq!(
        head_resp
            .headers()
            .get("content-length")
            .and_then(|v| v.to_str().ok()),
        Some(total_size.to_string().as_str())
    );

    // GET streams full 4.5 MiB artifact back with identical SHA-256 and signature header.
    let get_resp = client
        .get(format!(
            "{}/v8/artifacts/hash_4_5_mib?slug=monorepo",
            server.base_url
        ))
        .bearer_auth("test-turbo-token-secret")
        .send()
        .await?;
    assert_eq!(get_resp.status().as_u16(), 200);
    assert_eq!(
        get_resp
            .headers()
            .get("x-artifact-tag")
            .and_then(|v| v.to_str().ok()),
        Some("sig-main-ed25519-xyz")
    );
    let downloaded = get_resp.bytes().await?;
    assert_eq!(downloaded.len(), total_size);
    assert_eq!(hex::encode(Sha256::digest(&downloaded)), expected_sha);

    // Oversized streaming upload (7 MiB > 6 MiB limit) returns 413 and cleans up staging.
    let oversized = deterministic_payload(7 * 1024 * 1024, 9);
    let over_chunks: Vec<Result<Bytes, std::io::Error>> = oversized
        .chunks(256 * 1024)
        .map(|slice| Ok(Bytes::copy_from_slice(slice)))
        .collect();
    let over_resp = client
        .put(format!(
            "{}/v8/artifacts/too_big_hash?slug=monorepo",
            server.base_url
        ))
        .bearer_auth("test-turbo-token-secret")
        .body(reqwest::Body::wrap_stream(stream::iter(over_chunks)))
        .send()
        .await?;
    assert_eq!(over_resp.status().as_u16(), 413);
    let staging_after: Vec<_> =
        std::fs::read_dir(server.state.store.data_dir().join("staging"))?.collect();
    assert!(staging_after.is_empty());

    // Turbo events endpoint increments Prometheus counters.
    let events_resp = client
        .post(format!("{}/v8/artifacts/events", server.base_url))
        .bearer_auth("test-turbo-token-secret")
        .json(&serde_json::json!([
            { "sessionId": "s1", "source": "REMOTE", "event": "HIT", "hash": "hash_4_5_mib", "duration": 1800 },
            { "sessionId": "s1", "source": "REMOTE", "event": "MISS", "hash": "other_hash", "duration": 500 }
        ]))
        .send()
        .await?;
    assert_eq!(events_resp.status().as_u16(), 200);

    // /v8/clean deletes only stale entries matching olderThan=<days>.
    let put_second = client
        .put(format!(
            "{}/v8/artifacts/fresh_hash?slug=monorepo",
            server.base_url
        ))
        .bearer_auth("test-turbo-token-secret")
        .body(b"fresh-artifact".to_vec())
        .send()
        .await?;
    assert_eq!(put_second.status().as_u16(), 202);

    let fifteen_days_ago = now_unix_secs() - 15 * 86_400;
    server
        .state
        .store
        .set_entry_timestamps(
            "turbo:monorepo",
            "hash_4_5_mib",
            fifteen_days_ago,
            fifteen_days_ago,
        )
        .await?;

    let clean_resp = client
        .post(format!(
            "{}/v8/clean?slug=monorepo&olderThan=14",
            server.base_url
        ))
        .bearer_auth("test-turbo-token-secret")
        .send()
        .await?;
    assert_eq!(clean_resp.status().as_u16(), 200);
    let clean_body: serde_json::Value = clean_resp.json().await?;
    assert_eq!(
        clean_body,
        serde_json::json!({ "deleted": 1, "scanned": 2 })
    );
    assert!(!blob_path.exists());

    // Fresh entry remains intact.
    let fresh_get = client
        .get(format!(
            "{}/v8/artifacts/fresh_hash?slug=monorepo",
            server.base_url
        ))
        .bearer_auth("test-turbo-token-secret")
        .send()
        .await?;
    assert_eq!(fresh_get.status().as_u16(), 200);

    let metrics_text = client
        .get(format!("{}/metrics", server.base_url))
        .send()
        .await?
        .text()
        .await?;
    assert!(
        metrics_text.contains("ci_cache_turbo_events_total{source=\"REMOTE\",event=\"HIT\"} 1")
    );
    assert!(metrics_text.contains("ci_cache_saved_duration_ms_total{source=\"REMOTE\"} 1800"));

    server.stop().await;
    Ok(())
}

#[tokio::test]
async fn enforces_gradle_poisoning_boundary_and_sccache_copy_on_write_overlay() -> TestResult {
    let server = TestServer::start_with(|_| {}).await?;
    let client = reqwest::Client::builder().no_proxy().build()?;

    // Gradle: ci-main stores 3 MiB entry; ci-pull-request reads it (200) but cannot PUT (403).
    let gradle_blob = deterministic_payload(3 * 1024 * 1024, 42);
    let g_put = client
        .put(format!("{}/cache/build-key-3mib", server.base_url))
        .basic_auth("ci-main", Some("gradle-write-pw"))
        .body(gradle_blob.clone())
        .send()
        .await?;
    assert_eq!(g_put.status().as_u16(), 201);

    let g_get_pr = client
        .get(format!("{}/cache/build-key-3mib", server.base_url))
        .basic_auth("ci-pull-request", Some("gradle-read-pw"))
        .send()
        .await?;
    assert_eq!(g_get_pr.status().as_u16(), 200);
    assert_eq!(g_get_pr.bytes().await?.as_ref(), gradle_blob.as_slice());

    let g_put_pr = client
        .put(format!("{}/cache/build-key-3mib", server.base_url))
        .basic_auth("ci-pull-request", Some("gradle-read-pw"))
        .body(b"tampered".to_vec())
        .send()
        .await?;
    assert_eq!(g_put_pr.status().as_u16(), 403);

    // Verify original Gradle entry was not overwritten.
    let g_get_main = client
        .get(format!("{}/cache/build-key-3mib", server.base_url))
        .basic_auth("ci-main", Some("gradle-write-pw"))
        .send()
        .await?;
    assert_eq!(g_get_main.bytes().await?.as_ref(), gradle_blob.as_slice());

    // sccache WebDAV: MKCOL + copy-on-write PR overlay isolation.
    let mkcol = Method::from_bytes(b"MKCOL")?;
    let mkcol_resp = client
        .request(mkcol, format!("{}/sccache/0a/1b/", server.base_url))
        .basic_auth("ci-main", Some("gradle-write-pw"))
        .send()
        .await?;
    assert_eq!(mkcol_resp.status().as_u16(), 201);

    // 1. Main writes shared object -> sccache:trusted.
    let put_main = client
        .put(format!("{}/sccache/0a/1b/shared_crate", server.base_url))
        .basic_auth("ci-main", Some("gradle-write-pw"))
        .body(b"trusted-main-bytes".to_vec())
        .send()
        .await?;
    assert_eq!(put_main.status().as_u16(), 201);

    // 2. PR gets warm hit from sccache:trusted!
    let pr_warm_head = client
        .head(format!("{}/sccache/0a/1b/shared_crate", server.base_url))
        .basic_auth("ci-pull-request", Some("gradle-read-pw"))
        .send()
        .await?;
    assert_eq!(pr_warm_head.status().as_u16(), 200);

    let pr_warm_get = client
        .get(format!("{}/sccache/0a/1b/shared_crate", server.base_url))
        .basic_auth("ci-pull-request", Some("gradle-read-pw"))
        .send()
        .await?;
    assert_eq!(pr_warm_get.status().as_u16(), 200);
    assert_eq!(pr_warm_get.bytes().await?.as_ref(), b"trusted-main-bytes");

    // 3. PR writes both a brand-new key AND shadows shared_crate -> lands ONLY in sccache:pr!
    let pr_put_new = client
        .put(format!("{}/sccache/0a/1b/pr_only_crate", server.base_url))
        .basic_auth("ci-pull-request", Some("gradle-read-pw"))
        .body(b"pr-new-bytes".to_vec())
        .send()
        .await?;
    assert_eq!(pr_put_new.status().as_u16(), 201);

    let pr_put_shadow = client
        .put(format!("{}/sccache/0a/1b/shared_crate", server.base_url))
        .basic_auth("ci-pull-request", Some("gradle-read-pw"))
        .body(b"pr-shadow-bytes".to_vec())
        .send()
        .await?;
    assert_eq!(pr_put_shadow.status().as_u16(), 201);

    // 4. PR follow-up commits see both PR keys, while ci-main never sees PR writes!
    let pr_read_new = client
        .get(format!("{}/sccache/0a/1b/pr_only_crate", server.base_url))
        .basic_auth("ci-pull-request", Some("gradle-read-pw"))
        .send()
        .await?;
    assert_eq!(pr_read_new.bytes().await?.as_ref(), b"pr-new-bytes");

    let pr_read_shadow = client
        .get(format!("{}/sccache/0a/1b/shared_crate", server.base_url))
        .basic_auth("ci-pull-request", Some("gradle-read-pw"))
        .send()
        .await?;
    assert_eq!(pr_read_shadow.bytes().await?.as_ref(), b"pr-shadow-bytes");

    let main_read_pr_only = client
        .get(format!("{}/sccache/0a/1b/pr_only_crate", server.base_url))
        .basic_auth("ci-main", Some("gradle-write-pw"))
        .send()
        .await?;
    assert_eq!(main_read_pr_only.status().as_u16(), 404);

    let main_read_shared = client
        .get(format!("{}/sccache/0a/1b/shared_crate", server.base_url))
        .basic_auth("ci-main", Some("gradle-write-pw"))
        .send()
        .await?;
    assert_eq!(
        main_read_shared.bytes().await?.as_ref(),
        b"trusted-main-bytes"
    );

    server.stop().await;
    Ok(())
}

#[tokio::test]
async fn guards_against_write_amplification_on_cache_hits() -> TestResult {
    let server = TestServer::start_with(|_| {}).await?;
    let client = reqwest::Client::builder().no_proxy().build()?;

    client
        .put(format!(
            "{}/v8/artifacts/hot_artifact?slug=monorepo",
            server.base_url
        ))
        .bearer_auth("test-turbo-token-secret")
        .body(b"frequently-read-artifact".to_vec())
        .send()
        .await?;

    let commits_before_reads = server.state.store.writer_commit_count();
    assert_eq!(commits_before_reads, 1);

    for _ in 0..20 {
        let g = client
            .get(format!(
                "{}/v8/artifacts/hot_artifact?slug=monorepo",
                server.base_url
            ))
            .bearer_auth("test-turbo-token-secret")
            .send()
            .await?;
        assert_eq!(g.status().as_u16(), 200);
        let _ = g.bytes().await?;

        let h = client
            .head(format!(
                "{}/v8/artifacts/hot_artifact?slug=monorepo",
                server.base_url
            ))
            .bearer_auth("test-turbo-token-secret")
            .send()
            .await?;
        assert_eq!(h.status().as_u16(), 200);
    }

    // Zero synchronous SQLite write commits occurred across 40 cache hits!
    assert_eq!(
        server.state.store.writer_commit_count(),
        commits_before_reads
    );

    // /api/summary still reflects all 40 hits in real time without flushing to disk.
    let summary_before_flush: serde_json::Value = client
        .get(format!("{}/api/summary", server.base_url))
        .send()
        .await?
        .json()
        .await?;
    assert_eq!(summary_before_flush["window24h"]["hits"].as_u64(), Some(40));
    assert_eq!(
        server.state.store.writer_commit_count(),
        commits_before_reads
    );

    // Single batched flush persists all 40 hits in 1 SQLite transaction.
    let flushed = server.state.store.flush_pending_deltas().await?;
    assert_eq!(flushed, 1);
    assert_eq!(
        server.state.store.writer_commit_count(),
        commits_before_reads + 1
    );

    let summary_after_flush: serde_json::Value = client
        .get(format!("{}/api/summary", server.base_url))
        .send()
        .await?
        .json()
        .await?;
    assert_eq!(summary_after_flush["window24h"]["hits"].as_u64(), Some(40));
    assert_eq!(
        summary_after_flush["largestEntries"][0]["hitCount"].as_u64(),
        Some(40)
    );

    server.stop().await;
    Ok(())
}

#[tokio::test]
async fn evicts_expired_ttls_per_namespace_and_enforces_byte_watermarks() -> TestResult {
    let server = TestServer::start_with(|cfg| {
        cfg.high_watermark_bytes = 3 * MIB;
        cfg.low_watermark_bytes = 2 * MIB;
        cfg.quota_bytes = 4 * MIB;
    })
    .await?;
    let client = reqwest::Client::builder().no_proxy().build()?;

    // 1. Per-namespace TTL check:
    // turbo:monorepo & sccache:pr = 14d; gradle:main & sccache:trusted = 30d.
    client
        .put(format!(
            "{}/v8/artifacts/turbo_15d?slug=monorepo",
            server.base_url
        ))
        .bearer_auth("test-turbo-token-secret")
        .body(b"old-turbo".to_vec())
        .send()
        .await?;
    client
        .put(format!("{}/sccache/aa/bb/pr_15d", server.base_url))
        .basic_auth("ci-pull-request", Some("gradle-read-pw"))
        .body(b"old-pr-sccache".to_vec())
        .send()
        .await?;
    client
        .put(format!("{}/cache/gradle_20d", server.base_url))
        .basic_auth("ci-main", Some("gradle-write-pw"))
        .body(b"twenty-day-gradle".to_vec())
        .send()
        .await?;
    client
        .put(format!("{}/sccache/aa/bb/trusted_31d", server.base_url))
        .basic_auth("ci-main", Some("gradle-write-pw"))
        .body(b"expired-trusted-sccache".to_vec())
        .send()
        .await?;

    let now = now_unix_secs();
    server
        .state
        .store
        .set_entry_timestamps(
            "turbo:monorepo",
            "turbo_15d",
            now - 15 * 86_400,
            now - 15 * 86_400,
        )
        .await?;
    server
        .state
        .store
        .set_entry_timestamps(
            "sccache:pr",
            "aa/bb/pr_15d",
            now - 15 * 86_400,
            now - 15 * 86_400,
        )
        .await?;
    server
        .state
        .store
        .set_entry_timestamps(
            "gradle:main",
            "gradle_20d",
            now - 20 * 86_400,
            now - 20 * 86_400,
        )
        .await?;
    server
        .state
        .store
        .set_entry_timestamps(
            "sccache:trusted",
            "aa/bb/trusted_31d",
            now - 31 * 86_400,
            now - 31 * 86_400,
        )
        .await?;

    let ttl_outcome = run_eviction_pass(&server.state).await?;
    assert_eq!(
        ttl_outcome.ttl_evicted_by_ns.get("turbo:monorepo"),
        Some(&1)
    );
    assert_eq!(ttl_outcome.ttl_evicted_by_ns.get("sccache:pr"), Some(&1));
    assert_eq!(
        ttl_outcome.ttl_evicted_by_ns.get("sccache:trusted"),
        Some(&1)
    );
    assert_eq!(ttl_outcome.ttl_evicted_by_ns.get("gradle:main"), None);

    // 20-day-old gradle:main entry (30d TTL) survives!
    let g_survives = client
        .get(format!("{}/cache/gradle_20d", server.base_url))
        .basic_auth("ci-main", Some("gradle-write-pw"))
        .send()
        .await?;
    assert_eq!(g_survives.status().as_u16(), 200);

    // 2. Watermark check: upload four 1 MiB entries (total ~4 MiB > 3 MiB high watermark)
    // and verify eviction trims oldest last_accessed_at down to <= 2 MiB low watermark.
    let one_mib = deterministic_payload(1024 * 1024, 3);
    for idx in 0..4_i64 {
        let hash = format!("wm_entry_{idx}");
        client
            .put(format!(
                "{}/v8/artifacts/{hash}?slug=monorepo",
                server.base_url
            ))
            .bearer_auth("test-turbo-token-secret")
            .body(one_mib.clone())
            .send()
            .await?;
        let ts = now - (100 - idx * 10);
        server
            .state
            .store
            .set_entry_timestamps("turbo:monorepo", &hash, ts, ts)
            .await?;
    }

    let wm_outcome = run_eviction_pass(&server.state).await?;
    let total_wm_evicted: u64 = wm_outcome.watermark_evicted_by_ns.values().sum();
    assert!(total_wm_evicted >= 2);

    let summary = server.state.store.summary(&server.state.config).await?;
    assert!(summary.total_stored_bytes <= 2 * MIB);

    // Newest entries (wm_entry_2, wm_entry_3) remain; oldest (wm_entry_0) was evicted.
    let newest = client
        .get(format!(
            "{}/v8/artifacts/wm_entry_3?slug=monorepo",
            server.base_url
        ))
        .bearer_auth("test-turbo-token-secret")
        .send()
        .await?;
    assert_eq!(newest.status().as_u16(), 200);

    let oldest = client
        .get(format!(
            "{}/v8/artifacts/wm_entry_0?slug=monorepo",
            server.base_url
        ))
        .bearer_auth("test-turbo-token-secret")
        .send()
        .await?;
    assert_eq!(oldest.status().as_u16(), 404);

    server.stop().await;
    Ok(())
}

#[tokio::test]
async fn smoke_self_test_passes_against_built_assets() -> TestResult {
    let temp = TempDir::new()?;
    let static_dir: PathBuf = temp.path().join("client");
    std::fs::create_dir_all(static_dir.join("assets"))?;
    std::fs::write(
        static_dir.join("index.html"),
        "<!doctype html><html><body><div id=\"root\"></div><script type=\"module\" src=\"/assets/index-abc123.js\"></script></body></html>",
    )?;
    std::fs::write(
        static_dir.join("assets/index-abc123.js"),
        "console.log('smoke');",
    )?;

    smoke::run_smoke(Some(static_dir)).await?;
    Ok(())
}
