//! The authenticated REST client: one typed method per Explore route.

use std::fmt;
use std::time::Duration;

use reqwest::{Client, RequestBuilder, Response};
use scout_client_core::backend::backend_origin;
use scout_client_core::credentials::DeviceCredential;
use scout_client_core::desktop_api::{
    ActiveRun, ConversationGetRequest, ConversationListResponse, EmptyRequest,
    ExploreStatusResponse, RunActiveResponse, RunOutcome, RunOutcomeResponse, RunRequest,
    RunStartRequest, RunStopResponse,
};
use serde::Serialize;
use serde::de::DeserializeOwned;
use url::Url;
use uuid::Uuid;

use crate::contract::{CONTRACT_HEADER, CONTRACT_VERSION, Route};
use crate::error::{ExploreClientError, classify_rejection, retry_after};
use crate::model::Transcript;

/// How long a REST call may take end to end.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(15);
/// How long opening a connection may take, for REST and the stream alike.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
/// How long the stream may go without a byte before it counts as lost. The
/// server re-sends the run's snapshot about once a second, so a healthy
/// stream never comes close.
pub const STREAM_IDLE_TIMEOUT: Duration = Duration::from_secs(30);

/// Scout Desktop's client for Explore, authenticated as the paired device.
///
/// It holds two HTTP clients. REST calls get a bounded total timeout. The
/// run stream gets a connect timeout and an idle read timeout but no total
/// timeout, because an answer can legitimately stream for minutes.
#[derive(Clone)]
pub struct ExploreClient {
    http: Client,
    stream_http: Client,
    origin: Url,
    credential: DeviceCredential,
}

impl fmt::Debug for ExploreClient {
    // The credential's bearer token must never reach a log line.
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ExploreClient")
            .field("origin", &self.origin.as_str())
            .field("device_id", &self.credential.device_id)
            .finish_non_exhaustive()
    }
}

fn stream_client(idle_timeout: Duration) -> Result<Client, ExploreClientError> {
    Client::builder()
        .connect_timeout(CONNECT_TIMEOUT)
        .read_timeout(idle_timeout)
        .build()
        .map_err(ExploreClientError::Transport)
}

impl ExploreClient {
    /// A client for `origin` that authenticates with `credential`.
    ///
    /// # Errors
    ///
    /// Returns [`ExploreClientError::Origin`] for anything but an HTTPS origin
    /// (or loopback HTTP), or [`ExploreClientError::Transport`] when the HTTP
    /// clients cannot be built.
    pub fn new(origin: &str, credential: DeviceCredential) -> Result<Self, ExploreClientError> {
        let origin = backend_origin(origin).map_err(|_| ExploreClientError::Origin)?;
        let http = Client::builder()
            .connect_timeout(CONNECT_TIMEOUT)
            .timeout(REQUEST_TIMEOUT)
            .build()
            .map_err(ExploreClientError::Transport)?;
        Ok(Self {
            http,
            stream_http: stream_client(STREAM_IDLE_TIMEOUT)?,
            origin,
            credential,
        })
    }

    /// A client for `origin` using the device credential the pairing flow
    /// stored in the operating-system credential store.
    ///
    /// # Errors
    ///
    /// Returns [`ExploreClientError::NotPaired`] when the store holds no
    /// credential for this backend, [`ExploreClientError::Credential`] when
    /// the store fails, or any error of [`Self::new`].
    pub fn from_credential_store(origin: &str) -> Result<Self, ExploreClientError> {
        let scope = backend_origin(origin).map_err(|_| ExploreClientError::Origin)?;
        let credential =
            DeviceCredential::load(scope.as_str())?.ok_or(ExploreClientError::NotPaired)?;
        Self::new(origin, credential)
    }

    /// Replace the stream's idle read timeout, for tests that cannot wait
    /// thirty seconds for a stalled stream to count as lost.
    ///
    /// # Errors
    ///
    /// Returns [`ExploreClientError::Transport`] when the client cannot be
    /// built.
    pub fn with_stream_idle_timeout(
        mut self,
        timeout: Duration,
    ) -> Result<Self, ExploreClientError> {
        self.stream_http = stream_client(timeout)?;
        Ok(self)
    }

    /// The device this client acts as.
    #[must_use]
    pub const fn device_id(&self) -> Uuid {
        self.credential.device_id
    }

    fn post(&self, http: &Client, route: Route) -> Result<RequestBuilder, ExploreClientError> {
        let url = self
            .origin
            .join(route.path())
            .map_err(|_| ExploreClientError::Origin)?;
        Ok(http
            .post(url)
            .bearer_auth(&self.credential.token)
            .header(CONTRACT_HEADER, CONTRACT_VERSION.to_string()))
    }

    async fn call<Request, Answer>(
        &self,
        route: Route,
        body: &Request,
    ) -> Result<Answer, ExploreClientError>
    where
        Request: Serialize + Sync,
        Answer: DeserializeOwned,
    {
        let response = checked(
            self.post(&self.http, route)?
                .json(body)
                .send()
                .await
                .map_err(ExploreClientError::Transport)?,
        )
        .await?;
        let bytes = response
            .bytes()
            .await
            .map_err(ExploreClientError::Transport)?;
        serde_json::from_slice(&bytes).map_err(ExploreClientError::Decode)
    }

    /// `explore/status`: model picker, spending and quota.
    ///
    /// # Errors
    ///
    /// Returns a transport failure, a typed refusal, or a contract mismatch.
    pub async fn status(&self) -> Result<ExploreStatusResponse, ExploreClientError> {
        self.call(Route::ExploreStatus, &EmptyRequest {}).await
    }

    /// `explore/conversations/list`: the owner's conversations, most recent
    /// first.
    ///
    /// # Errors
    ///
    /// Returns a transport failure, a typed refusal, or a contract mismatch.
    pub async fn list_conversations(&self) -> Result<ConversationListResponse, ExploreClientError> {
        self.call(Route::ExploreConversationsList, &EmptyRequest {})
            .await
    }

    /// `explore/conversations/get`: one conversation's current branch.
    ///
    /// # Errors
    ///
    /// Returns a transport failure, a typed refusal, or a contract mismatch.
    pub async fn get_conversation(
        &self,
        conversation_id: Uuid,
    ) -> Result<Transcript, ExploreClientError> {
        self.call(
            Route::ExploreConversationsGet,
            &ConversationGetRequest { conversation_id },
        )
        .await
    }

    /// `explore/runs/start`: ask, edit or regenerate. The turn spends the
    /// owner's one Explore quota, shared with every surface.
    ///
    /// # Errors
    ///
    /// Returns a transport failure, a typed refusal, or a contract mismatch.
    pub async fn start_run(
        &self,
        request: &RunStartRequest,
    ) -> Result<ActiveRun, ExploreClientError> {
        self.call(Route::ExploreRunsStart, request).await
    }

    /// `explore/runs/stop`: stop a running turn; the server keeps the partial
    /// answer.
    ///
    /// # Errors
    ///
    /// Returns a transport failure, a typed refusal (`not_found` for a run
    /// that is gone or not the owner's), or a contract mismatch.
    pub async fn stop_run(&self, run_id: Uuid) -> Result<(), ExploreClientError> {
        let answer: RunStopResponse = self
            .call(Route::ExploreRunsStop, &RunRequest { run_id })
            .await?;
        if answer.ok {
            Ok(())
        } else {
            Err(ExploreClientError::Unexpected {
                status: 200,
                detail: "runs/stop answered ok: false".to_owned(),
            })
        }
    }

    /// `explore/runs/active`: the owner's running turns on every surface,
    /// oldest first.
    ///
    /// # Errors
    ///
    /// Returns a transport failure, a typed refusal, or a contract mismatch.
    pub async fn active_runs(&self) -> Result<Vec<ActiveRun>, ExploreClientError> {
        let answer: RunActiveResponse = self
            .call(Route::ExploreRunsActive, &EmptyRequest {})
            .await?;
        Ok(answer.runs)
    }

    /// `explore/runs/outcome`: how a run ended, or none while it runs or once
    /// the server has forgotten it.
    ///
    /// # Errors
    ///
    /// Returns a transport failure, a typed refusal, or a contract mismatch.
    pub async fn run_outcome(
        &self,
        run_id: Uuid,
    ) -> Result<Option<RunOutcome>, ExploreClientError> {
        let answer: RunOutcomeResponse = self
            .call(Route::ExploreRunsOutcome, &RunRequest { run_id })
            .await?;
        Ok(answer.outcome)
    }

    /// Open `explore/runs/stream` once, returning the response only when it
    /// is a `text/event-stream`.
    pub(crate) async fn open_stream(&self, run_id: Uuid) -> Result<Response, ExploreClientError> {
        let response = checked(
            self.post(&self.stream_http, Route::ExploreRunsStream)?
                .header(reqwest::header::ACCEPT, "text/event-stream")
                .json(&RunRequest { run_id })
                .send()
                .await
                .map_err(ExploreClientError::Transport)?,
        )
        .await?;
        let content_type = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .unwrap_or_default();
        if !content_type.starts_with("text/event-stream") {
            return Err(ExploreClientError::Unexpected {
                status: response.status().as_u16(),
                detail: format!("runs/stream answered {content_type:?}, not text/event-stream"),
            });
        }
        Ok(response)
    }
}

/// Succeed on a 2xx; otherwise read the body and map it to its typed failure.
async fn checked(response: Response) -> Result<Response, ExploreClientError> {
    let status = response.status();
    if status.is_success() {
        return Ok(response);
    }
    let wait = retry_after(response.headers());
    // A body that cannot be read still leaves the status to classify.
    let body = response.text().await.unwrap_or_default();
    Err(classify_rejection(status.as_u16(), &body, wait))
}
