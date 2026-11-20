//! The golden desktop fixtures parsed with strict serde, and the turn
//! reducer run over the sequences the web's vitest suite runs too.

use scout_client_core::desktop_api::{ConversationGetRequest, RunOutcome, RunRequest};
use scout_explore_client::contract::STREAM_EVENT_TYPES;
use scout_explore_client::model::{
    ExploreMessage, RunStreamFrames, StreamEvent, TraceDetails, TraceEntry, TraceStatus,
    Transcript, Visualization,
};
use scout_explore_client::reducer::{
    INTERRUPTED_CAVEAT, PendingTurn, STOPPED_CAVEAT, TurnView, resolve_run_completion,
    should_clear_run_marker, should_show_suggestions, turn_is_active, visible_pending,
};
use serde::Serialize;
use serde::de::DeserializeOwned;
use serde_json::{Value, json};
use uuid::Uuid;

type TestResult = Result<(), Box<dyn std::error::Error>>;

const GET: &str = include_str!(
    "../../../../data/src/scout-client/desktop-fixtures/explore-conversations-get.json"
);
const VISUALS: &str = include_str!(
    "../../../../data/src/scout-client/desktop-fixtures/explore-conversations-get-visuals.json"
);
const COACH: &str = include_str!(
    "../../../../data/src/scout-client/desktop-fixtures/explore-conversations-get-coach.json"
);
const RUNS_STREAM: &str =
    include_str!("../../../../data/src/scout-client/desktop-fixtures/explore-runs-stream.json");
const REDUCER: &str =
    include_str!("../../../../data/src/scout-client/desktop-fixtures/explore-turn-reducer.json");

/// Parse strictly, then prove serialising and parsing again is lossless.
fn round_trip<T>(value: &Value) -> TestResult
where
    T: DeserializeOwned + Serialize + PartialEq + std::fmt::Debug,
{
    let typed: T = serde_json::from_value(value.clone())?;
    let again: T = serde_json::from_value(serde_json::to_value(&typed)?)?;
    assert_eq!(typed, again);
    Ok(())
}

fn check_route<Request, Response>(fixture: &str, route: &str) -> TestResult
where
    Request: DeserializeOwned + Serialize + PartialEq + std::fmt::Debug,
    Response: DeserializeOwned + Serialize + PartialEq + std::fmt::Debug,
{
    let fixture: Value = serde_json::from_str(fixture)?;
    assert_eq!(fixture["route"], route);
    round_trip::<Request>(&fixture["request"])?;
    round_trip::<Response>(&fixture["response"])?;
    for case in fixture["invalidRequests"]
        .as_array()
        .ok_or("invalid requests")?
    {
        assert!(
            serde_json::from_value::<Request>(case["body"].clone()).is_err(),
            "{route} must refuse {}",
            case["reason"]
        );
    }
    Ok(())
}

#[test]
fn the_golden_transcript_parses_strictly() -> TestResult {
    check_route::<ConversationGetRequest, Transcript>(GET, "explore_conversations_get")
}

#[test]
fn the_golden_visuals_transcript_parses_strictly() -> TestResult {
    check_route::<ConversationGetRequest, Transcript>(VISUALS, "explore_conversations_get")
}

#[test]
fn the_golden_coach_transcript_parses_strictly_and_carries_its_options() -> TestResult {
    check_route::<ConversationGetRequest, Transcript>(COACH, "explore_conversations_get")?;
    let transcript: Transcript =
        serde_json::from_value(serde_json::from_str::<Value>(COACH)?["response"].clone())?;
    let labels: Vec<&str> = transcript
        .messages
        .iter()
        .filter_map(|message| message.coach_options.as_ref())
        .flatten()
        .map(|option| option.label.as_str())
        .collect();
    assert_eq!(labels, ["Ornn", "Orianna", "Ahri"]);
    Ok(())
}

#[test]
fn a_message_from_a_server_before_contract_7_has_no_options() -> TestResult {
    // A server below contract 7 never sends the key; it reads as none.
    let mut get: Value = serde_json::from_str(GET)?;
    let message = get["response"]["messages"][1].clone();
    assert!(message.get("coachOptions").is_some());
    get["response"]["messages"][1]
        .as_object_mut()
        .ok_or("message")?
        .remove("coachOptions");
    let parsed: ExploreMessage = serde_json::from_value(get["response"]["messages"][1].clone())?;
    assert_eq!(parsed.coach_options, None);
    Ok(())
}

#[test]
fn the_final_stream_frame_never_carries_options() -> TestResult {
    let stream: Value = serde_json::from_str(RUNS_STREAM)?;
    let mut final_frame = stream["response"]["events"][8].clone();
    final_frame["message"]["coachOptions"] = json!([]);
    assert!(serde_json::from_value::<StreamEvent>(final_frame).is_err());
    Ok(())
}

#[test]
fn the_golden_stream_parses_strictly() -> TestResult {
    check_route::<RunRequest, RunStreamFrames>(RUNS_STREAM, "explore_runs_stream")
}

#[test]
fn the_golden_stream_has_exactly_one_frame_per_contract_event() -> TestResult {
    let fixture: Value = serde_json::from_str(RUNS_STREAM)?;
    let frames: RunStreamFrames = serde_json::from_value(fixture["response"].clone())?;
    let kinds: Vec<&str> = frames.events.iter().map(StreamEvent::kind).collect();
    assert_eq!(kinds, STREAM_EVENT_TYPES);
    for (event, raw) in frames
        .events
        .iter()
        .zip(fixture["response"]["events"].as_array().ok_or("events")?)
    {
        assert_eq!(Value::from(event.kind()), raw["type"]);
    }
    Ok(())
}

#[test]
fn every_message_and_event_refuses_an_unknown_field() -> TestResult {
    let get: Value = serde_json::from_str(GET)?;
    let mut message = get["response"]["messages"][1].clone();
    message["extra"] = json!(1);
    assert!(serde_json::from_value::<ExploreMessage>(message).is_err());

    let stream: Value = serde_json::from_str(RUNS_STREAM)?;
    for raw in stream["response"]["events"].as_array().ok_or("events")? {
        let mut tampered = raw.clone();
        tampered["extra"] = json!(1);
        assert!(
            serde_json::from_value::<StreamEvent>(tampered).is_err(),
            "{} must refuse an unknown key",
            raw["type"]
        );
    }
    // The final frame carries the pre-card message shape only.
    let mut final_frame = stream["response"]["events"][8].clone();
    final_frame["message"]["matchCards"] = json!([]);
    assert!(serde_json::from_value::<StreamEvent>(final_frame).is_err());
    Ok(())
}

#[test]
fn a_legacy_trace_entry_is_upgraded_on_read() -> TestResult {
    let entry: TraceEntry = serde_json::from_value(json!({
        "toolName": "run_report_query",
        "message": "Ran the query.",
        "ok": false
    }))?;
    assert_eq!(entry.tool_call_id, "legacy-run_report_query");
    assert_eq!(entry.status, TraceStatus::Failed);
    assert!(
        serde_json::from_value::<TraceEntry>(json!({
            "toolName": "run_report_query",
            "message": "Ran the query.",
            "ok": false,
            "extra": 1
        }))
        .is_err()
    );
    Ok(())
}

#[test]
fn every_trace_detail_kind_parses_strictly() -> TestResult {
    for details in [
        json!({ "kind": "reference", "columns": 41, "idioms": null }),
        json!({ "kind": "reference", "metrics": 12, "groupBys": 4, "filters": 9 }),
        json!({
            "kind": "validation",
            "queryText": "FROM matches SELECT games",
            "ok": false,
            "diagnostics": ["Unknown column wins."],
            "formattedQueryText": null
        }),
        json!({ "kind": "format", "queryText": "FROM matches", "formattedQueryText": "FROM matches" }),
    ] {
        round_trip::<TraceDetails>(&details)?;
        let mut tampered = details.clone();
        tampered["extra"] = json!(1);
        assert!(
            serde_json::from_value::<TraceDetails>(tampered).is_err(),
            "{details}"
        );
    }
    Ok(())
}

#[test]
fn a_visualization_must_be_a_version_one_snapshot() {
    let message = |visualization: Value| {
        json!({
            "id": "9b2e4c7d-1f53-4a8b-9d66-8f3c2e5b0a12",
            "role": "assistant",
            "content": "Jinx.",
            "visualization": visualization,
            "createdAt": "2026-11-13T20:03:40.000Z"
        })
    };
    let snapshot = |version: u32| {
        json!({
            "version": version,
            "kind": "BAR_CHART",
            "title": null,
            "display": { "sparkline": false },
        })
    };
    let parsed = serde_json::from_value::<ExploreMessage>(message(snapshot(1)));
    let chart = parsed.ok().and_then(|message| message.visualization);
    assert_eq!(chart.as_ref().map(Visualization::kind), Some("BAR_CHART"));
    assert_eq!(chart.as_ref().and_then(|chart| chart.title()), None);
    assert!(serde_json::from_value::<ExploreMessage>(message(snapshot(2))).is_err());
    assert!(serde_json::from_value::<ExploreMessage>(message(json!([1]))).is_err());
    // The client reads the kind, title and sparkline flag, so it refuses a
    // snapshot that does not state them.
    for missing in ["kind", "title", "display"] {
        let mut incomplete = snapshot(1);
        if let Some(fields) = incomplete.as_object_mut() {
            fields.remove(missing);
        }
        assert!(
            serde_json::from_value::<ExploreMessage>(message(incomplete)).is_err(),
            "{missing}"
        );
    }
}

/// `toMatchObject` semantics: objects match on the expected keys, arrays
/// element by element at equal length, everything else exactly.
fn matches_subset(actual: &Value, expected: &Value, path: &str) -> Result<(), String> {
    match (actual, expected) {
        (Value::Object(actual), Value::Object(expected)) => {
            for (key, value) in expected {
                let actual = actual.get(key).unwrap_or(&Value::Null);
                matches_subset(actual, value, &format!("{path}.{key}"))?;
            }
            Ok(())
        }
        (Value::Array(actual), Value::Array(expected)) => {
            if actual.len() != expected.len() {
                return Err(format!(
                    "{path}: {} items, expected {}",
                    actual.len(),
                    expected.len()
                ));
            }
            for (index, (actual, expected)) in actual.iter().zip(expected).enumerate() {
                matches_subset(actual, expected, &format!("{path}[{index}]"))?;
            }
            Ok(())
        }
        (Value::Number(actual), Value::Number(expected))
            if actual.as_f64() == expected.as_f64() =>
        {
            Ok(())
        }
        _ if actual == expected => Ok(()),
        _ => Err(format!("{path}: got {actual}, expected {expected}")),
    }
}

fn uuid(value: &Value) -> Result<Option<Uuid>, uuid::Error> {
    value.as_str().map(Uuid::parse_str).transpose()
}

fn messages(value: &Value) -> Result<Vec<ExploreMessage>, serde_json::Error> {
    serde_json::from_value(value.clone())
}

fn check_turn(case: &Value) -> TestResult {
    let start = &case["start"];
    let mut turn = PendingTurn::new(
        uuid(&start["conversationId"])?,
        start["question"].as_str().map(str::to_owned),
        uuid(&start["leafIdAtStart"])?,
    );
    for step in case["steps"].as_array().ok_or("steps")? {
        turn = if step["markStopping"] == json!(true) {
            turn.mark_stopping()
        } else {
            let event: StreamEvent = serde_json::from_value(step["event"].clone())?;
            turn.apply(&event)
        };
        if let Some(expected) = step.get("expectTurn") {
            matches_subset(&serde_json::to_value(&turn)?, expected, "turn")?;
        }
    }
    if let Some(expected) = case.get("expectTurn") {
        matches_subset(&serde_json::to_value(&turn)?, expected, "turn")?;
    }
    for check in case["visible"].as_array().into_iter().flatten() {
        let visible = visible_pending(
            Some(&turn),
            uuid(&check["displayedConversationId"])?,
            &messages(&check["messages"])?,
        );
        matches_subset(
            &serde_json::to_value(&visible)?,
            &check["expect"],
            "visible",
        )?;
    }
    for check in case["landed"].as_array().into_iter().flatten() {
        let landed = turn.has_landed(&messages(&check["messages"])?);
        if check["expect"] != landed {
            return Err(format!("landed: got {landed}").into());
        }
    }
    Ok(())
}

fn check_completion(case: &Value) -> TestResult {
    let outcome: RunOutcome = serde_json::from_value(case["outcome"].clone())?;
    let version_count = u32::try_from(
        case["run"]["versionCountAtStart"]
            .as_u64()
            .ok_or("versionCountAtStart")?,
    )?;
    let completion = resolve_run_completion(
        uuid(&case["run"]["questionMessageId"])?.ok_or("questionMessageId")?,
        version_count,
        outcome,
        uuid(&case["finalMessageId"])?,
        &messages(&case["messages"])?,
    );
    matches_subset(
        &serde_json::to_value(completion)?,
        &case["expect"],
        "completion",
    )?;
    if let Some(clear) = case.get("clear") {
        let cleared = should_clear_run_marker(
            completion,
            uuid(&clear["displayedConversationId"])?,
            uuid(&clear["runConversationId"])?.ok_or("runConversationId")?,
        );
        if clear["expect"] != cleared {
            return Err(format!("clear: got {cleared}").into());
        }
    }
    Ok(())
}

#[test]
fn the_shared_reducer_sequences_pass() -> TestResult {
    let fixture: Value = serde_json::from_str(REDUCER)?;
    assert_eq!(fixture["caveats"]["stopped"], STOPPED_CAVEAT);
    assert_eq!(fixture["caveats"]["interrupted"], INTERRUPTED_CAVEAT);
    let turns = fixture["turns"].as_array().ok_or("turns")?;
    let completions = fixture["completions"].as_array().ok_or("completions")?;
    assert!(!turns.is_empty() && !completions.is_empty());
    let mut failures = Vec::new();
    for case in turns {
        if let Err(error) = check_turn(case) {
            failures.push(format!("{}: {error}", case["name"]));
        }
    }
    for case in completions {
        if let Err(error) = check_completion(case) {
            failures.push(format!("{}: {error}", case["name"]));
        }
    }
    assert!(failures.is_empty(), "{failures:#?}");
    Ok(())
}

#[test]
fn discovery_and_suggestions_follow_the_web() {
    let turn = PendingTurn::new(None, Some("Who wins?".to_owned()), None);
    assert!(turn_is_active(None, false));
    assert!(!turn_is_active(None, true));
    assert!(turn_is_active(Some(&turn), true));
    assert!(!should_show_suggestions(0, None, Some(&turn)));
    assert!(should_show_suggestions(0, None, None));
    assert!(!should_show_suggestions(0, Some("Who wins?"), None));
}

#[test]
fn the_view_keeps_error_title_quota_and_outcome() -> TestResult {
    let stream: Value = serde_json::from_str(RUNS_STREAM)?;
    let frames: RunStreamFrames = serde_json::from_value(stream["response"].clone())?;
    let view = frames.events.iter().fold(
        TurnView::new(PendingTurn::new(
            None,
            Some("Best ADC pair?".to_owned()),
            None,
        )),
        TurnView::apply,
    );
    assert_eq!(view.outcome, Some(RunOutcome::Succeeded));
    assert!(view.is_finished());
    assert_eq!(view.title.as_deref(), Some("Best ADC pair this week"));
    assert_eq!(view.quota.as_ref().map(Vec::len), Some(1));
    assert_eq!(
        view.error.as_ref().map(|error| error.message.as_str()),
        Some("Explore could not finish this answer.")
    );
    assert_eq!(
        view.turn.answer.as_deref(),
        Some("Jinx and Lulu lead with a 61% win rate.")
    );
    assert_eq!(
        view.turn.final_message_id,
        Some(Uuid::parse_str("9b2e4c7d-1f53-4a8b-9d66-8f3c2e5b0a12")?)
    );
    Ok(())
}
