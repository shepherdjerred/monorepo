//! The chat screen's view model, built from the chat parts the supervisor
//! relays. Nothing here knows about GPUI, so it builds and is tested on every
//! target; the chat view renders these structs and nothing else.

use std::collections::BTreeMap;

use scout_desktop_ipc::{
    ChatAttachment, ChatAvailability, ChatCommand, ChatDraftState, ChatImage, ChatMessage,
    ChatParts, ChatRole, ChatToolStatus, ChatToolStep, ChatTranscript, ChatVersion, ChatVisuals,
    StateSnapshot, UpdateSnapshot, WindowMessage,
};
use uuid::Uuid;

use crate::view_model::Action;

/// The key of the optimistic question row, until the transcript holds it.
pub const PENDING_QUESTION_KEY: &str = "pending-question";
/// The key of the streamed answer row. It stays the same for the whole turn,
/// so the text view keeps one state and fades in only what each frame adds.
pub const PENDING_ANSWER_KEY: &str = "pending-answer";

/// What the composer says before anything is typed.
pub const COMPOSER_PLACEHOLDER: &str = "Ask Scout about your games";
/// The subtle line shown while the run stream attaches again.
pub const RECONNECTING_LABEL: &str = "Reconnecting…";
/// What a blank conversation says.
pub const EMPTY_HINT: &str = "Ask about your matches, champions, or your server's games. Scout answers from the games it has recorded.";

/// Whether streamed text fades in. Reduced motion turns it off, so new words
/// appear at once.
#[must_use]
pub const fn stream_fade(streaming: bool, reduce_motion: bool) -> bool {
    streaming && !reduce_motion
}

/// One tool step in an answer's summary.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ToolRow {
    /// What the step did.
    pub label: String,
    /// How it stands.
    pub status: ChatToolStatus,
    /// The status in words, for the row's accessible text and its glyph.
    pub status_label: &'static str,
    /// How long it took, once finished.
    pub duration: Option<String>,
}

impl ToolRow {
    fn new(step: &ChatToolStep) -> Self {
        let status_label = match step.status {
            ChatToolStatus::Running => "Running",
            ChatToolStatus::Succeeded => "Done",
            ChatToolStatus::Failed => "Failed",
            ChatToolStatus::Interrupted => "Stopped",
        };
        Self {
            label: step.summary.clone(),
            status: step.status,
            status_label,
            duration: step.duration_ms.map(format_duration),
        }
    }
}

fn format_duration(milliseconds: u64) -> String {
    if milliseconds < 1_000 {
        format!("{milliseconds} ms")
    } else {
        let tenths = milliseconds / 100;
        format!("{}.{} s", tenths / 10, tenths % 10)
    }
}

/// What one picture slot shows.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Picture<'a> {
    /// Nothing to fetch: an empty slot, or an id the game data lacks.
    Absent,
    /// The supervisor is fetching it.
    Loading,
    /// The cached file to draw.
    Ready(&'a str),
    /// Why it could not be fetched.
    Failed(&'a str),
}

/// What a chart slot says while its image is not there.
pub const CHART_LOADING: &str = "Drawing the chart…";

/// What a chat button does. Most send a command to the supervisor; the rest
/// change what only this window knows: what is being edited, whether the
/// picker is open, the file picker, the clipboard.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum UiAction {
    /// Send a message to the supervisor.
    Send(WindowMessage),
    /// Put a question back in the composer to be edited into a new version.
    Edit {
        /// The question.
        message_id: Uuid,
        /// Its text.
        text: String,
    },
    /// Stop editing and clear the composer.
    CancelEdit,
    /// Open or close the model picker.
    TogglePicker,
    /// Turn the composer's "Using your live game" chip on or off.
    ToggleLiveGame,
    /// Open the file picker for an image.
    PickImage,
    /// Put a link on the clipboard.
    CopyLink(String),
}

/// One chat button.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Control {
    /// A stable element id, unique on the page.
    pub id: String,
    /// What it says.
    pub label: String,
    /// What it does.
    pub action: UiAction,
    /// Whether it can be used now.
    pub enabled: bool,
}

impl Control {
    fn new(id: impl Into<String>, label: impl Into<String>, action: UiAction) -> Self {
        Self {
            id: id.into(),
            label: label.into(),
            action,
            enabled: true,
        }
    }

    fn send(id: impl Into<String>, label: impl Into<String>, command: ChatCommand) -> Self {
        Self::new(id, label, UiAction::Send(chat(command)))
    }
}

/// An image shown with a question: a thumbnail when this computer has the
/// file, a labelled tile when the image was attached elsewhere.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ImageView {
    /// The image's name or type, for the tile and the accessible text.
    pub label: String,
    /// A file to draw.
    pub thumbnail: Option<String>,
}

impl ImageView {
    fn new(attachment: &ChatAttachment) -> Self {
        Self {
            label: attachment
                .media_type
                .strip_prefix("image/")
                .unwrap_or("image")
                .to_ascii_uppercase(),
            thumbnail: attachment.thumbnail.clone(),
        }
    }
}

/// The "2 of 3" switcher on a turn with several versions.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SwitcherView {
    /// "2 of 3".
    pub label: String,
    /// Step to the version before; disabled on the first.
    pub previous: Control,
    /// Step to the version after; disabled on the last.
    pub next: Control,
}

impl SwitcherView {
    fn new(message: &ChatMessage, version: &ChatVersion, enabled: bool) -> Self {
        let step = |id: &str, label: &str, target: Option<Uuid>| Control {
            enabled: enabled && target.is_some(),
            ..target.map_or_else(
                || Control::new(format!("{id}-{}", message.id), label, UiAction::CancelEdit),
                |message_id| {
                    Control::send(
                        format!("{id}-{}", message.id),
                        label,
                        ChatCommand::SwitchVersion { message_id },
                    )
                },
            )
        };
        Self {
            label: format!("{} of {}", version.position, version.count),
            previous: step("version-previous", "‹", version.previous),
            next: step("version-next", "›", version.next),
        }
    }
}

/// One option of a multiple-choice coach answer: a chip to pick, and the
/// reason the answer gave for it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OptionChip {
    /// The chip. Picking it asks Scout about the option, from the saved
    /// answer; the window sends no text.
    pub control: Control,
    /// One line on why the option is worth considering.
    pub rationale: String,
}

/// One row of the transcript: a question, or an answer with its steps.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TranscriptRow {
    /// A key stable across frames: the message id, or a pending-turn key.
    pub key: String,
    /// Who wrote it.
    pub role: ChatRole,
    /// Markdown text; empty while an answer has not started.
    pub text: String,
    /// Whether the text is still arriving.
    pub streaming: bool,
    /// The steps behind an answer.
    pub tools: Vec<ToolRow>,
    /// The live status line of a streaming answer.
    pub activity: Option<String>,
    /// Caveats under a persisted answer.
    pub caveats: Vec<String>,
    /// The options a persisted answer offers for a choice.
    pub options: Vec<OptionChip>,
    /// The error a run reported.
    pub error: Option<String>,
    /// A persisted answer's chart or table and its cards.
    pub visuals: ChatVisuals,
    /// Where each picture `visuals` names stands.
    pub pictures: BTreeMap<String, ChatImage>,
    /// Images attached to a question.
    pub images: Vec<ImageView>,
    /// The version switcher, when the turn has several versions.
    pub switcher: Option<SwitcherView>,
    /// What can be done with this message: edit a question, regenerate an
    /// answer.
    pub actions: Vec<Control>,
}

impl TranscriptRow {
    /// What the picture named `key` shows.
    #[must_use]
    pub fn picture(&self, key: Option<&str>) -> Picture<'_> {
        let Some(key) = key else {
            return Picture::Absent;
        };
        match self.pictures.get(key) {
            None | Some(ChatImage::Loading) => Picture::Loading,
            Some(ChatImage::Ready { path }) => Picture::Ready(path),
            Some(ChatImage::Failed { message }) => Picture::Failed(message),
        }
    }

    fn pending(key: &str, role: ChatRole, text: String) -> Self {
        Self {
            key: key.to_owned(),
            role,
            text,
            streaming: false,
            tools: Vec::new(),
            activity: None,
            caveats: Vec::new(),
            options: Vec::new(),
            error: None,
            images: Vec::new(),
            switcher: None,
            actions: Vec::new(),
            visuals: ChatVisuals::default(),
            pictures: BTreeMap::new(),
        }
    }
}

/// An image waiting in the composer.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DraftView {
    /// The file name.
    pub name: String,
    /// The file to draw.
    pub thumbnail: String,
    /// "Uploading…" or why it failed; none once ready.
    pub status: Option<String>,
    /// Whether the status is a failure.
    pub failed: bool,
    /// Take it out.
    pub remove: Control,
}

/// One choice in the model picker.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PickerOption {
    /// Choose it.
    pub control: Control,
    /// Whether it is the model in use.
    pub selected: bool,
}

/// The model picker: a button naming the model in use, and while open, the
/// models to choose between.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PickerModel {
    /// Opens and closes the list; names the model in use.
    pub toggle: Control,
    /// Whether the list is open.
    pub open: bool,
    /// The models, in the server's order.
    pub options: Vec<PickerOption>,
}

/// The banner over the composer while a question is being edited.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EditingModel {
    /// What it says.
    pub label: &'static str,
    /// Stop editing.
    pub cancel: Control,
}

/// What only this window knows about the chat page.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct ChatUi {
    /// The question being edited, until the new version is sent.
    pub editing: Option<Uuid>,
    /// Whether the model picker is open.
    pub picker_open: bool,
    /// Whether the supervisor reports a game in progress.
    pub live_game: bool,
    /// Whether the player turned the live game chip off. It stays off for
    /// the rest of the window's life, across games.
    pub live_game_off: bool,
}

/// The composer's "Using your live game" chip: whether the next question
/// carries the game in progress. Shown only while a game is live.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LiveGameChip {
    /// Turns it on or off.
    pub toggle: Control,
    /// Whether the next question carries the game.
    pub on: bool,
}

/// What the chip says while on.
pub const LIVE_GAME_ON: &str = "Using your live game";
/// What the chip says once turned off.
pub const LIVE_GAME_OFF: &str = "Not using your live game";

/// The composer's controls.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ComposerModel {
    /// Whether a question can be sent now.
    pub can_send: bool,
    /// Whether the running answer can be stopped.
    pub can_stop: bool,
    /// Attach an image; disabled at the web's four-image cap.
    pub attach: Control,
    /// The images attached so far.
    pub drafts: Vec<DraftView>,
    /// The model picker; none while the server chooses.
    pub picker: Option<PickerModel>,
    /// The editing banner, while a question is being edited.
    pub editing: Option<EditingModel>,
    /// The live game chip, while a game is live and a new question is
    /// being written. An edit never carries the game.
    pub live_game: Option<LiveGameChip>,
}

/// An open or blank conversation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConversationModel {
    /// The heading: the conversation's title, or "New chat".
    pub title: String,
    /// Questions and answers, oldest first.
    pub rows: Vec<TranscriptRow>,
    /// Whether the open conversation's transcript is still loading.
    pub loading: bool,
    /// The composer.
    pub composer: ComposerModel,
    /// Whether the run stream is reconnecting.
    pub reconnecting: bool,
    /// A one-line failure, such as a refused question.
    pub notice: Option<String>,
    /// "Open in browser" and the share link controls.
    pub header: Vec<Control>,
    /// The share link, while the conversation is shared.
    pub share_url: Option<String>,
}

/// A chat screen that cannot chat yet, and what the user can do about it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GateModel {
    /// The heading.
    pub title: &'static str,
    /// What happened and what to do.
    pub body: String,
    /// A secondary line: the pairing code to compare, or the update status.
    pub detail: Option<String>,
    /// The buttons.
    pub actions: Vec<Action>,
}

/// What the chat screen shows.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ChatScreen {
    /// Asking Scout whether chat works.
    Loading,
    /// Chat works.
    Conversation(Box<ConversationModel>),
    /// Chat needs the user first.
    Gate(GateModel),
}

/// One conversation in the sidebar.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SidebarEntry {
    /// The conversation.
    pub id: Uuid,
    /// Its title.
    pub title: String,
    /// Whether it is the open one.
    pub selected: bool,
    /// What clicking it sends.
    pub message: WindowMessage,
}

/// The conversation sidebar.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SidebarModel {
    /// "New chat", and whether a blank conversation is open.
    pub new_chat: Action,
    /// Whether the blank conversation is the open one.
    pub new_chat_selected: bool,
    /// The owner's conversations, most recent first.
    pub conversations: Vec<SidebarEntry>,
}

fn chat(command: ChatCommand) -> WindowMessage {
    WindowMessage::Chat { command }
}

fn try_again() -> Action {
    Action {
        id: "chat-try-again",
        label: "Try again",
        message: chat(ChatCommand::Refresh),
        primary: false,
        destructive: false,
    }
}

impl SidebarModel {
    /// The sidebar from the relayed list. Nothing is selected off the chat
    /// page, or while chat cannot be used.
    #[must_use]
    pub fn new(parts: &ChatParts, on_chat_page: bool) -> Self {
        let open = parts.status.open_conversation;
        let chatting = on_chat_page && parts.status.availability == ChatAvailability::Ready;
        Self {
            new_chat: Action {
                id: "chat-new",
                label: "New chat",
                message: chat(ChatCommand::New),
                primary: false,
                destructive: false,
            },
            new_chat_selected: chatting && open.is_none(),
            conversations: parts
                .conversations
                .iter()
                .map(|conversation| SidebarEntry {
                    id: conversation.id,
                    title: conversation.title.clone(),
                    selected: chatting && open == Some(conversation.id),
                    message: chat(ChatCommand::Open {
                        conversation_id: conversation.id,
                    }),
                })
                .collect(),
        }
    }
}

fn gate(
    availability: &ChatAvailability,
    state: &StateSnapshot,
    update: &UpdateSnapshot,
) -> Option<GateModel> {
    let model = match availability {
        ChatAvailability::Loading | ChatAvailability::Ready => return None,
        ChatAvailability::NeedsApproval => {
            let (action, detail) = match &state.approval_url {
                Some(url) => (
                    Action {
                        id: "chat-open-approval",
                        label: "Open the approval page",
                        message: WindowMessage::OpenUrl { url: url.clone() },
                        primary: true,
                        destructive: false,
                    },
                    state
                        .pairing_match_code
                        .as_ref()
                        .map(|code| format!("Check that the page shows the code {code}.")),
                ),
                None => (
                    Action {
                        id: "chat-approve",
                        label: "Approve on the web",
                        message: WindowMessage::Pair,
                        primary: true,
                        destructive: false,
                    },
                    None,
                ),
            };
            GateModel {
                title: "Approve chat on the web",
                body: "Scout Desktop needs your approval before it can chat as you. Approving opens Scout in your browser, and also covers game uploads.".to_owned(),
                detail,
                actions: vec![action],
            }
        }
        ChatAvailability::SignInOnWeb => GateModel {
            title: "Sign in to Scout on the web",
            body: "Your Discord sign-in has expired. Sign in on the Scout website, then try again."
                .to_owned(),
            detail: None,
            actions: vec![try_again()],
        },
        ChatAvailability::TurnedOff => GateModel {
            title: "Chat is turned off",
            body: "Chat in Scout Desktop is switched off for your account right now. Scout on the web still has Explore.".to_owned(),
            detail: None,
            actions: vec![try_again()],
        },
        ChatAvailability::NoServer => GateModel {
            title: "Chat needs a Scout server",
            body: "Explore answers for servers that use Scout. Join or add one, then try again."
                .to_owned(),
            detail: None,
            actions: vec![try_again()],
        },
        ChatAvailability::UpgradeRequired => GateModel {
            title: "Update Scout Desktop",
            body: "This version is too old for chat. Scout updates itself; chat comes back once the new version is installed.".to_owned(),
            detail: Some(format!("Update: {}", update.summary())),
            actions: Vec::new(),
        },
        ChatAvailability::Unavailable { message } => GateModel {
            title: "Chat is unavailable",
            body: message.clone(),
            detail: None,
            actions: vec![try_again()],
        },
    };
    Some(model)
}

fn tools(steps: &[ChatToolStep]) -> Vec<ToolRow> {
    steps.iter().map(ToolRow::new).collect()
}

fn message_actions(message: &ChatMessage, enabled: bool) -> Vec<Control> {
    // Editing copies only the text, so a question with images would lose
    // them. The web hides Edit for these too.
    if message.role == ChatRole::User && !message.attachments.is_empty() {
        return Vec::new();
    }
    let mut control = match message.role {
        ChatRole::User => Control::new(
            format!("edit-{}", message.id),
            "Edit",
            UiAction::Edit {
                message_id: message.id,
                text: message.content.clone(),
            },
        ),
        ChatRole::Assistant => Control::send(
            format!("regenerate-{}", message.id),
            "Regenerate",
            ChatCommand::Regenerate {
                message_id: message.id,
            },
        ),
    };
    control.enabled = enabled;
    vec![control]
}

fn option_chips(message: &ChatMessage, enabled: bool) -> Vec<OptionChip> {
    message
        .coach_options
        .iter()
        .zip(0_u8..)
        .map(|(option, index)| {
            let mut control = Control::send(
                format!("option-{}-{index}", message.id),
                option.label.clone(),
                ChatCommand::ChooseOption {
                    message_id: message.id,
                    index,
                },
            );
            control.enabled = enabled;
            OptionChip {
                control,
                rationale: option.rationale.clone(),
            }
        })
        .collect()
}

fn rows(parts: &ChatParts) -> Vec<TranscriptRow> {
    // Versions, Edit and Regenerate wait for a running turn, and for a
    // version switch that has not been read back yet.
    let turn_running = parts.turn.is_some() || parts.composer.switching;
    let mut rows: Vec<TranscriptRow> = parts
        .transcript
        .iter()
        .flat_map(|transcript| &transcript.messages)
        .map(|message| TranscriptRow {
            key: message.id.to_string(),
            role: message.role,
            text: message.content.clone(),
            streaming: false,
            tools: tools(&message.tools),
            activity: None,
            caveats: message.caveats.clone(),
            options: option_chips(message, !turn_running),
            error: None,
            pictures: message
                .visuals
                .image_keys()
                .into_iter()
                .filter_map(|key| {
                    parts
                        .images
                        .get(key)
                        .map(|image| (key.to_owned(), image.clone()))
                })
                .collect(),
            visuals: message.visuals.clone(),
            images: message.attachments.iter().map(ImageView::new).collect(),
            switcher: message
                .version
                .as_ref()
                .map(|version| SwitcherView::new(message, version, !turn_running)),
            actions: message_actions(message, !turn_running),
        })
        .collect();
    let Some(turn) = &parts.turn else {
        return rows;
    };
    if let Some(question) = &turn.question {
        let mut row =
            TranscriptRow::pending(PENDING_QUESTION_KEY, ChatRole::User, question.clone());
        row.images = turn.attachments.iter().map(ImageView::new).collect();
        rows.push(row);
    }
    let answering = turn.answer.is_some()
        || turn.activity.is_some()
        || !turn.tools.is_empty()
        || turn.error.is_some();
    if answering {
        rows.push(TranscriptRow {
            streaming: turn.error.is_none(),
            tools: tools(&turn.tools),
            activity: turn.activity.clone(),
            error: turn.error.clone(),
            ..TranscriptRow::pending(
                PENDING_ANSWER_KEY,
                ChatRole::Assistant,
                turn.answer.clone().unwrap_or_default(),
            )
        });
    }
    rows
}

/// Whether the question being edited is still on screen. Opening another
/// conversation or switching to another branch takes it away, and the edit
/// goes with it.
#[must_use]
pub fn edit_target_shown(parts: &ChatParts, message_id: Uuid) -> bool {
    parts
        .transcript
        .iter()
        .flat_map(|transcript| &transcript.messages)
        .any(|message| message.id == message_id)
}

fn composer(parts: &ChatParts, ui: ChatUi, transcript_open: bool) -> ComposerModel {
    let turn_running = parts.turn.is_some();
    let composer = &parts.composer;
    let mut attach = Control::new("chat-attach", "Attach image", UiAction::PickImage);
    attach.enabled = composer.drafts.len() < usize::try_from(composer.max_images).unwrap_or(0);
    let drafts = composer
        .drafts
        .iter()
        .map(|draft| {
            let (status, failed) = match &draft.state {
                ChatDraftState::Uploading => (Some("Uploading…".to_owned()), false),
                ChatDraftState::Ready => (None, false),
                ChatDraftState::Failed { message } => (Some(message.clone()), true),
            };
            DraftView {
                name: draft.name.clone(),
                thumbnail: draft.thumbnail.clone(),
                status,
                failed,
                remove: Control::send(
                    format!("remove-{}", draft.key),
                    "Remove",
                    ChatCommand::RemoveAttachment { key: draft.key },
                ),
            }
        })
        .collect();
    let picker = (!composer.models.is_empty()).then(|| {
        let current = composer
            .models
            .iter()
            .find(|model| Some(&model.id) == composer.model.as_ref())
            .map_or("Default model", |model| model.label.as_str());
        PickerModel {
            toggle: Control::new(
                "chat-model",
                format!("Model: {current}"),
                UiAction::TogglePicker,
            ),
            open: ui.picker_open,
            options: composer
                .models
                .iter()
                .map(|model| PickerOption {
                    control: Control::send(
                        format!("model-{}", model.id),
                        model.label.clone(),
                        ChatCommand::ChooseModel {
                            model: Some(model.id.clone()),
                        },
                    ),
                    selected: Some(&model.id) == composer.model.as_ref(),
                })
                .collect(),
        }
    });
    let editing = ui
        .editing
        .filter(|_| transcript_open)
        .filter(|id| edit_target_shown(parts, *id))
        .map(|_| EditingModel {
            label: "Editing your question. Sending adds a new version.",
            cancel: Control::new("chat-cancel-edit", "Cancel", UiAction::CancelEdit),
        });
    let live_game = (ui.live_game && editing.is_none()).then(|| LiveGameChip {
        toggle: Control::new(
            "chat-live-game",
            if ui.live_game_off {
                LIVE_GAME_OFF
            } else {
                LIVE_GAME_ON
            },
            UiAction::ToggleLiveGame,
        ),
        on: !ui.live_game_off,
    });
    ComposerModel {
        // An image still uploading blocks sending: the supervisor refuses the
        // question and the window has already cleared the text.
        can_send: !turn_running
            && !composer.switching
            && !parts
                .composer
                .drafts
                .iter()
                .any(|draft| matches!(draft.state, ChatDraftState::Uploading)),
        can_stop: parts.turn.as_ref().is_some_and(|turn| turn.stoppable),
        attach,
        drafts,
        picker,
        editing,
        live_game,
    }
}

/// "Open in browser" and the share link controls for an open conversation.
fn header(transcript: &ChatTranscript, enabled: bool) -> Vec<Control> {
    let mut controls = vec![Control::new(
        "chat-open-browser",
        "Open in browser",
        UiAction::Send(WindowMessage::OpenUrl {
            url: transcript.web_url.clone(),
        }),
    )];
    match &transcript.share_url {
        None => controls.push(Control::send(
            "chat-share",
            "Share link",
            ChatCommand::Share,
        )),
        Some(url) => {
            controls.push(Control::new(
                "chat-copy-link",
                "Copy link",
                UiAction::CopyLink(url.clone()),
            ));
            controls.push(Control::send(
                "chat-stop-sharing",
                "Stop sharing",
                ChatCommand::RevokeShare,
            ));
        }
    }
    for control in &mut controls[1..] {
        control.enabled = enabled;
    }
    controls
}

impl ChatScreen {
    /// The chat screen from the relayed parts, the runtime snapshot (for a
    /// pending pairing) and the update status (for an upgrade).
    #[must_use]
    pub fn new(parts: &ChatParts, state: &StateSnapshot, update: &UpdateSnapshot) -> Self {
        Self::with_ui(parts, state, update, ChatUi::default())
    }

    /// [`Self::new`], with what only the window knows: the question being
    /// edited and whether the model picker is open.
    #[must_use]
    pub fn with_ui(
        parts: &ChatParts,
        state: &StateSnapshot,
        update: &UpdateSnapshot,
        ui: ChatUi,
    ) -> Self {
        let status = &parts.status;
        if status.availability == ChatAvailability::Loading {
            return Self::Loading;
        }
        if let Some(gate) = gate(&status.availability, state, update) {
            return Self::Gate(gate);
        }
        let turn_running = parts.turn.is_some();
        let loading = status.open_conversation.is_some()
            && parts
                .transcript
                .as_ref()
                .map(|transcript| transcript.conversation_id)
                != status.open_conversation
            && !turn_running;
        let title = parts
            .transcript
            .as_ref()
            .filter(|transcript| Some(transcript.conversation_id) == status.open_conversation)
            .map(|transcript| transcript.title.clone())
            .or_else(|| {
                parts
                    .conversations
                    .iter()
                    .find(|conversation| Some(conversation.id) == status.open_conversation)
                    .map(|conversation| conversation.title.clone())
            })
            .unwrap_or_else(|| "New chat".to_owned());
        let open_transcript = parts
            .transcript
            .as_ref()
            .filter(|transcript| Some(transcript.conversation_id) == status.open_conversation);
        Self::Conversation(Box::new(ConversationModel {
            title,
            rows: rows(parts),
            loading,
            composer: composer(parts, ui, open_transcript.is_some()),
            reconnecting: status.reconnecting,
            notice: status.notice.clone(),
            header: open_transcript
                .map(|transcript| header(transcript, !turn_running))
                .unwrap_or_default(),
            share_url: open_transcript.and_then(|transcript| transcript.share_url.clone()),
        }))
    }
}

/// What the composer's send sends, or none for a blank question. With the
/// live game chip on, the supervisor attaches the game in progress.
#[must_use]
pub fn send_message(text: &str, live_game: bool) -> Option<WindowMessage> {
    let question = text.trim();
    (!question.is_empty()).then(|| {
        chat(ChatCommand::Send {
            question: question.to_owned(),
            live_game,
        })
    })
}

/// What the composer's send sends while a question is being edited: the
/// edit as a new version of that turn.
#[must_use]
pub fn edit_message(message_id: Uuid, text: &str) -> Option<WindowMessage> {
    let question = text.trim();
    (!question.is_empty()).then(|| {
        chat(ChatCommand::Edit {
            message_id,
            question: question.to_owned(),
        })
    })
}

/// What the stop button sends.
#[must_use]
pub fn stop_message() -> WindowMessage {
    chat(ChatCommand::Stop)
}

#[cfg(test)]
mod tests {
    use scout_desktop_ipc::{
        ChatAvailability, ChatCommand, ChatParts, ChatRole, ChatStatus, ChatToolStatus,
        StateSnapshot, UpdateSnapshot, UpdateStatus, WindowMessage,
    };
    use scout_explore_client::golden;
    use uuid::Uuid;

    use super::{
        ChatScreen, ChatUi, ConversationModel, GateModel, PENDING_ANSWER_KEY, PENDING_QUESTION_KEY,
        Picture, SidebarModel, UiAction, edit_message, edit_target_shown, send_message,
        stop_message, stream_fade,
    };

    type TestResult = Result<(), Box<dyn std::error::Error>>;

    fn conversation(parts: &ChatParts) -> Result<ConversationModel, String> {
        match ChatScreen::new(parts, &StateSnapshot::default(), &UpdateSnapshot::default()) {
            ChatScreen::Conversation(model) => Ok(*model),
            other => Err(format!("expected a conversation, got {other:?}")),
        }
    }

    fn gated(availability: ChatAvailability, state: &StateSnapshot) -> Result<GateModel, String> {
        let parts = ChatParts {
            status: ChatStatus {
                availability,
                ..ChatStatus::default()
            },
            ..ChatParts::default()
        };
        let update = UpdateSnapshot {
            status: UpdateStatus::Downloading,
            version: Some("0.4.0".to_owned()),
            required: true,
        };
        match ChatScreen::new(&parts, state, &update) {
            ChatScreen::Gate(model) => Ok(model),
            other => Err(format!("expected a gate, got {other:?}")),
        }
    }

    #[test]
    fn mid_turn_the_golden_stream_renders_the_question_and_a_streaming_answer() -> TestResult {
        let model = conversation(&golden::streaming()?.parts())?;
        assert_eq!(model.title, "Best ADC pair this week");
        assert!(!model.loading, "a running turn is not a loading transcript");
        let keys: Vec<_> = model.rows.iter().map(|row| row.key.as_str()).collect();
        assert_eq!(keys, [PENDING_QUESTION_KEY, PENDING_ANSWER_KEY]);
        let answer = &model.rows[1];
        assert_eq!(answer.role, ChatRole::Assistant);
        assert!(answer.streaming);
        assert_eq!(answer.text, "Jinx and Lulu lead with a 61% win rate.");
        assert_eq!(answer.activity.as_deref(), Some("Running the query"));
        let tools: Vec<_> = answer
            .tools
            .iter()
            .map(|tool| {
                (
                    tool.label.as_str(),
                    tool.status_label,
                    tool.duration.as_deref(),
                )
            })
            .collect();
        assert_eq!(
            tools,
            [
                ("Checked the query.", "Done", Some("41 ms")),
                ("The query returned 1 row.", "Done", Some("230 ms")),
            ]
        );
        assert!(!model.composer.can_send, "one turn at a time");
        assert!(model.composer.can_stop);
        Ok(())
    }

    #[test]
    fn a_landed_golden_answer_is_a_persisted_row_with_its_steps() -> TestResult {
        let model = conversation(&golden::settled()?.parts())?;
        assert_eq!(model.rows.len(), 2);
        assert!(model.rows.iter().all(|row| !row.streaming));
        assert_eq!(model.rows[0].role, ChatRole::User);
        assert_eq!(model.rows[0].text, golden::QUESTION);
        assert_eq!(model.rows[1].tools.len(), 2);
        assert_eq!(model.rows[1].activity, None);
        assert!(model.composer.can_send);
        assert!(!model.composer.can_stop);
        Ok(())
    }

    #[test]
    fn a_reported_error_ends_the_stream_and_stays_as_a_notice() -> TestResult {
        let model = conversation(&golden::interrupted()?.parts())?;
        assert_eq!(
            model.notice.as_deref(),
            Some("Explore could not finish this answer.")
        );
        assert!(model.composer.can_send);
        Ok(())
    }

    #[test]
    fn the_sidebar_marks_the_open_conversation_only_on_the_chat_page() -> TestResult {
        let parts = golden::streaming()?.parts();
        let sidebar = SidebarModel::new(&parts, true);
        let selected: Vec<_> = sidebar
            .conversations
            .iter()
            .map(|entry| (entry.title.as_str(), entry.selected))
            .collect();
        assert_eq!(
            selected,
            [
                ("Best ADC pair this week", true),
                ("Who carries our ARAMs?", false)
            ]
        );
        assert!(!sidebar.new_chat_selected);
        assert!(
            SidebarModel::new(&parts, false)
                .conversations
                .iter()
                .all(|entry| !entry.selected)
        );
        let blank = SidebarModel::new(&golden::ready()?.parts(), true);
        assert!(blank.new_chat_selected);
        assert_eq!(
            blank.conversations[1].message,
            WindowMessage::Chat {
                command: ChatCommand::Open {
                    conversation_id: blank.conversations[1].id
                }
            }
        );
        Ok(())
    }

    #[test]
    fn a_blank_conversation_has_no_rows_and_a_working_composer() -> TestResult {
        let model = conversation(&golden::ready()?.parts())?;
        assert_eq!(model.title, "New chat");
        assert_eq!(model.rows, []);
        assert!(model.composer.can_send);
        assert!(!model.composer.can_stop);
        Ok(())
    }

    #[test]
    fn approving_chat_starts_a_pairing_then_opens_its_page_with_the_code() -> TestResult {
        let fresh = gated(ChatAvailability::NeedsApproval, &StateSnapshot::default())?;
        assert_eq!(fresh.title, "Approve chat on the web");
        assert_eq!(fresh.actions[0].message, WindowMessage::Pair);
        assert_eq!(fresh.detail, None);

        let pending = StateSnapshot {
            approval_url: Some(
                "https://beta.scout-for-lol.com/app/scout-client/pair/abc".to_owned(),
            ),
            pairing_match_code: Some("K7Q-2M".to_owned()),
            ..StateSnapshot::default()
        };
        let waiting = gated(ChatAvailability::NeedsApproval, &pending)?;
        assert_eq!(
            waiting.actions[0].message,
            WindowMessage::OpenUrl {
                url: "https://beta.scout-for-lol.com/app/scout-client/pair/abc".to_owned()
            }
        );
        assert_eq!(
            waiting.detail.as_deref(),
            Some("Check that the page shows the code K7Q-2M.")
        );
        Ok(())
    }

    #[test]
    fn every_other_gate_says_what_happened_and_how_to_recover() -> TestResult {
        let state = StateSnapshot::default();
        let off = gated(ChatAvailability::TurnedOff, &state)?;
        assert_eq!(off.title, "Chat is turned off");
        assert_eq!(
            off.actions[0].message,
            WindowMessage::Chat {
                command: ChatCommand::Refresh
            }
        );
        let upgrade = gated(ChatAvailability::UpgradeRequired, &state)?;
        assert_eq!(upgrade.title, "Update Scout Desktop");
        assert_eq!(upgrade.detail.as_deref(), Some("Update: Downloading 0.4.0"));
        assert!(upgrade.actions.is_empty(), "the updater installs it");
        for availability in [
            ChatAvailability::SignInOnWeb,
            ChatAvailability::NoServer,
            ChatAvailability::Unavailable {
                message: "Scout is unreachable.".to_owned(),
            },
        ] {
            let model = gated(availability.clone(), &state)?;
            assert_eq!(model.actions.len(), 1, "{availability:?}");
        }
        assert_eq!(
            ChatScreen::new(&ChatParts::default(), &state, &UpdateSnapshot::default()),
            ChatScreen::Loading
        );
        Ok(())
    }

    #[test]
    fn a_reconnect_shows_and_a_running_step_reads_running() -> TestResult {
        let mut parts = golden::streaming()?.parts();
        parts.status.reconnecting = true;
        if let Some(turn) = parts.turn.as_mut() {
            turn.tools[1].status = ChatToolStatus::Running;
            turn.tools[1].duration_ms = None;
        }
        let model = conversation(&parts)?;
        assert!(model.reconnecting);
        assert_eq!(model.rows[1].tools[1].status_label, "Running");
        assert_eq!(model.rows[1].tools[1].duration, None);
        Ok(())
    }

    #[test]
    fn an_answer_row_carries_its_visuals_and_where_each_picture_stands() -> TestResult {
        use scout_desktop_ipc::{ChatImage, ChatVisual};

        let mut parts = golden::visuals()?.parts();
        let model = conversation(&parts)?;
        assert_eq!(model.title, "My Jinx this month");
        assert_eq!(model.rows.len(), 8);
        let Some(ChatVisual::Chart { image, .. }) = model.rows[1].visuals.visual.clone() else {
            return Err("the first answer should be a chart".into());
        };
        assert_eq!(model.rows[1].picture(Some(&image)), Picture::Loading);
        assert_eq!(model.rows[0].picture(None), Picture::Absent);

        parts.images.insert(
            image.clone(),
            ChatImage::Ready {
                path: "/cache/chart.asset".to_owned(),
            },
        );
        let model = conversation(&parts)?;
        assert_eq!(
            model.rows[1].picture(Some(&image)),
            Picture::Ready("/cache/chart.asset")
        );
        assert_eq!(model.rows[5].visuals.match_cards.len(), 1);
        assert_eq!(model.rows[7].visuals.loadout_cards.len(), 1);
        assert!(
            model.rows[3].pictures.is_empty(),
            "a native table names no pictures"
        );
        Ok(())
    }

    #[test]
    fn reduced_motion_turns_the_stream_fade_off() {
        assert!(stream_fade(true, false));
        assert!(!stream_fade(true, true));
        assert!(!stream_fade(false, false));
    }

    #[test]
    fn the_composer_sends_a_trimmed_question_and_nothing_when_blank() {
        assert_eq!(send_message("   ", true), None);
        assert_eq!(
            send_message(" Who wins? ", true),
            Some(WindowMessage::Chat {
                command: ChatCommand::Send {
                    question: "Who wins?".to_owned(),
                    live_game: true,
                }
            })
        );
        assert_eq!(
            stop_message(),
            WindowMessage::Chat {
                command: ChatCommand::Stop
            }
        );
    }

    fn conversation_with(parts: &ChatParts, ui: ChatUi) -> Result<ConversationModel, String> {
        match ChatScreen::with_ui(
            parts,
            &StateSnapshot::default(),
            &UpdateSnapshot::default(),
            ui,
        ) {
            ChatScreen::Conversation(model) => Ok(*model),
            other => Err(format!("expected a conversation, got {other:?}")),
        }
    }

    fn command(command: ChatCommand) -> UiAction {
        UiAction::Send(WindowMessage::Chat { command })
    }

    #[test]
    fn a_turn_with_versions_shows_its_switcher_and_steps_to_the_neighbours() -> TestResult {
        let model = conversation(&golden::branched()?.parts())?;
        let question = model.rows[0].switcher.as_ref().ok_or("switcher")?;
        assert_eq!(question.label, "2 of 3");
        assert_eq!(
            question.previous.action,
            command(ChatCommand::SwitchVersion {
                message_id: golden::BRANCHED_QUESTION_FIRST
            })
        );
        assert_eq!(
            question.next.action,
            command(ChatCommand::SwitchVersion {
                message_id: golden::BRANCHED_QUESTION_LAST
            })
        );
        assert!(question.previous.enabled && question.next.enabled);

        // The end of the line has nowhere to go.
        let answer = model.rows[1].switcher.as_ref().ok_or("switcher")?;
        assert_eq!(answer.label, "1 of 2");
        assert!(!answer.previous.enabled);
        assert!(answer.next.enabled);
        // A turn with one version shows no switcher.
        assert_eq!(model.rows[2].switcher, None);
        Ok(())
    }

    #[test]
    fn a_question_offers_edit_and_an_answer_regenerate() -> TestResult {
        let model = conversation(&golden::branched()?.parts())?;
        assert_eq!(model.rows[0].actions[0].label, "Edit");
        assert_eq!(
            model.rows[0].actions[0].action,
            UiAction::Edit {
                message_id: golden::BRANCHED_QUESTION,
                text: "Which bot lane pair wins most in ARAM this month?".to_owned()
            }
        );
        assert_eq!(model.rows[1].actions[0].label, "Regenerate");
        assert_eq!(
            model.rows[1].actions[0].action,
            command(ChatCommand::Regenerate {
                message_id: golden::BRANCHED_ANSWER
            })
        );
        Ok(())
    }

    #[test]
    fn nothing_is_edited_or_switched_while_a_turn_runs() -> TestResult {
        let mut session = golden::branched()?;
        session
            .regenerate(golden::BRANCHED_FOLLOW_UP_ANSWER)
            .ok_or("request")?;
        let model = conversation(&session.parts())?;
        for row in &model.rows {
            assert!(row.actions.iter().all(|action| !action.enabled), "{row:?}");
            if let Some(switcher) = &row.switcher {
                assert!(!switcher.previous.enabled && !switcher.next.enabled);
            }
        }
        assert!(model.header[1..].iter().all(|control| !control.enabled));
        Ok(())
    }

    #[test]
    fn nothing_is_sent_edited_or_switched_while_a_version_switch_is_read_back() -> TestResult {
        let mut session = golden::branched()?;
        session
            .switch_version(golden::BRANCHED_QUESTION_LAST)
            .ok_or("the switch starts")?;
        let model = conversation(&session.parts())?;
        assert!(!model.composer.can_send);
        for row in &model.rows {
            assert!(row.actions.iter().all(|action| !action.enabled), "{row:?}");
            if let Some(switcher) = &row.switcher {
                assert!(!switcher.previous.enabled && !switcher.next.enabled);
            }
        }
        Ok(())
    }

    #[test]
    fn an_edit_ends_with_its_question_leaving_the_screen() -> TestResult {
        let parts = golden::branched()?.parts();
        assert!(edit_target_shown(&parts, golden::BRANCHED_QUESTION));
        // Another conversation, or another branch, does not hold it.
        let other = golden::ready()?.parts();
        assert!(!edit_target_shown(&other, golden::BRANCHED_QUESTION));
        assert!(!edit_target_shown(&parts, Uuid::from_u128(1)));
        Ok(())
    }

    #[test]
    fn an_attached_image_shows_a_tile_or_its_thumbnail() -> TestResult {
        let mut parts = golden::branched()?.parts();
        let question = parts
            .transcript
            .as_mut()
            .and_then(|transcript| transcript.messages.first_mut())
            .ok_or("question")?;
        question.attachments = vec![scout_desktop_ipc::ChatAttachment {
            id: uuid::Uuid::from_u128(9),
            media_type: "image/png".to_owned(),
            thumbnail: None,
        }];
        let model = conversation(&parts)?;
        assert!(
            model.rows[0].actions.is_empty(),
            "Edit would drop the image, so it is hidden"
        );
        let images = &model.rows[0].images;
        assert_eq!(images.len(), 1);
        assert_eq!(images[0].label, "PNG");
        assert_eq!(
            images[0].thumbnail, None,
            "attached elsewhere: no local file"
        );

        let mut session = golden::composing("/tmp/a.png", "/tmp/b.png")?;
        session.submit("Look").ok_or("request")?;
        let model = conversation(&session.parts())?;
        let pending = model
            .rows
            .iter()
            .find(|row| row.key == PENDING_QUESTION_KEY)
            .ok_or("pending question")?;
        let thumbnails: Vec<_> = pending
            .images
            .iter()
            .map(|image| image.thumbnail.as_deref())
            .collect();
        assert_eq!(thumbnails, [Some("/tmp/a.png"), Some("/tmp/b.png")]);
        Ok(())
    }

    #[test]
    fn the_composer_lists_its_images_and_stops_attaching_at_the_cap() -> TestResult {
        let model = conversation(&golden::composing("/tmp/a.png", "/tmp/b.png")?.parts())?;
        assert_eq!(model.composer.drafts.len(), 2);
        assert_eq!(model.composer.drafts[0].status, None);
        assert_eq!(model.composer.drafts[0].thumbnail, "/tmp/a.png");
        assert!(model.composer.attach.enabled);
        assert_eq!(model.composer.attach.action, UiAction::PickImage);

        let mut session = golden::composing("/tmp/a.png", "/tmp/b.png")?;
        session.begin_attach("/tmp/c.png").ok_or("third")?;
        session.begin_attach("/tmp/d.png").ok_or("fourth")?;
        let model = conversation(&session.parts())?;
        assert!(!model.composer.attach.enabled, "four is the web's cap");
        assert_eq!(
            model.composer.drafts[2].status.as_deref(),
            Some("Uploading…")
        );
        Ok(())
    }

    #[test]
    fn the_picker_names_the_model_in_use_and_chooses_through_a_command() -> TestResult {
        let parts = golden::branched()?.parts();
        let model = conversation_with(&parts, ChatUi::default())?;
        let picker = model.composer.picker.ok_or("picker")?;
        assert_eq!(picker.toggle.label, "Model: GPT-6 Luna · High");
        assert!(!picker.open);
        let selected: Vec<_> = picker
            .options
            .iter()
            .map(|option| (option.control.label.as_str(), option.selected))
            .collect();
        assert_eq!(
            selected,
            [("GPT-6 Luna · High", true), ("GPT-6.1 Sol · High", false)]
        );
        assert_eq!(
            picker.options[1].control.action,
            command(ChatCommand::ChooseModel {
                model: Some("gpt-6.1-sol".to_owned())
            })
        );

        let open = conversation_with(
            &parts,
            ChatUi {
                picker_open: true,
                ..ChatUi::default()
            },
        )?;
        assert!(open.composer.picker.ok_or("picker")?.open);

        // With the picker off the server chooses and nothing shows.
        let none = conversation(&golden::ready()?.parts())?;
        assert_eq!(none.composer.picker, None);
        Ok(())
    }

    #[test]
    fn the_live_game_chip_shows_only_in_a_game_and_turns_off() -> TestResult {
        use super::{LIVE_GAME_OFF, LIVE_GAME_ON};

        let parts = golden::ready()?.parts();
        let idle = conversation_with(&parts, ChatUi::default())?;
        assert_eq!(idle.composer.live_game, None, "no game, no chip");

        let playing = ChatUi {
            live_game: true,
            ..ChatUi::default()
        };
        let chip = conversation_with(&parts, playing)?
            .composer
            .live_game
            .ok_or("chip")?;
        assert!(chip.on, "on until the player turns it off");
        assert_eq!(chip.toggle.label, LIVE_GAME_ON);
        assert_eq!(chip.toggle.action, UiAction::ToggleLiveGame);

        let off = conversation_with(
            &parts,
            ChatUi {
                live_game_off: true,
                ..playing
            },
        )?
        .composer
        .live_game
        .ok_or("chip")?;
        assert!(!off.on);
        assert_eq!(off.toggle.label, LIVE_GAME_OFF);
        Ok(())
    }

    #[test]
    fn an_edit_never_offers_the_live_game() -> TestResult {
        let parts = golden::branched()?.parts();
        let editing = conversation_with(
            &parts,
            ChatUi {
                editing: Some(golden::BRANCHED_QUESTION),
                live_game: true,
                ..ChatUi::default()
            },
        )?;
        assert!(editing.composer.editing.is_some());
        assert_eq!(editing.composer.live_game, None);
        Ok(())
    }

    #[test]
    fn a_conversation_links_to_the_web_and_shares() -> TestResult {
        let model = conversation(&golden::branched()?.parts())?;
        let labels: Vec<_> = model.header.iter().map(|c| c.label.as_str()).collect();
        assert_eq!(labels, ["Open in browser", "Share link"]);
        assert_eq!(
            model.header[0].action,
            UiAction::Send(WindowMessage::OpenUrl {
                url: format!(
                    "https://scout-for-lol.com/app/explore/{}",
                    golden::BRANCHED_CONVERSATION
                )
            })
        );
        assert_eq!(model.header[1].action, command(ChatCommand::Share));
        assert_eq!(model.share_url, None);

        let shared = conversation(&golden::shared()?.parts())?;
        let labels: Vec<_> = shared.header.iter().map(|c| c.label.as_str()).collect();
        assert_eq!(labels, ["Open in browser", "Copy link", "Stop sharing"]);
        let url = shared.share_url.ok_or("share url")?;
        assert_eq!(shared.header[1].action, UiAction::CopyLink(url));
        assert_eq!(shared.header[2].action, command(ChatCommand::RevokeShare));

        // A blank conversation has nothing to open or share.
        assert_eq!(conversation(&golden::ready()?.parts())?.header, []);
        Ok(())
    }

    #[test]
    fn editing_shows_its_banner_and_sends_a_new_version() -> TestResult {
        let parts = golden::branched()?.parts();
        let ui = ChatUi {
            editing: Some(golden::BRANCHED_QUESTION),
            ..ChatUi::default()
        };
        let model = conversation_with(&parts, ui)?;
        let banner = model.composer.editing.ok_or("banner")?;
        assert_eq!(banner.cancel.action, UiAction::CancelEdit);

        // An edit of a message that is no longer on screen is dropped.
        let gone = ChatUi {
            editing: Some(Uuid::from_u128(5)),
            ..ChatUi::default()
        };
        assert_eq!(conversation_with(&parts, gone)?.composer.editing, None);
        assert_eq!(conversation(&parts)?.composer.editing, None);

        assert_eq!(edit_message(golden::BRANCHED_QUESTION, "  "), None);
        assert_eq!(
            edit_message(golden::BRANCHED_QUESTION, " Who wins? "),
            Some(WindowMessage::Chat {
                command: ChatCommand::Edit {
                    message_id: golden::BRANCHED_QUESTION,
                    question: "Who wins?".to_owned()
                }
            })
        );
        Ok(())
    }
}
