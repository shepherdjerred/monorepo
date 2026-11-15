//! The golden desktop fixtures played through a [`ChatSession`], so the
//! window's view-model and render tests start from the same frames the
//! server's contract tests send. Built only with the `golden` feature.
//!
//! The run: the owner opens a blank conversation, asks [`QUESTION`], and the
//! golden `runs/stream` body answers it. [`streaming`] stops before `final`;
//! [`settled`] plays the rest (without the golden `error` frame, which
//! [`interrupted`] keeps) and lands the persisted answer with its tool steps.

use scout_client_core::desktop_api::{ActiveRun, ConversationListResponse, RunOutcome};
use serde_json::{Value, json};

use crate::model::{RunStreamFrames, StreamEvent, Transcript};
use crate::reducer::PendingTurn;
use crate::session::ChatSession;
use crate::stream::{StreamEnd, StreamSignal};

/// The golden conversation list.
pub const CONVERSATIONS_LIST: &str = include_str!(
    "../../../../data/src/scout-client/desktop-fixtures/explore-conversations-list.json"
);
/// The golden transcript.
pub const CONVERSATIONS_GET: &str = include_str!(
    "../../../../data/src/scout-client/desktop-fixtures/explore-conversations-get.json"
);
/// The golden run stream.
pub const RUNS_STREAM: &str =
    include_str!("../../../../data/src/scout-client/desktop-fixtures/explore-runs-stream.json");

/// What the owner asks in the golden run.
pub const QUESTION: &str = "Which bot lane pair wins most in ARAM this month?";

/// A fixture that failed to parse: the golden files and these types disagree.
pub type GoldenError = Box<dyn std::error::Error>;

fn response(fixture: &str) -> Result<Value, GoldenError> {
    let fixture: Value = serde_json::from_str(fixture)?;
    Ok(fixture["response"].clone())
}

fn frames() -> Result<Vec<StreamEvent>, GoldenError> {
    let frames: RunStreamFrames = serde_json::from_value(response(RUNS_STREAM)?)?;
    Ok(frames.events)
}

/// A session that has listed the golden conversations.
///
/// # Errors
/// The golden list does not parse.
pub fn ready() -> Result<ChatSession, GoldenError> {
    let list: ConversationListResponse = serde_json::from_value(response(CONVERSATIONS_LIST)?)?;
    let mut session = ChatSession::new();
    session.listed(list);
    Ok(session)
}

/// The golden transcript, as `conversations/get` answers it.
///
/// # Errors
/// The golden transcript does not parse.
pub fn transcript() -> Result<Transcript, GoldenError> {
    Ok(serde_json::from_value(response(CONVERSATIONS_GET)?)?)
}

/// The run `runs/start` answers for [`QUESTION`]: the golden snapshot's ids.
fn active_run(events: &[StreamEvent]) -> Result<ActiveRun, GoldenError> {
    match events.first() {
        Some(StreamEvent::Snapshot {
            run_id,
            conversation_id,
            question_message_id,
            leaf_id_at_start,
            version_count_at_start,
            started_at,
            ..
        }) => Ok(ActiveRun {
            run_id: *run_id,
            conversation_id: *conversation_id,
            question_message_id: *question_message_id,
            leaf_id_at_start: *leaf_id_at_start,
            version_count_at_start: *version_count_at_start,
            started_at: *started_at,
        }),
        other => Err(format!("the golden stream opens with {other:?}").into()),
    }
}

/// The golden run, streamed up to (not including) `final`.
///
/// # Errors
/// A golden file does not parse, or the session refused the question.
pub fn streaming() -> Result<ChatSession, GoldenError> {
    let events = frames()?;
    let mut session = ready()?;
    session.start_new();
    session
        .submit(QUESTION)
        .ok_or("a ready session refused the golden question")?;
    session.started(active_run(&events)?);
    for event in events
        .into_iter()
        .take_while(|event| !matches!(event, StreamEvent::Final { .. }))
    {
        session.signal(&StreamSignal::Event(Box::new(event)));
    }
    Ok(session)
}

/// What `conversations/get` answers once the golden run has landed: the
/// question, and the final answer with the tool steps the run streamed.
fn landed(events: &[StreamEvent]) -> Result<Transcript, GoldenError> {
    let run = active_run(events)?;
    // The steps as the reducer folded them before `final`; the golden final
    // frame carries none, and a persisted answer keeps its steps.
    let streamed = events
        .iter()
        .take_while(|event| !matches!(event, StreamEvent::Final { .. }))
        .fold(PendingTurn::new(None, None, None), PendingTurn::apply);
    let answer = events
        .iter()
        .find_map(|event| match event {
            StreamEvent::Final { message, .. } => Some(message),
            _ => None,
        })
        .ok_or("the golden stream has no final")?;
    let mut answer = serde_json::to_value(answer)?;
    answer["trace"] = serde_json::to_value(&streamed.trace)?;
    let list = response(CONVERSATIONS_LIST)?;
    let header = list["conversations"]
        .as_array()
        .and_then(|conversations| {
            conversations
                .iter()
                .find(|conversation| conversation["id"] == json!(run.conversation_id))
        })
        .ok_or("the golden list does not hold the run's conversation")?;
    Ok(serde_json::from_value(json!({
        "conversation": {
            "id": header["id"],
            "title": header["title"],
            "preferredModel": null,
            "origin": header["origin"],
            "shareToken": null,
            "sharedLeafId": null,
            "createdAt": header["createdAt"],
            "updatedAt": header["updatedAt"],
        },
        "messages": [
            {
                "id": run.question_message_id,
                "role": "user",
                "content": QUESTION,
                "createdAt": run.started_at,
            },
            answer,
        ],
    }))?)
}

fn finish(keep_error: bool) -> Result<ChatSession, GoldenError> {
    let events = frames()?;
    let mut session = streaming()?;
    for event in events
        .iter()
        .skip_while(|event| !matches!(event, StreamEvent::Final { .. }))
        .filter(|event| keep_error || !matches!(event, StreamEvent::Error { .. }))
    {
        session.signal(&StreamSignal::Event(Box::new(event.clone())));
    }
    session
        .stream_ended(Ok(StreamEnd::Done(RunOutcome::Succeeded)))
        .ok_or("the golden run did not ask for its transcript")?;
    session.settled(landed(&events)?);
    Ok(session)
}

/// The golden run, landed in its transcript.
///
/// # Errors
/// A golden file does not parse, or the run did not settle.
pub fn settled() -> Result<ChatSession, GoldenError> {
    finish(false)
}

/// The golden run with its `error` frame: landed, with the error as a notice.
///
/// # Errors
/// A golden file does not parse, or the run did not settle.
pub fn interrupted() -> Result<ChatSession, GoldenError> {
    finish(true)
}
