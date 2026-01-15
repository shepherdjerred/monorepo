//! HTTP middleware for API requests.

use axum::{extract::Request, http::HeaderValue, middleware::Next, response::Response};
use uuid::Uuid;

use crate::observability::CorrelationId;

/// Header name for correlation ID
pub const CORRELATION_ID_HEADER: &str = "X-Correlation-ID";

/// Middleware that adds a correlation ID to each request.
///
/// If the client sends an X-Correlation-ID header, use it.
/// Otherwise, generate a new correlation ID.
///
/// The correlation ID is:
/// 1. Added to the tracing span for the request
/// 2. Added to the response headers
/// 3. Available for logging throughout the request lifecycle
pub async fn correlation_id_middleware(mut request: Request, next: Next) -> Response {
    // Extract or generate correlation ID
    let correlation_id = request
        .headers()
        .get(CORRELATION_ID_HEADER)
        .and_then(|v| v.to_str().ok())
        .and_then(|s| Uuid::parse_str(s).ok())
        .map_or_else(CorrelationId::new, CorrelationId::from);

    // Add to request extensions for downstream handlers
    request.extensions_mut().insert(correlation_id);

    // Add to tracing span
    let span = tracing::info_span!(
        "http_request",
        correlation_id = %correlation_id,
        method = %request.method(),
        uri = %request.uri()
    );

    // Process request within the span
    let response = {
        let _enter = span.enter();
        next.run(request).await
    };

    // Add correlation ID to response headers
    let (mut parts, body) = response.into_parts();
    if let Ok(header_value) = HeaderValue::from_str(&correlation_id.to_string()) {
        parts.headers.insert(CORRELATION_ID_HEADER, header_value);
    }

    Response::from_parts(parts, body)
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        Router,
        body::Body,
        http::{Request, StatusCode},
        middleware,
        response::IntoResponse,
        routing::get,
    };
    use tower::ServiceExt;

    async fn test_handler() -> impl IntoResponse {
        StatusCode::OK
    }

    #[tokio::test]
    async fn test_correlation_id_added_to_response() {
        let app = Router::new()
            .route("/test", get(test_handler))
            .layer(middleware::from_fn(correlation_id_middleware));

        let response = app
            .oneshot(Request::builder().uri("/test").body(Body::empty()).unwrap())
            .await
            .unwrap();

        // Response should have correlation ID header
        assert!(response.headers().contains_key(CORRELATION_ID_HEADER));

        // Header value should be a valid UUID
        let correlation_id = response
            .headers()
            .get(CORRELATION_ID_HEADER)
            .unwrap()
            .to_str()
            .unwrap();
        assert!(Uuid::parse_str(correlation_id).is_ok());
    }

    #[tokio::test]
    async fn test_correlation_id_preserved_from_request() {
        let app = Router::new()
            .route("/test", get(test_handler))
            .layer(middleware::from_fn(correlation_id_middleware));

        let test_id = Uuid::new_v4();
        let response = app
            .oneshot(
                Request::builder()
                    .uri("/test")
                    .header(CORRELATION_ID_HEADER, test_id.to_string())
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        // Response should have the same correlation ID
        let response_id = response
            .headers()
            .get(CORRELATION_ID_HEADER)
            .unwrap()
            .to_str()
            .unwrap();
        assert_eq!(response_id, test_id.to_string());
    }
}
