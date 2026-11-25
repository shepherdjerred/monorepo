use std::sync::Arc;

use axum::body::Body;
use axum::extract::{Path, State};
use axum::http::{HeaderMap, Method, StatusCode, header};
use axum::response::{IntoResponse, Response};
use bytes::Bytes;
use futures_util::StreamExt;
use tokio_util::io::ReaderStream;

use crate::AppState;
use crate::auth::{CiIdentity, basic_unauthorized_response, verify_basic};
use crate::store::{PutMetadata, STREAM_CHUNK_BYTES, StoreError};

const GRADLE_NAMESPACE: &str = "gradle:main";

fn is_valid_gradle_key(key: &str) -> bool {
    let trimmed = key.trim_matches('/');
    !trimmed.is_empty()
        && trimmed.len() <= 512
        && !trimmed.contains('\0')
        && !trimmed
            .split('/')
            .any(|seg| seg.is_empty() || seg == "." || seg == "..")
}

fn parse_content_length(headers: &HeaderMap) -> Option<u64> {
    headers
        .get(header::CONTENT_LENGTH)
        .and_then(|val| val.to_str().ok())
        .and_then(|s| s.parse::<u64>().ok())
}

pub async fn handle_gradle(
    State(state): State<Arc<AppState>>,
    method: Method,
    headers: HeaderMap,
    Path(raw_key): Path<String>,
    body: Body,
) -> Response {
    let Some(identity) = verify_basic(&headers, &state.gradle_creds) else {
        return basic_unauthorized_response("Gradle build cache");
    };

    let key = raw_key.trim_matches('/').to_owned();
    if !is_valid_gradle_key(&key) {
        return (StatusCode::BAD_REQUEST, "invalid cache key\n").into_response();
    }

    match (identity, method.as_str()) {
        (_, "GET" | "HEAD") => {
            let is_head = method == Method::HEAD;
            let op = if is_head { "head" } else { "get" };
            match state
                .store
                .get_entry(GRADLE_NAMESPACE, &key, "gradle", !is_head, true)
                .await
            {
                Ok(Some((meta, file_opt))) => {
                    state
                        .metrics
                        .record_request("gradle", GRADLE_NAMESPACE, op, "hit");
                    let builder = Response::builder()
                        .status(StatusCode::OK)
                        .header(header::CONTENT_TYPE, "application/octet-stream")
                        .header(header::CONTENT_LENGTH, meta.size_bytes.to_string())
                        .header(header::ETAG, format!("\"{}\"", meta.sha256_hex));
                    let resp_body = if let Some(file) = file_opt {
                        let metrics = Arc::clone(&state.metrics);
                        let stream = ReaderStream::with_capacity(file, STREAM_CHUNK_BYTES).map(
                            move |chunk_res: Result<Bytes, std::io::Error>| {
                                if let Ok(ref bytes) = chunk_res {
                                    metrics.record_bytes_out("gradle", bytes.len() as u64);
                                }
                                chunk_res
                            },
                        );
                        Body::from_stream(stream)
                    } else {
                        Body::empty()
                    };
                    builder.body(resp_body).unwrap_or_else(|_| {
                        (StatusCode::INTERNAL_SERVER_ERROR, "response build error\n")
                            .into_response()
                    })
                }
                Ok(None) => {
                    state
                        .metrics
                        .record_request("gradle", GRADLE_NAMESPACE, op, "miss");
                    (StatusCode::NOT_FOUND, "not found\n").into_response()
                }
                Err(err) => {
                    tracing::error!(error = %err, key = %key, "gradle read failed");
                    state
                        .metrics
                        .record_request("gradle", GRADLE_NAMESPACE, op, "error");
                    (StatusCode::INTERNAL_SERVER_ERROR, "storage error\n").into_response()
                }
            }
        }
        (CiIdentity::PullRequest, _) => {
            state
                .metrics
                .record_request("gradle", GRADLE_NAMESPACE, "put", "forbidden");
            (StatusCode::FORBIDDEN, "forbidden\n").into_response()
        }
        (CiIdentity::Main, "PUT") => {
            let put_meta = PutMetadata {
                namespace: GRADLE_NAMESPACE.to_owned(),
                key: key.clone(),
                protocol: "gradle".to_owned(),
                max_bytes: state.config.gradle_max_body_bytes,
                content_length_hint: parse_content_length(&headers),
                artifact_tag: None,
                duration_ms: None,
            };
            match state
                .store
                .put_stream(put_meta, body.into_data_stream())
                .await
            {
                Ok(stored) => {
                    state
                        .metrics
                        .record_request("gradle", GRADLE_NAMESPACE, "put", "stored");
                    state.metrics.record_bytes_in("gradle", stored.size_bytes);
                    (StatusCode::CREATED, Body::empty()).into_response()
                }
                Err(StoreError::PayloadTooLarge { .. }) => {
                    state
                        .metrics
                        .record_request("gradle", GRADLE_NAMESPACE, "put", "too_large");
                    (StatusCode::PAYLOAD_TOO_LARGE, "payload too large\n").into_response()
                }
                Err(err) => {
                    tracing::error!(error = %err, key = %key, "gradle upload failed");
                    state
                        .metrics
                        .record_request("gradle", GRADLE_NAMESPACE, "put", "error");
                    (StatusCode::INTERNAL_SERVER_ERROR, "storage error\n").into_response()
                }
            }
        }
        (CiIdentity::Main, _) => {
            (StatusCode::METHOD_NOT_ALLOWED, "method not allowed\n").into_response()
        }
    }
}
