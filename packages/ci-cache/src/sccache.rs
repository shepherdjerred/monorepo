use std::sync::Arc;
use std::time::{Duration, UNIX_EPOCH};

use axum::body::Body;
use axum::extract::{Path, State};
use axum::http::{HeaderMap, HeaderValue, Method, StatusCode, header};
use axum::response::{IntoResponse, Response};
use bytes::Bytes;
use futures_util::StreamExt;
use tokio_util::io::ReaderStream;

use crate::AppState;
use crate::auth::{CiIdentity, basic_unauthorized_response, verify_basic};
use crate::store::{EntryMeta, PutMetadata, STREAM_CHUNK_BYTES, StoreError, now_unix_secs};

const SCCACHE_TRUSTED_NS: &str = "sccache:trusted";
const SCCACHE_PR_NS: &str = "sccache:pr";

fn normalize_webdav_path(raw: &str) -> Option<String> {
    if raw.len() > 1024 || raw.contains('\0') {
        return None;
    }
    let mut segments = Vec::new();
    for seg in raw.split('/') {
        if seg.is_empty() {
            continue;
        }
        if seg == "." || seg == ".." {
            return None;
        }
        segments.push(seg);
    }
    if segments.is_empty() {
        return None;
    }
    Some(segments.join("/"))
}

fn parse_content_length(headers: &HeaderMap) -> Option<u64> {
    headers
        .get(header::CONTENT_LENGTH)
        .and_then(|val| val.to_str().ok())
        .and_then(|s| s.parse::<u64>().ok())
}

fn format_http_timestamp(unix_secs: i64) -> String {
    let secs = u64::try_from(unix_secs.max(0)).unwrap_or(0);
    httpdate::fmt_http_date(UNIX_EPOCH + Duration::from_secs(secs))
}

fn xml_escape(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for ch in input.chars() {
        match ch {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&apos;"),
            other => out.push(other),
        }
    }
    out
}

fn build_hit_response(
    state: &Arc<AppState>,
    meta: &EntryMeta,
    file_opt: Option<tokio::fs::File>,
) -> Response {
    let last_modified = format_http_timestamp(meta.created_at);
    let builder = Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "application/octet-stream")
        .header(header::CONTENT_LENGTH, meta.size_bytes.to_string())
        .header(header::LAST_MODIFIED, last_modified)
        .header(header::ETAG, format!("\"{}\"", meta.sha256_hex));
    let body = if let Some(file) = file_opt {
        let metrics = Arc::clone(&state.metrics);
        let stream = ReaderStream::with_capacity(file, STREAM_CHUNK_BYTES).map(
            move |chunk_res: Result<Bytes, std::io::Error>| {
                if let Ok(ref bytes) = chunk_res {
                    metrics.record_bytes_out("sccache", bytes.len() as u64);
                }
                chunk_res
            },
        );
        Body::from_stream(stream)
    } else {
        Body::empty()
    };
    builder.body(body).unwrap_or_else(|_| {
        (StatusCode::INTERNAL_SERVER_ERROR, "response build error\n").into_response()
    })
}

fn options_response() -> Response {
    (
        StatusCode::OK,
        [
            (
                header::ALLOW,
                HeaderValue::from_static("OPTIONS, GET, HEAD, PUT, MKCOL, PROPFIND"),
            ),
            (
                axum::http::HeaderName::from_static("dav"),
                HeaderValue::from_static("1"),
            ),
        ],
        Body::empty(),
    )
        .into_response()
}

fn multistatus_collection_response(href: &str) -> Response {
    let last_modified = format_http_timestamp(now_unix_secs());
    let escaped_href = xml_escape(href);
    let xml = format!(
        "<?xml version=\"1.0\" encoding=\"utf-8\"?>\
         <D:multistatus xmlns:D=\"DAV:\">\
         <D:response><D:href>{escaped_href}</D:href>\
         <D:propstat><D:prop>\
         <D:resourcetype><D:collection/></D:resourcetype>\
         <D:getlastmodified>{last_modified}</D:getlastmodified>\
         </D:prop>\
         <D:status>HTTP/1.1 200 OK</D:status></D:propstat>\
         </D:response></D:multistatus>"
    );
    (
        StatusCode::MULTI_STATUS,
        [(header::CONTENT_TYPE, "application/xml; charset=utf-8")],
        xml,
    )
        .into_response()
}

fn multistatus_file_response(href: &str, meta: &EntryMeta) -> Response {
    let last_modified = format_http_timestamp(meta.created_at);
    let escaped_href = xml_escape(href);
    let xml = format!(
        "<?xml version=\"1.0\" encoding=\"utf-8\"?>\
         <D:multistatus xmlns:D=\"DAV:\">\
         <D:response><D:href>{escaped_href}</D:href>\
         <D:propstat><D:prop>\
         <D:resourcetype/>\
         <D:getcontentlength>{}</D:getcontentlength>\
         <D:getcontenttype>application/octet-stream</D:getcontenttype>\
         <D:getetag>\"{}\"</D:getetag>\
         <D:getlastmodified>{last_modified}</D:getlastmodified>\
         </D:prop>\
         <D:status>HTTP/1.1 200 OK</D:status></D:propstat>\
         </D:response></D:multistatus>",
        meta.size_bytes, meta.sha256_hex,
    );
    (
        StatusCode::MULTI_STATUS,
        [(header::CONTENT_TYPE, "application/xml; charset=utf-8")],
        xml,
    )
        .into_response()
}

async fn lookup_sccache_entry(
    state: &AppState,
    identity: CiIdentity,
    key: &str,
    open_file: bool,
    record_stats: bool,
) -> Result<Option<(&'static str, EntryMeta, Option<tokio::fs::File>)>, StoreError> {
    match identity {
        CiIdentity::Main => state
            .store
            .get_entry(SCCACHE_TRUSTED_NS, key, "sccache", open_file, record_stats)
            .await
            .map(|opt| opt.map(|(m, f)| (SCCACHE_TRUSTED_NS, m, f))),
        CiIdentity::PullRequest => {
            if let Some((meta, file_opt)) = state
                .store
                .get_entry(SCCACHE_PR_NS, key, "sccache", open_file, false)
                .await?
            {
                return Ok(Some((SCCACHE_PR_NS, meta, file_opt)));
            }
            if let Some((meta, file_opt)) = state
                .store
                .get_entry(SCCACHE_TRUSTED_NS, key, "sccache", open_file, false)
                .await?
            {
                return Ok(Some((SCCACHE_TRUSTED_NS, meta, file_opt)));
            }
            if record_stats {
                state.store.record_miss_only(SCCACHE_PR_NS, "sccache");
            }
            Ok(None)
        }
    }
}

pub async fn handle_sccache_root(
    State(state): State<Arc<AppState>>,
    method: Method,
    headers: HeaderMap,
) -> Response {
    if verify_basic(&headers, &state.sccache_creds).is_none() {
        return basic_unauthorized_response("sccache");
    }
    match method.as_str() {
        "MKCOL" => (StatusCode::CREATED, Body::empty()).into_response(),
        "OPTIONS" => options_response(),
        "PROPFIND" => multistatus_collection_response("/sccache/"),
        "HEAD" | "GET" => (StatusCode::OK, Body::empty()).into_response(),
        _ => (StatusCode::METHOD_NOT_ALLOWED, "method not allowed\n").into_response(),
    }
}

pub async fn handle_sccache(
    State(state): State<Arc<AppState>>,
    method: Method,
    headers: HeaderMap,
    Path(raw_path): Path<String>,
    body: Body,
) -> Response {
    let Some(identity) = verify_basic(&headers, &state.sccache_creds) else {
        return basic_unauthorized_response("sccache");
    };

    let primary_ns = match identity {
        CiIdentity::Main => SCCACHE_TRUSTED_NS,
        CiIdentity::PullRequest => SCCACHE_PR_NS,
    };

    match method.as_str() {
        "MKCOL" => {
            state
                .metrics
                .record_request("sccache", primary_ns, "mkcol", "ok");
            return (StatusCode::CREATED, Body::empty()).into_response();
        }
        "OPTIONS" => {
            return options_response();
        }
        "PROPFIND" if raw_path.ends_with('/') || raw_path.trim_matches('/').is_empty() => {
            let trimmed = raw_path.trim_matches('/');
            let href = if trimmed.is_empty() {
                "/sccache/".to_owned()
            } else {
                format!("/sccache/{trimmed}/")
            };
            return multistatus_collection_response(&href);
        }
        _ => {}
    }

    let Some(key) = normalize_webdav_path(&raw_path) else {
        if raw_path.trim_matches('/').is_empty()
            && (method == Method::HEAD || method == Method::GET)
        {
            return (StatusCode::OK, Body::empty()).into_response();
        }
        return (StatusCode::BAD_REQUEST, "invalid sccache path\n").into_response();
    };

    match method.as_str() {
        "PROPFIND" => match lookup_sccache_entry(&state, identity, &key, false, false).await {
            Ok(Some((hit_ns, meta, _))) => {
                state
                    .metrics
                    .record_request("sccache", hit_ns, "propfind", "hit");
                multistatus_file_response(&format!("/sccache/{key}"), &meta)
            }
            Ok(None) => {
                state
                    .metrics
                    .record_request("sccache", primary_ns, "propfind", "miss");
                (StatusCode::NOT_FOUND, Body::empty()).into_response()
            }
            Err(err) => {
                tracing::error!(error = %err, key = %key, "sccache propfind failed");
                state
                    .metrics
                    .record_request("sccache", primary_ns, "propfind", "error");
                (StatusCode::INTERNAL_SERVER_ERROR, "storage error\n").into_response()
            }
        },
        "GET" | "HEAD" => {
            let is_head = method == Method::HEAD;
            let op = if is_head { "head" } else { "get" };
            match lookup_sccache_entry(&state, identity, &key, !is_head, true).await {
                Ok(Some((hit_ns, meta, file_opt))) => {
                    state.metrics.record_request("sccache", hit_ns, op, "hit");
                    build_hit_response(&state, &meta, file_opt)
                }
                Ok(None) => {
                    state
                        .metrics
                        .record_request("sccache", primary_ns, op, "miss");
                    (StatusCode::NOT_FOUND, Body::empty()).into_response()
                }
                Err(err) => {
                    tracing::error!(error = %err, key = %key, "sccache read failed");
                    state
                        .metrics
                        .record_request("sccache", primary_ns, op, "error");
                    (StatusCode::INTERNAL_SERVER_ERROR, "storage error\n").into_response()
                }
            }
        }
        "PUT" => {
            let put_meta = PutMetadata {
                namespace: primary_ns.to_owned(),
                key: key.clone(),
                protocol: "sccache".to_owned(),
                max_bytes: state.config.sccache_max_body_bytes,
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
                        .record_request("sccache", primary_ns, "put", "stored");
                    state.metrics.record_bytes_in("sccache", stored.size_bytes);
                    (StatusCode::CREATED, Body::empty()).into_response()
                }
                Err(StoreError::PayloadTooLarge { .. }) => {
                    state
                        .metrics
                        .record_request("sccache", primary_ns, "put", "too_large");
                    (StatusCode::PAYLOAD_TOO_LARGE, "payload too large\n").into_response()
                }
                Err(err) => {
                    tracing::error!(error = %err, namespace = %primary_ns, key = %key, "sccache upload failed");
                    state
                        .metrics
                        .record_request("sccache", primary_ns, "put", "error");
                    (StatusCode::INTERNAL_SERVER_ERROR, "storage error\n").into_response()
                }
            }
        }
        _ => (StatusCode::METHOD_NOT_ALLOWED, "method not allowed\n").into_response(),
    }
}
