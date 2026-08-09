//! The network layer: the transport the host implements, and the `/v2` client
//! the core builds on top of it.
//!
//! | module | role |
//! |---|---|
//! | [`http`] | the host boundary — bytes out, bytes in, and cancellation |
//! | [`endpoints`] | every `/v2` path, and the one escaping rule they share |
//! | [`client`] | the wire boundary: URL, headers, bodies, status → error |
//! | [`api`] | the engine's port, in domain vocabulary |
//!
//! The layering is the point. A host supplies [`HttpClient`] and nothing else;
//! the core owns everything from the URL upwards, so a second and third shell
//! inherit correct escaping, correct field renaming, correct envelope handling
//! and correct retry classification without writing any of it.

pub mod api;
pub mod client;
pub mod endpoints;
pub mod http;

pub use api::{InstanceCompletion, TaskApi};
pub use client::{
    DEFAULT_REQUEST_TIMEOUT_MILLIS, IDEMPOTENT_REPLAY_HEADER, MUTATION_ID_HEADER, TaskNotesClient,
};
pub use http::{
    HttpClient, HttpHeader, HttpMethod, HttpRequest, HttpResponse, TransportError,
    TransportErrorKind,
};
