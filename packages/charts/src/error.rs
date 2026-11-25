use axum::Json;
use axum::http::{HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};
use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("configuration error: {0}")]
    Config(String),

    #[error("{0}")]
    BadRequest(String),

    #[error("unauthorized")]
    Unauthorized,

    #[error("{0}")]
    NotFound(String),

    #[error("{0}")]
    Conflict(String),

    #[error("{0}")]
    PayloadTooLarge(String),

    #[error("service unavailable: {0}")]
    Unavailable(String),

    #[error("storage error: {0}")]
    Storage(String),

    #[error("internal error: {0}")]
    Internal(String),
}

#[derive(Serialize)]
struct ErrorBody {
    error: String,
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let status = match &self {
            Self::Config(_) | Self::Storage(_) | Self::Internal(_) => {
                StatusCode::INTERNAL_SERVER_ERROR
            }
            Self::BadRequest(_) => StatusCode::BAD_REQUEST,
            Self::Unauthorized => StatusCode::UNAUTHORIZED,
            Self::NotFound(_) => StatusCode::NOT_FOUND,
            Self::Conflict(_) => StatusCode::CONFLICT,
            Self::PayloadTooLarge(_) => StatusCode::PAYLOAD_TOO_LARGE,
            Self::Unavailable(_) => StatusCode::SERVICE_UNAVAILABLE,
        };

        if matches!(status, StatusCode::INTERNAL_SERVER_ERROR) {
            tracing::error!(error = %self, "request failed with internal error");
        }

        let message = match &self {
            Self::Config(_) | Self::Storage(_) | Self::Internal(_) => {
                "internal server error".to_owned()
            }
            other => other.to_string(),
        };

        let mut response = (status, Json(ErrorBody { error: message })).into_response();
        if matches!(self, Self::Unauthorized) {
            response.headers_mut().insert(
                header::WWW_AUTHENTICATE,
                HeaderValue::from_static("Basic realm=\"charts\""),
            );
        }
        response
    }
}
