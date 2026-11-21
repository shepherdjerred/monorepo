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
//!
//! In the beta profile it also asks Scout for the proactive turns the
//! supervisor's detectors find (`coach/triggers`), through a
//! [`crate::proactive::TriggerGate`] that stops them when Scout says so, and
//! loads Data Dragon's `item.json` for those detectors. A stable build has
//! none of this.

use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use scout_client_core::coach_context::GameContext;
use scout_client_core::desktop_api::{
    ActiveRun, AppTurnRequest, ConversationListResponse, ModelsResponse, RunStartRequest,
};
use scout_client_core::live::champ_select::ChampSelectSnapshot;
use scout_client_core::live::snapshot::LiveSnapshot;
use scout_desktop_ipc::{ChatAvailability, ChatCommand, ChatImage, ChatParts};
use tokio::sync::{Semaphore, mpsc, watch};
use tokio::task::JoinHandle;
use url::Url;
use uuid::Uuid;

use crate::app_turns::CoachInput;
use crate::asset_cache::{AssetCache, DEFAULT_CAPACITY_BYTES};
use crate::authored::PlayerAuthored;
use crate::client::ExploreClient;
use crate::contract::Route;
#[cfg(scout_proactive_coach)]
use crate::data_dragon::item_list_url;
use crate::data_dragon::{DATA_DRAGON_HOST, DataDragon, champion_list_url, rune_list_url};
use crate::error::{ExploreClientError, Recovery};
use crate::model::{Attachment, Transcript};
#[cfg(scout_proactive_coach)]
use crate::proactive::{ProactiveTurn, TriggerGate, TriggerVerdict};
use crate::session::{AttachJob, ChatSession, UploadFailure, load_image};
use crate::stream::{StreamEnd, StreamOptions, StreamSignal};
use crate::visuals::ImageSource;
#[cfg(scout_proactive_coach)]
use scout_client_core::desktop_api::CoachTriggerResponse;
#[cfg(scout_proactive_coach)]
use scout_client_core::live::detectors::ItemCatalog;

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

/// One window command, with the game in progress when it arrived.
#[derive(Debug, Clone, PartialEq)]
pub struct RelayCommand {
    /// What the window asked.
    pub command: ChatCommand,
    /// The supervisor's latest allowlisted snapshot, for a `send` whose
    /// composer chip asked to use the live game while one was live; none
    /// otherwise.
    pub live_game: Option<LiveSnapshot>,
    /// What the champion-select screen shows while it is open, for a `send`:
    /// the player asked while choosing, so the question may carry it.
    pub champ_select: Option<ChampSelectSnapshot>,
}

/// The supervisor's handle on the chat relay.
#[derive(Debug, Clone)]
pub struct ChatRelay {
    commands: mpsc::UnboundedSender<RelayCommand>,
    coach: mpsc::UnboundedSender<CoachInput>,
    /// Cleared when Scout says the coach is off for this player; set again
    /// by the next refresh.
    coach_enabled: Arc<AtomicBool>,
    parts: watch::Receiver<ChatParts>,
    /// Data Dragon's item facts, once loaded, for the proactive detectors.
    #[cfg(scout_proactive_coach)]
    items: watch::Receiver<Option<Arc<ItemCatalog>>>,
    /// The run of the latest proactive turn that answered, for voice to speak.
    #[cfg(scout_proactive_coach)]
    proactive_answers: watch::Receiver<Option<Uuid>>,
}

/// What a relay with nothing behind it hands the test that drives it.
pub struct DetachedRelay {
    /// The relay the supervisor holds.
    pub relay: ChatRelay,
    /// The window commands it was given.
    pub commands: mpsc::UnboundedReceiver<RelayCommand>,
    /// The coach's turns, and the end of one.
    pub coach: mpsc::UnboundedReceiver<CoachInput>,
    /// Publishes the parts the supervisor reads.
    pub parts: watch::Sender<ChatParts>,
    /// What the relay would set when Scout says the coach is off.
    pub coach_enabled: Arc<AtomicBool>,
    /// Publishes the item facts the proactive detectors read.
    #[cfg(scout_proactive_coach)]
    pub items: watch::Sender<Option<Arc<ItemCatalog>>>,
    /// Publishes the proactive answers voice may speak.
    #[cfg(scout_proactive_coach)]
    pub proactive_answers: watch::Sender<Option<Uuid>>,
}

impl ChatRelay {
    /// Start the relay for `origin` on the current Tokio runtime, caching
    /// pictures in `cache_directory`. It asks Scout nothing until the first
    /// [`ChatCommand::Refresh`], which the supervisor sends when a window
    /// opens.
    #[must_use]
    pub fn spawn(origin: String, cache_directory: PathBuf) -> Self {
        let DetachedRelay {
            relay,
            commands,
            coach,
            parts,
            #[cfg(scout_proactive_coach)]
            items,
            #[cfg(scout_proactive_coach)]
            proactive_answers,
            ..
        } = Self::detached_coach();
        let enabled = Arc::clone(&relay.coach_enabled);
        tokio::spawn(run(
            Channels {
                commands,
                coach,
                coach_enabled: enabled,
                parts,
                #[cfg(scout_proactive_coach)]
                items,
                #[cfg(scout_proactive_coach)]
                proactive_answers,
            },
            origin,
            cache_directory,
        ));
        relay
    }

    /// A relay with nothing behind it: the caller reads the commands and
    /// publishes the parts. For tests of the supervisor's side of the link.
    #[must_use]
    pub fn detached() -> (
        Self,
        mpsc::UnboundedReceiver<RelayCommand>,
        watch::Sender<ChatParts>,
    ) {
        let DetachedRelay {
            relay,
            commands,
            parts,
            ..
        } = Self::detached_coach();
        (relay, commands, parts)
    }

    /// [`Self::detached`], with the coach's turns to read as well.
    #[must_use]
    pub fn detached_coach() -> DetachedRelay {
        let (commands, receiver) = mpsc::unbounded_channel();
        let (coach, coach_receiver) = mpsc::unbounded_channel();
        let (parts, watcher) = watch::channel(ChatParts::default());
        let coach_enabled = Arc::new(AtomicBool::new(true));
        #[cfg(scout_proactive_coach)]
        let (items, items_watcher) = watch::channel(None);
        #[cfg(scout_proactive_coach)]
        let (proactive_answers, answers_watcher) = watch::channel(None);
        DetachedRelay {
            relay: Self {
                commands,
                coach,
                coach_enabled: Arc::clone(&coach_enabled),
                parts: watcher,
                #[cfg(scout_proactive_coach)]
                items: items_watcher,
                #[cfg(scout_proactive_coach)]
                proactive_answers: answers_watcher,
            },
            commands: receiver,
            coach: coach_receiver,
            parts,
            coach_enabled,
            #[cfg(scout_proactive_coach)]
            items,
            #[cfg(scout_proactive_coach)]
            proactive_answers,
        }
    }

    /// Pass one window command on. A relay that has stopped drops it: the
    /// supervisor is shutting down.
    pub fn send(&self, command: ChatCommand) {
        self.send_with_live_game(command, None);
    }

    /// Pass one window command on with the game in progress. The relay
    /// attaches `live_game` only to a `send` whose chip asked for it.
    pub fn send_with_live_game(&self, command: ChatCommand, live_game: Option<LiveSnapshot>) {
        self.send_with_game(command, live_game, None);
    }

    /// Pass one window command on with the game around it: the live game, or
    /// the champion-select screen. Only a `send` carries either.
    pub fn send_with_game(
        &self,
        command: ChatCommand,
        live_game: Option<LiveSnapshot>,
        champ_select: Option<ChampSelectSnapshot>,
    ) {
        // A send fails only once the relay's task has ended, which happens
        // when the supervisor drops its runtime on the way out.
        let _stopped = self.commands.send(RelayCommand {
            command,
            live_game,
            champ_select,
        });
    }

    /// Hand the relay a coach turn, or the end of one.
    pub fn coach(&self, input: CoachInput) {
        let _stopped = self.coach.send(input);
    }

    /// Whether Scout Coach may start turns for this player: true until Scout
    /// says it is turned off, and again after the next refresh.
    #[must_use]
    pub fn coach_enabled(&self) -> bool {
        self.coach_enabled.load(Ordering::Relaxed)
    }

    /// Follow what the window should render.
    #[must_use]
    pub fn subscribe(&self) -> watch::Receiver<ChatParts> {
        self.parts.clone()
    }

    /// Data Dragon's item facts for the proactive detectors, once Scout has
    /// named its version and `item.json` loaded. Beta profile only.
    #[cfg(scout_proactive_coach)]
    #[must_use]
    pub fn item_catalog(&self) -> Option<Arc<ItemCatalog>> {
        self.items.borrow().clone()
    }

    /// The run of each proactive turn that answers, as it does: voice speaks
    /// it when the player has conversation mode on. Beta profile only.
    #[cfg(scout_proactive_coach)]
    #[must_use]
    pub fn proactive_answers(&self) -> watch::Receiver<Option<Uuid>> {
        self.proactive_answers.clone()
    }

    /// Whether Scout refused this build as too old for chat.
    #[must_use]
    pub fn upgrade_required(&self) -> bool {
        self.parts.borrow().status.availability == ChatAvailability::UpgradeRequired
    }
}

/// The champion-select screen as the coach contract carries it, or none when
/// this screen breaks a bound Scout would refuse.
fn champ_select_context(snapshot: &ChampSelectSnapshot) -> Option<GameContext> {
    match GameContext::champ_select(snapshot) {
        Ok(game) => Some(game),
        Err(error) => {
            tracing::warn!(%error, "sending the question without the champion select");
            None
        }
    }
}

/// The live game as the coach contract carries it, or none when this frame
/// breaks a bound Scout would refuse. Riot's frame is outside Scout's
/// control, so an out-of-bounds one sends the question without it rather than
/// losing the question.
fn live_context(snapshot: &LiveSnapshot) -> Option<GameContext> {
    let game = GameContext::live(snapshot);
    match game.validate() {
        Ok(()) => Some(game),
        Err(error) => {
            tracing::warn!(%error, "sending the question without the live game");
            None
        }
    }
}

/// An answer from a request the relay started.
enum Answer {
    Client(Result<ExploreClient, ExploreClientError>),
    Listed(Result<ConversationListResponse, ExploreClientError>),
    /// A transcript read for a conversation, stamped with the version-switch
    /// count when it was asked for.
    Opened(u64, Result<Transcript, ExploreClientError>),
    /// The transcript read back after a version switch.
    Switched(Result<Transcript, ExploreClientError>),
    Started(Result<ActiveRun, ExploreClientError>),
    /// `runs/start-app` answered for a turn Scout asked for.
    AppStarted(Result<ActiveRun, ExploreClientError>),
    Models(Result<ModelsResponse, ExploreClientError>),
    Uploaded(Uuid, Result<Attachment, UploadFailure>),
    /// A version switch, share or revoke finished; the conversation's
    /// transcript is read again either way it went.
    Changed {
        conversation_id: Uuid,
        switch: bool,
        result: Result<(), ExploreClientError>,
    },
    Signal(StreamSignal),
    Ended(Result<StreamEnd, ExploreClientError>),
    Settled(Result<Transcript, ExploreClientError>),
    Failed(ExploreClientError),
    Art(Result<DataDragon, String>),
    /// `item.json` for the proactive detectors.
    #[cfg(scout_proactive_coach)]
    Items(Result<ItemCatalog, String>),
    /// `coach/triggers` answered for a turn of this game.
    #[cfg(scout_proactive_coach)]
    Triggered(String, Result<CoachTriggerResponse, ExploreClientError>),
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
    coach_enabled: Arc<AtomicBool>,
    pictures: Arc<Pictures>,
    /// Picture keys already asked for, so each is fetched once.
    requested: HashSet<String>,
    /// Whether Scout still takes proactive turns.
    #[cfg(scout_proactive_coach)]
    gate: TriggerGate,
    #[cfg(scout_proactive_coach)]
    items: watch::Sender<Option<Arc<ItemCatalog>>>,
    /// The proactive turn being followed, until its stream ends.
    #[cfg(scout_proactive_coach)]
    proactive_run: Option<Uuid>,
    #[cfg(scout_proactive_coach)]
    proactive_answers: watch::Sender<Option<Uuid>>,
}

/// The relay task's ends of its channels.
struct Channels {
    commands: mpsc::UnboundedReceiver<RelayCommand>,
    coach: mpsc::UnboundedReceiver<CoachInput>,
    coach_enabled: Arc<AtomicBool>,
    parts: watch::Sender<ChatParts>,
    #[cfg(scout_proactive_coach)]
    items: watch::Sender<Option<Arc<ItemCatalog>>>,
    #[cfg(scout_proactive_coach)]
    proactive_answers: watch::Sender<Option<Uuid>>,
}

async fn run(channels: Channels, origin: String, cache_directory: PathBuf) {
    let Channels {
        mut commands,
        mut coach,
        coach_enabled,
        parts,
        #[cfg(scout_proactive_coach)]
        items,
        #[cfg(scout_proactive_coach)]
        proactive_answers,
    } = channels;
    let (answers, mut answered) = mpsc::unbounded_channel();
    let session = ChatSession::with_web_origin(&origin);
    let mut relay = Relay {
        origin,
        session,
        client: None,
        answers,
        follow: None,
        coach_enabled,
        pictures: Arc::new(Pictures::open(cache_directory)),
        requested: HashSet::new(),
        #[cfg(scout_proactive_coach)]
        gate: TriggerGate::new(),
        #[cfg(scout_proactive_coach)]
        items,
        #[cfg(scout_proactive_coach)]
        proactive_run: None,
        #[cfg(scout_proactive_coach)]
        proactive_answers,
    };
    loop {
        tokio::select! {
            command = commands.recv() => match command {
                Some(command) => relay.command(command),
                None => break,
            },
            Some(input) = coach.recv() => relay.coach_input(input),
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
    fn command(&mut self, input: RelayCommand) {
        let RelayCommand {
            command,
            live_game,
            champ_select,
        } = input;
        match command {
            ChatCommand::Refresh => {
                // Pairing, a new window or a retry: ask whether the coach is
                // on again.
                self.coach_enabled.store(true, Ordering::Relaxed);
                #[cfg(scout_proactive_coach)]
                self.gate.refresh();
                self.refresh();
            }
            ChatCommand::Open { conversation_id } => {
                // Looking again retries what failed to load last time.
                for key in self.session.forget_failed_images() {
                    self.requested.remove(&key);
                }
                if self.session.open(conversation_id) {
                    self.fetch_opened(conversation_id);
                }
            }
            ChatCommand::New => self.session.new_chat(),
            ChatCommand::Send {
                question,
                live_game: use_live_game,
            } => self.send(question, live_game.filter(|_| use_live_game), champ_select),
            ChatCommand::Edit {
                message_id,
                question,
            } => {
                let request = self.session.edit(message_id, &question);
                self.start(request);
            }
            ChatCommand::ChooseOption { message_id, index } => {
                let request = self.session.choose_option(message_id, index);
                self.start(request);
            }
            ChatCommand::Regenerate { message_id } => {
                let request = self.session.regenerate(message_id);
                self.start(request);
            }
            ChatCommand::SwitchVersion { message_id } => {
                // Ask the session last: it marks the switch as under way.
                if let Some(client) = self.client.clone()
                    && let Some((conversation_id, message_id)) =
                        self.session.switch_version(message_id)
                {
                    self.change(conversation_id, true, async move {
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
                    self.change(conversation_id, false, async move {
                        client.share(conversation_id).await.map(drop)
                    });
                }
            }
            ChatCommand::RevokeShare => {
                if let (Some(client), Some(conversation_id)) =
                    (self.client.clone(), self.session.shareable())
                {
                    self.change(conversation_id, false, async move {
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

    /// The composer's question, with the game around it when the player is in
    /// one: the live game if the chip asked for it, else the champion-select
    /// screen while the coach is on.
    fn send(
        &mut self,
        question: String,
        live_game: Option<LiveSnapshot>,
        champ_select: Option<ChampSelectSnapshot>,
    ) {
        // The composer's `send` is the only text the player typed.
        let question = PlayerAuthored::from_composer(question);
        let game = live_game
            .and_then(|snapshot| live_context(&snapshot))
            .or_else(|| {
                champ_select
                    .filter(|_| self.coach_enabled.load(Ordering::Relaxed))
                    .and_then(|select| champ_select_context(&select))
            });
        let request = match game {
            Some(game) => self.session.submit_with_game(&question, game),
            None => self.session.submit(question.get()),
        };
        self.start(request);
    }

    /// A turn Scout asks for itself, or the end of one. Nothing starts while
    /// Scout says the coach is off, or before a credential is read.
    fn coach_input(&mut self, input: CoachInput) {
        match input {
            CoachInput::Clear => self.session.clear_coach(),
            CoachInput::Turn(turn) => {
                if !self.coach_enabled.load(Ordering::Relaxed) {
                    return;
                }
                let Some(client) = self.client.clone() else {
                    return;
                };
                let Some(request) = self.session.begin_app_turn(&turn) else {
                    return;
                };
                self.start_app(client, request);
            }
            #[cfg(scout_proactive_coach)]
            CoachInput::Trigger(turn) => self.trigger(&turn),
        }
    }

    /// Ask Scout for the proactive turn a detector found, unless the coach is
    /// off or Scout has stopped proactive turns for this game.
    #[cfg(scout_proactive_coach)]
    fn trigger(&mut self, turn: &ProactiveTurn) {
        if !self.coach_enabled.load(Ordering::Relaxed) || !self.gate.admits(&turn.game_key) {
            return;
        }
        let Some(client) = self.client.clone() else {
            return;
        };
        let Some(request) = self.session.begin_proactive_turn(turn) else {
            return;
        };
        let answers = self.answers.clone();
        let game_key = turn.game_key.clone();
        tokio::spawn(async move {
            let result = client.start_coach_trigger(&request).await;
            let _ = answers.send(Answer::Triggered(game_key, result));
        });
    }

    /// Scout's answer to a proactive turn.
    #[cfg(scout_proactive_coach)]
    fn triggered(
        &mut self,
        game_key: &str,
        result: Result<CoachTriggerResponse, ExploreClientError>,
    ) {
        let verdict = TriggerVerdict::of(&result);
        self.gate.settle(game_key, &verdict);
        if let TriggerVerdict::Started(run) = verdict {
            let run_id = run.run_id;
            self.session.started(run);
            self.follow_run(run_id);
            self.proactive_run = Some(run_id);
        } else {
            self.session
                .proactive_turn_not_started(result.err().as_ref());
        }
    }

    /// Load `item.json` at the version Scout names, through the picture
    /// cache, for the proactive detectors.
    #[cfg(scout_proactive_coach)]
    fn load_items(&self, client: &ExploreClient) {
        let client = client.clone();
        let pictures = Arc::clone(&self.pictures);
        let answers = self.answers.clone();
        tokio::spawn(async move {
            let loaded = async {
                let version = client
                    .assets()
                    .await
                    .map_err(|error| error.to_string())?
                    .data_dragon_version;
                let path = pictures.art(&item_list_url(&version)).await?;
                let json = std::fs::read_to_string(path).map_err(|error| error.to_string())?;
                ItemCatalog::from_data_dragon(&json).map_err(|error| error.to_string())
            };
            let _ = answers.send(Answer::Items(loaded.await));
        });
    }

    fn start_app(&self, client: ExploreClient, request: AppTurnRequest) {
        let answers = self.answers.clone();
        tokio::spawn(async move {
            let _ = answers.send(Answer::AppStarted(client.start_app_run(&request).await));
        });
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
        switch: bool,
        change: impl std::future::Future<Output = Result<(), ExploreClientError>> + Send + 'static,
    ) {
        let answers = self.answers.clone();
        tokio::spawn(async move {
            let _ = answers.send(Answer::Changed {
                conversation_id,
                switch,
                result: change.await,
            });
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

    /// Read a conversation for the screen, stamped so a switch that starts
    /// meanwhile makes the answer stale.
    fn fetch_opened(&self, conversation_id: Uuid) {
        let epoch = self.session.epoch();
        self.fetch(conversation_id, move |result| Answer::Opened(epoch, result));
    }

    fn fetch(
        &self,
        conversation_id: Uuid,
        wrap: impl FnOnce(Result<Transcript, ExploreClientError>) -> Answer + Send + 'static,
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
                #[cfg(scout_proactive_coach)]
                if self.items.borrow().is_none() {
                    self.load_items(&client);
                }
                self.client = Some(client);
                self.list();
                self.models();
                if let Some(open) = self.session.open_conversation() {
                    self.fetch_opened(open);
                }
            }
            Answer::Client(Err(error)) => {
                self.client = None;
                self.session.refresh_failed(&error);
            }
            Answer::Listed(Ok(list)) => self.session.listed(list),
            Answer::Listed(Err(error)) => self.session.refresh_failed(&error),
            Answer::Opened(epoch, Ok(transcript)) => self.session.read_back(epoch, transcript),
            Answer::Switched(result) => self.session.switch_settled(result),
            Answer::Opened(_, Err(error)) | Answer::Failed(error) => {
                self.session.request_failed(&error);
            }
            Answer::Started(Ok(run)) | Answer::AppStarted(Ok(run)) => {
                let run_id = run.run_id;
                self.session.started(run);
                self.follow_run(run_id);
            }
            Answer::Started(Err(error)) => self.session.start_failed(&error),
            Answer::AppStarted(Err(error)) => {
                if error.recovery() == Some(Recovery::FeatureDisabled) {
                    // Scout Coach is off for this player: show nothing and
                    // stop asking until the next refresh.
                    self.coach_enabled.store(false, Ordering::Relaxed);
                    self.session.clear_coach();
                }
                self.session.app_turn_failed(&error);
            }
            Answer::Models(Ok(models)) => self.session.models_loaded(models),
            Answer::Models(Err(error)) => self.session.request_failed(&error),
            Answer::Uploaded(key, result) => {
                if let (Some(client), Some(id)) = (
                    self.client.clone(),
                    self.session.upload_finished(key, result),
                ) {
                    // The draft was removed while this uploaded. Best effort,
                    // like RemoveAttachment: the hold lapses on its own.
                    tokio::spawn(async move {
                        let _ = client.discard_attachment(id).await;
                    });
                }
            }
            Answer::Changed {
                conversation_id,
                switch,
                result,
            } => {
                if let Err(error) = result {
                    self.session.request_failed(&error);
                }
                // Read it again whichever way it went: a switch moves the
                // branch, a share adds the link, a refusal shows what is true.
                // A switch settles on its own readback, failed or not.
                if switch {
                    self.fetch(conversation_id, Answer::Switched);
                } else {
                    self.fetch_opened(conversation_id);
                }
                self.list();
            }
            Answer::Signal(signal) => self.session.signal(&signal),
            Answer::Ended(end) => self.ended(end),
            Answer::Settled(Ok(transcript)) => self.session.settled(transcript),
            Answer::Settled(Err(error)) => self.session.settle_failed(&error),
            // Without the catalog, cards keep their labelled placeholders;
            // the next refresh tries again.
            Answer::Art(Ok(art)) => self.session.art_loaded(art),
            Answer::Art(Err(_)) => {}
            #[cfg(scout_proactive_coach)]
            Answer::Items(Ok(catalog)) => {
                self.items.send_replace(Some(Arc::new(catalog)));
            }
            // Without item facts the detectors do not run; the next refresh
            // tries again.
            #[cfg(scout_proactive_coach)]
            Answer::Items(Err(error)) => {
                tracing::warn!(%error, "could not load Data Dragon item facts");
            }
            #[cfg(scout_proactive_coach)]
            Answer::Triggered(game_key, result) => self.triggered(&game_key, result),
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

    /// The run stream ended: read the conversation back once it landed.
    fn ended(&mut self, end: Result<StreamEnd, ExploreClientError>) {
        self.follow = None;
        // A proactive turn that answered may be spoken.
        #[cfg(scout_proactive_coach)]
        if let Some(run_id) = self.proactive_run.take()
            && matches!(
                end,
                Ok(StreamEnd::Done(
                    scout_client_core::desktop_api::RunOutcome::Succeeded
                ))
            )
        {
            self.proactive_answers.send_replace(Some(run_id));
        }
        if let Some(conversation_id) = self.session.stream_ended(end) {
            self.fetch(conversation_id, Answer::Settled);
            // The title and order change once a turn lands.
            self.list();
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

#[cfg(test)]
mod tests {
    use scout_client_core::live::snapshot::{
        LiveGameInfo, LiveItem, LiveParticipant, LiveSnapshot, OwnStats, Team,
    };

    use super::live_context;

    fn snapshot(item_name: &str) -> LiveSnapshot {
        LiveSnapshot {
            game: LiveGameInfo {
                mode: "CLASSIC".to_owned(),
                map: "Map11".to_owned(),
                game_time_secs: 421,
            },
            own: OwnStats {
                gold: 845,
                max_health: 1180.5,
                health: 902.25,
                resource: "MANA".to_owned(),
                max_resource: 840.0,
                current_resource: 512.5,
                armor: 38.4,
                magic_resist: 30.0,
                attack_damage: 64.0,
                ability_power: 132.5,
                attack_speed: 0.703,
                move_speed: 345.0,
                crit_chance: 0.0,
            },
            participants: vec![LiveParticipant {
                team: Team::Order,
                is_self: true,
                champion: "Ahri".to_owned(),
                level: 10,
                kills: 4,
                deaths: 2,
                assists: 7,
                creep_score: 87,
                items: vec![LiveItem {
                    item_id: 6655,
                    name: item_name.to_owned(),
                    count: 1,
                }],
                summoner_spells: ["Flash".to_owned(), "Ignite".to_owned()],
                keystone: Some("Electrocute".to_owned()),
            }],
            event_count: 0,
            latest_event: None,
        }
    }

    #[test]
    fn the_live_game_goes_as_the_coach_contract_spells_it() {
        let game = live_context(&snapshot("Luden's Companion"));
        let live = game.and_then(|game| game.live);
        assert_eq!(
            live.map(|live| (live.game.game_time_secs, live.participants.len())),
            Some((421, 1))
        );
    }

    #[test]
    fn a_frame_past_the_contract_sends_the_question_without_it() {
        assert_eq!(live_context(&snapshot(&"x".repeat(97))), None);
    }
}
