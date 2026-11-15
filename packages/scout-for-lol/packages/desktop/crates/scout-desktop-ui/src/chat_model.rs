//! The chat screen's view model, built from the chat parts the supervisor
//! relays. Nothing here knows about GPUI, so it builds and is tested on every
//! target; the chat view renders these structs and nothing else.

use std::collections::BTreeMap;

use scout_desktop_ipc::{
    ChatAvailability, ChatCommand, ChatImage, ChatParts, ChatRole, ChatToolStatus, ChatToolStep,
    ChatVisuals, StateSnapshot, UpdateSnapshot, WindowMessage,
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
    /// The error a run reported.
    pub error: Option<String>,
    /// A persisted answer's chart or table and its cards.
    pub visuals: ChatVisuals,
    /// Where each picture `visuals` names stands.
    pub pictures: BTreeMap<String, ChatImage>,
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
}

/// The composer's controls.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ComposerModel {
    /// Whether a question can be sent now.
    pub can_send: bool,
    /// Whether the running answer can be stopped.
    pub can_stop: bool,
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
    Conversation(ConversationModel),
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

fn rows(parts: &ChatParts) -> Vec<TranscriptRow> {
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
        })
        .collect();
    let Some(turn) = &parts.turn else {
        return rows;
    };
    if let Some(question) = &turn.question {
        rows.push(TranscriptRow {
            key: PENDING_QUESTION_KEY.to_owned(),
            role: ChatRole::User,
            text: question.clone(),
            streaming: false,
            tools: Vec::new(),
            activity: None,
            caveats: Vec::new(),
            error: None,
            visuals: ChatVisuals::default(),
            pictures: BTreeMap::new(),
        });
    }
    let answering = turn.answer.is_some()
        || turn.activity.is_some()
        || !turn.tools.is_empty()
        || turn.error.is_some();
    if answering {
        rows.push(TranscriptRow {
            key: PENDING_ANSWER_KEY.to_owned(),
            role: ChatRole::Assistant,
            text: turn.answer.clone().unwrap_or_default(),
            streaming: turn.error.is_none(),
            tools: tools(&turn.tools),
            activity: turn.activity.clone(),
            caveats: Vec::new(),
            error: turn.error.clone(),
            visuals: ChatVisuals::default(),
            pictures: BTreeMap::new(),
        });
    }
    rows
}

impl ChatScreen {
    /// The chat screen from the relayed parts, the runtime snapshot (for a
    /// pending pairing) and the update status (for an upgrade).
    #[must_use]
    pub fn new(parts: &ChatParts, state: &StateSnapshot, update: &UpdateSnapshot) -> Self {
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
        Self::Conversation(ConversationModel {
            title,
            rows: rows(parts),
            loading,
            composer: ComposerModel {
                can_send: !turn_running,
                can_stop: parts.turn.as_ref().is_some_and(|turn| turn.stoppable),
            },
            reconnecting: status.reconnecting,
            notice: status.notice.clone(),
        })
    }
}

/// What the composer's send sends, or none for a blank question.
#[must_use]
pub fn send_message(text: &str) -> Option<WindowMessage> {
    let question = text.trim();
    (!question.is_empty()).then(|| {
        chat(ChatCommand::Send {
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

    use super::{
        ChatScreen, ConversationModel, GateModel, PENDING_ANSWER_KEY, PENDING_QUESTION_KEY,
        Picture, SidebarModel, send_message, stop_message, stream_fade,
    };

    type TestResult = Result<(), Box<dyn std::error::Error>>;

    fn conversation(parts: &ChatParts) -> Result<ConversationModel, String> {
        match ChatScreen::new(parts, &StateSnapshot::default(), &UpdateSnapshot::default()) {
            ChatScreen::Conversation(model) => Ok(model),
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
        assert_eq!(send_message("   "), None);
        assert_eq!(
            send_message(" Who wins? "),
            Some(WindowMessage::Chat {
                command: ChatCommand::Send {
                    question: "Who wins?".to_owned()
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
}
