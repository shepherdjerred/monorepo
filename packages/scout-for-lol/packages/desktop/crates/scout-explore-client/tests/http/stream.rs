//! Following a run against a scripted server: reconnects, idle timeouts and
//! every terminal answer.

use std::time::Duration;

use crate::support::{MockServer, Reply, TOKEN, TestResult};
use scout_client_core::desktop_api::{DesktopApiErrorCode, RunOutcome};
use scout_explore_client::contract::{CONTRACT_HEADER, CONTRACT_VERSION, Route};
use scout_explore_client::reducer::{PendingTurn, TurnView};
use scout_explore_client::stream::{StreamEnd, StreamOptions, StreamSignal};
use scout_explore_client::{ExploreClient, ExploreClientError, Recovery};
use serde_json::{Value, json};
use uuid::Uuid;

const RUN: &str = "3d8f1a62-7b4c-4e29-9a05-c61e2f7b8d43";
const CONVERSATION: &str = "7c3e5a91-2b64-4d0f-8e17-5a9c4b2d6f30";
const QUESTION: &str = "e5b7c9d1-3f24-4a6b-8c8e-0d2f4a6b8c01";

fn options() -> StreamOptions {
    StreamOptions {
        initial_backoff: Duration::from_millis(5),
        max_backoff: Duration::from_millis(40),
        max_corrupt_connections: 3,
    }
}

fn snapshot(answer: Option<&str>) -> Value {
    json!({
        "type": "snapshot",
        "runId": RUN,
        "conversationId": CONVERSATION,
        "questionMessageId": QUESTION,
        "leafIdAtStart": null,
        "versionCountAtStart": 0,
        "startedAt": "2026-11-14T09:12:30.000Z",
        "answer": answer,
        "activity": "Counting ARAM games this month",
        "trace": []
    })
}

fn delta(text: &str) -> Value {
    json!({ "type": "answer_delta", "text": text })
}

fn done(outcome: &str) -> Value {
    json!({ "type": "done", "outcome": outcome })
}

fn refusal(status: u16, code: &str, message: &str) -> Reply {
    Reply::json(
        status,
        json!({ "error": code, "message": message }).to_string(),
    )
}

fn run_id() -> Result<Uuid, uuid::Error> {
    Uuid::parse_str(RUN)
}

/// Follow the run, folding every frame into a view and keeping the signals.
async fn follow(
    client: &ExploreClient,
) -> Result<
    (
        Result<StreamEnd, ExploreClientError>,
        TurnView,
        Vec<StreamSignal>,
    ),
    uuid::Error,
> {
    let mut view = Some(TurnView::new(PendingTurn::new(
        None,
        Some("Who carries our ARAMs?".to_owned()),
        None,
    )));
    let mut signals = Vec::new();
    let end = client
        .follow_run(run_id()?, options(), |signal| {
            if let StreamSignal::Event(event) = &signal {
                view = view.take().map(|current| current.apply(event));
            }
            signals.push(signal);
        })
        .await;
    let view = view.unwrap_or_else(|| TurnView::new(PendingTurn::new(None, None, None)));
    Ok((end, view, signals))
}

fn reconnects(signals: &[StreamSignal]) -> Vec<Duration> {
    signals
        .iter()
        .filter_map(|signal| match signal {
            StreamSignal::Reconnecting { delay, .. } => Some(*delay),
            StreamSignal::Event(_) => None,
        })
        .collect()
}

#[tokio::test]
async fn a_dropped_stream_reconnects_and_the_snapshot_keeps_the_answer_whole() -> TestResult {
    let server = MockServer::start(vec![(
        Route::ExploreRunsStream.path(),
        vec![
            Reply::stream(&[snapshot(None), delta("Jinx and Lulu lead")]),
            Reply::stream(&[
                snapshot(Some("Jinx and Lulu lead")),
                delta(" with a 61% win rate."),
                done("succeeded"),
            ]),
        ],
    )])
    .await?;
    let (end, view, signals) = follow(&server.client()?).await?;

    assert_eq!(end?, StreamEnd::Done(RunOutcome::Succeeded));
    // Without the snapshot replacing state, the first delta would repeat.
    assert_eq!(
        view.turn.answer.as_deref(),
        Some("Jinx and Lulu lead with a 61% win rate.")
    );
    assert_eq!(view.outcome, Some(RunOutcome::Succeeded));
    let delays = reconnects(&signals);
    assert_eq!(delays.len(), 1);
    assert!(
        delays
            .iter()
            .all(|delay| *delay >= Duration::from_millis(5))
    );

    let requests = server.requests_to(Route::ExploreRunsStream.path());
    assert_eq!(requests.len(), 2);
    for request in requests {
        assert_eq!(
            request.headers.get("authorization").map(String::as_str),
            Some(format!("Bearer {TOKEN}").as_str())
        );
        assert_eq!(
            request.headers.get(&CONTRACT_HEADER.to_ascii_lowercase()),
            Some(&CONTRACT_VERSION.to_string())
        );
        assert_eq!(
            request.headers.get("accept").map(String::as_str),
            Some("text/event-stream")
        );
        assert_eq!(
            serde_json::from_str::<Value>(&request.body)?,
            json!({ "runId": RUN })
        );
    }
    Ok(())
}

#[tokio::test]
async fn a_stalled_stream_times_out_and_reconnects() -> TestResult {
    let server = MockServer::start(vec![(
        Route::ExploreRunsStream.path(),
        vec![
            Reply::stalled(&[snapshot(Some("Jinx"))]),
            Reply::stream(&[snapshot(Some("Jinx")), done("succeeded")]),
        ],
    )])
    .await?;
    let client = server
        .client()?
        .with_stream_idle_timeout(Duration::from_millis(150))?;
    let (end, view, signals) = follow(&client).await?;

    assert_eq!(end?, StreamEnd::Done(RunOutcome::Succeeded));
    assert_eq!(view.turn.answer.as_deref(), Some("Jinx"));
    assert_eq!(reconnects(&signals).len(), 1);
    Ok(())
}

#[tokio::test]
async fn a_missing_run_asks_for_its_outcome() -> TestResult {
    let server = MockServer::start(vec![
        (
            Route::ExploreRunsStream.path(),
            vec![refusal(404, "not_found", "Run not found.")],
        ),
        (
            Route::ExploreRunsOutcome.path(),
            vec![
                // A transient failure on the way is retried.
                Reply::json(502, "<html>Bad Gateway</html>"),
                Reply::json(200, json!({ "outcome": "stopped" }).to_string()),
            ],
        ),
    ])
    .await?;
    let (end, _, _) = follow(&server.client()?).await?;

    assert_eq!(end?, StreamEnd::Gone(Some(RunOutcome::Stopped)));
    let asked = server.requests_to(Route::ExploreRunsOutcome.path());
    assert_eq!(asked.len(), 2);
    assert_eq!(
        serde_json::from_str::<Value>(&asked[1].body)?,
        json!({ "runId": RUN })
    );
    Ok(())
}

#[tokio::test]
async fn a_revoked_device_surfaces_a_re_pair_state_without_retrying() -> TestResult {
    for (code, recovery) in [
        ("unauthorized", Recovery::RePair),
        ("reauthorize_required", Recovery::SignInOnWeb),
    ] {
        let server = MockServer::start(vec![(
            Route::ExploreRunsStream.path(),
            vec![refusal(401, code, "Sign in again.")],
        )])
        .await?;
        let (end, _, signals) = follow(&server.client()?).await?;
        match end? {
            StreamEnd::RePairRequired(refusal) => assert_eq!(refusal.recovery(), recovery),
            other => return Err(format!("{code}: {other:?}").into()),
        }
        assert_eq!(reconnects(&signals), Vec::<Duration>::new());
        assert_eq!(server.requests().len(), 1);
    }
    Ok(())
}

#[tokio::test]
async fn an_old_contract_surfaces_an_upgrade_state() -> TestResult {
    let server = MockServer::start(vec![(
        Route::ExploreRunsStream.path(),
        vec![refusal(
            426,
            "contract_unsupported",
            "Update Scout Desktop to keep using Explore.",
        )],
    )])
    .await?;
    let (end, _, _) = follow(&server.client()?).await?;
    assert_eq!(
        end?,
        StreamEnd::UpgradeRequired {
            message: "Update Scout Desktop to keep using Explore.".to_owned()
        }
    );
    Ok(())
}

#[tokio::test]
async fn a_disabled_feature_ends_the_stream() -> TestResult {
    let server = MockServer::start(vec![(
        Route::ExploreRunsStream.path(),
        vec![refusal(
            503,
            "feature_disabled",
            "Explore in Scout Desktop is turned off right now.",
        )],
    )])
    .await?;
    let (end, _, _) = follow(&server.client()?).await?;
    match end? {
        StreamEnd::Refused(refusal) => {
            assert_eq!(refusal.code, DesktopApiErrorCode::FeatureDisabled);
        }
        other => return Err(format!("{other:?}").into()),
    }
    Ok(())
}

#[tokio::test]
async fn transient_refusals_and_proxy_errors_are_retried() -> TestResult {
    let server = MockServer::start(vec![(
        Route::ExploreRunsStream.path(),
        vec![
            refusal(
                429,
                "stream_limit",
                "This device is already following too many answers.",
            )
            .with_header("Retry-After", "0"),
            refusal(503, "unavailable", "Try again shortly."),
            Reply::json(502, "<html>Bad Gateway</html>"),
            Reply::stream(&[snapshot(Some("Jinx")), done("failed")]),
        ],
    )])
    .await?;
    let (end, _, signals) = follow(&server.client()?).await?;

    assert_eq!(end?, StreamEnd::Done(RunOutcome::Failed));
    let delays = reconnects(&signals);
    assert_eq!(delays.len(), 3);
    // Three failures in a row walk the backoff up without passing its cap.
    assert!(
        delays
            .iter()
            .all(|delay| *delay <= Duration::from_millis(40))
    );
    Ok(())
}

#[tokio::test]
async fn an_unknown_ignorable_frame_is_skipped() -> TestResult {
    let server = MockServer::start(vec![(
        Route::ExploreRunsStream.path(),
        vec![Reply::Stream {
            frames: vec![
                crate::support::frame(&snapshot(None)),
                ": keepalive\n\n".to_owned(),
                crate::support::frame(&json!({ "type": "replay_hint", "ignorable": true })),
                crate::support::frame(&done("succeeded")),
            ],
            stall: false,
        }],
    )])
    .await?;
    let (end, _, signals) = follow(&server.client()?).await?;
    assert_eq!(end?, StreamEnd::Done(RunOutcome::Succeeded));
    assert_eq!(signals.len(), 2);
    Ok(())
}

#[tokio::test]
async fn frames_that_stay_corrupt_fail_loudly() -> TestResult {
    let corrupt = || Reply::stream(&[json!({ "type": "answer_delta", "text": "x", "extra": 1 })]);
    let server = MockServer::start(vec![(
        Route::ExploreRunsStream.path(),
        vec![corrupt(), corrupt(), corrupt()],
    )])
    .await?;
    let (end, _, signals) = follow(&server.client()?).await?;
    assert!(
        matches!(end, Err(ExploreClientError::Unexpected { .. })),
        "{end:?}"
    );
    assert_eq!(reconnects(&signals).len(), 2);
    Ok(())
}

#[tokio::test]
async fn a_json_answer_to_the_stream_is_a_broken_contract() -> TestResult {
    let server = MockServer::start(vec![(
        Route::ExploreRunsStream.path(),
        vec![Reply::json(200, json!({ "events": [] }).to_string())],
    )])
    .await?;
    let (end, _, _) = follow(&server.client()?).await?;
    assert!(
        matches!(end, Err(ExploreClientError::Unexpected { status: 200, .. })),
        "{end:?}"
    );
    Ok(())
}
