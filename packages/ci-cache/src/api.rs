use std::path::{Component, Path, PathBuf};
use std::sync::Arc;

use axum::Json;
use axum::body::Body;
use axum::extract::State;
use axum::http::{StatusCode, Uri, header};
use axum::response::{IntoResponse, Response};

use crate::AppState;

pub async fn healthz() -> impl IntoResponse {
    (
        StatusCode::OK,
        [(header::CONTENT_TYPE, "text/plain; charset=utf-8")],
        "ok\n",
    )
}

pub async fn readyz(State(state): State<Arc<AppState>>) -> Response {
    match state.store.check_ready().await {
        Ok(()) => (
            StatusCode::OK,
            Json(serde_json::json!({ "status": "ready" })),
        )
            .into_response(),
        Err(err) => {
            tracing::error!(error = %err, "readiness probe failed");
            (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(serde_json::json!({
                    "status": "not_ready",
                    "reason": "storage_unavailable"
                })),
            )
                .into_response()
        }
    }
}

pub async fn metrics(State(state): State<Arc<AppState>>) -> Response {
    let gauges = match state.store.namespace_gauges().await {
        Ok(list) => list,
        Err(err) => {
            tracing::error!(error = %err, "failed to read namespace gauges");
            return (StatusCode::INTERNAL_SERVER_ERROR, "metrics error\n").into_response();
        }
    };
    let text = state.metrics.render(&gauges);
    (
        StatusCode::OK,
        [(
            header::CONTENT_TYPE,
            "text/plain; version=0.0.4; charset=utf-8",
        )],
        text,
    )
        .into_response()
}

pub async fn summary(State(state): State<Arc<AppState>>) -> Response {
    match state.store.summary(&state.config).await {
        Ok(payload) => (
            StatusCode::OK,
            [(header::CACHE_CONTROL, "no-store")],
            Json(payload),
        )
            .into_response(),
        Err(err) => {
            tracing::error!(error = %err, "failed to compute cache summary");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": "summary unavailable" })),
            )
                .into_response()
        }
    }
}

fn content_type_for_path(path: &Path) -> &'static str {
    match path.extension().and_then(|ext| ext.to_str()) {
        Some("html") => "text/html; charset=utf-8",
        Some("js" | "mjs") => "application/javascript; charset=utf-8",
        Some("css") => "text/css; charset=utf-8",
        Some("json" | "map") => "application/json; charset=utf-8",
        Some("svg") => "image/svg+xml",
        Some("woff2") => "font/woff2",
        Some("woff") => "font/woff",
        Some("png") => "image/png",
        Some("ico") => "image/x-icon",
        _ => "application/octet-stream",
    }
}

fn safe_relative_static_path(base: &Path, req_path: &str) -> Option<PathBuf> {
    let rel = req_path.trim_start_matches('/');
    if rel.is_empty() {
        return None;
    }
    let mut joined = base.to_path_buf();
    for comp in Path::new(rel).components() {
        match comp {
            Component::Normal(seg) => joined.push(seg),
            _ => return None,
        }
    }
    Some(joined)
}

pub async fn serve_spa(State(state): State<Arc<AppState>>, uri: Uri) -> Response {
    let req_path = uri.path();
    let static_dir = &state.config.static_dir;

    if let Some(candidate) = safe_relative_static_path(static_dir, req_path)
        && let Ok(meta) = tokio::fs::metadata(&candidate).await
        && meta.is_file()
    {
        return match tokio::fs::read(&candidate).await {
            Ok(bytes) => {
                let cache_control = if req_path.starts_with("/assets/") {
                    "public, max-age=31536000, immutable"
                } else {
                    "no-cache"
                };
                (
                    StatusCode::OK,
                    [
                        (header::CONTENT_TYPE, content_type_for_path(&candidate)),
                        (header::CACHE_CONTROL, cache_control),
                    ],
                    Body::from(bytes),
                )
                    .into_response()
            }
            Err(_) => (StatusCode::INTERNAL_SERVER_ERROR, "asset read error\n").into_response(),
        };
    }

    // Do not serve SPA HTML fallback for missing hashed assets or API paths.
    if req_path.starts_with("/assets/") || req_path.starts_with("/api/") {
        return (StatusCode::NOT_FOUND, "not found\n").into_response();
    }

    let index_path = static_dir.join("index.html");
    match tokio::fs::read(&index_path).await {
        Ok(bytes) => (
            StatusCode::OK,
            [
                (header::CONTENT_TYPE, "text/html; charset=utf-8"),
                (header::CACHE_CONTROL, "no-cache"),
            ],
            Body::from(bytes),
        )
            .into_response(),
        Err(_) => (
            StatusCode::NOT_FOUND,
            "UI assets not found (run vite build)\n",
        )
            .into_response(),
    }
}
