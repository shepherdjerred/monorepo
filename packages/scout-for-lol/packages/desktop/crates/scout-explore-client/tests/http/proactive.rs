//! `coach/triggers` against a scripted server, the way the chat relay asks:
//! a detection posts once, and every answer but a started turn stops later
//! posts for the game. Beta profile only; a stable build has no sender.

use scout_client_core::desktop_api::CoachTriggerRequest;
use scout_explore_client::ExploreClient;
use scout_explore_client::contract::{CONTRACT_HEADER, CONTRACT_VERSION, Route};
use scout_explore_client::proactive::{TriggerGate, TriggerVerdict};
use serde_json::{Value, json};

use crate::support::{MockServer, Reply, TOKEN, TestResult};

const FIXTURE: &str =
    include_str!("../../../../../data/src/scout-client/desktop-fixtures/coach-triggers.json");

fn golden() -> Result<Value, serde_json::Error> {
    serde_json::from_str(FIXTURE)
}

fn golden_request(fixture: &Value) -> Result<CoachTriggerRequest, serde_json::Error> {
    serde_json::from_value(fixture["request"].clone())
}

/// What the relay does for one detection: ask unless the gate says no, and
/// record the answer.
async fn ask(
    gate: &mut TriggerGate,
    client: &ExploreClient,
    request: &CoachTriggerRequest,
) -> Option<TriggerVerdict> {
    if !gate.admits(&request.game_key) {
        return None;
    }
    let verdict = TriggerVerdict::of(&client.start_coach_trigger(request).await);
    gate.settle(&request.game_key, &verdict);
    Some(verdict)
}

#[tokio::test]
async fn a_detection_posts_the_golden_body_once_and_starts_the_run() -> TestResult {
    let fixture = golden()?;
    let server = MockServer::start(vec![(
        Route::CoachTriggers.path(),
        vec![Reply::json(200, fixture["response"].to_string())],
    )])
    .await?;
    let request = golden_request(&fixture)?;
    let mut gate = TriggerGate::new();

    let verdict = ask(&mut gate, &server.client()?, &request).await;

    let Some(TriggerVerdict::Started(run)) = verdict else {
        return Err(format!("expected a started run, got {verdict:?}").into());
    };
    assert_eq!(run.run_id.to_string(), fixture["response"]["run"]["runId"]);
    let posted = server.requests_to(Route::CoachTriggers.path());
    assert_eq!(posted.len(), 1);
    let sent: Value = serde_json::from_str(&posted[0].body)?;
    assert_eq!(sent, fixture["request"]);
    assert!(sent.get("question").is_none(), "never free text");
    assert_eq!(
        posted[0].headers.get("authorization").map(String::as_str),
        Some(format!("Bearer {TOKEN}").as_str())
    );
    assert_eq!(
        posted[0]
            .headers
            .get(&CONTRACT_HEADER.to_ascii_lowercase())
            .map(String::as_str),
        Some(CONTRACT_VERSION.to_string().as_str())
    );
    assert!(
        gate.admits(&request.game_key),
        "a started turn stops nothing"
    );
    Ok(())
}

/// Scout answers `reply` to the first post; the game asks three more times.
async fn posts_after(reply: Reply) -> Result<(usize, TriggerGate), Box<dyn std::error::Error>> {
    let fixture = golden()?;
    // Only one reply is scripted: a second post would find none and fail.
    let server = MockServer::start(vec![(Route::CoachTriggers.path(), vec![reply])]).await?;
    let client = server.client()?;
    let request = golden_request(&fixture)?;
    let mut gate = TriggerGate::new();
    let first = ask(&mut gate, &client, &request).await;
    assert!(first.is_some(), "the first detection asks");
    for _ in 0..3 {
        assert_eq!(ask(&mut gate, &client, &request).await, None);
    }
    Ok((server.requests_to(Route::CoachTriggers.path()).len(), gate))
}

#[tokio::test]
async fn spacing_and_the_cap_stop_every_later_post_for_the_game() -> TestResult {
    let spacing = Reply::json(
        429,
        json!({
            "error": "rate_limited",
            "message": "Scout coached a moment ago. It waits before coaching again."
        })
        .to_string(),
    )
    .with_header("retry-after", "60");
    let (posted, gate) = posts_after(spacing).await?;
    assert_eq!(posted, 1);
    assert!(gate.admits("g-next-game"), "the next game may ask");

    let cap = Reply::json(
        429,
        json!({
            "error": "rate_limited",
            "message": "Scout has already coached 10 times this game."
        })
        .to_string(),
    );
    assert_eq!(posts_after(cap).await?.0, 1);
    Ok(())
}

#[tokio::test]
async fn a_duplicate_stops_every_later_post_for_the_game() -> TestResult {
    let fixture = golden()?;
    let (posted, _) =
        posts_after(Reply::json(200, fixture["duplicateResponse"].to_string())).await?;
    assert_eq!(posted, 1);
    Ok(())
}

#[tokio::test]
async fn feature_disabled_stops_every_game_until_a_refresh() -> TestResult {
    let disabled = Reply::json(
        503,
        json!({
            "error": "feature_disabled",
            "message": "Scout does not start coaching on its own here."
        })
        .to_string(),
    );
    let (posted, mut gate) = posts_after(disabled).await?;
    assert_eq!(posted, 1);
    assert!(!gate.admits("g-next-game"));
    gate.refresh();
    assert!(gate.admits("g-next-game"));
    Ok(())
}

#[tokio::test]
async fn an_invalid_snapshot_refusal_stops_the_game_too() -> TestResult {
    let invalid = Reply::json(
        400,
        json!({
            "error": "invalid_game_context",
            "message": "The trigger's evidence does not match its snapshot."
        })
        .to_string(),
    );
    let (posted, _) = posts_after(invalid).await?;
    assert_eq!(posted, 1);
    Ok(())
}
