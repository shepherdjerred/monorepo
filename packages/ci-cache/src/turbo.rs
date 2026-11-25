use std::sync::Arc;

use axum::Json;
use axum::body::Body;
use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, HeaderValue, Method, StatusCode, header};
use axum::response::{IntoResponse, Response};
use bytes::Bytes;
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use tokio_util::io::ReaderStream;

use crate::AppState;
use crate::auth::{bearer_unauthorized_response, verify_bearer};
use crate::store::{PutMetadata, STREAM_CHUNK_BYTES, StoreError};

const MAX_EVENTS_BODY_BYTES: usize = 2 * 1024 * 1024;

#[derive(Debug, Default, Deserialize)]
pub struct TurboScopeQuery {
    pub slug: Option<String>,
    #[serde(rename = "teamId")]
    pub team_id: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
pub struct TurboCleanQuery {
    pub slug: Option<String>,
    #[serde(rename = "teamId")]
    pub team_id: Option<String>,
    #[serde(rename = "olderThan")]
    pub older_than: Option<u64>,
}

#[derive(Debug, Deserialize)]
pub struct TurboTelemetryEvent {
    #[serde(default)]
    pub source: String,
    #[serde(default)]
    pub event: String,
    #[serde(default)]
    pub duration: Option<u64>,
}

#[derive(Debug, Serialize)]
pub struct TurboCleanResponse {
    pub deleted: u64,
    pub scanned: u64,
}

fn is_valid_hash(hash: &str) -> bool {
    !hash.is_empty()
        && hash.len() <= 128
        && hash
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

fn is_valid_slug(slug: &str) -> bool {
    !slug.is_empty()
        && slug.len() <= 128
        && slug
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-' || b == b'.')
}

fn bad_request_json(message: &'static str) -> Response {
    (
        StatusCode::BAD_REQUEST,
        Json(serde_json::json!({ "error": message })),
    )
        .into_response()
}

fn resolve_slug(slug: Option<&str>, team_id: Option<&str>) -> Result<String, &'static str> {
    let raw = slug
        .filter(|s| !s.is_empty())
        .or_else(|| team_id.filter(|s| !s.is_empty()))
        .unwrap_or("default");
    if !is_valid_slug(raw) {
        return Err("invalid team slug");
    }
    Ok(raw.to_owned())
}

fn parse_content_length(headers: &HeaderMap) -> Option<u64> {
    headers
        .get(header::CONTENT_LENGTH)
        .and_then(|val| val.to_str().ok())
        .and_then(|s| s.parse::<u64>().ok())
}

fn parse_artifact_tag(headers: &HeaderMap) -> Result<Option<String>, &'static str> {
    let Some(raw_val) = headers.get("x-artifact-tag") else {
        return Ok(None);
    };
    let Ok(tag_str) = raw_val.to_str() else {
        return Err("invalid x-artifact-tag header");
    };
    let trimmed = tag_str.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }
    if trimmed.len() > 1024 || trimmed.bytes().any(|b| b < 0x20 || b == 0x7f) {
        return Err("invalid x-artifact-tag header");
    }
    Ok(Some(trimmed.to_owned()))
}

fn parse_artifact_duration(headers: &HeaderMap) -> Option<u64> {
    headers
        .get("x-artifact-duration")
        .and_then(|val| val.to_str().ok())
        .and_then(|s| s.trim().parse::<u64>().ok())
}

pub async fn status() -> impl IntoResponse {
    (
        StatusCode::OK,
        Json(serde_json::json!({ "status": "enabled" })),
    )
}

pub async fn get_or_head_artifact(
    State(state): State<Arc<AppState>>,
    method: Method,
    headers: HeaderMap,
    Path(hash): Path<String>,
    Query(query): Query<TurboScopeQuery>,
) -> Response {
    if !verify_bearer(&headers, state.config.turbo_token.as_deref()) {
        return bearer_unauthorized_response();
    }
    if !is_valid_hash(&hash) {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "invalid artifact hash" })),
        )
            .into_response();
    }
    let slug = match resolve_slug(query.slug.as_deref(), query.team_id.as_deref()) {
        Ok(val) => val,
        Err(msg) => return bad_request_json(msg),
    };
    let namespace = format!("turbo:{slug}");
    let is_head = method == Method::HEAD;
    let op = if is_head { "head" } else { "get" };

    match state
        .store
        .get_entry(&namespace, &hash, "turbo", !is_head, true)
        .await
    {
        Ok(Some((meta, file_opt))) => {
            state.metrics.record_request("turbo", &namespace, op, "hit");
            let mut builder = Response::builder()
                .status(StatusCode::OK)
                .header(header::CONTENT_TYPE, "application/octet-stream")
                .header(header::CONTENT_LENGTH, meta.size_bytes.to_string());

            if let Some(ref tag) = meta.artifact_tag
                && let Ok(val) = HeaderValue::from_str(tag)
            {
                builder = builder.header("x-artifact-tag", val);
            }
            if let Some(duration_ms) = meta.duration_ms {
                builder = builder.header("x-artifact-duration", duration_ms.to_string());
            }

            let body = if let Some(file) = file_opt {
                let metrics = Arc::clone(&state.metrics);
                let stream = ReaderStream::with_capacity(file, STREAM_CHUNK_BYTES).map(
                    move |chunk_res: Result<Bytes, std::io::Error>| {
                        if let Ok(ref bytes) = chunk_res {
                            metrics.record_bytes_out("turbo", bytes.len() as u64);
                        }
                        chunk_res
                    },
                );
                Body::from_stream(stream)
            } else {
                Body::empty()
            };

            builder.body(body).unwrap_or_else(|_| {
                (StatusCode::INTERNAL_SERVER_ERROR, "response build error").into_response()
            })
        }
        Ok(None) => {
            state
                .metrics
                .record_request("turbo", &namespace, op, "miss");
            (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({ "error": "artifact not found" })),
            )
                .into_response()
        }
        Err(err) => {
            tracing::error!(error = %err, namespace = %namespace, hash = %hash, "turbo read failed");
            state
                .metrics
                .record_request("turbo", &namespace, op, "error");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": "storage error" })),
            )
                .into_response()
        }
    }
}

pub async fn put_artifact(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(hash): Path<String>,
    Query(query): Query<TurboScopeQuery>,
    body: Body,
) -> Response {
    if !verify_bearer(&headers, state.config.turbo_token.as_deref()) {
        return bearer_unauthorized_response();
    }
    if !is_valid_hash(&hash) {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "invalid artifact hash" })),
        )
            .into_response();
    }
    let slug = match resolve_slug(query.slug.as_deref(), query.team_id.as_deref()) {
        Ok(val) => val,
        Err(msg) => return bad_request_json(msg),
    };
    let artifact_tag = match parse_artifact_tag(&headers) {
        Ok(tag) => tag,
        Err(msg) => return bad_request_json(msg),
    };
    let duration_ms = parse_artifact_duration(&headers);
    let content_length_hint = parse_content_length(&headers);
    let namespace = format!("turbo:{slug}");

    let put_meta = PutMetadata {
        namespace: namespace.clone(),
        key: hash.clone(),
        protocol: "turbo".to_owned(),
        max_bytes: state.config.turbo_max_body_bytes,
        content_length_hint,
        artifact_tag,
        duration_ms,
    };

    match state
        .store
        .put_stream(put_meta, body.into_data_stream())
        .await
    {
        Ok(stored) => {
            state
                .metrics
                .record_request("turbo", &namespace, "put", "stored");
            state.metrics.record_bytes_in("turbo", stored.size_bytes);
            let url = format!("/v8/artifacts/{hash}?slug={slug}");
            (
                StatusCode::ACCEPTED,
                Json(serde_json::json!({ "urls": [url] })),
            )
                .into_response()
        }
        Err(StoreError::PayloadTooLarge { limit }) => {
            state
                .metrics
                .record_request("turbo", &namespace, "put", "too_large");
            (
                StatusCode::PAYLOAD_TOO_LARGE,
                Json(serde_json::json!({
                    "error": "artifact exceeds size limit",
                    "maxBytes": limit
                })),
            )
                .into_response()
        }
        Err(err) => {
            tracing::error!(error = %err, namespace = %namespace, hash = %hash, "turbo upload failed");
            state
                .metrics
                .record_request("turbo", &namespace, "put", "error");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": "storage error" })),
            )
                .into_response()
        }
    }
}

pub async fn post_events(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    body: Body,
) -> Response {
    if !verify_bearer(&headers, state.config.turbo_token.as_deref()) {
        return bearer_unauthorized_response();
    }
    let bytes = match axum::body::to_bytes(body, MAX_EVENTS_BODY_BYTES).await {
        Ok(b) => b,
        Err(_) => {
            return (
                StatusCode::PAYLOAD_TOO_LARGE,
                Json(serde_json::json!({ "error": "events payload too large" })),
            )
                .into_response();
        }
    };
    let events: Vec<TurboTelemetryEvent> = match serde_json::from_slice(&bytes) {
        Ok(list) => list,
        Err(_) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({ "error": "invalid events json" })),
            )
                .into_response();
        }
    };
    if events.len() > 5_000 {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "too many events" })),
        )
            .into_response();
    }

    for ev in &events {
        let source = if ev.source.is_empty() {
            "UNKNOWN"
        } else {
            ev.source.as_str()
        };
        let kind = if ev.event.is_empty() {
            "UNKNOWN"
        } else {
            ev.event.as_str()
        };
        state.metrics.record_turbo_event(source, kind, ev.duration);
    }

    (StatusCode::OK, Json(serde_json::json!({}))).into_response()
}

pub async fn post_clean(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(query): Query<TurboCleanQuery>,
) -> Response {
    if !verify_bearer(&headers, state.config.turbo_token.as_deref()) {
        return bearer_unauthorized_response();
    }
    let slug = match resolve_slug(query.slug.as_deref(), query.team_id.as_deref()) {
        Ok(val) => val,
        Err(msg) => return bad_request_json(msg),
    };
    let older_than = query.older_than.unwrap_or(14);
    let namespace = format!("turbo:{slug}");

    match state
        .store
        .clean_namespace_older_than_days(&namespace, older_than)
        .await
    {
        Ok(outcome) => {
            state
                .metrics
                .record_evictions(&namespace, "clean", outcome.deleted);
            state
                .metrics
                .record_request("turbo", &namespace, "clean", "ok");
            (
                StatusCode::OK,
                Json(TurboCleanResponse {
                    deleted: outcome.deleted,
                    scanned: outcome.scanned,
                }),
            )
                .into_response()
        }
        Err(err) => {
            tracing::error!(error = %err, namespace = %namespace, "turbo clean failed");
            state
                .metrics
                .record_request("turbo", &namespace, "clean", "error");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": "clean failed" })),
            )
                .into_response()
        }
    }
}
