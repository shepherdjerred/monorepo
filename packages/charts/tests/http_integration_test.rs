use std::collections::BTreeMap;
use std::error::Error;
use std::io::Write as _;
use std::net::SocketAddr;

use axum::Router;
use axum::body::Body;
use axum::http::Request;
use base64::Engine as _;
use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use charts::archive::{MAX_ARCHIVE_BYTES, build_chart_tgz};
use charts::auth::BasicAuthCredentials;
use charts::index_yaml::{CatalogSummaryResponse, ChartKind, ChartReleaseView, HelmIndexDocument};
use charts::metrics::AppMetrics;
use charts::routes::{AppState, build_router};
use charts::smoke::run_smoke;
use charts::storage::ChartStore;
use flate2::Compression;
use flate2::write::GzEncoder;
use reqwest::{Client, StatusCode, header};
use sha2::{Digest as _, Sha256};
use tar::{Builder, EntryType, Header};
use tempfile::TempDir;
use tokio::io::{AsyncReadExt as _, AsyncWriteExt as _};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::oneshot;
use tokio_util::io::ReaderStream;
use tower::ServiceExt as _;

struct TestServer {
    addr: SocketAddr,
    base_url: String,
    router: Router,
    data_dir: std::path::PathBuf,
    _temp_dir: TempDir,
    shutdown_tx: Option<oneshot::Sender<()>>,
    handle: tokio::task::JoinHandle<Result<(), std::io::Error>>,
}

impl TestServer {
    async fn start() -> Result<Self, Box<dyn Error>> {
        let temp_dir = TempDir::new()?;
        let data_dir = temp_dir.path().join("data");
        let static_dir = temp_dir.path().join("client");
        std::fs::create_dir_all(static_dir.join("assets"))?;
        std::fs::write(
            static_dir.join("index.html"),
            r#"<!doctype html><html><head><script type="module" src="/assets/main-deadbeef.js"></script></head><body><div id="root"></div></body></html>"#,
        )?;
        std::fs::write(
            static_dir.join("assets/main-deadbeef.js"),
            "console.log('charts client');\n",
        )?;

        let quota = 8_589_934_592_u64;
        let store = ChartStore::open(&data_dir, quota)?;
        let metrics = AppMetrics::new(quota);
        let basic_auth = Some(BasicAuthCredentials::new("ci-publisher", "ci-secret"));

        let app = build_router(AppState {
            store,
            metrics,
            basic_auth,
            static_dir,
        });
        let router = app.clone();

        let listener = TcpListener::bind("127.0.0.1:0").await?;
        let addr: SocketAddr = listener.local_addr()?;
        let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();
        let handle = tokio::spawn(async move {
            axum::serve(listener, app)
                .with_graceful_shutdown(async {
                    let _ = shutdown_rx.await;
                })
                .await
        });

        Ok(Self {
            addr,
            base_url: format!("http://{addr}"),
            router,
            data_dir,
            _temp_dir: temp_dir,
            shutdown_tx: Some(shutdown_tx),
            handle,
        })
    }

    async fn stop(mut self) -> Result<(), Box<dyn Error>> {
        if let Some(tx) = self.shutdown_tx.take() {
            let _ = tx.send(());
        }
        self.handle.await??;
        Ok(())
    }
}

#[tokio::test]
async fn upload_idempotency_immutability_index_and_download_roundtrip() -> Result<(), Box<dyn Error>>
{
    let server = TestServer::start().await?;
    let client = Client::new();

    // Empty catalog checks
    let missing_resp = client
        .get(format!("{}/api/charts/arcade", server.base_url))
        .send()
        .await?;
    assert_eq!(missing_resp.status(), StatusCode::NOT_FOUND);

    let archive_v1 = build_chart_tgz(
        "scout-beta",
        "2.0.0-100001",
        "2.0.0-100001",
        "Scout beta chart",
        Some("sha256:1111111111111111111111111111111111111111111111111111111111111111"),
        "image: v1\n",
    )?;
    let digest_v1 = hex::encode(Sha256::digest(&archive_v1));
    assert_eq!(digest_v1.len(), 64);

    let archive_v2 = build_chart_tgz(
        "scout-beta",
        "2.0.0-100010",
        "2.0.0-100010",
        "Scout beta chart",
        Some("sha256:2222222222222222222222222222222222222222222222222222222222222222"),
        "image: v2\n",
    )?;
    let digest_v2 = hex::encode(Sha256::digest(&archive_v2));

    let upstream_archive = build_chart_tgz(
        "cert-manager",
        "v1.21.2",
        "v1.21.2",
        "Cloud Native Certificate Management",
        None,
        "crds:\n  enabled: true\n",
    )?;
    let digest_upstream = hex::encode(Sha256::digest(&upstream_archive));

    // 401 without credentials & with wrong credentials
    let no_auth = client
        .post(format!("{}/api/charts", server.base_url))
        .body(archive_v1.clone())
        .send()
        .await?;
    assert_eq!(no_auth.status(), StatusCode::UNAUTHORIZED);
    assert!(no_auth.headers().contains_key(header::WWW_AUTHENTICATE));

    let wrong_auth = client
        .post(format!("{}/api/charts", server.base_url))
        .basic_auth("ci-publisher", Some("wrong-secret"))
        .body(archive_v1.clone())
        .send()
        .await?;
    assert_eq!(wrong_auth.status(), StatusCode::UNAUTHORIZED);

    // 201 Created on initial uploads
    for payload in [&archive_v1, &archive_v2, &upstream_archive] {
        let created = client
            .post(format!("{}/api/charts", server.base_url))
            .basic_auth("ci-publisher", Some("ci-secret"))
            .body(payload.clone())
            .send()
            .await?;
        assert_eq!(created.status(), StatusCode::CREATED);
        let json: serde_json::Value = created.json().await?;
        assert_eq!(
            json.get("saved").and_then(serde_json::Value::as_bool),
            Some(true)
        );
    }

    // 200 OK idempotent retry with identical bytes
    let retry = client
        .post(format!("{}/api/charts", server.base_url))
        .basic_auth("ci-publisher", Some("ci-secret"))
        .body(archive_v2.clone())
        .send()
        .await?;
    assert_eq!(retry.status(), StatusCode::OK);
    let retry_json: serde_json::Value = retry.json().await?;
    assert_eq!(
        retry_json
            .get("idempotent")
            .and_then(serde_json::Value::as_bool),
        Some(true)
    );

    // 409 Conflict when uploading mutated bytes for existing (name, version)
    let mutated_v2 = build_chart_tgz(
        "scout-beta",
        "2.0.0-100010",
        "2.0.0-100010",
        "Scout beta chart mutated",
        None,
        "image: mutated\n",
    )?;
    let conflict = client
        .post(format!("{}/api/charts", server.base_url))
        .basic_auth("ci-publisher", Some("ci-secret"))
        .body(mutated_v2)
        .send()
        .await?;
    assert_eq!(conflict.status(), StatusCode::CONFLICT);

    // GET /api/charts/:name returns newest version first (100010 before 100001)
    let scout_releases: Vec<ChartReleaseView> = client
        .get(format!("{}/api/charts/scout-beta", server.base_url))
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    assert_eq!(scout_releases.len(), 2);
    assert_eq!(scout_releases[0].version, "2.0.0-100010");
    assert_eq!(scout_releases[0].digest, digest_v2);
    assert_eq!(
        scout_releases[0].urls,
        vec!["charts/scout-beta-2.0.0-100010.tgz".to_owned()]
    );
    assert_eq!(scout_releases[1].version, "2.0.0-100001");
    assert_eq!(scout_releases[1].digest, digest_v1);

    // GET /api/charts/:name/:version
    let single: ChartReleaseView = client
        .get(format!(
            "{}/api/charts/cert-manager/v1.21.2",
            server.base_url
        ))
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    assert_eq!(single.digest, digest_upstream);
    assert_eq!(single.content_fingerprint, None);

    // GET /api/summary
    let summary: CatalogSummaryResponse = client
        .get(format!("{}/api/summary", server.base_url))
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    assert_eq!(summary.chart_count, 2);
    assert_eq!(summary.release_count, 3);
    assert_eq!(summary.catalog_revision, 3);
    assert_eq!(summary.charts.len(), 2);
    assert_eq!(summary.charts[0].name, "cert-manager");
    assert_eq!(summary.charts[0].kind, ChartKind::Upstream);
    assert_eq!(summary.charts[1].name, "scout-beta");
    assert_eq!(summary.charts[1].kind, ChartKind::FirstParty);

    // GET /index.yaml schema + ETag + 304 Not Modified
    let index_resp = client
        .get(format!("{}/index.yaml", server.base_url))
        .send()
        .await?;
    assert_eq!(index_resp.status(), StatusCode::OK);
    let etag = index_resp
        .headers()
        .get(header::ETAG)
        .and_then(|v| v.to_str().ok())
        .ok_or("missing ETag on /index.yaml")?
        .to_owned();
    assert!(etag.starts_with("\"rev-3-"));
    let yaml_body = index_resp.text().await?;
    let parsed_index: HelmIndexDocument = serde_norway::from_str(&yaml_body)?;
    assert_eq!(parsed_index.api_version, "v1");
    let index_scout = parsed_index
        .entries
        .get("scout-beta")
        .ok_or("scout-beta missing from index.yaml")?;
    assert_eq!(index_scout[0].version, "2.0.0-100010");
    assert_eq!(index_scout[0].digest, digest_v2);
    assert!(!index_scout[0].digest.starts_with("sha256:"));

    let cached_index = client
        .get(format!("{}/index.yaml", server.base_url))
        .header(header::IF_NONE_MATCH, &etag)
        .send()
        .await?;
    assert_eq!(cached_index.status(), StatusCode::NOT_MODIFIED);

    // GET /charts/:filename with hyphenated chart AND hyphenated version
    let dl_resp = client
        .get(format!(
            "{}/charts/scout-beta-2.0.0-100010.tgz",
            server.base_url
        ))
        .send()
        .await?;
    assert_eq!(dl_resp.status(), StatusCode::OK);
    assert_eq!(
        dl_resp
            .headers()
            .get(header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok()),
        Some("application/gzip")
    );
    assert_eq!(
        dl_resp
            .headers()
            .get(header::CACHE_CONTROL)
            .and_then(|v| v.to_str().ok()),
        Some("public, max-age=31536000, immutable")
    );
    let dl_bytes = dl_resp.bytes().await?;
    assert_eq!(dl_bytes.as_ref(), archive_v2.as_slice());

    // Path traversal rejection on /charts/:filename
    for bad_path in [
        "/charts/..%2fcharts.sqlite3",
        "/charts/bad..name.tgz",
        "/charts/UPPERCASE-1.0.0.tgz",
        "/charts/not-a-tgz.yaml",
    ] {
        let bad_resp = client
            .get(format!("{}{bad_path}", server.base_url))
            .send()
            .await?;
        assert!(
            matches!(
                bad_resp.status(),
                StatusCode::BAD_REQUEST | StatusCode::NOT_FOUND
            ),
            "unexpected status {} for {bad_path}",
            bad_resp.status()
        );
    }

    // GET /api/charts map
    let all_map: BTreeMap<String, Vec<ChartReleaseView>> = client
        .get(format!("{}/api/charts", server.base_url))
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    assert_eq!(all_map.len(), 2);

    // Verify SQLite WAL file and immutable blob exist on disk
    assert!(server.data_dir.join("charts.sqlite3").is_file());
    assert!(
        server
            .data_dir
            .join("blobs/scout-beta-2.0.0-100010.tgz")
            .is_file()
    );

    server.stop().await?;
    Ok(())
}

#[tokio::test]
async fn rejects_oversized_body_tar_slip_symlinks_and_duplicate_chart_yaml()
-> Result<(), Box<dyn Error>> {
    let server = TestServer::start().await?;
    let client = Client::new();

    // 1. >16 MiB body -> 413 Payload Too Large (both Content-Length fast-reject over TCP
    //    without flooding unread socket bytes after close, and streaming body limit).
    let auth_header = format!("Basic {}", BASE64_STANDARD.encode("ci-publisher:ci-secret"));
    let oversized_len = MAX_ARCHIVE_BYTES + 1024;
    let mut tcp = TcpStream::connect(server.addr).await?;
    let raw_req = format!(
        "POST /api/charts HTTP/1.1\r\nHost: {}\r\nAuthorization: {auth_header}\r\nContent-Length: {oversized_len}\r\nConnection: close\r\n\r\n",
        server.addr,
    );
    tcp.write_all(raw_req.as_bytes()).await?;
    let mut raw_resp = String::new();
    tcp.read_to_string(&mut raw_resp).await?;
    assert!(
        raw_resp.starts_with("HTTP/1.1 413 "),
        "expected HTTP/1.1 413 response, got: {raw_resp}"
    );

    let stream_body = Body::from_stream(ReaderStream::new(
        tokio::io::repeat(0_u8).take(oversized_len as u64),
    ));
    let stream_resp = server
        .router
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/charts")
                .header(header::AUTHORIZATION, &auth_header)
                .body(stream_body)?,
        )
        .await?;
    assert_eq!(stream_resp.status(), StatusCode::PAYLOAD_TOO_LARGE);

    // 2. Tar-slip path (`../evil`) -> 400 Bad Request
    let tar_slip = build_raw_tar_gz(|tar_bytes| {
        write_raw_tar_entry(
            tar_bytes,
            b"../evil.txt",
            EntryType::Regular,
            b"owned",
            None,
        );
    })?;
    let slip_resp = client
        .post(format!("{}/api/charts", server.base_url))
        .basic_auth("ci-publisher", Some("ci-secret"))
        .body(tar_slip)
        .send()
        .await?;
    assert_eq!(slip_resp.status(), StatusCode::BAD_REQUEST);

    // 3. Symlink entry -> 400 Bad Request
    let symlink_tgz = build_custom_archive(|builder| {
        let mut header = Header::new_gnu();
        header.set_entry_type(EntryType::Symlink);
        header.set_size(0);
        header.set_mode(0o777);
        header.set_cksum();
        builder.append_link(&mut header, "evil/Chart.yaml", "/etc/passwd")?;
        Ok(())
    })?;
    let sym_resp = client
        .post(format!("{}/api/charts", server.base_url))
        .basic_auth("ci-publisher", Some("ci-secret"))
        .body(symlink_tgz)
        .send()
        .await?;
    assert_eq!(sym_resp.status(), StatusCode::BAD_REQUEST);

    // 4. Duplicate Chart.yaml -> 400 Bad Request
    let duplicate_chart_yaml = build_custom_archive(|builder| {
        let yaml = b"apiVersion: v2\nname: dup\nversion: 1.0.0\n";
        for _ in 0..2 {
            let mut header = Header::new_gnu();
            header.set_entry_type(EntryType::Regular);
            header.set_size(yaml.len() as u64);
            header.set_mode(0o644);
            header.set_cksum();
            builder.append_data(&mut header, "dup/Chart.yaml", &yaml[..])?;
        }
        Ok(())
    })?;
    let dup_resp = client
        .post(format!("{}/api/charts", server.base_url))
        .basic_auth("ci-publisher", Some("ci-secret"))
        .body(duplicate_chart_yaml)
        .send()
        .await?;
    assert_eq!(dup_resp.status(), StatusCode::BAD_REQUEST);

    // 5. Gzip bomb (>16 MiB unpacked from tiny .tgz) -> 400 Bad Request
    let gzip_bomb = build_custom_archive(|builder| {
        let yaml = b"apiVersion: v2\nname: bomb\nversion: 1.0.0\n";
        let mut h1 = Header::new_gnu();
        h1.set_entry_type(EntryType::Regular);
        h1.set_size(yaml.len() as u64);
        h1.set_mode(0o644);
        h1.set_cksum();
        builder.append_data(&mut h1, "bomb/Chart.yaml", &yaml[..])?;

        let zeros = vec![0_u8; 17 * 1024 * 1024];
        let mut h2 = Header::new_gnu();
        h2.set_entry_type(EntryType::Regular);
        h2.set_size(zeros.len() as u64);
        h2.set_mode(0o644);
        h2.set_cksum();
        builder.append_data(&mut h2, "bomb/values.yaml", zeros.as_slice())?;
        Ok(())
    })?;
    assert!(gzip_bomb.len() < 100_000);
    let bomb_resp = client
        .post(format!("{}/api/charts", server.base_url))
        .basic_auth("ci-publisher", Some("ci-secret"))
        .body(gzip_bomb)
        .send()
        .await?;
    assert_eq!(bomb_resp.status(), StatusCode::BAD_REQUEST);

    // None of the rejected archives may leave blobs on disk
    assert_eq!(std::fs::read_dir(server.data_dir.join("blobs"))?.count(), 0);

    server.stop().await?;
    Ok(())
}

#[test]
fn startup_reconciliation_cleans_staging_and_fails_on_corrupt_blob() -> Result<(), Box<dyn Error>> {
    let temp = TempDir::new()?;
    let data_dir = temp.path().join("data");
    let rt = tokio::runtime::Runtime::new()?;

    let archive = build_chart_tgz(
        "golink",
        "2.0.0-55",
        "2.0.0-55",
        "Go links chart",
        None,
        "port: 7352\n",
    )?;

    {
        let store = ChartStore::open(&data_dir, 1024 * 1024)?;
        let parsed = charts::archive::parse_chart_archive(&archive)?;
        rt.block_on(store.store_chart(&parsed, &archive))?;
    }

    // Leave an orphaned `.part` staging file; reopen must clean it and succeed.
    let orphan = data_dir.join("staging/orphan-upload.part");
    std::fs::write(&orphan, b"partial")?;
    assert!(orphan.exists());

    {
        let _reopened = ChartStore::open(&data_dir, 1024 * 1024)?;
        assert!(!orphan.exists());
    }

    // Truncate committed blob; reopen must fail fast!
    let blob_path = data_dir.join("blobs/golink-2.0.0-55.tgz");
    std::fs::write(&blob_path, b"truncated")?;
    let corrupt_open = ChartStore::open(&data_dir, 1024 * 1024);
    assert!(corrupt_open.is_err());

    Ok(())
}

#[tokio::test]
async fn smoke_runner_succeeds_end_to_end() -> Result<(), Box<dyn Error>> {
    let temp = TempDir::new()?;
    run_smoke(temp.path()).await?;
    Ok(())
}

fn build_custom_archive<F>(populate: F) -> Result<Vec<u8>, Box<dyn Error>>
where
    F: FnOnce(&mut Builder<GzEncoder<Vec<u8>>>) -> Result<(), Box<dyn Error>>,
{
    let encoder = GzEncoder::new(Vec::new(), Compression::fast());
    let mut builder = Builder::new(encoder);
    populate(&mut builder)?;
    let encoder = builder.into_inner()?;
    Ok(encoder.finish()?)
}

fn build_raw_tar_gz<F>(populate: F) -> Result<Vec<u8>, Box<dyn Error>>
where
    F: FnOnce(&mut Vec<u8>),
{
    let mut tar_bytes = Vec::new();
    populate(&mut tar_bytes);
    tar_bytes.extend_from_slice(&[0_u8; 1024]); // end-of-archive blocks
    let mut encoder = GzEncoder::new(Vec::new(), Compression::fast());
    encoder.write_all(&tar_bytes)?;
    Ok(encoder.finish()?)
}

fn write_raw_tar_entry(
    out: &mut Vec<u8>,
    path_bytes: &[u8],
    entry_type: EntryType,
    payload: &[u8],
    link_target: Option<&[u8]>,
) {
    let mut block = [0_u8; 512];
    let copy_len = path_bytes.len().min(100);
    block[..copy_len].copy_from_slice(&path_bytes[..copy_len]);
    block[100..108].copy_from_slice(b"0000644\0");
    block[108..116].copy_from_slice(b"0000000\0");
    block[116..124].copy_from_slice(b"0000000\0");
    let size_octal = format!("{:011o}\0", payload.len());
    block[124..136].copy_from_slice(size_octal.as_bytes());
    block[136..148].copy_from_slice(b"00000000000\0");
    block[148..156].fill(b' ');
    block[156] = entry_type.as_byte();
    if let Some(link) = link_target {
        let link_len = link.len().min(100);
        block[157..157 + link_len].copy_from_slice(&link[..link_len]);
    }
    block[257..263].copy_from_slice(b"ustar\0");
    block[263..265].copy_from_slice(b"00");

    let checksum: u32 = block.iter().map(|b| u32::from(*b)).sum();
    let cksum_str = format!("{checksum:06o}\0 ");
    block[148..156].copy_from_slice(cksum_str.as_bytes());

    out.extend_from_slice(&block);
    out.extend_from_slice(payload);
    let rem = payload.len() % 512;
    if rem != 0 {
        out.resize(out.len() + (512 - rem), 0);
    }
}
