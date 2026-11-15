//! The supervisor's side of desktop chat: runs the Explore client against a
//! [`ChatSession`] and publishes the window's view of it.
//!
//! The device credential stays in the supervisor process, which already holds
//! it for uploads; the window, which renders on the GPU and can be lost with
//! it, never sees the bearer. It sends [`ChatCommand`]s over IPC and renders
//! the [`ChatParts`] this relay publishes.
//!
//! The relay also fetches every picture the open transcript names into the
//! disk cache: each chart from `explore/visualization` with the device
//! credential, one at a time so a long conversation stays inside the
//! device's render budget, and card art from Data Dragon, a few at a time.
//! The window reads the cached files; it never fetches anything itself.

use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use scout_client_core::desktop_api::{
    ActiveRun, ConversationListResponse, ModelsResponse, RunStartRequest,
};
use scout_desktop_ipc::{ChatAvailability, ChatCommand, ChatImage, ChatParts};
use tokio::sync::{Semaphore, mpsc, watch};
use tokio::task::JoinHandle;
use url::Url;
use uuid::Uuid;

use crate::asset_cache::{AssetCache, DEFAULT_CAPACITY_BYTES};
use crate::client::ExploreClient;
use crate::contract::Route;
use crate::data_dragon::{DATA_DRAGON_HOST, DataDragon, champion_list_url, rune_list_url};
use crate::error::ExploreClientError;
use crate::model::{Attachment, Transcript};
use crate::session::{AttachJob, ChatSession, UploadFailure, load_image};
use crate::stream::{StreamEnd, StreamOptions, StreamSignal};
use crate::visuals::ImageSource;

/// How long one Data Dragon download may take.
const ART_TIMEOUT: Duration = Duration::from_secs(15);
/// The largest Data Dragon file chat accepts; `champion.json` is the largest.
const MAX_ART_BYTES: usize = 4 * 1024 * 1024;
/// Data Dragon downloads in flight at once.
const ART_CONCURRENCY: usize = 6;
/// What a picture that could not be fetched says.
const ART_FAILED: &str = "This image is unavailable.";

/// Where pictures come from and land: the disk cache, the Data Dragon
/// client, and how many of each may be in flight.
#[derive(Debug)]
struct Pictures {
    cache: Result<AssetCache, String>,
    http: Result<reqwest::Client, String>,
    art_permits: Semaphore,
    chart_permits: Semaphore,
}

impl Pictures {
    fn open(directory: PathBuf) -> Self {
        Self {
            cache: AssetCache::open(directory, DEFAULT_CAPACITY_BYTES)
                .map_err(|error| format!("Scout could not keep images on this computer: {error}")),
            http: reqwest::Client::builder()
                .timeout(ART_TIMEOUT)
                .build()
                .map_err(|error| error.to_string()),
            art_permits: Semaphore::new(ART_CONCURRENCY),
            chart_permits: Semaphore::new(1),
        }
    }

    fn cache(&self) -> Result<&AssetCache, String> {
        self.cache.as_ref().map_err(Clone::clone)
    }

    async fn cached(self: &Arc<Self>, key: &str) -> Result<Option<PathBuf>, String> {
        self.cache()?;
        let pictures = Arc::clone(self);
        let key = key.to_owned();
        tokio::task::spawn_blocking(move || pictures.cache().map(|cache| cache.get(&key)))
            .await
            .map_err(|error| error.to_string())?
    }

    async fn store(self: &Arc<Self>, key: &str, bytes: Vec<u8>) -> Result<PathBuf, String> {
        let pictures = Arc::clone(self);
        let key = key.to_owned();
        tokio::task::spawn_blocking(move || {
            pictures
                .cache()?
                .put(&key, &bytes)
                .map_err(|error| error.to_string())
        })
        .await
        .map_err(|error| error.to_string())?
    }

    /// A Data Dragon file, from the cache or downloaded into it. Only
    /// `https://ddragon.leagueoflegends.com` is ever fetched.
    async fn art(self: &Arc<Self>, url: &str) -> Result<PathBuf, String> {
        let parsed = Url::parse(url).map_err(|error| error.to_string())?;
        if parsed.scheme() != "https" || parsed.host_str() != Some(DATA_DRAGON_HOST) {
            return Err(format!("{url} is not a Data Dragon URL"));
        }
        if let Some(path) = self.cached(url).await? {
            return Ok(path);
        }
        let _permit = self
            .art_permits
            .acquire()
            .await
            .map_err(|error| error.to_string())?;
        let http = self.http.as_ref().map_err(Clone::clone)?;
        let response = http
            .get(parsed)
            .send()
            .await
            .and_then(reqwest::Response::error_for_status)
            .map_err(|error| error.to_string())?;
        let bytes = response.bytes().await.map_err(|error| error.to_string())?;
        if bytes.len() > MAX_ART_BYTES {
            return Err(format!("{url} is {} bytes", bytes.len()));
        }
        self.store(url, bytes.to_vec()).await
    }

    /// One answer's chart, from the cache or drawn by Scout into it.
    async fn chart(
        self: &Arc<Self>,
        client: &ExploreClient,
        conversation_id: Uuid,
        message_id: Uuid,
    ) -> Result<PathBuf, String> {
        // A persisted answer's chart never changes, so it is cached by the
        // backend and the answer alone.
        let key = format!(
            "{}{}#{conversation_id}/{message_id}",
            client.origin().trim_end_matches('/'),
            Route::ExploreVisualization.path()
        );
        if let Some(path) = self.cached(&key).await? {
            return Ok(path);
        }
        let _permit = self
            .chart_permits
            .acquire()
            .await
            .map_err(|error| error.to_string())?;
        let bytes = client
            .visualization(conversation_id, message_id)
            .await
            .map_err(|error| {
                error.refusal().map_or_else(
                    || "Scout could not draw this chart.".to_owned(),
                    |refusal| refusal.message.clone(),
                )
            })?;
        self.store(&key, bytes).await
    }

    /// Card art's catalog at the version Scout names.
    async fn data_dragon(self: &Arc<Self>, client: &ExploreClient) -> Result<DataDragon, String> {
        let version = client
            .assets()
            .await
            .map_err(|error| error.to_string())?
            .data_dragon_version;
        let read = |path: PathBuf| std::fs::read(path).map_err(|error| error.to_string());
        let champions = read(self.art(&champion_list_url(&version)).await?)?;
        let runes = read(self.art(&rune_list_url(&version)).await?)?;
        DataDragon::from_documents(&version, &champions, &runes).map_err(|error| error.to_string())
    }
}

/// The supervisor's handle on the chat relay.
#[derive(Debug, Clone)]
pub struct ChatRelay {
    commands: mpsc::UnboundedSender<ChatCommand>,
    parts: watch::Receiver<ChatParts>,
}

impl ChatRelay {
    /// Start the relay for `origin` on the current Tokio runtime, caching
    /// pictures in `cache_directory`. It asks Scout nothing until the first
    /// [`ChatCommand::Refresh`], which the supervisor sends when a window
    /// opens.
    #[must_use]
    pub fn spawn(origin: String, cache_directory: PathBuf) -> Self {
        let (relay, commands, parts) = Self::detached();
        tokio::spawn(run(origin, cache_directory, commands, parts));
        relay
    }

    /// A relay with nothing behind it: the caller reads the commands and
    /// publishes the parts. For tests of the supervisor's side of the link.
    #[must_use]
    pub fn detached() -> (
        Self,
        mpsc::UnboundedReceiver<ChatCommand>,
        watch::Sender<ChatParts>,
    ) {
        let (commands, receiver) = mpsc::unbounded_channel();
        let (parts, watcher) = watch::channel(ChatParts::default());
        (
            Self {
                commands,
                parts: watcher,
            },
            receiver,
            parts,
        )
    }

    /// Pass one window command on. A relay that has stopped drops it: the
    /// supervisor is shutting down.
    pub fn send(&self, command: ChatCommand) {
        // A send fails only once the relay's task has ended, which happens
        // when the supervisor drops its runtime on the way out.
        let _stopped = self.commands.send(command);
    }

    /// Follow what the window should render.
    #[must_use]
    pub fn subscribe(&self) -> watch::Receiver<ChatParts> {
        self.parts.clone()
    }

    /// Whether Scout refused this build as too old for chat.
    #[must_use]
    pub fn upgrade_required(&self) -> bool {
        self.parts.borrow().status.availability == ChatAvailability::UpgradeRequired
    }
}

/// An answer from a request the relay started.
enum Answer {
    Client(Result<ExploreClient, ExploreClientError>),
    Listed(Result<ConversationListResponse, ExploreClientError>),
    Opened(Result<Transcript, ExploreClientError>),
    Started(Result<ActiveRun, ExploreClientError>),
    Models(Result<ModelsResponse, ExploreClientError>),
    Uploaded(Uuid, Result<Attachment, UploadFailure>),
    /// A version switch, share or revoke finished; the conversation's
    /// transcript is read again either way it went.
    Changed(Uuid, Result<(), ExploreClientError>),
    Signal(StreamSignal),
    Ended(Result<StreamEnd, ExploreClientError>),
    Settled(Result<Transcript, ExploreClientError>),
    Failed(ExploreClientError),
    Art(Result<DataDragon, String>),
    Picture {
        key: String,
        fetched: Result<PathBuf, String>,
    },
}

struct Relay {
    origin: String,
    session: ChatSession,
    client: Option<ExploreClient>,
    answers: mpsc::UnboundedSender<Answer>,
    follow: Option<JoinHandle<()>>,
    pictures: Arc<Pictures>,
    /// Picture keys already asked for, so each is fetched once.
    requested: HashSet<String>,
}

async fn run(
    origin: String,
    cache_directory: PathBuf,
    mut commands: mpsc::UnboundedReceiver<ChatCommand>,
    parts: watch::Sender<ChatParts>,
) {
    let (answers, mut answered) = mpsc::unbounded_channel();
    let session = ChatSession::with_web_origin(&origin);
    let mut relay = Relay {
        origin,
        session,
        client: None,
        answers,
        follow: None,
        pictures: Arc::new(Pictures::open(cache_directory)),
        requested: HashSet::new(),
    };
    loop {
        tokio::select! {
            command = commands.recv() => match command {
                Some(command) => relay.command(command),
                None => break,
            },
            Some(answer) = answered.recv() => relay.answer(answer),
        }
        relay.fetch_pictures();
        let next = relay.session.parts();
        parts.send_if_modified(|current| {
            if *current == next {
                false
            } else {
                *current = next;
                true
            }
        });
    }
    if let Some(follow) = relay.follow.take() {
        follow.abort();
    }
}

impl Relay {
    fn command(&mut self, command: ChatCommand) {
        match command {
            ChatCommand::Refresh => self.refresh(),
            ChatCommand::Open { conversation_id } => {
                // Looking again retries what failed to load last time.
                for key in self.session.forget_failed_images() {
                    self.requested.remove(&key);
                }
                if self.session.open(conversation_id) {
                    self.fetch(conversation_id, Answer::Opened);
                }
            }
            ChatCommand::New => self.session.start_new(),
            ChatCommand::Send { question } => {
                let request = self.session.submit(&question);
                self.start(request);
            }
            ChatCommand::Edit {
                message_id,
                question,
            } => {
                let request = self.session.edit(message_id, &question);
                self.start(request);
            }
            ChatCommand::Regenerate { message_id } => {
                let request = self.session.regenerate(message_id);
                self.start(request);
            }
            ChatCommand::SwitchVersion { message_id } => {
                if let (Some(client), Some((conversation_id, message_id))) =
                    (self.client.clone(), self.session.switch_version(message_id))
                {
                    self.change(conversation_id, async move {
                        client.set_leaf(conversation_id, message_id).await
                    });
                }
            }
            ChatCommand::Attach { path } => {
                if let (Some(client), Some(job)) =
                    (self.client.clone(), self.session.begin_attach(&path))
                {
                    self.upload(client, job);
                }
            }
            ChatCommand::RemoveAttachment { key } => {
                if let (Some(client), Some(id)) =
                    (self.client.clone(), self.session.remove_attachment(key))
                {
                    // Best effort: an image the server keeps is reclaimed
                    // when its hold lapses, so a failure is not worth a notice.
                    tokio::spawn(async move {
                        let _ = client.discard_attachment(id).await;
                    });
                }
            }
            ChatCommand::Share => {
                if let (Some(client), Some(conversation_id)) =
                    (self.client.clone(), self.session.shareable())
                {
                    self.change(conversation_id, async move {
                        client.share(conversation_id).await.map(drop)
                    });
                }
            }
            ChatCommand::RevokeShare => {
                if let (Some(client), Some(conversation_id)) =
                    (self.client.clone(), self.session.shareable())
                {
                    self.change(conversation_id, async move {
                        client.revoke_share(conversation_id).await
                    });
                }
            }
            ChatCommand::ChooseModel { model } => self.session.choose_model(model.as_deref()),
            ChatCommand::Stop => {
                if let (Some(client), Some(run_id)) = (self.client.clone(), self.session.stop()) {
                    let answers = self.answers.clone();
                    tokio::spawn(async move {
                        if let Err(error) = client.stop_run(run_id).await {
                            let _ = answers.send(Answer::Failed(error));
                        }
                    });
                }
            }
        }
    }

    /// Start the turn a command asked for, if the session allowed it.
    fn start(&self, request: Option<RunStartRequest>) {
        let (Some(client), Some(request)) = (self.client.clone(), request) else {
            return;
        };
        let answers = self.answers.clone();
        tokio::spawn(async move {
            let _ = answers.send(Answer::Started(client.start_run(&request).await));
        });
    }

    /// Run a change to one conversation, then read it again.
    fn change(
        &self,
        conversation_id: Uuid,
        change: impl std::future::Future<Output = Result<(), ExploreClientError>> + Send + 'static,
    ) {
        let answers = self.answers.clone();
        tokio::spawn(async move {
            let _ = answers.send(Answer::Changed(conversation_id, change.await));
        });
    }

    /// Read an image file and upload it.
    fn upload(&self, client: ExploreClient, job: AttachJob) {
        let answers = self.answers.clone();
        tokio::spawn(async move {
            let AttachJob { key, path } = job;
            // File reads can block on a slow disk.
            let loaded = tokio::task::spawn_blocking(move || load_image(&path))
                .await
                .unwrap_or_else(|join| Err(format!("Reading the image failed: {join}")));
            let result = match loaded {
                Ok((media_type, bytes)) => client
                    .upload_attachment(media_type, &bytes)
                    .await
                    .map_err(UploadFailure::Remote),
                Err(message) => Err(UploadFailure::Local(message)),
            };
            let _ = answers.send(Answer::Uploaded(key, result));
        });
    }

    /// Read the credential again (pairing may have replaced it) and ask for
    /// the conversation list, which every gate refuses the same way.
    fn refresh(&self) {
        let origin = self.origin.clone();
        let answers = self.answers.clone();
        tokio::spawn(async move {
            // The credential store can block on the operating system.
            let client =
                tokio::task::spawn_blocking(move || ExploreClient::from_credential_store(&origin))
                    .await
                    .unwrap_or_else(|join| {
                        Err(ExploreClientError::Unexpected {
                            status: 0,
                            detail: format!("reading the device credential failed: {join}"),
                        })
                    });
            let _ = answers.send(Answer::Client(client));
        });
    }

    fn fetch(
        &self,
        conversation_id: Uuid,
        wrap: fn(Result<Transcript, ExploreClientError>) -> Answer,
    ) {
        let Some(client) = self.client.clone() else {
            return;
        };
        let answers = self.answers.clone();
        tokio::spawn(async move {
            let _ = answers.send(wrap(client.get_conversation(conversation_id).await));
        });
    }

    fn models(&self) {
        let Some(client) = self.client.clone() else {
            return;
        };
        let answers = self.answers.clone();
        tokio::spawn(async move {
            let _ = answers.send(Answer::Models(client.models().await));
        });
    }

    fn list(&self) {
        let Some(client) = self.client.clone() else {
            return;
        };
        let answers = self.answers.clone();
        tokio::spawn(async move {
            let _ = answers.send(Answer::Listed(client.list_conversations().await));
        });
    }

    fn answer(&mut self, answer: Answer) {
        match answer {
            Answer::Client(Ok(client)) => {
                self.load_art(&client);
                self.client = Some(client);
                self.list();
                self.models();
                if let Some(open) = self.session.open_conversation() {
                    self.fetch(open, Answer::Opened);
                }
            }
            Answer::Client(Err(error)) => {
                self.client = None;
                self.session.refresh_failed(&error);
            }
            Answer::Listed(Ok(list)) => self.session.listed(list),
            Answer::Listed(Err(error)) => self.session.refresh_failed(&error),
            Answer::Opened(Ok(transcript)) => self.session.opened(transcript),
            Answer::Opened(Err(error)) | Answer::Failed(error) => {
                self.session.request_failed(&error);
            }
            Answer::Started(Ok(run)) => {
                let run_id = run.run_id;
                self.session.started(run);
                self.follow_run(run_id);
            }
            Answer::Started(Err(error)) => self.session.start_failed(&error),
            Answer::Models(Ok(models)) => self.session.models_loaded(models),
            Answer::Models(Err(error)) => self.session.request_failed(&error),
            Answer::Uploaded(key, result) => self.session.upload_finished(key, result),
            Answer::Changed(conversation_id, result) => {
                if let Err(error) = result {
                    self.session.request_failed(&error);
                }
                // Read it again whichever way it went: a switch moves the
                // branch, a share adds the link, a refusal shows what is true.
                self.fetch(conversation_id, Answer::Opened);
                self.list();
            }
            Answer::Signal(signal) => self.session.signal(&signal),
            Answer::Ended(end) => {
                self.follow = None;
                if let Some(conversation_id) = self.session.stream_ended(end) {
                    self.fetch(conversation_id, Answer::Settled);
                    // The title and order change once a turn lands.
                    self.list();
                }
            }
            Answer::Settled(Ok(transcript)) => self.session.settled(transcript),
            Answer::Settled(Err(error)) => self.session.settle_failed(&error),
            // Without the catalog, cards keep their labelled placeholders;
            // the next refresh tries again.
            Answer::Art(Ok(art)) => self.session.art_loaded(art),
            Answer::Art(Err(_)) => {}
            Answer::Picture { key, fetched } => {
                let image = match fetched {
                    Ok(path) => ChatImage::Ready {
                        path: path.to_string_lossy().into_owned(),
                    },
                    Err(message) => ChatImage::Failed { message },
                };
                self.session.image_loaded(key, image);
            }
        }
    }

    fn load_art(&self, client: &ExploreClient) {
        let client = client.clone();
        let pictures = Arc::clone(&self.pictures);
        let answers = self.answers.clone();
        tokio::spawn(async move {
            let _ = answers.send(Answer::Art(pictures.data_dragon(&client).await));
        });
    }

    /// Ask for every picture the transcript names that has not been asked
    /// for yet.
    fn fetch_pictures(&mut self) {
        let Some(client) = self.client.clone() else {
            return;
        };
        for (key, source) in self.session.wanted_images() {
            if !self.requested.insert(key.clone()) {
                continue;
            }
            let client = client.clone();
            let pictures = Arc::clone(&self.pictures);
            let answers = self.answers.clone();
            tokio::spawn(async move {
                let fetched = match source {
                    ImageSource::Chart {
                        conversation_id,
                        message_id,
                    } => pictures.chart(&client, conversation_id, message_id).await,
                    ImageSource::Art { url } => {
                        pictures.art(&url).await.map_err(|_| ART_FAILED.to_owned())
                    }
                };
                let _ = answers.send(Answer::Picture { key, fetched });
            });
        }
    }

    fn follow_run(&mut self, run_id: Uuid) {
        let Some(client) = self.client.clone() else {
            return;
        };
        let answers = self.answers.clone();
        self.follow = Some(tokio::spawn(async move {
            let signals = answers.clone();
            let end = client
                .follow_run(run_id, StreamOptions::default(), move |signal| {
                    let _ = signals.send(Answer::Signal(signal));
                })
                .await;
            let _ = answers.send(Answer::Ended(end));
        }));
    }
}
