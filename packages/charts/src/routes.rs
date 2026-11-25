use std::path::PathBuf;

use axum::Json;
use axum::Router;
use axum::body::{Body, to_bytes};
use axum::extract::{DefaultBodyLimit, MatchedPath, Path, Request, State};
use axum::http::{HeaderMap, HeaderValue, StatusCode, Uri, header};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use serde::Serialize;
use tokio::fs::File;
use tokio_util::io::ReaderStream;
use tower::ServiceExt as _;
use tower_http::services::ServeDir;
use tower_http::trace::TraceLayer;

use crate::archive::{MAX_ARCHIVE_BYTES, parse_chart_archive};
use crate::auth::{BasicAuthCredentials, verify_request_auth};
use crate::error::AppError;
use crate::index_yaml::if_none_match_matches;
use crate::metrics::AppMetrics;
use crate::storage::{ChartStore, UploadOutcome};

#[derive(Clone)]
pub struct AppState {
    pub store: ChartStore,
    pub metrics: AppMetrics,
    pub basic_auth: Option<BasicAuthCredentials>,
    pub static_dir: PathBuf,
}

#[derive(Serialize)]
struct UploadResponse {
    saved: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    idempotent: Option<bool>,
}

pub fn build_router(state: AppState) -> Router {
    Router::new()
        .route("/healthz", get(handle_healthz))
        .route("/readyz", get(handle_readyz))
        .route("/metrics", get(handle_metrics))
        .route("/index.yaml", get(handle_index_yaml))
        .route("/charts/{filename}", get(handle_download_chart))
        .route(
            "/api/charts",
            get(handle_list_all_charts)
                .post(handle_upload_chart)
                .layer(DefaultBodyLimit::disable()),
        )
        .route("/api/charts/{name}", get(handle_list_chart))
        .route(
            "/api/charts/{name}/{version}",
            get(handle_get_chart_version),
        )
        .route("/api/summary", get(handle_summary))
        .fallback(handle_static_fallback)
        .layer(middleware::from_fn_with_state(
            state.clone(),
            metrics_middleware,
        ))
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}

async fn metrics_middleware(
    State(state): State<AppState>,
    request: Request,
    next: Next,
) -> Response {
    let method = request.method().as_str().to_owned();
    let route = request.extensions().get::<MatchedPath>().map_or_else(
        || classify_fallback_route(request.uri()),
        |mp| mp.as_str().to_owned(),
    );
    let response = next.run(request).await;
    state
        .metrics
        .record_request(&method, &route, response.status().as_u16());
    response
}

fn classify_fallback_route(uri: &Uri) -> String {
    let path = uri.path();
    if path == "/" {
        "/".to_owned()
    } else if path.starts_with("/assets/") {
        "/assets/*".to_owned()
    } else if path.starts_with("/api/") {
        "/api/*".to_owned()
    } else if path.starts_with("/charts/") {
        "/charts/*".to_owned()
    } else {
        "/*spa".to_owned()
    }
}

async fn handle_healthz() -> impl IntoResponse {
    (
        StatusCode::OK,
        [(
            header::CONTENT_TYPE,
            HeaderValue::from_static("text/plain; charset=utf-8"),
        )],
        "ok",
    )
}

async fn handle_readyz(State(state): State<AppState>) -> Result<impl IntoResponse, AppError> {
    state.store.check_ready()?;
    Ok((
        StatusCode::OK,
        [(
            header::CONTENT_TYPE,
            HeaderValue::from_static("text/plain; charset=utf-8"),
        )],
        "ok",
    ))
}

async fn handle_metrics(State(state): State<AppState>) -> Result<impl IntoResponse, AppError> {
    let stats = state.store.stats()?;
    let body = state
        .metrics
        .encode_with_stats(stats, state.store.quota_bytes())?;
    Ok((
        StatusCode::OK,
        [(
            header::CONTENT_TYPE,
            HeaderValue::from_static("text/plain; version=0.0.4; charset=utf-8"),
        )],
        body,
    ))
}

async fn handle_index_yaml(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Response, AppError> {
    let rendered = state.store.rendered_index_yaml()?;
    let etag_header = HeaderValue::from_str(&rendered.etag)
        .map_err(|err| AppError::Internal(format!("invalid etag header: {err}")))?;

    if let Some(inm) = headers.get(header::IF_NONE_MATCH)
        && let Ok(inm_str) = inm.to_str()
        && if_none_match_matches(inm_str, &rendered.etag)
    {
        return Ok((
            StatusCode::NOT_MODIFIED,
            [
                (header::ETAG, etag_header),
                (header::CACHE_CONTROL, HeaderValue::from_static("no-cache")),
            ],
            Body::empty(),
        )
            .into_response());
    }

    Ok((
        StatusCode::OK,
        [
            (
                header::CONTENT_TYPE,
                HeaderValue::from_static("application/x-yaml; charset=utf-8"),
            ),
            (header::ETAG, etag_header),
            (header::CACHE_CONTROL, HeaderValue::from_static("no-cache")),
        ],
        rendered.body,
    )
        .into_response())
}

async fn handle_download_chart(
    State(state): State<AppState>,
    Path(filename): Path<String>,
    headers: HeaderMap,
) -> Result<Response, AppError> {
    let Some((blob_path, release)) = state.store.resolve_blob_by_filename(&filename)? else {
        return Err(AppError::NotFound(format!(
            "chart archive '{filename}' not found"
        )));
    };

    let etag_value = format!("\"{}\"", release.digest_hex);
    let etag_header = HeaderValue::from_str(&etag_value)
        .map_err(|err| AppError::Internal(format!("invalid digest etag: {err}")))?;
    let cache_control = HeaderValue::from_static("public, max-age=31536000, immutable");

    if let Some(inm) = headers.get(header::IF_NONE_MATCH)
        && let Ok(inm_str) = inm.to_str()
        && if_none_match_matches(inm_str, &etag_value)
    {
        return Ok((
            StatusCode::NOT_MODIFIED,
            [
                (header::ETAG, etag_header),
                (header::CACHE_CONTROL, cache_control),
            ],
            Body::empty(),
        )
            .into_response());
    }

    let file = File::open(&blob_path).await.map_err(|err| {
        AppError::Storage(format!(
            "failed opening blob '{}': {err}",
            blob_path.display()
        ))
    })?;
    let content_length = HeaderValue::from_str(&release.size_bytes.to_string())
        .map_err(|err| AppError::Internal(format!("invalid content-length: {err}")))?;
    let stream = ReaderStream::new(file);

    Ok((
        StatusCode::OK,
        [
            (
                header::CONTENT_TYPE,
                HeaderValue::from_static("application/gzip"),
            ),
            (header::CONTENT_LENGTH, content_length),
            (header::ETAG, etag_header),
            (header::CACHE_CONTROL, cache_control),
        ],
        Body::from_stream(stream),
    )
        .into_response())
}

async fn handle_list_all_charts(
    State(state): State<AppState>,
) -> Result<impl IntoResponse, AppError> {
    let grouped = state.store.list_all_charts()?;
    Ok((StatusCode::OK, Json(grouped)))
}

async fn handle_list_chart(
    State(state): State<AppState>,
    Path(name): Path<String>,
) -> Result<impl IntoResponse, AppError> {
    let Some(releases) = state.store.list_chart_releases(&name)? else {
        return Err(AppError::NotFound(format!("chart '{name}' not found")));
    };
    Ok((StatusCode::OK, Json(releases)))
}

async fn handle_get_chart_version(
    State(state): State<AppState>,
    Path((name, version)): Path<(String, String)>,
) -> Result<impl IntoResponse, AppError> {
    let Some(release) = state.store.get_chart_release(&name, &version)? else {
        return Err(AppError::NotFound(format!(
            "chart release '{name}@{version}' not found"
        )));
    };
    Ok((StatusCode::OK, Json(release)))
}

async fn handle_summary(State(state): State<AppState>) -> Result<impl IntoResponse, AppError> {
    let summary = state.store.catalog_summary()?;
    Ok((StatusCode::OK, Json(summary)))
}

const AUTH_REJECT_DRAIN_BYTES: usize = 64 * 1024;

async fn handle_upload_chart(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Body,
) -> Result<impl IntoResponse, AppError> {
    if let Err(err) = verify_request_auth(&headers, state.basic_auth.as_ref()) {
        // Drain bounded body bytes so small unauthenticated uploads receive a clean
        // 401 + WWW-Authenticate response instead of TCP RST from unread socket data.
        let _ = to_bytes(body, AUTH_REJECT_DRAIN_BYTES).await;
        return Err(err);
    }

    if let Some(cl_header) = headers.get(header::CONTENT_LENGTH)
        && let Ok(cl_str) = cl_header.to_str()
        && let Ok(cl) = cl_str.parse::<usize>()
        && cl > MAX_ARCHIVE_BYTES
    {
        return Err(AppError::PayloadTooLarge(
            "chart archive exceeds 16 MiB limit".to_owned(),
        ));
    }

    let raw_bytes = to_bytes(body, MAX_ARCHIVE_BYTES)
        .await
        .map_err(|_| AppError::PayloadTooLarge("chart archive exceeds 16 MiB limit".to_owned()))?;

    let parsed = parse_chart_archive(&raw_bytes)?;
    let outcome = state.store.store_chart(&parsed, &raw_bytes).await?;

    let response = match outcome {
        UploadOutcome::Created => (
            StatusCode::CREATED,
            Json(UploadResponse {
                saved: true,
                idempotent: None,
            }),
        ),
        UploadOutcome::Idempotent => (
            StatusCode::OK,
            Json(UploadResponse {
                saved: true,
                idempotent: Some(true),
            }),
        ),
    };
    Ok(response)
}

async fn handle_static_fallback(
    State(state): State<AppState>,
    request: Request,
) -> Result<Response, AppError> {
    let path = request.uri().path().to_owned();
    if path.starts_with("/api/") || path == "/api" {
        return Err(AppError::NotFound(format!("route '{path}' not found")));
    }
    if path.starts_with("/charts/") || path == "/charts" {
        return Err(AppError::BadRequest(format!(
            "invalid chart archive path '{path}'"
        )));
    }

    let is_hashed_asset = path.starts_with("/assets/");
    let service = ServeDir::new(&state.static_dir).append_index_html_on_directories(true);
    let serve_response = service
        .oneshot(request)
        .await
        .map_err(|err| AppError::Internal(format!("static file service error: {err}")))?;

    if serve_response.status() != StatusCode::NOT_FOUND {
        let mut resp = serve_response.into_response();
        resp.headers_mut().insert(
            header::CACHE_CONTROL,
            if is_hashed_asset {
                HeaderValue::from_static("public, max-age=31536000, immutable")
            } else {
                HeaderValue::from_static("no-cache")
            },
        );
        return Ok(resp);
    }

    if is_hashed_asset {
        return Err(AppError::NotFound(format!("asset '{path}' not found")));
    }

    let index_path = state.static_dir.join("index.html");
    let html = tokio::fs::read(&index_path)
        .await
        .map_err(|_| AppError::NotFound("client bundle index.html not found".to_owned()))?;

    Ok((
        StatusCode::OK,
        [
            (
                header::CONTENT_TYPE,
                HeaderValue::from_static("text/html; charset=utf-8"),
            ),
            (header::CACHE_CONTROL, HeaderValue::from_static("no-cache")),
        ],
        html,
    )
        .into_response())
}
