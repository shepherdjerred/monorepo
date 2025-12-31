//! HTTP request filtering for access control.

use http::Method;

/// Check if HTTP method is a write operation
///
/// For safety in read-only mode, we use an allowlist approach:
/// only known-safe read methods are allowed. All others (including
/// unknown/custom methods) are treated as write operations.
pub fn is_write_operation(method: &Method) -> bool {
    !is_read_operation(method)
}

/// Check if HTTP method is a read operation (safe allowlist)
///
/// Only these methods are guaranteed to be read-only:
/// - GET: Retrieve resource
/// - HEAD: Like GET but no body
/// - OPTIONS: Query available methods
/// - TRACE: Echo request for debugging
///
/// All other methods (POST, PUT, DELETE, PATCH, CONNECT, custom methods)
/// are treated as write operations for safety.
pub fn is_read_operation(method: &Method) -> bool {
    matches!(
        method,
        &Method::GET | &Method::HEAD | &Method::OPTIONS | &Method::TRACE
    )
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
