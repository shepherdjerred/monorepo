//! The transport boundary: bytes out, bytes in.
//!
//! This is the **only** network capability the core asks a host for. Everything
//! above it — the URL, the escaping, the four-entry rename table, the envelope,
//! the HTTP-status → [`Error`](crate::Error) mapping — is core policy and lives
//! in [`super::client`].
//!
//! ## Why this and not a domain-level trait
//!
//! The boundary used to sit at [`TaskApi`](super::api::TaskApi):
//! `create_task(&CreateTaskRequest) -> Result<Task>`. That made every shell
//! responsible for the whole wire layer, which had three consequences and all
//! three were real:
//!
//! * **Duplication of the one layer a shared core exists to own.** TypeScript
//!   had it; Swift transcribed ~180 lines of it; a C# shell would have written
//!   it a third time.
//! * **Retry correctness became shell policy.**
//!   [`classify`](crate::sync::classify) branches on exactly
//!   [`Error::kind`](crate::Error::kind) and [`Error::status`](crate::Error::status),
//!   so a host that mapped a 503 to anything but `Api { status: 503 }` silently
//!   turned a transient failure into a dead-lettered command. Status → error
//!   mapping is now core policy: [`TransportError`] cannot express a status at
//!   all.
//! * **It mangled user data.** `serde_json` here is built with `preserve_order`
//!   and unmodelled frontmatter lives in an [`IndexMap`](indexmap::IndexMap), so
//!   key order round-trips exactly. Foundation's `JSONSerialization` has no
//!   ordered dictionary, so a task carrying `customProperties` had its keys
//!   scrambled in both directions — and the server writes YAML frontmatter from
//!   those keys, so a read-then-write reordered the user's file. That is not
//!   fixable inside Swift; moving the boundary down here is the fix.
//!
//! ## Five properties of the shapes below, each load-bearing
//!
//! 1. **[`TransportError`] is transport-only.** Four kinds, no status. A host
//!    cannot express "the server said 503", because that is not something a
//!    transport knows — it is something the *response* says, and the core reads
//!    it off [`HttpResponse::status`].
//! 2. **[`HttpRequest::url`] is absolute and fully escaped**, built by the core.
//!    A task id is a vault path, so it carries both `/` and spaces;
//!    `CharacterSet.urlPathAllowed` permits `/`, which is wrong for a single
//!    path component and cost a test to find. Every shell would rediscover it.
//! 3. **Bodies are bytes, never `String`.** UniFFI's `FfiConverterString` strips
//!    a leading BOM — one of the fixes the `=0.31.2` pin exists for — so a
//!    BOM-carrying response would be silently altered on the way in.
//! 4. **Headers are a `Vec`, not a map.** Order and duplicates are real, a
//!    `HashMap` has unspecified iteration order and is banned in anything that
//!    crosses, and it makes the server's `X-Idempotent-Replay` visible to the
//!    core for free.
//! 5. **Nothing streams.** The largest `/v2` payload is a 200-task page, and a
//!    chunk-callback shape is something UniFFI expresses badly.

/// The HTTP methods the `/v2` client uses.
///
/// A closed set rather than a string: a typo in a method is a request the server
/// rejects at runtime, and there is no reason for that to be expressible.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum HttpMethod {
    /// Read.
    Get,
    /// Create.
    Post,
    /// Replace or patch.
    Put,
    /// Remove.
    Delete,
}

impl HttpMethod {
    /// The method's wire spelling, uppercase.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Get => "GET",
            Self::Post => "POST",
            Self::Put => "PUT",
            Self::Delete => "DELETE",
        }
    }
}

/// One header, as a name/value pair.
///
/// A pair rather than a map entry because both order and duplicates are part of
/// HTTP and neither survives a map.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct HttpHeader {
    /// The field name, as the core wrote it or the server sent it.
    pub name: String,
    /// The field value.
    pub value: String,
}

impl HttpHeader {
    /// Build a header from anything string-like.
    #[must_use]
    pub fn new(name: impl Into<String>, value: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            value: value.into(),
        }
    }
}

/// One request, fully described.
///
/// A host implementing [`HttpClient`] does not decide anything about it: it
/// hands these bytes to the platform's HTTP stack and reports what came back.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct HttpRequest {
    /// The method.
    pub method: HttpMethod,
    /// The absolute, fully escaped URL, built by the core.
    pub url: String,
    /// The headers to send, in order.
    pub headers: Vec<HttpHeader>,
    /// The body, if the request carries one.
    ///
    /// `None` is not the same as `Some(vec![])`: `/complete-instance` with no
    /// body at all makes the server fall back to its legacy toggle-today
    /// behaviour, while an empty object makes it try to parse one.
    pub body: Option<Vec<u8>>,
    /// How long the host may spend on this request before abandoning it.
    pub timeout_millis: u32,
}

/// One response, exactly as it arrived.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct HttpResponse {
    /// The HTTP status code.
    pub status: u16,
    /// The response headers, in order.
    pub headers: Vec<HttpHeader>,
    /// The response body, undecoded.
    pub body: Vec<u8>,
}

impl HttpResponse {
    /// The first value for a header name, compared case-insensitively.
    ///
    /// Case-insensitive because HTTP field names are, and HTTP/2 lowercases
    /// them while HTTP/1.1 usually does not — so a case-sensitive lookup would
    /// find `X-Idempotent-Replay` on one connection and miss it on another.
    #[must_use]
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|header| header.name.eq_ignore_ascii_case(name))
            .map(|header| header.value.as_str())
    }

    /// Whether the status is in the 2xx range.
    #[must_use]
    pub const fn is_success(&self) -> bool {
        self.status >= 200 && self.status < 300
    }
}

/// Why a request never produced a response.
///
/// Deliberately **not** a status code. A transport reports that it could not
/// complete the exchange; what a completed exchange *means* — 401 is auth, 429
/// and 5xx are transient, 404 is a delete's goal state — is
/// [`classify`](crate::sync::classify)'s job, and it reads the response the core
/// itself mapped.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TransportErrorKind {
    /// The request outlived [`HttpRequest::timeout_millis`].
    Timeout,
    /// The host could not reach the network or the server at all — refused,
    /// unreachable, DNS, airplane mode.
    Offline,
    /// The TLS handshake or certificate validation failed.
    Tls,
    /// Anything else the platform's HTTP stack reported.
    Other,
}

/// A transport failure, with the platform's own description attached.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("{message}")]
pub struct TransportError {
    /// Which class of failure it was.
    pub kind: TransportErrorKind,
    /// What the platform reported, for the log and the banner.
    pub message: String,
}

impl TransportError {
    /// Build a transport failure of a given kind.
    #[must_use]
    pub fn new(kind: TransportErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
        }
    }

    /// A [`TransportErrorKind::Timeout`].
    #[must_use]
    pub fn timeout(message: impl Into<String>) -> Self {
        Self::new(TransportErrorKind::Timeout, message)
    }

    /// A [`TransportErrorKind::Offline`].
    #[must_use]
    pub fn offline(message: impl Into<String>) -> Self {
        Self::new(TransportErrorKind::Offline, message)
    }

    /// A [`TransportErrorKind::Tls`].
    #[must_use]
    pub fn tls(message: impl Into<String>) -> Self {
        Self::new(TransportErrorKind::Tls, message)
    }

    /// A [`TransportErrorKind::Other`].
    #[must_use]
    pub fn other(message: impl Into<String>) -> Self {
        Self::new(TransportErrorKind::Other, message)
    }
}

/// The host's HTTP stack.
///
/// Implemented by the shell — `URLSession` on Apple, `HttpClient` on .NET — so
/// the platform's own proxy configuration, ATS policy, credential storage and
/// HTTP/2 behaviour is what actually makes the request. Implemented in-process
/// by the core's tests, so every gate stays runnable on Linux.
///
/// `Send + Sync` because the engine is wrapped in a `Mutex` and handed to a host
/// that will call it from more than one thread.
pub trait HttpClient: Send + Sync {
    /// Perform one request, synchronously.
    ///
    /// Synchronous because UniFFI 0.31 has no cancellation support for async
    /// calls at all; [`HttpClient::cancel_all`] is the explicit replacement.
    ///
    /// # Errors
    ///
    /// Only a [`TransportError`]. A response the host does not like — a 500, an
    /// empty body, a wrong content type — is still a response and must be
    /// returned as one, because deciding what it means is core policy.
    fn send(&self, request: &HttpRequest) -> Result<HttpResponse, TransportError>;

    /// Abandon every request currently in flight.
    ///
    /// Designed in from day one rather than bolted on: UniFFI async has no
    /// cancellation, so a dropped future cannot be the mechanism, and without
    /// this a quit or a server change parks a thread until the timeout expires.
    ///
    /// **Must be callable while [`HttpClient::send`] is blocked**, from another
    /// thread, and must be a no-op when nothing is in flight. An abandoned
    /// request surfaces to its caller as an ordinary [`TransportError`].
    fn cancel_all(&self);
}

#[cfg(test)]
mod tests {
    use super::{HttpHeader, HttpMethod, HttpResponse, TransportError, TransportErrorKind};

    #[test]
    fn methods_spell_themselves_the_way_http_does() {
        assert_eq!(HttpMethod::Get.as_str(), "GET");
        assert_eq!(HttpMethod::Post.as_str(), "POST");
        assert_eq!(HttpMethod::Put.as_str(), "PUT");
        assert_eq!(HttpMethod::Delete.as_str(), "DELETE");
    }

    #[test]
    fn a_header_lookup_ignores_case_because_http_does() {
        let response = HttpResponse {
            status: 200,
            headers: vec![HttpHeader::new("x-idempotent-replay", "true")],
            body: Vec::new(),
        };
        assert_eq!(response.header("X-Idempotent-Replay"), Some("true"));
        assert_eq!(response.header("x-idempotent-replay"), Some("true"));
        assert_eq!(response.header("X-Mutation-Id"), None);
    }

    #[test]
    fn duplicate_headers_keep_both_values_and_their_order() {
        // The reason headers are a `Vec` and not a map: `Set-Cookie` and
        // `Warning` legitimately repeat, and a map silently keeps one.
        let response = HttpResponse {
            status: 200,
            headers: vec![
                HttpHeader::new("warning", "first"),
                HttpHeader::new("Warning", "second"),
            ],
            body: Vec::new(),
        };
        assert_eq!(response.headers.len(), 2);
        assert_eq!(response.header("warning"), Some("first"));
    }

    #[test]
    fn success_is_exactly_the_2xx_range() {
        for (status, expected) in [
            (199, false),
            (200, true),
            (204, true),
            (299, true),
            (300, false),
        ] {
            let response = HttpResponse {
                status,
                headers: Vec::new(),
                body: Vec::new(),
            };
            assert_eq!(response.is_success(), expected, "status {status}");
        }
    }

    #[test]
    fn a_transport_failure_carries_its_kind_and_nothing_resembling_a_status() {
        let error = TransportError::timeout("timed out after 15s");
        assert_eq!(error.kind, TransportErrorKind::Timeout);
        assert_eq!(error.to_string(), "timed out after 15s");
        assert_eq!(
            TransportError::offline("x").kind,
            TransportErrorKind::Offline
        );
        assert_eq!(TransportError::tls("x").kind, TransportErrorKind::Tls);
        assert_eq!(TransportError::other("x").kind, TransportErrorKind::Other);
    }
}
