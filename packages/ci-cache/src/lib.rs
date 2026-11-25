pub mod api;
pub mod auth;
pub mod config;
pub mod evictor;
pub mod gradle;
pub mod metrics;
pub mod sccache;
pub mod smoke;
pub mod store;
pub mod turbo;

use std::sync::Arc;

use axum::Router;
use axum::extract::DefaultBodyLimit;
use axum::routing::{any, get, post};

use crate::auth::BasicCredentials;
use crate::config::Config;
use crate::metrics::Metrics;
use crate::store::{CacheStore, StoreError};

pub struct AppState {
    pub config: Config,
    pub store: Arc<CacheStore>,
    pub metrics: Arc<Metrics>,
    pub gradle_creds: BasicCredentials,
    pub sccache_creds: BasicCredentials,
}

impl AppState {
    pub fn new(config: Config) -> Result<Self, StoreError> {
        let store = CacheStore::open(&config.data_dir)?;
        let metrics = Arc::new(Metrics::new(
            config.quota_bytes,
            config.high_watermark_bytes,
            config.low_watermark_bytes,
        ));
        let gradle_creds = BasicCredentials {
            write_user: config.gradle_write_user.clone(),
            write_password: config.gradle_write_password.clone(),
            read_user: config.gradle_read_user.clone(),
            read_password: config.gradle_read_password.clone(),
        };
        let sccache_creds = BasicCredentials {
            write_user: config.sccache_write_user.clone(),
            write_password: config.sccache_write_password.clone(),
            read_user: config.sccache_read_user.clone(),
            read_password: config.sccache_read_password.clone(),
        };

        Ok(Self {
            config,
            store,
            metrics,
            gradle_creds,
            sccache_creds,
        })
    }
}

pub fn build_router(state: Arc<AppState>) -> Router {
    Router::new()
        .route("/healthz", get(api::healthz))
        .route("/readyz", get(api::readyz))
        .route("/metrics", get(api::metrics))
        .route("/api/summary", get(api::summary))
        .route("/v8/artifacts/status", get(turbo::status))
        .route("/v8/artifacts/events", post(turbo::post_events))
        .route(
            "/v8/artifacts/{hash}",
            get(turbo::get_or_head_artifact).put(turbo::put_artifact),
        )
        .route("/v8/clean", post(turbo::post_clean))
        .route("/cache/{*key}", any(gradle::handle_gradle))
        .route("/sccache", any(sccache::handle_sccache_root))
        .route("/sccache/", any(sccache::handle_sccache_root))
        .route("/sccache/{*path}", any(sccache::handle_sccache))
        .fallback(get(api::serve_spa))
        // Streaming handlers enforce exact protocol byte limits incrementally.
        .layer(DefaultBodyLimit::disable())
        .with_state(state)
}
