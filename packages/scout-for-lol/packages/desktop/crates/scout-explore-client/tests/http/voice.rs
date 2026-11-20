//! `coach/voice/turns` against a scripted server: the golden upload, the
//! golden event stream, a refusal before the stream opens, and a stream that
//! ends early.

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD;
use futures_util::StreamExt;
use scout_client_core::coach_context::GameContext;
use scout_client_core::desktop_api::DesktopApiErrorCode;
use scout_explore_client::PlayerAuthored;
use scout_explore_client::contract::{
    CONTRACT_HEADER, CONTRACT_VERSION, Route, VOICE_MAX_DURATION_MS, VOICE_SAMPLE_RATE_HZ,
    VOICE_TURN_ERROR_CODES, VOICE_TURN_EVENT_TYPES,
};
use scout_explore_client::voice::{
    Utterance, UtteranceError, VoiceStreamError, VoiceTrigger, VoiceTurnErrorCode, VoiceTurnEvent,
    VoiceTurnEvents, VoiceTurnOutcome, VoiceTurnRequest,
};
use scout_explore_client::{ExploreClientError, Recovery};
use serde_json::{Value, json};
use uuid::Uuid;

use crate::support::{MockServer, Reply, TOKEN, TestResult};

const FIXTURE: &str =
    include_str!("../../../../../data/src/scout-client/desktop-fixtures/coach-voice-turns.json");

fn golden() -> Result<Value, serde_json::Error> {
    serde_json::from_str(FIXTURE)
}

fn golden_utterance(fixture: &Value) -> Result<Utterance, Box<dyn std::error::Error>> {
    let wav = STANDARD.decode(
        fixture["request"]["audio"]["base64"]
            .as_str()
            .ok_or("golden audio")?,
    )?;
    Ok(Utterance::from_wav(wav)?)
}

/// The golden recording as voice capture hands it over.
fn spoken(fixture: &Value) -> Result<PlayerAuthored<Utterance>, Box<dyn std::error::Error>> {
    Ok(PlayerAuthored::from_voice_capture(golden_utterance(
        fixture,
    )?))
}

/// A canonical mono 16-bit WAV of `samples` samples at `rate`.
fn wav(samples: u32, rate: u32) -> Vec<u8> {
    let data = samples * 2;
    let mut bytes = Vec::new();
    bytes.extend_from_slice(b"RIFF");
    bytes.extend_from_slice(&(36 + data).to_le_bytes());
    bytes.extend_from_slice(b"WAVEfmt ");
    bytes.extend_from_slice(&16_u32.to_le_bytes());
    bytes.extend_from_slice(&1_u16.to_le_bytes());
    bytes.extend_from_slice(&1_u16.to_le_bytes());
    bytes.extend_from_slice(&rate.to_le_bytes());
    bytes.extend_from_slice(&(rate * 2).to_le_bytes());
    bytes.extend_from_slice(&2_u16.to_le_bytes());
    bytes.extend_from_slice(&16_u16.to_le_bytes());
    bytes.extend_from_slice(b"data");
    bytes.extend_from_slice(&data.to_le_bytes());
    bytes.resize(bytes.len() + usize::try_from(data).unwrap_or(0), 0);
    bytes
}

async fn collect(mut events: VoiceTurnEvents) -> Vec<Result<VoiceTurnEvent, VoiceStreamError>> {
    let mut all = Vec::new();
    while let Some(event) = events.next().await {
        all.push(event);
    }
    all
}

#[test]
fn the_golden_request_and_events_parse_strictly() -> TestResult {
    let fixture = golden()?;
    assert_eq!(fixture["route"], Route::CoachVoiceTurns.name());
    let request: VoiceTurnRequest = serde_json::from_value(fixture["request"].clone())?;
    // Typed, so a float the JSON wrote as 64 compares equal to 64.0.
    let again: VoiceTurnRequest = serde_json::from_value(serde_json::to_value(&request)?)?;
    assert_eq!(again, request);
    for case in fixture["invalidRequests"].as_array().ok_or("invalid")? {
        assert!(
            serde_json::from_value::<VoiceTurnRequest>(case["body"].clone()).is_err(),
            "must refuse {}",
            case["reason"]
        );
    }
    let events: Vec<VoiceTurnEvent> =
        serde_json::from_value(fixture["response"]["events"].clone())?;
    assert_eq!(
        serde_json::to_value(&events)?,
        fixture["response"]["events"]
    );
    let kinds: Vec<&str> = events.iter().map(VoiceTurnEvent::kind).collect();
    assert_eq!(kinds, VOICE_TURN_EVENT_TYPES);
    for refusal in fixture["refusals"].as_array().ok_or("refusals")? {
        let events: Vec<VoiceTurnEvent> = serde_json::from_value(refusal["events"].clone())?;
        assert_eq!(
            events.last(),
            Some(&VoiceTurnEvent::Done {
                outcome: VoiceTurnOutcome::Refused
            }),
            "{}",
            refusal["flow"]
        );
    }
    Ok(())
}

#[test]
fn every_contract_refusal_code_is_a_variant() -> TestResult {
    for code in VOICE_TURN_ERROR_CODES {
        let parsed: VoiceTurnErrorCode = serde_json::from_value(json!(code))?;
        assert_eq!(serde_json::to_value(parsed)?, json!(code));
    }
    Ok(())
}

#[test]
fn an_utterance_is_checked_before_it_leaves_the_device() -> TestResult {
    let fixture = golden()?;
    assert_eq!(golden_utterance(&fixture)?.duration_ms(), 200);
    let longest = VOICE_MAX_DURATION_MS * VOICE_SAMPLE_RATE_HZ / 1000;
    assert!(Utterance::from_wav(wav(longest, VOICE_SAMPLE_RATE_HZ)).is_ok());
    assert_eq!(
        Utterance::from_wav(wav(longest + 16, VOICE_SAMPLE_RATE_HZ)),
        Err(UtteranceError::TooLong {
            duration_ms: VOICE_MAX_DURATION_MS + 1
        })
    );
    assert_eq!(
        Utterance::from_wav(wav(160, VOICE_SAMPLE_RATE_HZ)),
        Err(UtteranceError::TooShort { duration_ms: 10 })
    );
    assert_eq!(
        Utterance::from_wav(wav(48_000, 48_000)),
        Err(UtteranceError::Format)
    );
    assert_eq!(
        Utterance::from_wav(b"OggS not a wav".to_vec()),
        Err(UtteranceError::NotPlainWav)
    );
    // The recording itself never reaches a log line.
    let debug = format!("{:?}", golden_utterance(&fixture)?);
    assert!(!debug.contains("RIFF") && debug.contains("duration_ms: 200"));
    Ok(())
}

#[tokio::test]
async fn a_voice_turn_uploads_audio_only_and_reads_every_event() -> TestResult {
    let fixture = golden()?;
    let events = fixture["response"]["events"]
        .as_array()
        .ok_or("events")?
        .clone();
    let server = MockServer::start(vec![(
        Route::CoachVoiceTurns.path(),
        vec![Reply::stream(&events)],
    )])
    .await?;
    let context: GameContext = serde_json::from_value(fixture["request"]["gameContext"].clone())?;
    let conversation = Uuid::parse_str(
        fixture["request"]["conversationId"]
            .as_str()
            .ok_or("conversation")?,
    )?;

    let stream = server
        .client()?
        .start_voice_turn(
            &spoken(&fixture)?,
            VoiceTrigger::WakeWord,
            Some(conversation),
            Some(context),
        )
        .await?;
    let received = collect(stream).await;

    let parsed: Vec<VoiceTurnEvent> = serde_json::from_value(Value::Array(events))?;
    assert_eq!(received.into_iter().collect::<Result<Vec<_>, _>>()?, parsed);
    let [request] = server
        .requests_to(Route::CoachVoiceTurns.path())
        .try_into()
        .map_err(|_| "one request")?;
    assert_eq!(
        request.headers.get("authorization").map(String::as_str),
        Some(format!("Bearer {TOKEN}").as_str())
    );
    assert_eq!(
        request
            .headers
            .get(&CONTRACT_HEADER.to_ascii_lowercase())
            .map(String::as_str),
        Some(CONTRACT_VERSION.to_string().as_str())
    );
    let body: Value = serde_json::from_str(&request.body)?;
    let sent: VoiceTurnRequest = serde_json::from_value(body.clone())?;
    let golden: VoiceTurnRequest = serde_json::from_value(fixture["request"].clone())?;
    assert_eq!(sent, golden);
    assert!(body.get("question").is_none());
    Ok(())
}

#[tokio::test]
async fn a_refusal_before_the_stream_keeps_its_recovery() -> TestResult {
    let fixture = golden()?;
    let server = MockServer::start(vec![(
        Route::CoachVoiceTurns.path(),
        vec![Reply::json(
            503,
            json!({
                "error": "feature_disabled",
                "message": "Voice answers in Scout Desktop are turned off right now."
            })
            .to_string(),
        )],
    )])
    .await?;

    let result = server
        .client()?
        .start_voice_turn(&spoken(&fixture)?, VoiceTrigger::PushToTalk, None, None)
        .await;

    match result {
        Err(ExploreClientError::Refused(refusal)) => {
            assert_eq!(refusal.code, DesktopApiErrorCode::FeatureDisabled);
            assert_eq!(refusal.recovery(), Recovery::FeatureDisabled);
        }
        Err(other) => return Err(other.into()),
        Ok(_) => return Err("a refused turn must not open a stream".into()),
    }
    Ok(())
}

#[tokio::test]
async fn a_stream_that_closes_before_done_says_so() -> TestResult {
    let fixture = golden()?;
    let first = fixture["response"]["events"][0].clone();
    let server = MockServer::start(vec![(
        Route::CoachVoiceTurns.path(),
        vec![Reply::stream(&[first])],
    )])
    .await?;

    let stream = server
        .client()?
        .start_voice_turn(&spoken(&fixture)?, VoiceTrigger::WakeWord, None, None)
        .await?;
    let received = collect(stream).await;

    assert_eq!(received.len(), 2);
    assert!(matches!(received[0], Ok(VoiceTurnEvent::Transcript { .. })));
    assert!(matches!(received[1], Err(VoiceStreamError::Ended)));
    Ok(())
}
