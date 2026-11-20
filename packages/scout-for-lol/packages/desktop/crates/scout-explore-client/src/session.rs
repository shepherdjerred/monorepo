//! One desktop chat session as plain state: what the supervisor knows about
//! the owner's conversations and the turn in flight, and the window's view of
//! it.
//!
//! Nothing here does I/O. [`crate::relay`] performs each request this state
//! asks for and feeds the answer back; the window renders
//! [`ChatSession::parts`]. Keeping the transitions pure is what lets the
//! golden reducer fixtures drive the same code the app runs.

use std::collections::{BTreeMap, HashMap};
use std::io::Read;
use std::path::{Path, PathBuf};

use scout_client_core::coach_context::GameContext;
use scout_client_core::desktop_api::{
    ActiveRun, AppInitiation, AppTurnRequest, AttachPoint, ConversationListResponse,
    ConversationSummary, ExploreModel, ModelsResponse, RunStartRequest,
};
use scout_desktop_ipc::{
    ChatAttachment, ChatAvailability, ChatCoach, ChatCoachKind, ChatCoachOption, ChatComposer,
    ChatConversation, ChatDraft, ChatDraftState, ChatImage, ChatMessage, ChatModelOption,
    ChatParts, ChatRole, ChatStatus, ChatToolStatus, ChatToolStep, ChatTranscript, ChatTurn,
    ChatVersion, ChatVisuals,
};
use uuid::Uuid;

use crate::app_turns::AppTurn;
use crate::authored::PlayerAuthored;
use crate::data_dragon::DataDragon;
use crate::error::{ExploreClientError, Recovery};
use crate::model::{
    Attachment, AttachmentMediaType, ExploreMessage, MessageRole, TraceEntry, TraceStatus,
    Transcript,
};
use crate::reducer::{PendingTurn, TurnPhase, TurnView, visible_pending};
use crate::stream::{StreamEnd, StreamSignal};
use crate::visuals::{ImageSource, chat_visuals, image_sources};

/// The longest question the composer sends, matching the web's limit.
pub const MAX_QUESTION_CHARS: usize = 4_000;
/// Images one question may carry: the web's `EXPLORE_MAX_ATTACHMENTS`.
pub const MAX_IMAGES: usize = 4;
/// The largest image Explore accepts: the web's 10 MiB.
pub const MAX_IMAGE_BYTES: u64 = 10 * 1024 * 1024;
/// Where the Scout website lives until the session is told the backend's
/// origin; the golden sessions use it.
pub const DEFAULT_WEB_ORIGIN: &str = "https://scout-for-lol.com";

/// An image the composer holds for the next question.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Draft {
    key: Uuid,
    name: String,
    path: PathBuf,
    media_type: AttachmentMediaType,
    state: DraftState,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum DraftState {
    Uploading,
    /// Stored on the server under this id.
    Ready(Uuid),
    Failed(String),
}

/// The image file the relay should read and upload.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AttachJob {
    /// The draft the answer belongs to.
    pub key: Uuid,
    /// The file to read.
    pub path: PathBuf,
}

/// Why an image did not upload.
#[derive(Debug)]
pub enum UploadFailure {
    /// The file could not be used: too large, unreadable, or not an image
    /// Explore takes. Safe to show.
    Local(String),
    /// Scout refused it, or could not be reached.
    Remote(ExploreClientError),
}

/// Read an image file for upload: at most [`MAX_IMAGE_BYTES`], and an image
/// type Explore stores, told by its first bytes as the server tells it.
///
/// # Errors
///
/// A user-facing reason when the file cannot be used.
pub fn load_image(path: &Path) -> Result<(AttachmentMediaType, Vec<u8>), String> {
    let metadata =
        std::fs::metadata(path).map_err(|_| "That image could not be read.".to_owned())?;
    if metadata.len() > MAX_IMAGE_BYTES {
        return Err("Images can be at most 10 MiB.".to_owned());
    }
    // The file may have grown since `metadata`, so the read itself is bounded.
    let file = std::fs::File::open(path).map_err(|_| "That image could not be read.".to_owned())?;
    let bytes = read_bounded(file)?;
    let media_type = AttachmentMediaType::sniff(&bytes)
        .ok_or_else(|| "Choose a PNG, JPEG, or WebP image.".to_owned())?;
    Ok((media_type, bytes))
}

/// Read at most [`MAX_IMAGE_BYTES`] from `reader`; one byte more is refused
/// rather than buffered.
fn read_bounded(reader: impl Read) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::new();
    reader
        .take(MAX_IMAGE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "That image could not be read.".to_owned())?;
    if u64::try_from(bytes.len()).is_ok_and(|read| read > MAX_IMAGE_BYTES) {
        return Err("Images can be at most 10 MiB.".to_owned());
    }
    Ok(bytes)
}

/// The turn being followed, and the run the server created for it.
#[derive(Debug, Clone)]
struct FollowedTurn {
    view: TurnView,
    run: Option<ActiveRun>,
    /// For an edit or regenerate: how many of the persisted messages stay on
    /// screen above it while it runs. A plain question keeps them all.
    keep: Option<usize>,
    /// The images that went with the question, shown beside it.
    images: Vec<ChatAttachment>,
    /// The drafts the question took, put back if the server refuses it.
    stash: Vec<Draft>,
}

/// The coach conversation the panel above the chat shows: the select or game
/// it belongs to, and the conversation its turns land in.
#[derive(Debug, Clone, PartialEq, Eq)]
struct CoachPanel {
    kind: ChatCoachKind,
    /// The champion select or game the turns were asked for.
    key: String,
    conversation: Uuid,
}

/// One desktop chat session.
#[derive(Debug, Clone)]
pub struct ChatSession {
    web_origin: String,
    availability: ChatAvailability,
    reconnecting: bool,
    notice: Option<String>,
    conversations: Vec<ConversationSummary>,
    open: Option<Uuid>,
    transcript: Option<Transcript>,
    turn: Option<FollowedTurn>,
    /// Card art, once Scout has named its version and the catalog loaded.
    art: Option<DataDragon>,
    /// Pictures fetched or failed, by key; anything else wanted is loading.
    images: BTreeMap<String, ChatImage>,
    drafts: Vec<Draft>,
    /// Local files of the images this session uploaded, by stored id.
    thumbnails: HashMap<Uuid, PathBuf>,
    models: Option<ModelsResponse>,
    chosen_model: Option<ExploreModel>,
    /// A version switch is changing the branch on the server and its
    /// transcript has not been read back: nothing else may start.
    switching: bool,
    /// Counts version switches. A transcript fetched before the latest one
    /// began describes the old branch and is refused.
    epoch: u64,
    /// The coach conversation of the select or game in progress.
    coach: Option<CoachPanel>,
    /// The coach turn whose run `runs/start-app` has not created yet.
    pending_coach: Option<(ChatCoachKind, String)>,
}

impl Default for ChatSession {
    fn default() -> Self {
        Self::with_web_origin(DEFAULT_WEB_ORIGIN)
    }
}

/// What a failed request means for chat as a whole.
enum Failure {
    /// Chat cannot be used until the owner acts.
    Gate(ChatAvailability),
    /// This one request failed; say why in one line.
    Notice(String),
}

fn classify(error: &ExploreClientError) -> Failure {
    let message = || {
        error
            .refusal()
            .map_or_else(|| error.to_string(), |refusal| refusal.message.clone())
    };
    match error.recovery() {
        Some(Recovery::RePair) => Failure::Gate(ChatAvailability::NeedsApproval),
        Some(Recovery::SignInOnWeb) => Failure::Gate(ChatAvailability::SignInOnWeb),
        Some(Recovery::UpgradeApp) => Failure::Gate(ChatAvailability::UpgradeRequired),
        Some(Recovery::FeatureDisabled) => Failure::Gate(ChatAvailability::TurnedOff),
        Some(Recovery::ExploreForbidden) => Failure::Gate(ChatAvailability::NoServer),
        Some(
            Recovery::NotFound
            | Recovery::ConversationBusy
            | Recovery::RetryLater { .. }
            | Recovery::FixRequest,
        )
        | None => Failure::Notice(message()),
    }
}

/// Where the open conversation, and its share link, live on the website.
struct Links<'a> {
    origin: &'a str,
}

impl Links<'_> {
    fn conversation(&self, id: Uuid) -> String {
        format!("{}/app/explore/{id}", self.origin)
    }

    fn share(&self, token: &str) -> String {
        format!("{}/app/explore/s/{token}", self.origin)
    }
}

impl ChatSession {
    /// A session that has not heard from Scout yet, for the production site.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// A session whose "Open in browser" and share links point at the Scout
    /// website served from `origin`, the same origin the API answers on (the
    /// pairing approval page is served from it too).
    #[must_use]
    pub fn with_web_origin(origin: &str) -> Self {
        let web_origin = url::Url::parse(origin)
            .ok()
            .filter(|parsed| matches!(parsed.scheme(), "http" | "https"))
            .map_or_else(
                || DEFAULT_WEB_ORIGIN.to_owned(),
                |parsed| parsed.origin().ascii_serialization(),
            );
        Self {
            web_origin,
            availability: ChatAvailability::default(),
            reconnecting: false,
            notice: None,
            conversations: Vec::new(),
            open: None,
            transcript: None,
            turn: None,
            art: None,
            images: BTreeMap::new(),
            drafts: Vec::new(),
            thumbnails: HashMap::new(),
            models: None,
            chosen_model: None,
            switching: false,
            epoch: 0,
            coach: None,
            pending_coach: None,
        }
    }

    /// Whether chat currently works.
    #[must_use]
    pub const fn availability(&self) -> &ChatAvailability {
        &self.availability
    }

    /// The conversation on screen, if any.
    #[must_use]
    pub const fn open_conversation(&self) -> Option<Uuid> {
        self.open
    }

    /// Whether a turn is in flight, so another cannot be asked.
    #[must_use]
    pub const fn turn_active(&self) -> bool {
        self.turn.is_some()
    }

    /// The conversation list loaded: chat works.
    pub fn listed(&mut self, list: ConversationListResponse) {
        self.availability = ChatAvailability::Ready;
        self.conversations = list.conversations;
    }

    /// Asking whether chat works failed. A refusal that names what the owner
    /// must do gates chat; anything else (an outage, a broken contract) shows
    /// as unavailable with its reason.
    pub fn refresh_failed(&mut self, error: &ExploreClientError) {
        self.availability = match classify(error) {
            Failure::Gate(availability) => availability,
            Failure::Notice(message) => ChatAvailability::Unavailable { message },
        };
    }

    /// A request made while chat worked failed.
    pub fn request_failed(&mut self, error: &ExploreClientError) {
        match classify(error) {
            Failure::Gate(availability) => self.availability = availability,
            Failure::Notice(message) => self.notice = Some(message),
        }
    }

    /// Card art can be resolved from now on.
    pub fn art_loaded(&mut self, art: DataDragon) {
        self.art = Some(art);
    }

    /// One picture landed or failed.
    pub fn image_loaded(&mut self, key: String, image: ChatImage) {
        self.images.insert(key, image);
    }

    /// Forget pictures that failed, so the next look asks for them again.
    /// Returns their keys.
    pub fn forget_failed_images(&mut self) -> Vec<String> {
        let failed: Vec<String> = self
            .images
            .iter()
            .filter(|(_, image)| matches!(image, ChatImage::Failed { .. }))
            .map(|(key, _)| key.clone())
            .collect();
        for key in &failed {
            self.images.remove(key);
        }
        failed
    }

    /// Every picture the open transcript names, and how to fetch each, in
    /// transcript order without repeats.
    #[must_use]
    pub fn wanted_images(&self) -> Vec<(String, ImageSource)> {
        let Some(transcript) = &self.transcript else {
            return Vec::new();
        };
        let conversation_id = transcript.conversation.id;
        let mut seen = std::collections::BTreeSet::new();
        transcript
            .messages
            .iter()
            .flat_map(|message| {
                let visuals = chat_visuals(message, conversation_id, self.art.as_ref());
                image_sources(conversation_id, message.id, &visuals)
            })
            .filter(|(key, _)| seen.insert(key.clone()))
            .collect()
    }

    /// Show `conversation_id`. Returns whether its transcript must be fetched.
    pub fn open(&mut self, conversation_id: Uuid) -> bool {
        self.notice = None;
        if self.open == Some(conversation_id) && self.transcript.is_some() {
            return false;
        }
        self.open = Some(conversation_id);
        self.transcript = None;
        true
    }

    /// Show a blank conversation.
    pub fn start_new(&mut self) {
        self.notice = None;
        self.open = None;
        self.transcript = None;
    }

    /// A transcript arrived. One for a conversation no longer on screen is
    /// dropped: the user moved on while it was loading.
    pub fn opened(&mut self, transcript: Transcript) {
        if self.open == Some(transcript.conversation.id) {
            self.transcript = Some(transcript);
        }
    }

    /// The version-switch count to stamp on a transcript fetch, so
    /// [`Self::read_back`] can tell a stale answer from a current one.
    #[must_use]
    pub const fn epoch(&self) -> u64 {
        self.epoch
    }

    /// A transcript fetched while the switch count was `epoch` arrived. One
    /// fetched before the latest version switch began shows the old branch
    /// and is dropped; so is one for a conversation no longer on screen.
    pub fn read_back(&mut self, epoch: u64, transcript: Transcript) {
        if epoch == self.epoch {
            self.opened(transcript);
        }
    }

    /// The transcript read after a version switch arrived, or could not be
    /// read. Either way the switch is over and chat may start again.
    pub fn switch_settled(&mut self, result: Result<Transcript, ExploreClientError>) {
        self.switching = false;
        match result {
            Ok(transcript) => self.opened(transcript),
            Err(error) => self.request_failed(&error),
        }
    }

    /// The models the owner may choose between loaded. A choice the server no
    /// longer offers is forgotten.
    pub fn models_loaded(&mut self, models: ModelsResponse) {
        if let Some(chosen) = self.chosen_model
            && !models.models.iter().any(|model| model.id == chosen)
        {
            self.chosen_model = None;
        }
        self.models = Some(models);
    }

    /// Choose the model for the next questions; `id` is one the server
    /// offered, or none to leave it to the server. Anything else is ignored.
    pub fn choose_model(&mut self, id: Option<&str>) {
        let Some(models) = self.models.as_ref().filter(|models| models.picker_enabled) else {
            return;
        };
        self.chosen_model = match id {
            None => None,
            Some(id) => models
                .models
                .iter()
                .find(|model| model.id.id() == id)
                .map(|model| model.id),
        };
    }

    /// Put an image file in the composer. Returns the file to read and
    /// upload, or none when it is refused (a notice says why).
    pub fn begin_attach(&mut self, path: &str) -> Option<AttachJob> {
        if self.availability != ChatAvailability::Ready {
            return None;
        }
        let path = PathBuf::from(path);
        // Drafts a pending question took come back if it is refused, so they
        // still count toward the limit.
        let stashed = self.turn.as_ref().map_or(0, |turn| turn.stash.len());
        if self.drafts.len() + stashed >= MAX_IMAGES {
            self.notice = Some(format!("A question can carry at most {MAX_IMAGES} images."));
            return None;
        }
        let Some(media_type) = path
            .extension()
            .and_then(|extension| extension.to_str())
            .and_then(AttachmentMediaType::from_extension)
        else {
            self.notice = Some("Choose a PNG, JPEG, or WebP image.".to_owned());
            return None;
        };
        self.notice = None;
        let key = Uuid::new_v4();
        self.drafts.push(Draft {
            key,
            name: path.file_name().map_or_else(
                || "image".to_owned(),
                |name| name.to_string_lossy().into_owned(),
            ),
            path: path.clone(),
            media_type,
            state: DraftState::Uploading,
        });
        Some(AttachJob { key, path })
    }

    /// An upload finished. A refusal marks the draft failed and names why; a
    /// refusal that gates chat gates it. Returns the stored image to discard
    /// on the server when the draft was removed while it uploaded.
    pub fn upload_finished(
        &mut self,
        key: Uuid,
        result: Result<Attachment, UploadFailure>,
    ) -> Option<Uuid> {
        let Some(draft) = self.drafts.iter_mut().find(|draft| draft.key == key) else {
            return result.ok().map(|attachment| attachment.id);
        };
        match result {
            Ok(attachment) => {
                draft.media_type = attachment.media_type;
                draft.state = DraftState::Ready(attachment.id);
                self.thumbnails.insert(attachment.id, draft.path.clone());
            }
            Err(UploadFailure::Local(message)) => draft.state = DraftState::Failed(message),
            Err(UploadFailure::Remote(error)) => {
                draft.state = DraftState::Failed(match classify(&error) {
                    Failure::Notice(message) => message,
                    Failure::Gate(_) => "Scout needs you before it can take images.".to_owned(),
                });
                self.request_failed(&error);
            }
        }
        None
    }

    /// Take an image out of the composer. Returns the stored image to
    /// discard on the server, when it had been uploaded.
    pub fn remove_attachment(&mut self, key: Uuid) -> Option<Uuid> {
        let at = self.drafts.iter().position(|draft| draft.key == key)?;
        match self.drafts.remove(at).state {
            DraftState::Ready(id) => Some(id),
            DraftState::Uploading | DraftState::Failed(_) => None,
        }
    }

    /// Whether a new turn may start now.
    fn can_start(&self) -> bool {
        self.availability == ChatAvailability::Ready && self.turn.is_none() && !self.switching
    }

    /// The images that go with the next question, or none when one is still
    /// uploading (a notice says so). Failed images are left behind.
    fn take_drafts(&mut self) -> Option<Vec<Draft>> {
        if self
            .drafts
            .iter()
            .any(|draft| draft.state == DraftState::Uploading)
        {
            self.notice = Some("Wait for your images to finish uploading.".to_owned());
            return None;
        }
        let (ready, failed): (Vec<_>, Vec<_>) = std::mem::take(&mut self.drafts)
            .into_iter()
            .partition(|draft| matches!(draft.state, DraftState::Ready(_)));
        drop(failed);
        Some(ready)
    }

    /// The question text after the composer's checks, or none (the composer
    /// says why).
    fn checked_question(&mut self, question: &str) -> Option<String> {
        let question = question.trim();
        if question.is_empty() {
            return None;
        }
        if question.chars().count() > MAX_QUESTION_CHARS {
            self.notice = Some(format!(
                "Questions can be at most {MAX_QUESTION_CHARS} characters."
            ));
            return None;
        }
        Some(question.to_owned())
    }

    /// Begin a turn: the optimistic state and the request to send.
    fn begin_turn(
        &mut self,
        question: Option<String>,
        attach: AttachPoint,
        keep: Option<usize>,
        drafts: Vec<Draft>,
        game: Option<GameContext>,
    ) -> RunStartRequest {
        self.notice = None;
        let leaf = self
            .transcript
            .as_ref()
            .and_then(|transcript| transcript.messages.last())
            .map(|message| message.id);
        let attachment_ids: Vec<Uuid> = drafts
            .iter()
            .filter_map(|draft| match draft.state {
                DraftState::Ready(id) => Some(id),
                DraftState::Uploading | DraftState::Failed(_) => None,
            })
            .collect();
        let images = drafts
            .iter()
            .filter_map(|draft| match draft.state {
                DraftState::Ready(id) => {
                    Some(self.attachment(id, draft.media_type, Some(&draft.path)))
                }
                DraftState::Uploading | DraftState::Failed(_) => None,
            })
            .collect();
        self.turn = Some(FollowedTurn {
            view: TurnView::new(PendingTurn::new(self.open, question.clone(), leaf)),
            run: None,
            keep,
            images,
            stash: drafts,
        });
        RunStartRequest {
            conversation_id: self.open,
            question,
            attach,
            // Send what the picker shows, so the model that runs is the one
            // on screen even when a conversation remembers another.
            model: self
                .models
                .as_ref()
                .filter(|models| models.picker_enabled)
                .map(|models| self.chosen_model.unwrap_or(models.default_model)),
            attachment_ids: (!attachment_ids.is_empty()).then_some(attachment_ids),
            // Set only through `submit_with_game`, on a question the player
            // typed.
            game_context: game,
        }
    }

    fn attachment(
        &self,
        id: Uuid,
        media_type: AttachmentMediaType,
        local: Option<&Path>,
    ) -> ChatAttachment {
        ChatAttachment {
            id,
            media_type: media_type.as_str().to_owned(),
            thumbnail: local
                .or_else(|| self.thumbnails.get(&id).map(PathBuf::as_path))
                .map(|path| path.to_string_lossy().into_owned()),
        }
    }

    /// Ask `question` in the open conversation. Returns the request to send,
    /// or none when chat does not work, a turn is already running, or the
    /// question is blank or too long (the composer says why).
    pub fn submit(&mut self, question: &str) -> Option<RunStartRequest> {
        self.submit_turn(question, None)
    }

    /// [`Self::submit`], with the game the player is in. Only a question the
    /// player typed carries one, so it takes [`PlayerAuthored`] text.
    pub fn submit_with_game(
        &mut self,
        question: &PlayerAuthored<String>,
        game: GameContext,
    ) -> Option<RunStartRequest> {
        self.submit_turn(question.get(), Some(game))
    }

    fn submit_turn(
        &mut self,
        question: &str,
        game: Option<GameContext>,
    ) -> Option<RunStartRequest> {
        if !self.can_start() {
            return None;
        }
        let question = self.checked_question(question)?;
        let drafts = self.take_drafts()?;
        Some(self.begin_turn(Some(question), AttachPoint::Leaf, None, drafts, game))
    }

    /// Begin the turn Scout asks for itself. Returns the `runs/start-app` body,
    /// or none when a turn cannot start now (chat is gated or another turn is
    /// running); the planner has counted it, so it is not asked again.
    ///
    /// A select's or game's first turn opens its own conversation and shows
    /// it; later turns for the same one continue it while it is still open.
    pub fn begin_app_turn(&mut self, turn: &AppTurn) -> Option<AppTurnRequest> {
        if !self.can_start() {
            return None;
        }
        let kind = match turn.initiation {
            AppInitiation::AppChampSelect => ChatCoachKind::ChampSelect,
            AppInitiation::AppPregame => ChatCoachKind::Pregame,
        };
        let continues = self.coach.as_ref().is_some_and(|coach| {
            coach.key == turn.game_key && Some(coach.conversation) == self.open
        });
        if !continues {
            self.start_new();
        }
        self.pending_coach = Some((kind, turn.game_key.clone()));
        let started = self.begin_turn(None, AttachPoint::Leaf, None, Vec::new(), None);
        Some(AppTurnRequest {
            conversation_id: started.conversation_id,
            ..app_turn_request(turn)
        })
    }

    /// `runs/start-app` refused the turn. It was not asked for by the player,
    /// so a coach that is off, a limit, or a busy conversation says nothing;
    /// only a refusal that gates chat as a whole shows.
    pub fn app_turn_failed(&mut self, error: &ExploreClientError) {
        self.pending_coach = None;
        self.turn = None;
        match error.recovery() {
            Some(
                Recovery::FeatureDisabled
                | Recovery::RetryLater { .. }
                | Recovery::NotFound
                | Recovery::ConversationBusy,
            ) => {}
            _ => self.request_failed(error),
        }
    }

    /// Take the coach panel down: the select or game it described is over, or
    /// Scout Coach is off.
    pub fn clear_coach(&mut self) {
        self.coach = None;
        self.pending_coach = None;
    }

    /// The panel: the newest answer of the coach conversation, while it is
    /// the one on screen.
    fn coach_panel(&self) -> Option<ChatCoach> {
        let coach = self.coach.as_ref()?;
        let transcript = self.transcript.as_ref()?;
        if transcript.conversation.id != coach.conversation {
            return None;
        }
        let answer = transcript
            .messages
            .iter()
            .rev()
            .find(|message| message.role == MessageRole::Assistant)?;
        Some(ChatCoach {
            kind: coach.kind,
            message_id: answer.id,
        })
    }

    /// Edit the question `message_id` into a new version of its turn.
    /// Returns the request to send, or none when it cannot be edited now.
    pub fn edit(&mut self, message_id: Uuid, question: &str) -> Option<RunStartRequest> {
        if !self.can_start() || self.open.is_none() {
            return None;
        }
        let messages = &self.transcript.as_ref()?.messages;
        let index = messages
            .iter()
            .position(|message| message.id == message_id && message.role == MessageRole::User)?;
        // A fork attaches under the edited question's parent; the opening
        // question has none, which `root` names.
        let attach = messages[index]
            .parent_id
            .map_or(AttachPoint::Root, |parent| AttachPoint::Message {
                message_id: parent,
            });
        let question = self.checked_question(question)?;
        let drafts = self.take_drafts()?;
        Some(self.begin_turn(Some(question), attach, Some(index), drafts, None))
    }

    /// Answer the question behind `message_id` again, as a new version of the
    /// answer. Returns the request to send, or none when it cannot run now.
    pub fn regenerate(&mut self, message_id: Uuid) -> Option<RunStartRequest> {
        if !self.can_start() || self.open.is_none() {
            return None;
        }
        let messages = &self.transcript.as_ref()?.messages;
        let answer = messages
            .iter()
            .find(|message| message.id == message_id && message.role == MessageRole::Assistant)?;
        // The parent of an answer is the question it belongs to.
        let question = answer.parent_id?;
        let at = messages.iter().position(|message| message.id == question)?;
        Some(self.begin_turn(
            None,
            AttachPoint::Message {
                message_id: question,
            },
            Some(at + 1),
            Vec::new(),
            None,
        ))
    }

    /// The question that picking option `index` of the answer `message_id`
    /// asks: its label, read from the saved answer so the window never
    /// supplies text. It is a plain question, so it never carries the game.
    pub fn choose_option(&mut self, message_id: Uuid, index: u8) -> Option<RunStartRequest> {
        let label = self
            .transcript
            .as_ref()?
            .messages
            .iter()
            .find(|message| message.id == message_id && message.role == MessageRole::Assistant)?
            .coach_options
            .as_ref()?
            .get(usize::from(index))?
            .label
            .clone();
        self.submit(&format!("Tell me more about {label}"))
    }

    /// Show another version of a turn. Returns the conversation and the
    /// message whose branch to show, to send to the server.
    pub fn switch_version(&mut self, message_id: Uuid) -> Option<(Uuid, Uuid)> {
        if !self.can_start() {
            return None;
        }
        let transcript = self.transcript.as_ref()?;
        let known = transcript
            .messages
            .iter()
            .any(|message| message.sibling_ids.contains(&message_id));
        let conversation = transcript.conversation.id;
        if !known {
            return None;
        }
        // Until the new branch is read back, a question would attach to the
        // branch on screen while the server has already moved, and an older
        // fetch could put the old branch back.
        self.switching = true;
        self.epoch += 1;
        Some((conversation, message_id))
    }

    /// The open conversation to share or stop sharing, when it can be.
    #[must_use]
    pub fn shareable(&self) -> Option<Uuid> {
        if self.availability != ChatAvailability::Ready {
            return None;
        }
        self.transcript
            .as_ref()
            .map(|transcript| transcript.conversation.id)
    }

    /// The server created the run. A new conversation becomes the open one.
    pub fn started(&mut self, run: ActiveRun) {
        let Some(turn) = self.turn.as_mut() else {
            return;
        };
        if self.open.is_none() {
            self.open = Some(run.conversation_id);
        }
        turn.view.turn.run_id = Some(run.run_id);
        turn.view.turn.conversation_id = Some(run.conversation_id);
        turn.view.turn.question_message_id = Some(run.question_message_id);
        turn.stash.clear();
        if let Some((kind, key)) = self.pending_coach.take() {
            self.coach = Some(CoachPanel {
                kind,
                key,
                conversation: run.conversation_id,
            });
        }
        turn.run = Some(run);
    }

    /// `runs/start` refused the turn; the optimistic question goes away and
    /// the images go back to the composer.
    pub fn start_failed(&mut self, error: &ExploreClientError) {
        self.pending_coach = None;
        if let Some(turn) = self.turn.take() {
            let mut restored = turn.stash;
            restored.append(&mut self.drafts);
            self.drafts = restored;
        }
        self.request_failed(error);
    }

    /// Something the run stream reported.
    pub fn signal(&mut self, signal: &StreamSignal) {
        match signal {
            StreamSignal::Event(event) => {
                self.reconnecting = false;
                if let Some(turn) = self.turn.take() {
                    self.turn = Some(FollowedTurn {
                        view: turn.view.apply(event),
                        ..turn
                    });
                }
            }
            StreamSignal::Reconnecting { .. } => self.reconnecting = true,
        }
    }

    /// Mark the running turn as stopping. Returns the run to stop.
    pub fn stop(&mut self) -> Option<Uuid> {
        let turn = self.turn.take()?;
        let run_id = turn.run.as_ref().map(|run| run.run_id);
        let streaming = turn.view.turn.phase == TurnPhase::Streaming && !turn.view.is_finished();
        let view = if run_id.is_some() && streaming {
            TurnView {
                turn: turn.view.turn.mark_stopping(),
                ..turn.view
            }
        } else {
            turn.view
        };
        self.turn = Some(FollowedTurn { view, ..turn });
        run_id.filter(|_| streaming)
    }

    /// The stream ended. Returns the conversation whose transcript to fetch
    /// so the persisted answer replaces the streamed one; none when the turn
    /// cannot settle (chat is gated now, or the stream broke its contract).
    pub fn stream_ended(&mut self, end: Result<StreamEnd, ExploreClientError>) -> Option<Uuid> {
        self.reconnecting = false;
        let conversation = self
            .turn
            .as_ref()
            .and_then(|turn| turn.run.as_ref())
            .map(|run| run.conversation_id);
        match end {
            Ok(StreamEnd::Done(_) | StreamEnd::Gone(_)) => conversation,
            Ok(StreamEnd::RePairRequired(refusal)) => {
                self.turn = None;
                self.availability = match refusal.recovery() {
                    Recovery::SignInOnWeb => ChatAvailability::SignInOnWeb,
                    _ => ChatAvailability::NeedsApproval,
                };
                None
            }
            Ok(StreamEnd::UpgradeRequired { .. }) => {
                self.turn = None;
                self.availability = ChatAvailability::UpgradeRequired;
                None
            }
            Ok(StreamEnd::Refused(refusal)) => {
                self.turn = None;
                self.request_failed(&ExploreClientError::Refused(refusal));
                None
            }
            Err(error) => {
                self.turn = None;
                self.notice = Some(error.to_string());
                conversation
            }
        }
    }

    /// The transcript after a run ended: the persisted answer is on screen,
    /// so the turn goes. An error the run reported stays as the notice.
    pub fn settled(&mut self, transcript: Transcript) {
        if let Some(turn) = self.turn.take()
            && let Some(error) = turn.view.error
        {
            self.notice = Some(error.message);
        }
        self.opened(transcript);
    }

    /// The transcript after a run ended could not be read. The turn goes so
    /// the composer works again; the next open shows the persisted answer.
    pub fn settle_failed(&mut self, error: &ExploreClientError) {
        self.turn = None;
        self.request_failed(error);
    }

    /// The window's view of the session.
    #[must_use]
    pub fn parts(&self) -> ChatParts {
        let links = Links {
            origin: &self.web_origin,
        };
        ChatParts {
            status: ChatStatus {
                availability: self.availability.clone(),
                open_conversation: self.open,
                reconnecting: self.reconnecting,
                notice: self.notice.clone(),
            },
            conversations: self
                .conversations
                .iter()
                .map(|summary| ChatConversation {
                    id: summary.id,
                    title: summary.title.clone(),
                })
                .collect(),
            transcript: self.transcript.as_ref().map(|transcript| {
                project_transcript(
                    transcript,
                    self.shown(),
                    &links,
                    &self.thumbnails,
                    self.art.as_ref(),
                )
            }),
            turn: self.turn.as_ref().map(|turn| self.chat_turn(turn)),
            images: self
                .wanted_images()
                .into_iter()
                .map(|(key, _)| {
                    let image = self.images.get(&key).cloned().unwrap_or(ChatImage::Loading);
                    (key, image)
                })
                .collect(),
            composer: self.composer(),
            coach: self.coach_panel(),
        }
    }

    /// How many of the open transcript's messages are on screen: all of
    /// them, except while an edit or regenerate runs, which replaces the
    /// rest of the branch.
    fn shown(&self) -> usize {
        let held = self
            .transcript
            .as_ref()
            .map_or(0, |transcript| transcript.messages.len());
        self.turn
            .as_ref()
            // A cutoff belongs to the conversation its turn runs in.
            .filter(|turn| {
                self.transcript
                    .as_ref()
                    .map(|transcript| transcript.conversation.id)
                    == turn.view.turn.conversation_id
            })
            .and_then(|turn| turn.keep)
            .map_or(held, |keep| keep.min(held))
    }

    fn composer(&self) -> ChatComposer {
        let picker = self.models.as_ref().filter(|models| models.picker_enabled);
        ChatComposer {
            drafts: self
                .drafts
                .iter()
                .map(|draft| ChatDraft {
                    key: draft.key,
                    name: draft.name.clone(),
                    thumbnail: draft.path.to_string_lossy().into_owned(),
                    state: match &draft.state {
                        DraftState::Uploading => ChatDraftState::Uploading,
                        DraftState::Ready(_) => ChatDraftState::Ready,
                        DraftState::Failed(message) => ChatDraftState::Failed {
                            message: message.clone(),
                        },
                    },
                })
                .collect(),
            max_images: u32::try_from(MAX_IMAGES).unwrap_or(u32::MAX),
            switching: self.switching,
            models: picker.map_or_else(Vec::new, |models| {
                models
                    .models
                    .iter()
                    .map(|model| ChatModelOption {
                        id: model.id.id().to_owned(),
                        label: model.label.clone(),
                    })
                    .collect()
            }),
            model: picker.map(|models| {
                self.chosen_model
                    .unwrap_or(models.default_model)
                    .id()
                    .to_owned()
            }),
        }
    }

    fn chat_turn(&self, turn: &FollowedTurn) -> ChatTurn {
        let messages = self
            .transcript
            .as_ref()
            .map_or(&[][..], |transcript| &transcript.messages[..self.shown()]);
        let visible = visible_pending(Some(&turn.view.turn), self.open, messages);
        ChatTurn {
            stoppable: turn.run.is_some()
                && turn.view.turn.phase == TurnPhase::Streaming
                && !turn.view.is_finished(),
            attachments: if visible.pending_question.is_some() {
                turn.images.clone()
            } else {
                Vec::new()
            },
            question: visible.pending_question,
            answer: visible.pending_answer,
            activity: visible.activity,
            stopping: visible.stopping,
            tools: visible.trace.iter().map(tool_step).collect(),
            error: turn.view.error.as_ref().map(|error| error.message.clone()),
        }
    }
}

/// One tool step as the transcript summarizes it.
#[must_use]
pub fn tool_step(entry: &TraceEntry) -> ChatToolStep {
    ChatToolStep {
        summary: entry.message.clone(),
        status: match entry.status {
            TraceStatus::Running => ChatToolStatus::Running,
            TraceStatus::Succeeded => ChatToolStatus::Succeeded,
            TraceStatus::Failed => ChatToolStatus::Failed,
            TraceStatus::Interrupted => ChatToolStatus::Interrupted,
        },
        duration_ms: entry.duration_ms,
    }
}

/// Where a message stands among its turn's versions; none for a turn with
/// one version.
/// The `runs/start-app` body for a turn Scout asks for. It sets the one
/// section the turn carries and no question: a turn the player did not start
/// never carries live state, and the server words its question.
#[must_use]
pub fn app_turn_request(turn: &AppTurn) -> AppTurnRequest {
    AppTurnRequest {
        conversation_id: None,
        initiation: turn.initiation,
        game_key: turn.game_key.clone(),
        game_context: turn.context.clone(),
    }
}

fn chat_version(message: &ExploreMessage) -> Option<ChatVersion> {
    if message.version_count < 2 {
        return None;
    }
    let at = usize::try_from(message.version_index).ok()?;
    Some(ChatVersion {
        position: message.version_index + 1,
        count: message.version_count,
        previous: at
            .checked_sub(1)
            .and_then(|before| message.sibling_ids.get(before))
            .copied(),
        next: message.sibling_ids.get(at + 1).copied(),
    })
}

/// One persisted message as the transcript renders it, with card art from
/// `art` once it has loaded.
fn project_message(
    message: &ExploreMessage,
    conversation_id: Uuid,
    art: Option<&DataDragon>,
    thumbnails: &HashMap<Uuid, PathBuf>,
) -> ChatMessage {
    let visuals = match message.role {
        MessageRole::User => ChatVisuals::default(),
        MessageRole::Assistant => chat_visuals(message, conversation_id, art),
    };
    ChatMessage {
        id: message.id,
        role: match message.role {
            MessageRole::User => ChatRole::User,
            MessageRole::Assistant => ChatRole::Assistant,
        },
        content: message.content.clone(),
        tools: message.trace.iter().map(tool_step).collect(),
        caveats: message.caveats.clone(),
        coach_options: message
            .coach_options
            .iter()
            .flatten()
            .map(|option| ChatCoachOption {
                label: option.label.clone(),
                rationale: option.rationale.clone(),
            })
            .collect(),
        visuals,
        version: chat_version(message),
        attachments: message
            .attachments
            .iter()
            .map(|attachment| ChatAttachment {
                id: attachment.id,
                media_type: attachment.media_type.as_str().to_owned(),
                thumbnail: thumbnails
                    .get(&attachment.id)
                    .map(|path| path.to_string_lossy().into_owned()),
            })
            .collect(),
    }
}

fn project_transcript(
    transcript: &Transcript,
    shown: usize,
    links: &Links<'_>,
    thumbnails: &HashMap<Uuid, PathBuf>,
    art: Option<&DataDragon>,
) -> ChatTranscript {
    let conversation_id = transcript.conversation.id;
    ChatTranscript {
        conversation_id,
        title: transcript.conversation.title.clone(),
        messages: transcript
            .messages
            .iter()
            .take(shown)
            .map(|message| project_message(message, conversation_id, art, thumbnails))
            .collect(),
        web_url: links.conversation(transcript.conversation.id),
        share_url: transcript
            .conversation
            .share_token
            .as_deref()
            .map(|token| links.share(token)),
    }
}

/// A transcript as the window renders it, for the production site and with
/// no local thumbnails.
#[must_use]
pub fn chat_transcript(transcript: &Transcript, art: Option<&DataDragon>) -> ChatTranscript {
    project_transcript(
        transcript,
        transcript.messages.len(),
        &Links {
            origin: DEFAULT_WEB_ORIGIN,
        },
        &HashMap::new(),
        art,
    )
}

#[cfg(test)]
mod tests {
    use scout_client_core::desktop_api::{
        ActiveRun, ConversationListResponse, DesktopApiErrorCode, RunOutcome,
    };
    use scout_desktop_ipc::{ChatAvailability, ChatToolStatus};
    use uuid::Uuid;

    use super::{ChatSession, MAX_IMAGE_BYTES, MAX_QUESTION_CHARS, read_bounded};
    use crate::error::{ExploreClientError, Refusal};
    use crate::model::StreamEvent;
    use crate::stream::{StreamEnd, StreamSignal};

    type TestResult = Result<(), Box<dyn std::error::Error>>;

    #[test]
    fn a_file_that_grew_past_the_limit_is_refused_without_reading_it_all() {
        use std::io::Read;
        // An endless reader stands in for a file replaced after its size was
        // checked: only one byte past the limit may ever be taken from it.
        let limit = usize::try_from(MAX_IMAGE_BYTES).unwrap_or(usize::MAX);
        assert_eq!(
            read_bounded(std::io::repeat(0)),
            Err("Images can be at most 10 MiB.".to_owned())
        );
        assert_eq!(
            read_bounded(std::io::repeat(7).take(MAX_IMAGE_BYTES)).map(|bytes| bytes.len()),
            Ok(limit),
            "exactly the limit is fine"
        );
    }

    fn refused(code: DesktopApiErrorCode) -> ExploreClientError {
        ExploreClientError::Refused(Refusal {
            code,
            message: format!("{code:?} refused"),
            retry_after: None,
        })
    }

    fn ready() -> ChatSession {
        let mut session = ChatSession::new();
        session.listed(ConversationListResponse {
            conversations: Vec::new(),
        });
        session
    }

    #[test]
    fn each_gating_refusal_names_what_the_owner_must_do() {
        for (error, expected) in [
            (
                ExploreClientError::NotPaired,
                ChatAvailability::NeedsApproval,
            ),
            (
                refused(DesktopApiErrorCode::ScopeRequired),
                ChatAvailability::NeedsApproval,
            ),
            (
                refused(DesktopApiErrorCode::Unauthorized),
                ChatAvailability::NeedsApproval,
            ),
            (
                refused(DesktopApiErrorCode::ReauthorizeRequired),
                ChatAvailability::SignInOnWeb,
            ),
            (
                refused(DesktopApiErrorCode::FeatureDisabled),
                ChatAvailability::TurnedOff,
            ),
            (
                refused(DesktopApiErrorCode::ExploreForbidden),
                ChatAvailability::NoServer,
            ),
            (
                ExploreClientError::UpgradeRequired {
                    message: "old".to_owned(),
                },
                ChatAvailability::UpgradeRequired,
            ),
            (
                refused(DesktopApiErrorCode::Unavailable),
                ChatAvailability::Unavailable {
                    message: "Unavailable refused".to_owned(),
                },
            ),
        ] {
            let mut session = ChatSession::new();
            session.refresh_failed(&error);
            assert_eq!(session.parts().status.availability, expected, "{error:?}");
        }
    }

    #[test]
    fn a_busy_conversation_is_a_notice_and_chat_keeps_working() {
        let mut session = ready();
        assert!(session.submit("How is my Jinx?").is_some());
        session.start_failed(&refused(DesktopApiErrorCode::ConversationBusy));
        let parts = session.parts();
        assert_eq!(parts.status.availability, ChatAvailability::Ready);
        assert_eq!(
            parts.status.notice.as_deref(),
            Some("ConversationBusy refused")
        );
        assert_eq!(parts.turn, None);
        assert!(
            session.submit("Again?").is_some(),
            "the composer works again"
        );
    }

    #[test]
    fn only_a_ready_idle_session_sends_a_trimmed_question() -> TestResult {
        let mut loading = ChatSession::new();
        assert!(loading.submit("Hi").is_none());

        let mut session = ready();
        assert!(session.submit("   ").is_none());
        let long = "x".repeat(MAX_QUESTION_CHARS + 1);
        assert!(session.submit(&long).is_none());
        assert!(session.parts().status.notice.is_some());

        let request = session.submit("  Who wins?  ").ok_or("request")?;
        assert_eq!(request.question.as_deref(), Some("Who wins?"));
        assert_eq!(request.conversation_id, None);
        assert!(session.submit("Another").is_none(), "one turn at a time");
        let turn = session.parts().turn.ok_or("turn")?;
        assert_eq!(turn.question.as_deref(), Some("Who wins?"));
        assert!(!turn.stoppable, "nothing to stop before runs/start answers");
        Ok(())
    }

    #[test]
    fn a_reconnect_shows_until_the_next_frame() -> TestResult {
        let mut session = ready();
        session.submit("Who wins?").ok_or("request")?;
        session.signal(&StreamSignal::Reconnecting {
            attempt: 1,
            delay: std::time::Duration::from_millis(500),
            cause: "reset".to_owned(),
        });
        assert!(session.parts().status.reconnecting);
        session.signal(&StreamSignal::Event(Box::new(StreamEvent::AnswerDelta {
            text: "Jinx".to_owned(),
        })));
        let parts = session.parts();
        assert!(!parts.status.reconnecting);
        assert_eq!(
            parts.turn.and_then(|turn| turn.answer).as_deref(),
            Some("Jinx")
        );
        Ok(())
    }

    #[test]
    fn stopping_marks_running_steps_and_returns_the_run() -> TestResult {
        let mut session = ready();
        session.submit("Who wins?").ok_or("request")?;
        assert_eq!(session.stop(), None, "no run to stop yet");
        let run_id = Uuid::from_u128(6);
        session.started(ActiveRun {
            run_id,
            conversation_id: Uuid::from_u128(1),
            question_message_id: Uuid::from_u128(3),
            leaf_id_at_start: None,
            version_count_at_start: 0,
            started_at: chrono::Utc::now(),
        });
        assert_eq!(session.open_conversation(), Some(Uuid::from_u128(1)));
        session.signal(&StreamSignal::Event(Box::new(StreamEvent::ToolCall {
            tool_call_id: "call-1".to_owned(),
            tool_name: "run_report_query".to_owned(),
            message: "Running a Scout report query.".to_owned(),
            details: None,
            raw_input: None,
        })));
        assert!(session.parts().turn.ok_or("turn")?.stoppable);
        assert_eq!(session.stop(), Some(run_id));
        let turn = session.parts().turn.ok_or("turn")?;
        assert!(!turn.stoppable);
        assert_eq!(turn.tools[0].status, ChatToolStatus::Interrupted);
        assert_eq!(session.stop(), None, "a second stop sends nothing");
        assert_eq!(
            session.stream_ended(Ok(StreamEnd::Done(RunOutcome::Stopped))),
            Some(Uuid::from_u128(1))
        );
        Ok(())
    }

    #[test]
    fn a_refused_stream_gates_chat_and_drops_the_turn() -> TestResult {
        let mut session = ready();
        session.submit("Who wins?").ok_or("request")?;
        let refusal = Refusal {
            code: DesktopApiErrorCode::ScopeRequired,
            message: "Approve chat.".to_owned(),
            retry_after: None,
        };
        assert_eq!(
            session.stream_ended(Ok(StreamEnd::RePairRequired(refusal))),
            None
        );
        let parts = session.parts();
        assert_eq!(parts.status.availability, ChatAvailability::NeedsApproval);
        assert_eq!(parts.turn, None);
        Ok(())
    }
}
