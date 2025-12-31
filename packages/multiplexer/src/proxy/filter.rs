//! HTTP request filtering for access control.

use http::Method;

/// Check if HTTP method is a write operation
pub fn is_write_operation(method: &Method) -> bool {
    matches!(
        method,
        &Method::POST | &Method::PUT | &Method::DELETE | &Method::PATCH
    )
}

/// Check if HTTP method is a read operation
pub fn is_read_operation(method: &Method) -> bool {
    matches!(method, &Method::GET | &Method::HEAD | &Method::OPTIONS)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_write_operations() {
        assert!(is_write_operation(&Method::POST));
        assert!(is_write_operation(&Method::PUT));
        assert!(is_write_operation(&Method::DELETE));
        assert!(is_write_operation(&Method::PATCH));
        assert!(!is_write_operation(&Method::GET));
        assert!(!is_write_operation(&Method::HEAD));
        assert!(!is_write_operation(&Method::OPTIONS));
    }

    #[test]
    fn test_read_operations() {
        assert!(is_read_operation(&Method::GET));
        assert!(is_read_operation(&Method::HEAD));
        assert!(is_read_operation(&Method::OPTIONS));
        assert!(!is_read_operation(&Method::POST));
        assert!(!is_read_operation(&Method::PUT));
        assert!(!is_read_operation(&Method::DELETE));
    }
}
