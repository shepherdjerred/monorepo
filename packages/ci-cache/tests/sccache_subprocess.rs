use std::net::{IpAddr, Ipv4Addr, SocketAddr, TcpListener};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Arc;

use ci_cache::config::{
    Config, DEFAULT_EVICT_INTERVAL_SECS, DEFAULT_FLUSH_INTERVAL_SECS, DEFAULT_GRADLE_TTL_SECS,
    DEFAULT_HIGH_WATERMARK_BYTES, DEFAULT_LOW_WATERMARK_BYTES, DEFAULT_QUOTA_BYTES,
    DEFAULT_SCCACHE_PR_TTL_SECS, DEFAULT_SCCACHE_TRUSTED_TTL_SECS, DEFAULT_TURBO_TTL_SECS,
    GRADLE_MAX_BODY_BYTES, SCCACHE_MAX_BODY_BYTES, TURBO_MAX_BODY_BYTES,
};
use ci_cache::{AppState, build_router};
use tempfile::TempDir;

type TestResult = Result<(), Box<dyn std::error::Error>>;

fn locate_tool(env_override: &str, name: &str) -> Result<PathBuf, Box<dyn std::error::Error>> {
    if let Ok(explicit) = std::env::var(env_override) {
        let path = PathBuf::from(explicit.trim());
        if path.is_file() {
            return Ok(path);
        }
    }
    if let Some(path_os) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&path_os) {
            let candidate = dir.join(name);
            if candidate.is_file() {
                return Ok(candidate);
            }
        }
    }
    let mise_out = Command::new("mise").args(["which", name]).output()?;
    if mise_out.status.success() {
        let resolved = String::from_utf8(mise_out.stdout)?;
        let path = PathBuf::from(resolved.trim());
        if path.is_file() {
            return Ok(path);
        }
    }
    Err(format!("required tool '{name}' not found on PATH or via `mise which {name}`").into())
}

fn reserve_ephemeral_port() -> Result<u16, std::io::Error> {
    let listener = TcpListener::bind(SocketAddr::from(([127, 0, 0, 1], 0)))?;
    let port = listener.local_addr()?.port();
    drop(listener);
    Ok(port)
}

struct IsolatedSccacheDaemon {
    sccache_bin: PathBuf,
    port: u16,
    endpoint: String,
    username: String,
    password: String,
}

impl IsolatedSccacheDaemon {
    fn new(
        sccache_bin: PathBuf,
        endpoint: String,
        username: &str,
        password: &str,
    ) -> Result<Self, std::io::Error> {
        Ok(Self {
            sccache_bin,
            port: reserve_ephemeral_port()?,
            endpoint,
            username: username.to_owned(),
            password: password.to_owned(),
        })
    }

    fn configure_cmd(&self, cmd: &mut Command) {
        cmd.env("SCCACHE_SERVER_PORT", self.port.to_string())
            .env("SCCACHE_IDLE_TIMEOUT", "30")
            .env("SCCACHE_WEBDAV_ENDPOINT", &self.endpoint)
            .env("SCCACHE_WEBDAV_USERNAME", &self.username)
            .env("SCCACHE_WEBDAV_PASSWORD", &self.password)
            .env_remove("SCCACHE_DIR")
            .env_remove("SCCACHE_CONF")
            .env_remove("SCCACHE_CACHED_CONF")
            .env_remove("SCCACHE_BUCKET")
            .env_remove("SCCACHE_REDIS")
            .env_remove("SCCACHE_MEMCACHED")
            .env_remove("SCCACHE_GCS_BUCKET")
            .env_remove("SCCACHE_AZURE_CONNECTION_STRING")
            .env_remove("SCCACHE_GHA_ENABLED");
    }

    fn stats_json(&self) -> Result<serde_json::Value, Box<dyn std::error::Error>> {
        let mut cmd = Command::new(&self.sccache_bin);
        self.configure_cmd(&mut cmd);
        let output = cmd.args(["--show-stats", "--stats-format=json"]).output()?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("sccache --show-stats failed: {stderr}").into());
        }
        let parsed: serde_json::Value = serde_json::from_slice(&output.stdout)?;
        Ok(parsed)
    }

    fn stop(&self) {
        let mut cmd = Command::new(&self.sccache_bin);
        self.configure_cmd(&mut cmd);
        let _ = cmd.arg("--stop-server").output();
    }
}

impl Drop for IsolatedSccacheDaemon {
    fn drop(&mut self) {
        self.stop();
    }
}

fn sum_counts_field(stats_root: &serde_json::Value, field: &str) -> u64 {
    let Some(entry) = stats_root.get("stats").and_then(|s| s.get(field)) else {
        return 0;
    };
    if let Some(direct) = entry.as_u64() {
        return direct;
    }
    entry
        .get("counts")
        .and_then(serde_json::Value::as_object)
        .map_or(0, |map| {
            map.values()
                .filter_map(serde_json::Value::as_u64)
                .sum::<u64>()
        })
}

fn run_cargo_with_sccache(
    cargo_bin: &Path,
    crate_dir: &Path,
    daemon: &IsolatedSccacheDaemon,
    args: &[&str],
) -> Result<(), Box<dyn std::error::Error>> {
    let mut cmd = Command::new(cargo_bin);
    daemon.configure_cmd(&mut cmd);
    cmd.current_dir(crate_dir)
        .env("RUSTC_WRAPPER", &daemon.sccache_bin)
        .env("CARGO_INCREMENTAL", "0")
        .args(args);
    let out = cmd.output()?;
    if !out.status.success() {
        let stdout = String::from_utf8_lossy(&out.stdout);
        let stderr = String::from_utf8_lossy(&out.stderr);
        return Err(format!(
            "cargo {:?} failed (status {}):\nstdout:\n{stdout}\nstderr:\n{stderr}",
            args, out.status
        )
        .into());
    }
    Ok(())
}

#[tokio::test]
async fn real_sccache_binary_populates_and_hits_webdav_cache_with_pr_overlay() -> TestResult {
    let sccache_bin = locate_tool("SCCACHE_BIN", "sccache")?;
    let cargo_bin = locate_tool("CARGO", "cargo")?;

    let temp = TempDir::new()?;
    let config = Config {
        host: IpAddr::V4(Ipv4Addr::LOCALHOST),
        port: 0,
        data_dir: temp.path().join("cache-data"),
        static_dir: temp.path().join("static"),
        turbo_token: Some("unused-turbo-token".to_owned()),
        gradle_write_user: "ci-main".to_owned(),
        gradle_write_password: Some("main-webdav-pw".to_owned()),
        gradle_read_user: "ci-pull-request".to_owned(),
        gradle_read_password: Some("pr-webdav-pw".to_owned()),
        sccache_write_user: "ci-main".to_owned(),
        sccache_write_password: Some("main-webdav-pw".to_owned()),
        sccache_read_user: "ci-pull-request".to_owned(),
        sccache_read_password: Some("pr-webdav-pw".to_owned()),
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
    let router = build_router(Arc::clone(&state));
    let listener = tokio::net::TcpListener::bind(SocketAddr::from(([127, 0, 0, 1], 0))).await?;
    let addr = listener.local_addr()?;
    let (shutdown_tx, mut shutdown_rx) = tokio::sync::watch::channel(false);
    let server_handle = tokio::spawn(async move {
        let _ = axum::serve(listener, router)
            .with_graceful_shutdown(async move {
                let _ = shutdown_rx.changed().await;
            })
            .await;
    });

    // Create a scratch multi-crate or lib+bin Rust project so rustc produces cacheable .rlib units.
    let scratch_dir = temp.path().join("scratch-crate");
    std::fs::create_dir_all(scratch_dir.join("src"))?;
    std::fs::write(
        scratch_dir.join("Cargo.toml"),
        "[package]\nname = \"sccache_scratch_probe\"\nversion = \"0.1.0\"\nedition = \"2021\"\n",
    )?;
    std::fs::write(
        scratch_dir.join("src/lib.rs"),
        "pub fn compute_answer(seed: u64) -> u64 { seed.wrapping_mul(6364136223846793005).wrapping_add(1) }\n",
    )?;
    std::fs::write(
        scratch_dir.join("src/main.rs"),
        "fn main() { println!(\"{}\", sccache_scratch_probe::compute_answer(42)); }\n",
    )?;

    let endpoint = format!("http://{addr}/sccache/");
    let cargo_for_cold = cargo_bin.clone();
    let scratch_for_cold = scratch_dir.clone();
    let sccache_for_cold = sccache_bin.clone();
    let endpoint_for_cold = endpoint.clone();

    // 1. Cold compile as `ci-main` -> populates `sccache:trusted` over WebDAV.
    let cold_stats =
        tokio::task::spawn_blocking(
            move || -> Result<serde_json::Value, Box<dyn std::error::Error + Send + Sync>> {
                let daemon = IsolatedSccacheDaemon::new(
                    sccache_for_cold,
                    endpoint_for_cold,
                    "ci-main",
                    "main-webdav-pw",
                )?;
                run_cargo_with_sccache(&cargo_for_cold, &scratch_for_cold, &daemon, &["build"])
                    .map_err(|e| -> Box<dyn std::error::Error + Send + Sync> {
                        e.to_string().into()
                    })?;
                let stats = daemon.stats_json().map_err(
                    |e| -> Box<dyn std::error::Error + Send + Sync> { e.to_string().into() },
                )?;
                daemon.stop();
                Ok(stats)
            },
        )
        .await?
        .map_err(|e| -> Box<dyn std::error::Error> { e.to_string().into() })?;

    let cold_writes = cold_stats["stats"]["cache_writes"].as_u64().unwrap_or(0);
    assert!(
        cold_writes > 0,
        "expected cold sccache compile to write > 0 WebDAV objects, stats: {cold_stats}"
    );

    // Verify ci-cache stored the compiled artifact(s) in `sccache:trusted`.
    let summary_after_cold = state.store.summary(&state.config).await?;
    let trusted_ns = summary_after_cold
        .namespaces
        .iter()
        .find(|ns| ns.namespace == "sccache:trusted")
        .ok_or("missing sccache:trusted namespace")?;
    assert!(
        trusted_ns.entries > 0,
        "expected sccache:trusted to hold > 0 entries after cold build"
    );

    // 2. `cargo clean` + brand-new sccache daemon authenticated as `ci-pull-request` ->
    //    proves warm WebDAV hits across daemon restarts AND copy-on-write fallback from `sccache:trusted`!
    let cargo_for_warm = cargo_bin;
    let scratch_for_warm = scratch_dir;
    let sccache_for_warm = sccache_bin;
    let endpoint_for_warm = endpoint;

    let warm_stats =
        tokio::task::spawn_blocking(
            move || -> Result<serde_json::Value, Box<dyn std::error::Error + Send + Sync>> {
                let clean_status = Command::new(&cargo_for_warm)
                    .current_dir(&scratch_for_warm)
                    .arg("clean")
                    .status()?;
                if !clean_status.success() {
                    return Err("cargo clean failed".into());
                }

                let daemon = IsolatedSccacheDaemon::new(
                    sccache_for_warm,
                    endpoint_for_warm,
                    "ci-pull-request",
                    "pr-webdav-pw",
                )?;
                run_cargo_with_sccache(&cargo_for_warm, &scratch_for_warm, &daemon, &["build"])
                    .map_err(|e| -> Box<dyn std::error::Error + Send + Sync> {
                        e.to_string().into()
                    })?;
                let stats = daemon.stats_json().map_err(
                    |e| -> Box<dyn std::error::Error + Send + Sync> { e.to_string().into() },
                )?;
                daemon.stop();
                Ok(stats)
            },
        )
        .await?
        .map_err(|e| -> Box<dyn std::error::Error> { e.to_string().into() })?;

    let cache_hits = sum_counts_field(&warm_stats, "cache_hits");
    assert!(
        cache_hits > 0,
        "expected warm sccache compile after cargo clean to achieve cache_hits > 0, stats: {warm_stats}"
    );

    let _ = shutdown_tx.send(true);
    let _ = tokio::time::timeout(std::time::Duration::from_secs(2), server_handle).await;
    Ok(())
}
