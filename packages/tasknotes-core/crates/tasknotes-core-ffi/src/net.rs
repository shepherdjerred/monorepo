//! The network boundary, as the host sees it.
//!
//! Exactly one network capability crosses to the shell: [`HttpClient`], which
//! takes bytes and answers bytes. Everything above it — the absolute URL and
//! its percent-escaping, the `/v2` rename table, the `X-Mutation-Id` header,
//! the `{ success, data, error }` envelope, and the HTTP-status → error mapping
//! the retry classifier reads — is owned by
//! [`tasknotes_core::net::client`] and reached through [`TaskNotesApi`].
//!
//! ## Why the boundary is here and not one layer up
//!
//! It used to be a domain-level `TaskApi` the shell implemented, and that had
//! three costs, all measured rather than theorized:
//!
//! * TypeScript wrote the wire layer, Swift transcribed ~180 lines of it, and
//!   C# would have been the third — three implementations of the one layer a
//!   shared core exists to own.
//! * Retry correctness became shell policy. The classifier branches on exactly
//!   `kind()` and `status()`, so a host mapping a 503 to anything but
//!   `Api { status: 503 }` silently turned a transient failure into a
//!   dead-lettered command. [`TransportError`] now cannot express a status at
//!   all, so that mapping is unavoidably the core's.
//! * It mangled user data. Foundation's `JSONSerialization` has no ordered
//!   dictionary, so a task carrying `customProperties` had its keys scrambled
//!   in both directions — and the server writes YAML frontmatter from those
//!   keys, so a read-then-write reordered the user's file. The core keeps them
//!   in an `IndexMap` and `serde_json` is built with `preserve_order`, so once
//!   the boundary is bytes the problem stops existing.
//!
//! ## Cancellation, designed in rather than added later
//!
//! UniFFI 0.31 has **no** async cancellation, so a dropped future can never be
//! the mechanism. [`HttpClient::cancel_all`] is the explicit hook, and
//! [`TaskNotesApi::cancel_all`] is how the app reaches it: it takes no engine
//! lock, so it works from another thread *while* a request is blocked, which is
//! the only moment it is useful.

use std::sync::Arc;

use tasknotes_core::net::{
    HttpClient as CoreHttpClient, HttpHeader, HttpMethod, HttpRequest, HttpResponse,
    TaskNotesClient, TransportError as CoreTransportError, TransportErrorKind,
};

use crate::error::CoreError;

// ── The transport vocabulary ───────────────────────────────────────────────
//
// Remote derives rather than mirrors: the definition below is re-stated from
// `tasknotes_core::net::http`, so a renamed field, a changed type or a new
// variant is a compile error here rather than a silent binding change. Field
// order is the FFI buffer's layout — see the crate docs.

/// See [`tasknotes_core::net::HttpMethod`].
#[uniffi::remote(Enum)]
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

/// See [`tasknotes_core::net::HttpHeader`].
///
/// A pair rather than a map entry: header order and duplicates are part of
/// HTTP, neither survives a map, and a `HashMap`'s iteration order is
/// unspecified — which is banned in anything that crosses this boundary.
#[uniffi::remote(Record)]
pub struct HttpHeader {
    /// The field name, as the core wrote it or the server sent it.
    pub name: String,
    /// The field value.
    pub value: String,
}

/// See [`tasknotes_core::net::HttpRequest`].
#[uniffi::remote(Record)]
pub struct HttpRequest {
    /// The method.
    pub method: HttpMethod,
    /// The absolute, fully escaped URL, built by the core.
    pub url: String,
    /// The headers to send, in order.
    pub headers: Vec<HttpHeader>,
    /// The body, if the request carries one.
    ///
    /// `None` is not `Some(&[])`: `/complete-instance` with no body at all
    /// makes the server fall back to its legacy toggle-today behaviour.
    ///
    /// Bytes, never a `String`: UniFFI's `FfiConverterString` strips a leading
    /// BOM, so a text boundary would silently alter what the server sent.
    pub body: Option<Vec<u8>>,
    /// How long the host may spend before abandoning the request.
    pub timeout_millis: u32,
}

/// See [`tasknotes_core::net::HttpResponse`].
#[uniffi::remote(Record)]
pub struct HttpResponse {
    /// The HTTP status code.
    pub status: u16,
    /// The response headers, in order.
    pub headers: Vec<HttpHeader>,
    /// The response body, undecoded.
    pub body: Vec<u8>,
}

/// Why a request never produced a response.
///
/// A mirror rather than a remote derive, for the same reason [`CoreError`] is
/// one: UniFFI errors must be enums, and the core models this as a
/// `{ kind, message }` record so that the kind is a value the client can match
/// on rather than a variant it has to destructure. The two shapes carry exactly
/// the same information and the conversion is total in both directions, which a
/// test pins.
///
/// **There is deliberately no status here.** A transport reports that it could
/// not complete the exchange; what a *completed* exchange means — 401 is auth,
/// 429 and 5xx are transient, 404 is a delete's goal state — is the core's
/// decision, read off [`HttpResponse::status`].
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error, uniffi::Error)]
pub enum TransportError {
    /// The request outlived its timeout.
    #[error("{message}")]
    Timeout {
        /// What the platform reported.
        message: String,
    },

    /// The host could not reach the network or the server at all.
    #[error("{message}")]
    Offline {
        /// What the platform reported.
        message: String,
    },

    /// The TLS handshake or certificate validation failed.
    #[error("{message}")]
    Tls {
        /// What the platform reported.
        message: String,
    },

    /// Anything else the platform's HTTP stack reported.
    #[error("{message}")]
    Other {
        /// What the platform reported.
        message: String,
    },
}

impl From<TransportError> for CoreTransportError {
    fn from(error: TransportError) -> Self {
        match error {
            TransportError::Timeout { message } => Self::timeout(message),
            TransportError::Offline { message } => Self::offline(message),
            TransportError::Tls { message } => Self::tls(message),
            TransportError::Other { message } => Self::other(message),
        }
    }
}

impl From<CoreTransportError> for TransportError {
    fn from(error: CoreTransportError) -> Self {
        let message = error.message;
        match error.kind {
            TransportErrorKind::Timeout => Self::Timeout { message },
            TransportErrorKind::Offline => Self::Offline { message },
            TransportErrorKind::Tls => Self::Tls { message },
            TransportErrorKind::Other => Self::Other { message },
        }
    }
}

/// The host's HTTP stack.
///
/// See [`tasknotes_core::net::HttpClient`]. This is the whole network surface,
/// so the platform's own stack — `URLSession` on Apple, with its proxy, ATS,
/// credential storage and background-transfer behaviour — is what actually
/// makes the request.
///
/// The shell adds its own `Authorization` header here. The token comes from the
/// platform keychain and the core has no use for it, so it is never handed one.
#[uniffi::export(with_foreign)]
pub trait HttpClient: Send + Sync {
    /// Perform one request, synchronously.
    ///
    /// Synchronous because UniFFI has no async cancellation;
    /// [`HttpClient::cancel_all`] is the explicit replacement.
    ///
    /// # Errors
    ///
    /// Only a [`TransportError`]. A response the host dislikes — a 500, an
    /// empty body, an unexpected content type — is still a response and must be
    /// returned as one, because deciding what it means is core policy.
    fn send(&self, request: HttpRequest) -> Result<HttpResponse, TransportError>;

    /// Abandon every request currently in flight.
    ///
    /// **Must be callable from another thread while [`HttpClient::send`] is
    /// blocked**, and must be a no-op when nothing is in flight. An abandoned
    /// request surfaces to its caller as an ordinary [`TransportError`].
    fn cancel_all(&self);
}

/// Adapts a host [`HttpClient`] onto [`tasknotes_core::net::HttpClient`].
///
/// The one difference is ownership: UniFFI lifts a value out of the FFI buffer,
/// so there is no borrow to hand across and the request is cloned at the
/// boundary. The core keeps its allocation-free internal signature.
struct HttpClientAdapter(Arc<dyn HttpClient>);

impl CoreHttpClient for HttpClientAdapter {
    fn send(&self, request: &HttpRequest) -> Result<HttpResponse, CoreTransportError> {
        self.0.send(request.clone()).map_err(Into::into)
    }

    fn cancel_all(&self) {
        self.0.cancel_all();
    }
}

// ── The client the core owns ───────────────────────────────────────────────

/// The TaskNotes `/v2` API, over a host transport.
///
/// Construct one per configured server and hand it to
/// [`FfiSyncEngine::new`](crate::engine::FfiSyncEngine::new). Reconfiguring the
/// server means a new one of these and a new engine — never a mutated address,
/// which is what makes "one engine per server" checkable rather than a
/// convention.
#[derive(Debug, uniffi::Object)]
pub struct TaskNotesApi {
    inner: Arc<TaskNotesClient>,
}

impl TaskNotesApi {
    /// The client, for the engine to drive.
    pub(crate) fn client(&self) -> Arc<TaskNotesClient> {
        Arc::clone(&self.inner)
    }
}

#[uniffi::export]
impl TaskNotesApi {
    /// Point the core's client at `base_url`, using `transport` for every
    /// request.
    ///
    /// Trailing slashes are trimmed. `request_timeout_millis` is per request;
    /// pass [`api_default_timeout_millis`] unless there is a reason not to, so
    /// the retry classifier sees the same timing on both clients rather than a
    /// number each shell picked for itself.
    ///
    /// # Errors
    ///
    /// Returns [`CoreError::Validation`] when `base_url` is empty or carries no
    /// scheme. Checked here rather than per request because a typo should be
    /// reported when the user saves the setting, not fifteen seconds later as a
    /// mysterious transport failure.
    #[uniffi::constructor]
    pub fn new(
        transport: Arc<dyn HttpClient>,
        base_url: &str,
        request_timeout_millis: u32,
    ) -> Result<Self, CoreError> {
        let core_transport: Arc<dyn CoreHttpClient> = Arc::new(HttpClientAdapter(transport));
        let client = TaskNotesClient::new(core_transport, base_url, request_timeout_millis)
            .map_err(CoreError::from)?;
        Ok(Self {
            inner: Arc::new(client),
        })
    }

    /// The normalized server address every request is built against.
    #[must_use]
    pub fn base_url(&self) -> String {
        self.inner.base_url().to_owned()
    }

    /// Abandon every request currently in flight.
    ///
    /// Takes no engine lock on purpose. The engine's own `dispose()` has to
    /// take one, and the lock is held for the whole of a blocking drain — so a
    /// cancel routed through the engine could only ever run once the request it
    /// meant to cancel had already finished. This is the path that works while
    /// the app is quitting mid-request.
    pub fn cancel_all(&self) {
        self.inner.cancel_all();
    }
}

/// The default per-request timeout, in milliseconds.
///
/// Exported so a shell does not hard-code fifteen seconds on its own side and
/// then drift from the value the retry classifier was tuned against.
#[uniffi::export]
#[must_use]
pub fn api_default_timeout_millis() -> u32 {
    tasknotes_core::net::DEFAULT_REQUEST_TIMEOUT_MILLIS
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use tasknotes_core::net::{
        HttpHeader, HttpRequest, HttpResponse, TaskApi, TransportError as CoreTransportError,
        TransportErrorKind,
    };

    use super::{HttpClient, TaskNotesApi, TransportError};
    use crate::error::CoreError;

    /// A transport that answers one scripted response and records the request.
    struct Scripted {
        seen: Mutex<Vec<HttpRequest>>,
        answer: Mutex<Option<Result<HttpResponse, TransportError>>>,
        cancels: Mutex<u32>,
    }

    impl HttpClient for Scripted {
        fn send(&self, request: HttpRequest) -> Result<HttpResponse, TransportError> {
            self.seen.lock().unwrap().push(request);
            self.answer.lock().unwrap().take().unwrap_or_else(|| {
                Err(TransportError::Other {
                    message: "exhausted".to_owned(),
                })
            })
        }

        fn cancel_all(&self) {
            *self.cancels.lock().unwrap() += 1;
        }
    }

    fn scripted(answer: Result<HttpResponse, TransportError>) -> Arc<Scripted> {
        Arc::new(Scripted {
            seen: Mutex::new(Vec::new()),
            answer: Mutex::new(Some(answer)),
            cancels: Mutex::new(0),
        })
    }

    #[test]
    fn the_transport_error_mirror_is_total_in_both_directions() {
        // The mirror is the only place a host's failure can lose its class, and
        // losing it here would change what the retry classifier decides.
        for kind in [
            TransportErrorKind::Timeout,
            TransportErrorKind::Offline,
            TransportErrorKind::Tls,
            TransportErrorKind::Other,
        ] {
            let original = CoreTransportError::new(kind, "socket closed");
            let round_tripped = CoreTransportError::from(TransportError::from(original.clone()));
            assert_eq!(round_tripped, original);
            assert_eq!(round_tripped.kind, kind);
        }
    }

    #[test]
    fn a_swift_shaped_transport_drives_the_cores_own_wire_layer() {
        // The whole point of the boundary move: the *core* builds the URL,
        // escapes the path component, applies the rename table and reads the
        // envelope. The host only moved bytes.
        let body = br#"{"success":true,"data":{"path":"TaskNotes/a.md","title":"Alpha","status":"open","priority":"normal","customProperties":{"zebra":1,"apple":2}}}"#;
        let transport = scripted(Ok(HttpResponse {
            status: 200,
            headers: vec![HttpHeader::new("X-Idempotent-Replay", "true")],
            body: body.to_vec(),
        }));
        let host: Arc<dyn HttpClient> = Arc::<Scripted>::clone(&transport);
        let api = TaskNotesApi::new(host, "http://vault.test:8080/", 1_000).unwrap();
        assert_eq!(api.base_url(), "http://vault.test:8080");

        let task = api
            .client()
            .toggle_task_status(
                &tasknotes_core::domain::TaskId::parse("TaskNotes/Write the plan.md").unwrap(),
                tasknotes_core::domain::TaskStatus::Done,
                Some("cmd-1"),
            )
            .unwrap();
        assert_eq!(task.id.as_str(), "TaskNotes/a.md");
        let keys: Vec<&str> = task
            .extra_fields
            .as_map()
            .keys()
            .map(String::as_str)
            .collect();
        assert_eq!(keys, ["zebra", "apple"], "vault key order must survive");

        let seen = transport.seen.lock().unwrap().clone();
        let request = seen.first().unwrap();
        assert_eq!(
            request.url,
            "http://vault.test:8080/api/tasks/TaskNotes%2FWrite%20the%20plan.md"
        );
        assert_eq!(request.timeout_millis, 1_000);
        assert!(
            request
                .headers
                .iter()
                .any(|header| header.name == "X-Mutation-Id" && header.value == "cmd-1"),
            "the idempotency key must reach the wire: {:?}",
            request.headers
        );
    }

    #[test]
    fn a_bad_base_url_fails_when_the_api_is_built_not_when_a_request_is_sent() {
        let host: Arc<dyn HttpClient> = scripted(Err(TransportError::Offline {
            message: "n/a".to_owned(),
        }));
        let error = TaskNotesApi::new(host, "vault.test:8080", 1_000).unwrap_err();
        assert!(
            matches!(error, CoreError::Validation { ref message } if message.contains("scheme")),
            "unexpected error: {error:?}"
        );
    }

    #[test]
    fn cancelling_reaches_the_host_without_touching_the_engine() {
        let transport = scripted(Err(TransportError::Offline {
            message: "n/a".to_owned(),
        }));
        let host: Arc<dyn HttpClient> = Arc::<Scripted>::clone(&transport);
        let api = TaskNotesApi::new(host, "http://vault.test", 1_000).unwrap();
        api.cancel_all();
        assert_eq!(*transport.cancels.lock().unwrap(), 1);
    }
}
