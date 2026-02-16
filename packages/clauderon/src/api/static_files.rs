use axum::{
    http::{StatusCode, Uri, header},
    response::{Html, IntoResponse, Response},
};
use include_dir::{Dir, include_dir};

/// Embedded frontend build directory
static DIST_DIR: Dir<'static> = include_dir!("$CARGO_MANIFEST_DIR/web/frontend/dist");

/// Embedded docs build directory
static DOCS_DIR: Dir<'static> = include_dir!("$CARGO_MANIFEST_DIR/docs/dist");

/// Serve static files from the embedded frontend build
pub async fn serve_static(uri: Uri) -> Response {
    let path = uri.path().trim_start_matches('/');

    // Try to serve the requested file
    if let Some(file) = DIST_DIR.get_file(path) {
        return serve_file(file);
    }

    // For SPA routing: if file not found, serve index.html
    if let Some(index) = DIST_DIR.get_file("index.html") {
        return Html(index.contents()).into_response();
    }

    // Fallback 404
    (StatusCode::NOT_FOUND, "Not found").into_response()
}

/// Serve static files from the embedded docs build
pub async fn serve_docs(uri: Uri) -> Response {
    let path = uri
        .path()
        .trim_start_matches('/')
        .trim_start_matches("docs/");

    // Try to serve the requested file
    if let Some(file) = DOCS_DIR.get_file(path) {
        return serve_file(file);
    }

    // For SPA routing: if file not found, serve index.html
    if let Some(index) = DOCS_DIR.get_file("index.html") {
        return Html(index.contents()).into_response();
    }

    // Fallback 404
    (StatusCode::NOT_FOUND, "Not found").into_response()
}

/// Serve a specific file with appropriate content type
#[expect(clippy::unwrap_used, reason = "MIME types from mime_guess are always valid header values")]
fn serve_file(file: &include_dir::File<'_>) -> Response {
    let mime = mime_guess::from_path(file.path()).first_or_octet_stream();
    let mime_type = mime.as_ref();

    // Convert borrowed slice to owned Vec to satisfy lifetime requirements
    let contents = file.contents().to_vec();
    let mut response = contents.into_response();
    response
        .headers_mut()
        .insert(header::CONTENT_TYPE, mime_type.parse().unwrap());

    response
}
