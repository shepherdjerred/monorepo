//! Every REST route against a scripted server answering with its golden body,
//! and every golden refusal mapped over a real HTTP response.

use std::time::Duration;

use crate::support::{MockServer, Reply, TOKEN, TestResult};
use scout_client_core::desktop_api::{ActiveRun, DesktopApiErrorCode, RunOutcome, RunStartRequest};
use scout_explore_client::contract::{CONTRACT_HEADER, CONTRACT_VERSION, Route};
use scout_explore_client::{ExploreClient, ExploreClientError, Recovery};
use serde_json::Value;
use uuid::Uuid;

macro_rules! fixture {
    ($name:literal) => {
        include_str!(concat!(
            "../../../../../data/src/scout-client/desktop-fixtures/",
            $name
        ))
    };
}

fn golden(text: &str) -> Result<Value, serde_json::Error> {
    serde_json::from_str(text)
}

fn served(route: Route, fixture: &Value) -> (&'static str, Vec<Reply>) {
    (
        route.path(),
        vec![Reply::json(200, fixture["response"].to_string())],
    )
}

fn assert_authenticated(server: &MockServer, route: Route, fixture: &Value) -> TestResult {
    let requests = server.requests_to(route.path());
    assert_eq!(requests.len(), 1, "{}", route.name());
    let request = &requests[0];
    assert_eq!(
        request.headers.get("authorization"),
        Some(&format!("Bearer {TOKEN}"))
    );
    assert_eq!(
        request.headers.get(&CONTRACT_HEADER.to_ascii_lowercase()),
        Some(&CONTRACT_VERSION.to_string())
    );
    assert_eq!(
        serde_json::from_str::<Value>(&request.body)?,
        fixture["request"],
        "{}",
        route.name()
    );
    Ok(())
}

#[tokio::test]
async fn every_route_sends_its_golden_request_and_reads_its_golden_answer() -> TestResult {
    let status = golden(fixture!("explore-status.json"))?;
    let list = golden(fixture!("explore-conversations-list.json"))?;
    let get = golden(fixture!("explore-conversations-get.json"))?;
    let start = golden(fixture!("explore-runs-start.json"))?;
    let stop = golden(fixture!("explore-runs-stop.json"))?;
    let active = golden(fixture!("explore-runs-active.json"))?;
    let outcome = golden(fixture!("explore-runs-outcome.json"))?;
    let server = MockServer::start(vec![
        served(Route::ExploreStatus, &status),
        served(Route::ExploreConversationsList, &list),
        served(Route::ExploreConversationsGet, &get),
        served(Route::ExploreRunsStart, &start),
        served(Route::ExploreRunsStop, &stop),
        served(Route::ExploreRunsActive, &active),
        served(Route::ExploreRunsOutcome, &outcome),
    ])
    .await?;
    let client = server.client()?;
    let id = |value: &Value| Uuid::parse_str(value.as_str().unwrap_or_default());

    let answer = client.status().await?;
    assert_eq!(answer, serde_json::from_value(status["response"].clone())?);
    let answer = client.list_conversations().await?;
    assert_eq!(answer, serde_json::from_value(list["response"].clone())?);
    let transcript = client
        .get_conversation(id(&get["request"]["conversationId"])?)
        .await?;
    assert_eq!(transcript, serde_json::from_value(get["response"].clone())?);
    let request: RunStartRequest = serde_json::from_value(start["request"].clone())?;
    let run = client.start_run(&request).await?;
    assert_eq!(run, serde_json::from_value(start["response"].clone())?);
    client.stop_run(id(&stop["request"]["runId"])?).await?;
    let runs = client.active_runs().await?;
    assert_eq!(
        runs,
        serde_json::from_value::<Vec<ActiveRun>>(active["response"]["runs"].clone())?
    );
    let ended = client
        .run_outcome(id(&outcome["request"]["runId"])?)
        .await?;
    assert_eq!(ended, Some(RunOutcome::Succeeded));

    for (route, fixture) in [
        (Route::ExploreStatus, &status),
        (Route::ExploreConversationsList, &list),
        (Route::ExploreConversationsGet, &get),
        (Route::ExploreRunsStart, &start),
        (Route::ExploreRunsStop, &stop),
        (Route::ExploreRunsActive, &active),
        (Route::ExploreRunsOutcome, &outcome),
    ] {
        assert_authenticated(&server, route, fixture)?;
    }
    Ok(())
}

#[tokio::test]
async fn every_golden_refusal_arrives_as_its_typed_error() -> TestResult {
    let errors = golden(fixture!("errors.json"))?;
    let errors = errors["errors"].as_array().ok_or("errors")?;
    let replies = errors
        .iter()
        .map(|error| {
            let status =
                u16::try_from(error["status"].as_u64().unwrap_or_default()).unwrap_or_default();
            Reply::json(status, error["body"].to_string()).with_header("Retry-After", "7")
        })
        .collect();
    let server = MockServer::start(vec![(Route::ExploreStatus.path(), replies)]).await?;
    let client = server.client()?;
    for error in errors {
        let code: DesktopApiErrorCode = serde_json::from_value(error["body"]["error"].clone())?;
        let failure = match client.status().await {
            Ok(answer) => return Err(format!("{code:?} answered {answer:?}").into()),
            Err(failure) => failure,
        };
        match (&failure, code) {
            (
                ExploreClientError::UpgradeRequired { .. },
                DesktopApiErrorCode::ContractUnsupported,
            ) => {
                assert_eq!(failure.recovery(), Some(Recovery::UpgradeApp));
            }
            (ExploreClientError::Refused(refusal), _) => {
                assert_eq!(refusal.code, code);
                assert_eq!(refusal.retry_after, Some(Duration::from_secs(7)));
                assert_eq!(
                    Value::from(refusal.message.as_str()),
                    error["body"]["message"]
                );
            }
            (other, _) => return Err(format!("{code:?} became {other:?}").into()),
        }
    }
    Ok(())
}

#[tokio::test]
async fn a_body_outside_the_contract_is_a_decode_error() -> TestResult {
    let server = MockServer::start(vec![(
        Route::ExploreRunsOutcome.path(),
        vec![Reply::json(200, r#"{"outcome":"succeeded","extra":true}"#)],
    )])
    .await?;
    let result = server.client()?.run_outcome(Uuid::new_v4()).await;
    assert!(
        matches!(result, Err(ExploreClientError::Decode(_))),
        "{result:?}"
    );
    Ok(())
}

#[tokio::test]
async fn an_unreachable_backend_is_a_transport_error() -> TestResult {
    let listener = std::net::TcpListener::bind("127.0.0.1:0")?;
    let origin = format!("http://{}", listener.local_addr()?);
    drop(listener);
    let client = ExploreClient::new(
        &origin,
        scout_client_core::credentials::DeviceCredential {
            device_id: Uuid::new_v4(),
            token: TOKEN.to_owned(),
        },
    )?;
    let result = client.status().await;
    assert!(
        matches!(result, Err(ExploreClientError::Transport(_))),
        "{result:?}"
    );
    Ok(())
}

#[test]
fn a_remote_http_origin_is_refused_and_debug_hides_the_token() -> TestResult {
    let credential = || scout_client_core::credentials::DeviceCredential {
        device_id: Uuid::nil(),
        token: TOKEN.to_owned(),
    };
    assert!(matches!(
        ExploreClient::new("http://scout.example", credential()),
        Err(ExploreClientError::Origin)
    ));
    let client = ExploreClient::new("https://scout.example/app", credential())?;
    let debug = format!("{client:?}");
    assert!(!debug.contains(TOKEN), "{debug}");
    assert!(debug.contains("https://scout.example/"), "{debug}");
    Ok(())
}

#[tokio::test]
async fn the_chart_route_reads_a_png_and_refuses_anything_else() -> TestResult {
    let chart = golden(fixture!("explore-visualization.json"))?;
    let assets = golden(fixture!("explore-assets.json"))?;
    let mut png = scout_explore_client::PNG_SIGNATURE.to_vec();
    png.extend_from_slice(b"stub chart body");
    let server = MockServer::start(vec![
        (
            Route::ExploreVisualization.path(),
            vec![
                Reply::Bytes {
                    content_type: "image/png",
                    body: png.clone(),
                },
                Reply::Bytes {
                    content_type: "image/png",
                    body: b"<svg/>".to_vec(),
                },
                Reply::Bytes {
                    content_type: "image/svg+xml",
                    body: png.clone(),
                },
                Reply::json(404, r#"{"error":"not_found","message":"Chart not found."}"#),
            ],
        ),
        served(Route::ExploreAssets, &assets),
    ])
    .await?;
    let client = server.client()?;
    let id = |value: &Value| Uuid::parse_str(value.as_str().unwrap_or_default());
    let conversation = id(&chart["request"]["conversationId"])?;
    let message = id(&chart["request"]["messageId"])?;

    assert_eq!(client.visualization(conversation, message).await?, png);
    assert_authenticated(&server, Route::ExploreVisualization, &chart)?;
    for expected in ["not a PNG", "not image/png"] {
        match client.visualization(conversation, message).await {
            Err(ExploreClientError::Unexpected { detail, .. }) => {
                assert!(detail.contains(expected), "{detail}");
            }
            other => return Err(format!("expected a broken contract, got {other:?}").into()),
        }
    }
    match client.visualization(conversation, message).await {
        Err(ExploreClientError::Refused(refusal)) => {
            assert_eq!(refusal.code, DesktopApiErrorCode::NotFound);
        }
        other => return Err(format!("expected not_found, got {other:?}").into()),
    }

    let version = client.assets().await?;
    assert_eq!(
        serde_json::to_value(&version)?,
        assets["response"],
        "assets reads the golden answer"
    );
    assert_authenticated(&server, Route::ExploreAssets, &assets)?;
    Ok(())
}
