//! The Explore turn reducer, ported from the web.
//!
//! This is `app/src/lib/explore/explore-turn-state.ts` and
//! `explore-run-completion.ts` in Rust: plain data and pure functions that
//! fold stream events into the in-flight turn and decide when the persisted
//! transcript has caught up with it. Both implementations run the same
//! sequences from `data/src/scout-client/desktop-fixtures/explore-turn-reducer.json`,
//! so a behaviour change on one side fails the other's suite.
//!
//! [`TurnView`] adds what the web keeps in its page hook rather than in the
//! reducer: the error a run reported, its outcome, and the title and quota
//! the final frame carried.

use scout_client_core::desktop_api::{ExploreQuota, RunOutcome};
use serde::Serialize;
use uuid::Uuid;

use crate::model::{
    ExploreMessage, MessageRole, PreviewSummary, StreamEvent, TraceEntry, TraceStatus,
    Visualization,
};

/// Caveat the server writes onto a turn the asker stopped.
pub const STOPPED_CAVEAT: &str = "This answer was stopped before it finished.";
/// Caveat the server writes onto a turn an error interrupted.
pub const INTERRUPTED_CAVEAT: &str = "This answer was interrupted by an error before it finished.";

const THINKING: &str = "Thinking…";
const SAVING_PARTIAL: &str = "Stopped — saving the partial answer…";
const INTERRUPTED_STEP: &str = "Interrupted before this step finished.";

/// Whether the turn is still streaming or being stopped.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TurnPhase {
    /// The answer is arriving.
    Streaming,
    /// The asker stopped it; the partial answer is being saved.
    Stopping,
}

/// One in-flight Explore turn.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingTurn {
    /// None only while `runs/start` is still creating the run.
    pub run_id: Option<Uuid>,
    /// None until `started` arrives for a brand-new conversation.
    pub conversation_id: Option<Uuid>,
    /// From `started`; none until it arrives.
    pub question_message_id: Option<Uuid>,
    /// The optimistic question text; none for a regenerate.
    pub question: Option<String>,
    /// Streamed prose so far; replaced by the final message's content.
    pub answer: Option<String>,
    /// The live status line.
    pub activity: Option<String>,
    /// Tool steps keyed by provider call id, updated in place.
    pub trace: Vec<TraceEntry>,
    /// The newest query result. Last write wins.
    pub preview: Option<PreviewSummary>,
    /// The newest chart. A reconnect restores the table without it.
    pub visualization: Option<Visualization>,
    /// The leaf on screen when the turn began.
    pub leaf_id_at_start: Option<Uuid>,
    /// The persisted answer's id once `final` arrives.
    pub final_message_id: Option<Uuid>,
    /// Streaming or stopping.
    pub phase: TurnPhase,
}

/// Run discovery counts as active work, so a reconnecting conversation cannot
/// submit another turn before the server-owned run has been restored.
#[must_use]
pub const fn turn_is_active(turn: Option<&PendingTurn>, discovery_settled: bool) -> bool {
    turn.is_some() || !discovery_settled
}

impl PendingTurn {
    /// A turn the asker just submitted.
    #[must_use]
    pub fn new(
        conversation_id: Option<Uuid>,
        question: Option<String>,
        leaf_id_at_start: Option<Uuid>,
    ) -> Self {
        Self {
            run_id: None,
            conversation_id,
            question_message_id: None,
            question,
            answer: None,
            activity: Some(THINKING.to_owned()),
            trace: Vec::new(),
            preview: None,
            visualization: None,
            leaf_id_at_start,
            final_message_id: None,
            phase: TurnPhase::Streaming,
        }
    }

    /// Fold one stream event into the turn.
    ///
    /// `final` replaces the streamed prose with the persisted content, which
    /// is what the refetched transcript will show. `error` and `done` change
    /// nothing here: they are page state, which [`TurnView`] keeps.
    #[must_use]
    pub fn apply(mut self, event: &StreamEvent) -> Self {
        match event {
            StreamEvent::Snapshot {
                run_id,
                conversation_id,
                question_message_id,
                leaf_id_at_start,
                answer,
                activity,
                trace,
                ..
            } => {
                self.run_id = Some(*run_id);
                self.conversation_id = Some(*conversation_id);
                self.question_message_id = Some(*question_message_id);
                self.leaf_id_at_start = *leaf_id_at_start;
                self.answer.clone_from(answer);
                self.activity.clone_from(activity);
                self.trace.clone_from(trace);
                // The snapshot carries no result; `run_preview` follows it.
                // Clearing both means a reconnect cannot leave an older run's
                // table, or an earlier query's chart, above newer numbers.
                self.preview = None;
                self.visualization = None;
            }
            StreamEvent::Started {
                run_id,
                conversation_id,
                question_message_id,
            } => {
                self.run_id = Some(*run_id);
                self.conversation_id = Some(*conversation_id);
                self.question_message_id = Some(*question_message_id);
            }
            StreamEvent::Activity { text, .. } => self.activity = Some(text.clone()),
            StreamEvent::ToolCall {
                tool_call_id,
                tool_name,
                message,
                details,
                raw_input,
            } => self.trace.push(TraceEntry {
                tool_call_id: tool_call_id.clone(),
                tool_name: tool_name.clone(),
                message: message.clone(),
                status: TraceStatus::Running,
                duration_ms: None,
                details: details.clone(),
                raw_input: raw_input.clone(),
                raw_output: None,
            }),
            StreamEvent::ToolResult {
                tool_call_id,
                tool_name,
                status,
                message,
                duration_ms,
                details,
                raw_output,
            } => {
                let index = self
                    .trace
                    .iter()
                    .position(|entry| entry.tool_call_id == *tool_call_id);
                let completed = TraceEntry {
                    tool_call_id: tool_call_id.clone(),
                    tool_name: tool_name.clone(),
                    message: message.clone(),
                    status: (*status).into(),
                    duration_ms: *duration_ms,
                    details: details.clone(),
                    raw_input: index.and_then(|index| self.trace[index].raw_input.clone()),
                    raw_output: raw_output.clone(),
                };
                match index {
                    Some(index) => self.trace[index] = completed,
                    None => self.trace.push(completed),
                }
            }
            StreamEvent::AnswerDelta { text } => {
                self.answer.get_or_insert_with(String::new).push_str(text);
            }
            StreamEvent::Final { message, .. } => {
                self.answer = Some(message.content.clone());
                self.final_message_id = Some(message.id);
                self.activity = None;
                self.trace.clone_from(&message.trace);
                // The persisted message owns the result from here on.
                self.preview.clone_from(&message.preview);
                self.visualization.clone_from(&message.visualization);
            }
            StreamEvent::Preview {
                preview,
                visualization,
            } => {
                self.preview = Some(preview.clone());
                self.visualization.clone_from(visualization);
            }
            StreamEvent::RunPreview { preview, .. } => {
                // The reconnect companion: the newest table, with no chart.
                self.preview.clone_from(preview);
                self.visualization = None;
            }
            StreamEvent::Error { .. } | StreamEvent::Done { .. } => {}
        }
        self
    }

    /// Mark a deliberate stop while the partial answer is saved.
    #[must_use]
    pub fn mark_stopping(mut self) -> Self {
        self.phase = TurnPhase::Stopping;
        self.activity = self.answer.as_ref().map(|_| SAVING_PARTIAL.to_owned());
        for entry in &mut self.trace {
            if entry.status == TraceStatus::Running {
                entry.status = TraceStatus::Interrupted;
                INTERRUPTED_STEP.clone_into(&mut entry.message);
            }
        }
        self
    }

    /// Has this turn's question reached the transcript, judged by position:
    /// a user message saying what was rendered optimistically, after the leaf
    /// that was on screen when the turn began?
    ///
    /// The server persists the question before `started` reaches the client,
    /// so an id check alone would render the question twice in that window.
    /// The server trims the question; the composer may not have.
    fn question_row_arrived(&self, messages: &[ExploreMessage]) -> bool {
        let Some(question) = &self.question else {
            return false;
        };
        let start = self
            .leaf_id_at_start
            .and_then(|leaf| messages.iter().position(|message| message.id == leaf));
        let question = question.trim();
        messages.iter().enumerate().any(|(index, message)| {
            start.is_none_or(|start| index > start)
                && message.role == MessageRole::User
                && message.content.trim() == question
        })
    }

    /// Whether the persisted transcript now holds this turn's answer: its
    /// final message, or (after a stop, which gets no `final`) a new answer
    /// under its question that was not already on screen.
    #[must_use]
    pub fn has_landed(&self, messages: &[ExploreMessage]) -> bool {
        if let Some(final_id) = self.final_message_id
            && messages.iter().any(|message| message.id == final_id)
        {
            return true;
        }
        messages.last().is_some_and(|last| {
            last.role == MessageRole::Assistant
                && self.question_message_id.is_some()
                && last.parent_id == self.question_message_id
                && Some(last.id) != self.leaf_id_at_start
        })
    }
}

/// Whether the blank view shows its suggestions: only when nothing at all is
/// in flight.
#[must_use]
pub const fn should_show_suggestions(
    message_count: usize,
    pending_question: Option<&str>,
    pending_turn: Option<&PendingTurn>,
) -> bool {
    message_count == 0 && pending_question.is_none() && pending_turn.is_none()
}

/// What the transcript renders for an in-flight turn.
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VisiblePending {
    /// The optimistic question, until the transcript holds it.
    pub pending_question: Option<String>,
    /// The streamed answer, until the persisted one lands.
    pub pending_answer: Option<String>,
    /// The status line.
    pub activity: Option<String>,
    /// Whether the status describes a deliberate stop.
    pub stopping: bool,
    /// Tool steps.
    pub trace: Vec<TraceEntry>,
    /// The streamed table.
    pub preview: Option<PreviewSummary>,
    /// The streamed chart.
    pub visualization: Option<Visualization>,
}

/// What to render for `turn` while `displayed_conversation_id` is on screen
/// with `messages` persisted.
///
/// Nothing, when the turn belongs to a different opened conversation; a turn
/// whose id was just minted still shows on the blank view. The optimistic
/// question disappears the moment the transcript holds it and the streamed
/// answer once the turn has landed, so no frame shows both copies or neither.
#[must_use]
pub fn visible_pending(
    turn: Option<&PendingTurn>,
    displayed_conversation_id: Option<Uuid>,
    messages: &[ExploreMessage],
) -> VisiblePending {
    let Some(turn) = turn else {
        return VisiblePending::default();
    };
    if let (Some(displayed), Some(own)) = (displayed_conversation_id, turn.conversation_id)
        && displayed != own
    {
        return VisiblePending::default();
    }
    let question_persisted = turn
        .question_message_id
        .is_some_and(|question| messages.iter().any(|message| message.id == question))
        || turn.question_row_arrived(messages);
    if turn.has_landed(messages) {
        return VisiblePending {
            pending_question: (!question_persisted)
                .then(|| turn.question.clone())
                .flatten(),
            ..VisiblePending::default()
        };
    }
    VisiblePending {
        pending_question: (!question_persisted)
            .then(|| turn.question.clone())
            .flatten(),
        pending_answer: turn.answer.clone(),
        activity: turn.activity.clone(),
        stopping: turn.phase == TurnPhase::Stopping,
        trace: turn.trace.clone(),
        preview: turn.preview.clone(),
        visualization: turn.visualization.clone(),
    }
}

/// Where a run's local marker settles once the run ends.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum MarkerState {
    /// The run answered.
    Completed,
    /// The run failed.
    Failed,
}

/// How a finished run resolves against the transcript.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunCompletion {
    /// The marker's settled state; none for a deliberate stop.
    pub marker_state: Option<MarkerState>,
    /// Whether the transcript already shows the run's answer.
    pub answer_visible: bool,
}

/// The answer a run produced, if the transcript shows it: the final message
/// by id, or (without one) the newest version under the question that did
/// not exist when the run began.
#[must_use]
pub fn find_visible_run_answer(
    question_message_id: Uuid,
    version_count_at_start: u32,
    final_message_id: Option<Uuid>,
    messages: &[ExploreMessage],
) -> Option<&ExploreMessage> {
    match final_message_id {
        Some(final_id) => messages.iter().find(|message| message.id == final_id),
        None => messages.iter().find(|message| {
            message.role == MessageRole::Assistant
                && message.parent_id == Some(question_message_id)
                && message.sibling_ids.len() > version_count_at_start as usize
                && message.sibling_ids.last() == Some(&message.id)
        }),
    }
}

/// Settle a finished run: did it answer, fail, or get stopped, and is its
/// answer already on screen?
#[must_use]
pub fn resolve_run_completion(
    question_message_id: Uuid,
    version_count_at_start: u32,
    outcome: RunOutcome,
    final_message_id: Option<Uuid>,
    messages: &[ExploreMessage],
) -> RunCompletion {
    let answer = find_visible_run_answer(
        question_message_id,
        version_count_at_start,
        final_message_id,
        messages,
    );
    let has_caveat = |caveat: &str| {
        answer.is_some_and(|answer| answer.caveats.iter().any(|entry| entry == caveat))
    };
    if has_caveat(INTERRUPTED_CAVEAT) {
        return RunCompletion {
            marker_state: Some(MarkerState::Failed),
            answer_visible: true,
        };
    }
    if outcome == RunOutcome::Stopped || has_caveat(STOPPED_CAVEAT) {
        return RunCompletion {
            marker_state: None,
            answer_visible: answer.is_some(),
        };
    }
    RunCompletion {
        marker_state: Some(if answer.is_some() || outcome == RunOutcome::Succeeded {
            MarkerState::Completed
        } else {
            MarkerState::Failed
        }),
        answer_visible: answer.is_some(),
    }
}

/// Whether a settled run's marker can be dropped: always after a stop, and
/// otherwise once its conversation is on screen showing the answer or the
/// failure.
#[must_use]
pub fn should_clear_run_marker(
    completion: RunCompletion,
    displayed_conversation_id: Option<Uuid>,
    run_conversation_id: Uuid,
) -> bool {
    match completion.marker_state {
        None => true,
        Some(state) => {
            displayed_conversation_id == Some(run_conversation_id)
                && (state == MarkerState::Failed || completion.answer_visible)
        }
    }
}

/// The error a run reported, which outlives the turn on screen.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TurnError {
    /// Why, safe to show.
    pub message: String,
    /// When to try again.
    pub retry_after_seconds: Option<u32>,
}

/// Everything the desktop renders for one followed run: the reducer's turn
/// plus the page state the web keeps beside it.
#[derive(Debug, Clone, PartialEq)]
pub struct TurnView {
    /// The in-flight turn.
    pub turn: PendingTurn,
    /// The error the run reported, if any.
    pub error: Option<TurnError>,
    /// How the run ended, once `done` arrives.
    pub outcome: Option<RunOutcome>,
    /// The conversation title the final frame carried.
    pub title: Option<String>,
    /// The newest quota the run reported.
    pub quota: Option<Vec<ExploreQuota>>,
}

impl TurnView {
    /// A view of a turn the asker just submitted.
    #[must_use]
    pub const fn new(turn: PendingTurn) -> Self {
        Self {
            turn,
            error: None,
            outcome: None,
            title: None,
            quota: None,
        }
    }

    /// Fold one stream event into the view.
    #[must_use]
    pub fn apply(mut self, event: &StreamEvent) -> Self {
        match event {
            StreamEvent::Error {
                message,
                retry_after_seconds,
                quota,
            } => {
                self.error = Some(TurnError {
                    message: message.clone(),
                    retry_after_seconds: *retry_after_seconds,
                });
                if quota.is_some() {
                    self.quota.clone_from(quota);
                }
            }
            StreamEvent::Final { title, quota, .. } => {
                self.title = Some(title.clone());
                self.quota = Some(quota.clone());
            }
            StreamEvent::Done { outcome } => self.outcome = Some(*outcome),
            _ => {}
        }
        self.turn = self.turn.apply(event);
        self
    }

    /// Whether the run has ended.
    #[must_use]
    pub const fn is_finished(&self) -> bool {
        self.outcome.is_some()
    }
}
