//! The golden desktop fixtures played through a [`ChatSession`], so the
//! window's view-model and render tests start from the same frames the
//! server's contract tests send. Built only with the `golden` feature.
//!
//! The run: the owner opens a blank conversation, asks [`QUESTION`], and the
//! golden `runs/stream` body answers it. [`streaming`] stops before `final`;
//! [`settled`] plays the rest (without the golden `error` frame, which
//! [`interrupted`] keeps) and lands the persisted answer with its tool steps.
//!
//! [`visuals`] opens the golden visuals transcript instead: a bar chart, a
//! native table, a match card and a loadout card, with card art resolved
//! against trimmed Data Dragon documents ([`data_dragon`]).

use scout_client_core::desktop_api::{
    ActiveRun, ConversationListResponse, ModelsResponse, RunOutcome,
};
use serde_json::{Value, json};
use uuid::Uuid;

use crate::data_dragon::{DataDragon, DataDragonError};
use crate::model::{Attachment, AttachmentMediaType, RunStreamFrames, StreamEvent, Transcript};
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

/// The golden transcript with a chart, a native table and both cards.
pub const CONVERSATIONS_GET_VISUALS: &str = include_str!(
    "../../../../data/src/scout-client/desktop-fixtures/explore-conversations-get-visuals.json"
);
/// The Data Dragon version the golden `explore/assets` answer names.
pub const DATA_DRAGON_VERSION: &str = "16.22.1";

/// `champion.json`, trimmed to the champions in the visuals transcript.
const CHAMPIONS: &str = r#"{ "data": {
    "Jinx": { "id": "Jinx", "key": "222" },
    "Lulu": { "id": "Lulu", "key": "117" },
    "Ahri": { "id": "Ahri", "key": "103" },
    "Garen": { "id": "Garen", "key": "86" },
    "LeeSin": { "id": "LeeSin", "key": "64" },
    "Caitlyn": { "id": "Caitlyn", "key": "51" },
    "Thresh": { "id": "Thresh", "key": "412" },
    "Yasuo": { "id": "Yasuo", "key": "157" },
    "Darius": { "id": "Darius", "key": "122" },
    "Khazix": { "id": "Khazix", "key": "121" }
} }"#;

/// `runesReforged.json`, trimmed to the runes in the visuals transcript.
const RUNES: &str = r#"[
    { "id": 8200, "icon": "perk-images/Styles/7202_Sorcery.png", "slots": [
        { "runes": [{ "id": 8229, "icon": "perk-images/Styles/Sorcery/ArcaneComet/ArcaneComet.png" }] },
        { "runes": [{ "id": 8226, "icon": "perk-images/Styles/Sorcery/ManaflowBand/ManaflowBand.png" }] },
        { "runes": [{ "id": 8210, "icon": "perk-images/Styles/Sorcery/Transcendence/Transcendence.png" }] },
        { "runes": [{ "id": 8237, "icon": "perk-images/Styles/Sorcery/Scorch/Scorch.png" }] }
    ] },
    { "id": 8300, "icon": "perk-images/Styles/7203_Whimsy.png", "slots": [
        { "runes": [{ "id": 8304, "icon": "perk-images/Styles/Inspiration/MagicalFootwear/MagicalFootwear.png" }] },
        { "runes": [{ "id": 8345, "icon": "perk-images/Styles/Inspiration/BiscuitDelivery/BiscuitDelivery.png" }] }
    ] }
]"#;

/// Card art for the visuals transcript at [`DATA_DRAGON_VERSION`].
///
/// # Errors
/// The trimmed documents do not parse.
pub fn data_dragon() -> Result<DataDragon, DataDragonError> {
    DataDragon::from_documents(DATA_DRAGON_VERSION, CHAMPIONS.as_bytes(), RUNES.as_bytes())
}

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

/// A session showing the golden visuals transcript with its card art
/// resolved; every picture is still loading.
///
/// # Errors
/// A golden file does not parse.
pub fn visuals() -> Result<ChatSession, GoldenError> {
    let transcript: Transcript = serde_json::from_value(response(CONVERSATIONS_GET_VISUALS)?)?;
    let mut session = ready()?;
    session.open(transcript.conversation.id);
    session.opened(transcript);
    session.art_loaded(data_dragon()?);
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

/// The golden model list, as `explore/models` answers it with the picker on.
pub const MODELS: &str =
    include_str!("../../../../data/src/scout-client/desktop-fixtures/explore-models.json");

/// The id of the conversation [`branched`] opens.
pub const BRANCHED_CONVERSATION: Uuid = Uuid::from_u128(0x7c3e_5a91_2b64_4d0f_8e17_5a9c_4b2d_6f30);
/// The edited question of [`branched`], the second of its three versions.
pub const BRANCHED_QUESTION: Uuid = Uuid::from_u128(0x0a00_0000_0000_4000_8000_0000_0000_0002);
/// The first version of that question.
pub const BRANCHED_QUESTION_FIRST: Uuid =
    Uuid::from_u128(0x0a00_0000_0000_4000_8000_0000_0000_0001);
/// The third version of that question.
pub const BRANCHED_QUESTION_LAST: Uuid = Uuid::from_u128(0x0a00_0000_0000_4000_8000_0000_0000_0003);
/// The answer to the second version, the first of its two.
pub const BRANCHED_ANSWER: Uuid = Uuid::from_u128(0x0b00_0000_0000_4000_8000_0000_0000_0001);
/// The regenerated version of that answer.
pub const BRANCHED_ANSWER_NEXT: Uuid = Uuid::from_u128(0x0b00_0000_0000_4000_8000_0000_0000_0002);
/// The follow-up question under that answer, which has one version.
pub const BRANCHED_FOLLOW_UP: Uuid = Uuid::from_u128(0x0a00_0000_0000_4000_8000_0000_0000_0010);
/// The answer to the follow-up.
pub const BRANCHED_FOLLOW_UP_ANSWER: Uuid =
    Uuid::from_u128(0x0b00_0000_0000_4000_8000_0000_0000_0010);
/// The share token [`shared`] puts on the conversation.
pub const SHARE_TOKEN: &str = "aaaaaaaabbbbbbbbccccccccdddddddd";

fn models() -> Result<ModelsResponse, GoldenError> {
    Ok(serde_json::from_value(response(MODELS)?)?)
}

/// A conversation whose opening question was edited twice, so it has three
/// versions and this is the second, and whose answer was regenerated once.
///
/// # Errors
/// A golden file does not parse.
pub fn branched_transcript(share_token: Option<&str>) -> Result<Transcript, GoldenError> {
    let created = "2026-11-14T09:12:30.000Z";
    Ok(serde_json::from_value(json!({
        "conversation": {
            "id": BRANCHED_CONVERSATION,
            "title": "Best ADC pair this week",
            "preferredModel": null,
            "origin": "desktop",
            "shareToken": share_token,
            "sharedLeafId": share_token.map(|_| BRANCHED_ANSWER),
            "createdAt": created,
            "updatedAt": created,
        },
        "messages": [
            {
                "id": BRANCHED_QUESTION,
                "role": "user",
                "parentId": null,
                "siblingIds": [BRANCHED_QUESTION_FIRST, BRANCHED_QUESTION, BRANCHED_QUESTION_LAST],
                "versionIndex": 1,
                "versionCount": 3,
                "content": "Which bot lane pair wins most in ARAM this month?",
                "createdAt": created,
            },
            {
                "id": BRANCHED_ANSWER,
                "role": "assistant",
                "parentId": BRANCHED_QUESTION,
                "siblingIds": [BRANCHED_ANSWER, BRANCHED_ANSWER_NEXT],
                "versionIndex": 0,
                "versionCount": 2,
                "content": "Jinx and Lulu lead with a 61% win rate.",
                "createdAt": created,
            },
            {
                "id": BRANCHED_FOLLOW_UP,
                "role": "user",
                "parentId": BRANCHED_ANSWER,
                "siblingIds": [BRANCHED_FOLLOW_UP],
                "versionIndex": 0,
                "versionCount": 1,
                "content": "And on Summoner's Rift?",
                "createdAt": created,
            },
            {
                "id": BRANCHED_FOLLOW_UP_ANSWER,
                "role": "assistant",
                "parentId": BRANCHED_FOLLOW_UP,
                "siblingIds": [BRANCHED_FOLLOW_UP_ANSWER],
                "versionIndex": 0,
                "versionCount": 1,
                "content": "Jinx and Lulu stay on top at 54%.",
                "createdAt": created,
            },
        ],
    }))?)
}

/// The conversation [`branched_transcript`] describes, open on screen.
///
/// # Errors
/// A golden file does not parse.
pub fn branched() -> Result<ChatSession, GoldenError> {
    let mut session = ready()?;
    session.models_loaded(models()?);
    session.open(BRANCHED_CONVERSATION);
    session.opened(branched_transcript(None)?);
    Ok(session)
}

/// The first two messages of [`branched`]: the edited question with its
/// versions and the answer with its own, short enough to show whole.
fn compact_transcript(share_token: Option<&str>) -> Result<Transcript, GoldenError> {
    let mut transcript = branched_transcript(share_token)?;
    transcript.messages.truncate(2);
    Ok(transcript)
}

/// [`branched`] without its follow-up, so the version switcher on the
/// opening question is on screen.
///
/// # Errors
/// A golden file does not parse.
pub fn versioned() -> Result<ChatSession, GoldenError> {
    let mut session = branched()?;
    session.opened(compact_transcript(None)?);
    Ok(session)
}

/// [`versioned`], with its share link created.
///
/// # Errors
/// A golden file does not parse.
pub fn shared() -> Result<ChatSession, GoldenError> {
    let mut session = branched()?;
    session.opened(compact_transcript(Some(SHARE_TOKEN))?);
    Ok(session)
}

/// A blank conversation with two images attached and uploaded, and the model
/// picker on. The files are the thumbnails the composer draws.
///
/// # Errors
/// A golden file does not parse, or the session refused an image.
pub fn composing(first: &str, second: &str) -> Result<ChatSession, GoldenError> {
    let mut session = ready()?;
    session.models_loaded(models()?);
    session.start_new();
    for (path, id) in [
        (first, Uuid::from_u128(0xa1)),
        (second, Uuid::from_u128(0xa2)),
    ] {
        let job = session
            .begin_attach(path)
            .ok_or("a ready session refused an image")?;
        session.upload_finished(
            job.key,
            Ok(Attachment {
                id,
                media_type: AttachmentMediaType::Png,
            }),
        );
    }
    Ok(session)
}
