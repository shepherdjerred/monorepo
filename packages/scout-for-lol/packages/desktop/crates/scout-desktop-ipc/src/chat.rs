//! Explore chat as the window renders it.
//!
//! The supervisor holds the device credential and runs the Explore client;
//! the window only ever sees these projections. They carry no bearer, no raw
//! tool payload and no query text, only what the transcript shows.
//!
//! The supervisor sends each part on its own message when it changes, so a
//! streamed answer re-sends only the in-flight turn, never the transcript.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::SupervisorMessage;
use crate::chat_visuals::{ChatImage, ChatVisuals};

/// Whether chat can be used, and if not, what the user must do.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "snake_case", deny_unknown_fields)]
pub enum ChatAvailability {
    /// The supervisor is still asking Scout.
    #[default]
    Loading,
    /// Chat works.
    Ready,
    /// The device is not paired, or was paired without the `explore` scope:
    /// approve chat on the web with a new pairing.
    NeedsApproval,
    /// The owner's Discord sign-in expired: sign in to Scout on the web.
    SignInOnWeb,
    /// Explore in Scout Desktop is switched off for this owner.
    TurnedOff,
    /// The owner shares no server that may use Explore.
    NoServer,
    /// This build is older than Scout accepts.
    UpgradeRequired,
    /// Scout could not be reached or answered outside the contract.
    Unavailable {
        /// Why, safe to show.
        message: String,
    },
}

/// The connection and notice line above the composer.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ChatStatus {
    /// Whether chat can be used.
    pub availability: ChatAvailability,
    /// The conversation on screen; none for a blank one. It is known before
    /// its transcript arrives, so the sidebar can mark it at once.
    pub open_conversation: Option<Uuid>,
    /// The run stream dropped and is attaching again.
    pub reconnecting: bool,
    /// A failure worth one line, such as a refused turn; safe to show.
    pub notice: Option<String>,
}

/// One conversation in the sidebar.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ChatConversation {
    /// Conversation id.
    pub id: Uuid,
    /// Title.
    pub title: String,
}

/// Who wrote a message.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ChatRole {
    /// The asker.
    User,
    /// Scout.
    Assistant,
}

/// How a tool step stands.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ChatToolStatus {
    /// Still running.
    Running,
    /// Finished.
    Succeeded,
    /// Failed.
    Failed,
    /// Cut short by a stop or an error.
    Interrupted,
}

/// One tool step, summarized.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ChatToolStep {
    /// The step's generic description, as the web shows it.
    pub summary: String,
    /// How it stands.
    pub status: ChatToolStatus,
    /// How long it took, once finished.
    pub duration_ms: Option<u64>,
}

/// Where a message stands among the versions of its turn: the "2 of 3" the
/// switcher shows, and the messages its arrows move to.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ChatVersion {
    /// This version's place, counting from 1.
    pub position: u32,
    /// How many versions the turn has.
    pub count: u32,
    /// The version before this one, if any.
    pub previous: Option<Uuid>,
    /// The version after this one, if any.
    pub next: Option<Uuid>,
}

/// An image attached to a question.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ChatAttachment {
    /// The stored image's id.
    pub id: Uuid,
    /// The image type, such as `image/png`.
    pub media_type: String,
    /// A file on this computer the window can draw as the thumbnail, when
    /// this session attached the image; none for one attached elsewhere.
    pub thumbnail: Option<String>,
}

/// One choice in a multiple-choice coach answer: shown as a chip the player
/// can pick, with the reason the answer gave for it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ChatCoachOption {
    /// The short label on the chip.
    pub label: String,
    /// One line on why it is worth considering.
    pub rationale: String,
}

/// One persisted message on the open branch.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ChatMessage {
    /// Message id.
    pub id: Uuid,
    /// Who wrote it.
    pub role: ChatRole,
    /// Markdown text.
    pub content: String,
    /// The tool steps behind an answer.
    pub tools: Vec<ChatToolStep>,
    /// Caveats under an answer.
    pub caveats: Vec<String>,
    /// Two to four options the answer offers for a choice, or none.
    pub coach_options: Vec<ChatCoachOption>,
    /// The answer's chart or table and its cards.
    pub visuals: ChatVisuals,
    /// Which version of its turn this is; none when the turn has one version.
    pub version: Option<ChatVersion>,
    /// Images attached to a question.
    pub attachments: Vec<ChatAttachment>,
}

/// The open conversation's persisted branch.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ChatTranscript {
    /// Conversation id.
    pub conversation_id: Uuid,
    /// Title.
    pub title: String,
    /// Messages, oldest first.
    pub messages: Vec<ChatMessage>,
    /// The conversation on the Scout website, for "Open in browser".
    pub web_url: String,
    /// The conversation's public share link, while it is shared.
    pub share_url: Option<String>,
}

/// The in-flight turn, as the reducer says to render it over the transcript.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ChatTurn {
    /// Whether the run exists yet, so it can be stopped.
    pub stoppable: bool,
    /// The optimistic question, until the transcript holds it.
    pub question: Option<String>,
    /// The images that went with it.
    pub attachments: Vec<ChatAttachment>,
    /// The streamed answer so far, until the persisted one lands.
    pub answer: Option<String>,
    /// The live status line.
    pub activity: Option<String>,
    /// Whether the status describes a deliberate stop.
    pub stopping: bool,
    /// Tool steps so far.
    pub tools: Vec<ChatToolStep>,
    /// The error the run reported; safe to show.
    pub error: Option<String>,
}

/// How an image waiting in the composer stands.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "snake_case", deny_unknown_fields)]
pub enum ChatDraftState {
    /// Still being sent to Scout.
    Uploading,
    /// Stored and ready to go with the question.
    Ready,
    /// Refused or unreadable; the image will not be sent.
    Failed {
        /// Why, safe to show.
        message: String,
    },
}

/// One image attached in the composer, before the question is sent.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ChatDraft {
    /// A local id the window removes it by.
    pub key: Uuid,
    /// The file's name.
    pub name: String,
    /// A file on this computer the window draws as the thumbnail.
    pub thumbnail: String,
    /// How it stands.
    pub state: ChatDraftState,
}

/// One model the picker offers.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ChatModelOption {
    /// The id sent with the question.
    pub id: String,
    /// What the picker shows.
    pub label: String,
}

/// What the composer holds besides its text: images and the model choice.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ChatComposer {
    /// Images attached to the next question, in order.
    pub drafts: Vec<ChatDraft>,
    /// How many images a question may carry.
    pub max_images: u32,
    /// The models the owner may choose between; empty when the server
    /// chooses, in which case the picker is not shown.
    pub models: Vec<ChatModelOption>,
    /// The model the next question uses, when there is a choice.
    pub model: Option<String>,
    /// A version switch is being read back: sending, editing, regenerating
    /// and switching again wait for it.
    pub switching: bool,
}

/// A chat request from the window. The supervisor answers with chat parts.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "action", rename_all = "snake_case", deny_unknown_fields)]
pub enum ChatCommand {
    /// Ask Scout again whether chat works, and reload the conversation list.
    Refresh,
    /// Show one conversation.
    Open {
        /// The conversation.
        conversation_id: Uuid,
    },
    /// Start a blank conversation.
    New,
    /// Ask a question in the open conversation, or start one. Only the
    /// composer sends this, with the text the player typed.
    Send {
        /// The question as typed.
        question: String,
        /// Whether to send the game in progress with it: the composer's
        /// "Using your live game" chip, which the player can turn off. The
        /// supervisor attaches its own latest snapshot, never one from the
        /// window, and none when no game is live.
        live_game: bool,
    },
    /// Pick one of the options an answer offered. The window names the
    /// answer and the option's place, never text: the supervisor reads the
    /// label from the saved answer and asks Scout about it, without the game.
    ChooseOption {
        /// The answer that offered the option.
        message_id: Uuid,
        /// The option's place among the answer's options, from 0.
        index: u8,
    },
    /// Stop the running answer; Scout keeps what it has written.
    Stop,
    /// Ask the question again with new words: a new version of that turn.
    Edit {
        /// The question being edited.
        message_id: Uuid,
        /// The new question as typed.
        question: String,
    },
    /// Answer a question again: a new version of that answer.
    Regenerate {
        /// The answer to replace.
        message_id: Uuid,
    },
    /// Show another version of a turn.
    SwitchVersion {
        /// The version to show.
        message_id: Uuid,
    },
    /// Attach an image file to the next question.
    Attach {
        /// The file on this computer: picked, or a pasted image the window
        /// saved first.
        path: String,
    },
    /// Remove an image from the composer.
    RemoveAttachment {
        /// The draft's key.
        key: Uuid,
    },
    /// Create a share link for the open conversation.
    Share,
    /// Stop sharing the open conversation.
    RevokeShare,
    /// Choose the model for the next questions; none leaves it to the server.
    ChooseModel {
        /// A model id from the composer's list.
        model: Option<String>,
    },
}

/// Everything chat renders: the six parts the supervisor sends.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ChatParts {
    /// Availability, connection and notice.
    pub status: ChatStatus,
    /// The sidebar list.
    pub conversations: Vec<ChatConversation>,
    /// The open conversation.
    pub transcript: Option<ChatTranscript>,
    /// The in-flight turn.
    pub turn: Option<ChatTurn>,
    /// Where each picture the transcript names stands, by key.
    pub images: BTreeMap<String, ChatImage>,
    /// The composer's images and model choice.
    pub composer: ChatComposer,
}

impl ChatParts {
    /// The messages that bring a window holding `before` up to `self`; every
    /// part when the window holds nothing yet.
    #[must_use]
    pub fn changes_since(&self, before: Option<&Self>) -> Vec<SupervisorMessage> {
        let changed = |differs: fn(&Self, &Self) -> bool| before.is_none_or(|b| differs(self, b));
        let mut messages = Vec::new();
        if changed(|now, then| now.status != then.status) {
            messages.push(SupervisorMessage::ChatStatus {
                status: self.status.clone(),
            });
        }
        if changed(|now, then| now.conversations != then.conversations) {
            messages.push(SupervisorMessage::ChatConversations {
                conversations: self.conversations.clone(),
            });
        }
        if changed(|now, then| now.transcript != then.transcript) {
            messages.push(SupervisorMessage::ChatTranscript {
                transcript: self.transcript.clone(),
            });
        }
        if changed(|now, then| now.turn != then.turn) {
            messages.push(SupervisorMessage::ChatTurn {
                turn: self.turn.clone(),
            });
        }
        if changed(|now, then| now.images != then.images) {
            messages.push(SupervisorMessage::ChatImages {
                images: self.images.clone(),
            });
        }
        if changed(|now, then| now.composer != then.composer) {
            messages.push(SupervisorMessage::ChatComposer {
                composer: self.composer.clone(),
            });
        }
        messages
    }

    /// Apply one chat part. Returns `false` for a message that is not one.
    pub fn receive(&mut self, message: SupervisorMessage) -> bool {
        match message {
            SupervisorMessage::ChatStatus { status } => self.status = status,
            SupervisorMessage::ChatConversations { conversations } => {
                self.conversations = conversations;
            }
            SupervisorMessage::ChatTranscript { transcript } => self.transcript = transcript,
            SupervisorMessage::ChatTurn { turn } => self.turn = turn,
            SupervisorMessage::ChatImages { images } => self.images = images,
            SupervisorMessage::ChatComposer { composer } => self.composer = composer,
            _ => return false,
        }
        true
    }
}

#[cfg(test)]
mod tests {
    use super::{ChatAvailability, ChatParts, ChatStatus, ChatTurn};
    use crate::SupervisorMessage;

    #[test]
    fn a_new_window_gets_every_part_and_a_delta_only_what_changed() {
        let before = ChatParts::default();
        assert_eq!(before.changes_since(None).len(), 6);
        assert_eq!(before.changes_since(Some(&before)), []);

        let streaming = ChatParts {
            turn: Some(ChatTurn {
                answer: Some("Jinx".to_owned()),
                ..ChatTurn::default()
            }),
            ..before.clone()
        };
        assert_eq!(
            streaming.changes_since(Some(&before)),
            [SupervisorMessage::ChatTurn {
                turn: streaming.turn.clone()
            }]
        );

        let mut window = ChatParts::default();
        for message in streaming.changes_since(None) {
            assert!(window.receive(message));
        }
        assert_eq!(window, streaming);
        assert!(!window.receive(SupervisorMessage::Show));
    }

    #[test]
    fn an_image_landing_resends_only_the_images() {
        use crate::ChatImage;

        let loading = ChatParts {
            images: [("chart".to_owned(), ChatImage::Loading)].into(),
            ..ChatParts::default()
        };
        let landed = ChatParts {
            images: [(
                "chart".to_owned(),
                ChatImage::Ready {
                    path: "/cache/a.png".to_owned(),
                },
            )]
            .into(),
            ..loading.clone()
        };
        assert_eq!(
            landed.changes_since(Some(&loading)),
            [SupervisorMessage::ChatImages {
                images: landed.images.clone()
            }]
        );
    }

    #[test]
    fn a_status_change_is_one_message() {
        let ready = ChatParts {
            status: ChatStatus {
                availability: ChatAvailability::Ready,
                ..ChatStatus::default()
            },
            ..ChatParts::default()
        };
        let reconnecting = ChatParts {
            status: ChatStatus {
                reconnecting: true,
                ..ready.status.clone()
            },
            ..ready.clone()
        };
        assert_eq!(
            reconnecting.changes_since(Some(&ready)),
            [SupervisorMessage::ChatStatus {
                status: reconnecting.status.clone()
            }]
        );
    }

    #[test]
    fn a_composer_change_is_one_message_and_a_new_window_gets_it() {
        use super::{ChatComposer, ChatDraft, ChatDraftState};
        use uuid::Uuid;

        let before = ChatParts::default();
        let attached = ChatParts {
            composer: ChatComposer {
                drafts: vec![ChatDraft {
                    key: Uuid::from_u128(1),
                    name: "build.png".to_owned(),
                    thumbnail: "/tmp/build.png".to_owned(),
                    state: ChatDraftState::Uploading,
                }],
                max_images: 4,
                switching: false,
                ..ChatComposer::default()
            },
            ..before.clone()
        };
        assert_eq!(
            attached.changes_since(Some(&before)),
            [SupervisorMessage::ChatComposer {
                composer: attached.composer.clone()
            }]
        );
        let mut window = ChatParts::default();
        for message in attached.changes_since(None) {
            assert!(window.receive(message));
        }
        assert_eq!(window, attached);
    }
}
