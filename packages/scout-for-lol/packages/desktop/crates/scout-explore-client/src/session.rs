//! One desktop chat session as plain state: what the supervisor knows about
//! the owner's conversations and the turn in flight, and the window's view of
//! it.
//!
//! Nothing here does I/O. [`crate::relay`] performs each request this state
//! asks for and feeds the answer back; the window renders
//! [`ChatSession::parts`]. Keeping the transitions pure is what lets the
//! golden reducer fixtures drive the same code the app runs.

use scout_client_core::desktop_api::{
    ActiveRun, AttachPoint, ConversationListResponse, ConversationSummary, RunStartRequest,
};
use scout_desktop_ipc::{
    ChatAvailability, ChatConversation, ChatMessage, ChatParts, ChatRole, ChatStatus,
    ChatToolStatus, ChatToolStep, ChatTranscript, ChatTurn,
};
use uuid::Uuid;

use crate::error::{ExploreClientError, Recovery};
use crate::model::{ExploreMessage, MessageRole, TraceEntry, TraceStatus, Transcript};
use crate::reducer::{PendingTurn, TurnPhase, TurnView, visible_pending};
use crate::stream::{StreamEnd, StreamSignal};

/// The longest question the composer sends, matching the web's limit.
pub const MAX_QUESTION_CHARS: usize = 4_000;

/// The turn being followed, and the run the server created for it.
#[derive(Debug, Clone)]
struct FollowedTurn {
    view: TurnView,
    run: Option<ActiveRun>,
}

/// One desktop chat session.
#[derive(Debug, Clone, Default)]
pub struct ChatSession {
    availability: ChatAvailability,
    reconnecting: bool,
    notice: Option<String>,
    conversations: Vec<ConversationSummary>,
    open: Option<Uuid>,
    transcript: Option<Transcript>,
    turn: Option<FollowedTurn>,
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

impl ChatSession {
    /// A session that has not heard from Scout yet.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
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

    /// Ask `question` in the open conversation. Returns the request to send,
    /// or none when chat does not work, a turn is already running, or the
    /// question is blank or too long (the composer says why).
    pub fn submit(&mut self, question: &str) -> Option<RunStartRequest> {
        let question = question.trim();
        if self.availability != ChatAvailability::Ready || self.turn.is_some() {
            return None;
        }
        if question.is_empty() {
            return None;
        }
        if question.chars().count() > MAX_QUESTION_CHARS {
            self.notice = Some(format!(
                "Questions can be at most {MAX_QUESTION_CHARS} characters."
            ));
            return None;
        }
        self.notice = None;
        let leaf = self
            .transcript
            .as_ref()
            .and_then(|transcript| transcript.messages.last())
            .map(|message| message.id);
        self.turn = Some(FollowedTurn {
            view: TurnView::new(PendingTurn::new(self.open, Some(question.to_owned()), leaf)),
            run: None,
        });
        Some(RunStartRequest {
            conversation_id: self.open,
            question: Some(question.to_owned()),
            attach: AttachPoint::Leaf,
            model: None,
            attachment_ids: None,
        })
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
        turn.run = Some(run);
    }

    /// `runs/start` refused the turn; the optimistic question goes away.
    pub fn start_failed(&mut self, error: &ExploreClientError) {
        self.turn = None;
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
                        run: turn.run,
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
        self.turn = Some(FollowedTurn {
            view,
            run: turn.run,
        });
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
            transcript: self.transcript.as_ref().map(chat_transcript),
            turn: self.turn.as_ref().map(|turn| self.chat_turn(turn)),
        }
    }

    fn chat_turn(&self, turn: &FollowedTurn) -> ChatTurn {
        let messages = self
            .transcript
            .as_ref()
            .map_or(&[][..], |transcript| transcript.messages.as_slice());
        let visible = visible_pending(Some(&turn.view.turn), self.open, messages);
        ChatTurn {
            stoppable: turn.run.is_some()
                && turn.view.turn.phase == TurnPhase::Streaming
                && !turn.view.is_finished(),
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

/// One persisted message as the transcript renders it.
#[must_use]
pub fn chat_message(message: &ExploreMessage) -> ChatMessage {
    ChatMessage {
        id: message.id,
        role: match message.role {
            MessageRole::User => ChatRole::User,
            MessageRole::Assistant => ChatRole::Assistant,
        },
        content: message.content.clone(),
        tools: message.trace.iter().map(tool_step).collect(),
        caveats: message.caveats.clone(),
    }
}

/// A transcript as the window renders it.
#[must_use]
pub fn chat_transcript(transcript: &Transcript) -> ChatTranscript {
    ChatTranscript {
        conversation_id: transcript.conversation.id,
        title: transcript.conversation.title.clone(),
        messages: transcript.messages.iter().map(chat_message).collect(),
    }
}

#[cfg(test)]
mod tests {
    use scout_client_core::desktop_api::{
        ActiveRun, ConversationListResponse, DesktopApiErrorCode, RunOutcome,
    };
    use scout_desktop_ipc::{ChatAvailability, ChatToolStatus};
    use uuid::Uuid;

    use super::{ChatSession, MAX_QUESTION_CHARS};
    use crate::error::{ExploreClientError, Refusal};
    use crate::model::StreamEvent;
    use crate::stream::{StreamEnd, StreamSignal};

    type TestResult = Result<(), Box<dyn std::error::Error>>;

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
