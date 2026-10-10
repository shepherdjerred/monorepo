//! Public, schema-limited desktop ingestion. Prometheus stays on a separate private port.
use glitter_boys_core::{
    diagnostics::{Event, Outcome},
    updates,
};
use serde::Deserialize;
use std::{
    collections::{BTreeMap, BTreeSet},
    io::Read,
    sync::{Arc, Mutex, mpsc},
    time::{Duration, Instant},
};
use tiny_http::{Header, Method, Response, Server, StatusCode};

const BODY_LIMIT: u64 = 32 * 1024;
const BUCKETS: [u64; 8] = [100, 500, 1000, 5000, 30000, 120000, 600000, 3600000];
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Batch {
    schema: u8,
    events: Vec<Event>,
}
fn validate(bytes: &[u8]) -> Result<Batch, String> {
    let batch: Batch = serde_json::from_slice(bytes).map_err(|_| "invalid schema".to_string())?;
    if batch.schema != 1 || batch.events.is_empty() || batch.events.len() > 25 {
        return Err("invalid batch".into());
    }
    for e in &batch.events {
        if e.schema != 1
            || updates::version(&e.release).is_err()
            || e.duration_ms > 7 * 86400 * 1000
            || e.bytes > 512 * 1024 * 1024 * 1024
        {
            return Err("invalid event".into());
        }
    }
    Ok(batch)
}
#[derive(Default)]
struct Measure {
    count: u64,
    bytes: u64,
    duration_ms: u64,
    buckets: [u64; 8],
}
#[derive(Default)]
struct Metrics {
    series: BTreeMap<String, Measure>,
    releases: BTreeSet<String>,
    rejected: u64,
    report_failed: u64,
}
impl Metrics {
    fn observe(&mut self, event: &Event) {
        let version = if self.releases.contains(&event.release) || self.releases.len() < 32 {
            self.releases.insert(event.release.clone());
            event.release.as_str()
        } else {
            "other"
        };
        let operation = serde_json::to_value(event.operation)
            .ok()
            .and_then(|v| v.as_str().map(str::to_owned))
            .unwrap_or_else(|| "unknown".into());
        let outcome = serde_json::to_value(event.outcome)
            .ok()
            .and_then(|v| v.as_str().map(str::to_owned))
            .unwrap_or_else(|| "unknown".into());
        let key = format!(
            "game=\"{}\",operation=\"{operation}\",outcome=\"{outcome}\",release=\"{version}\"",
            event.game.map(|g| g.id()).unwrap_or("launcher")
        );
        let m = self.series.entry(key).or_default();
        m.count += 1;
        m.bytes = m.bytes.saturating_add(event.bytes);
        m.duration_ms = m.duration_ms.saturating_add(event.duration_ms);
        for (i, limit) in BUCKETS.iter().enumerate() {
            if event.duration_ms <= *limit {
                m.buckets[i] += 1;
            }
        }
    }
    fn render(&self) -> String {
        let mut lines = vec![
            "# TYPE glitter_launcher_events_total counter".into(),
            "# TYPE glitter_launcher_bytes_total counter".into(),
            "# TYPE glitter_launcher_duration_seconds histogram".into(),
            format!("glitter_launcher_rejected_total {}", self.rejected),
            format!(
                "glitter_launcher_reporting_failures_total {}",
                self.report_failed
            ),
        ];
        for (labels, m) in &self.series {
            lines.push(format!(
                "glitter_launcher_events_total{{{labels}}} {}",
                m.count
            ));
            lines.push(format!(
                "glitter_launcher_bytes_total{{{labels}}} {}",
                m.bytes
            ));
            lines.push(format!(
                "glitter_launcher_duration_seconds_count{{{labels}}} {}",
                m.count
            ));
            lines.push(format!(
                "glitter_launcher_duration_seconds_sum{{{labels}}} {}",
                m.duration_ms as f64 / 1000.0
            ));
            for (i, limit) in BUCKETS.iter().enumerate() {
                lines.push(format!(
                    "glitter_launcher_duration_seconds_bucket{{{labels},le=\"{}\"}} {}",
                    *limit as f64 / 1000.0,
                    m.buckets[i]
                ));
            }
            lines.push(format!(
                "glitter_launcher_duration_seconds_bucket{{{labels},le=\"+Inf\"}} {}",
                m.count
            ));
        }
        lines.join("\n") + "\n"
    }
}
fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    if std::env::args().any(|a| a == "--smoke") {
        assert!(validate(br#"{"schema":1,"events":[]}"#).is_err());
        println!("launcher service runtime loaded");
        return Ok(());
    }
    // DSN is bootstrap configuration. No arbitrary payloads or bearer tokens are accepted from clients.
    let dsn = reqwest::Url::parse(&std::env::var("SENTRY_DSN")?)?;
    let project = dsn.path().trim_matches('/');
    if dsn.scheme() != "https"
        || project.is_empty()
        || !project.bytes().all(|b| b.is_ascii_digit())
        || dsn.username().is_empty()
    {
        return Err("Invalid Bugsink DSN".into());
    }
    let mut target = dsn.clone();
    target.set_path(&format!("/api/{project}/store/"));
    target
        .set_username("")
        .map_err(|_| "Invalid Bugsink host")?;
    target
        .set_password(None)
        .map_err(|_| "Invalid Bugsink host")?;
    let auth = format!(
        "Sentry sentry_version=7,sentry_key={},sentry_client=glitter-boys/{}",
        dsn.username(),
        env!("CARGO_PKG_VERSION")
    );
    let metrics = Arc::new(Mutex::new(Metrics::default()));
    let private = metrics.clone();
    let server = Server::http("0.0.0.0:8080")?;
    let monitoring = Server::http("0.0.0.0:9091")?;
    std::thread::spawn(move || {
        for request in monitoring.incoming_requests() {
            let response = if request.url() == "/metrics" {
                match private.lock() {
                    Ok(m) => Response::from_string(m.render()),
                    Err(_) => {
                        Response::from_string("Unavailable").with_status_code(StatusCode(503))
                    }
                }
            } else {
                Response::from_string("Not found").with_status_code(StatusCode(404))
            };
            let _ = request.respond(response);
        }
    });
    let (sender, receiver) = mpsc::sync_channel::<Event>(128);
    let reporting = metrics.clone();
    std::thread::spawn(move || {
        let Ok(runtime) = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
        else {
            return;
        };
        let Ok(client) = reqwest::Client::builder()
            .https_only(true)
            .timeout(Duration::from_secs(5))
            .redirect(reqwest::redirect::Policy::none())
            .build()
        else {
            return;
        };
        for event in receiver {
            let body = serde_json::json!({"platform":"other","level":"error","logger":"glitter-boys","release":event.release,"message":format!("{:?}: {:?}",event.operation,event.failure),"tags":{"game":event.game.map(|g|g.id()).unwrap_or("launcher"),"operation":event.operation,"failure":event.failure}});
            let response = runtime.block_on(
                client
                    .post(target.clone())
                    .header("X-Sentry-Auth", &auth)
                    .json(&body)
                    .send(),
            );
            if !response.is_ok_and(|r| r.status().is_success())
                && let Ok(mut m) = reporting.lock()
            {
                m.report_failed += 1;
            }
        }
    });
    // Aggregate ingress cap also bounds attacks through shared proxy addresses; no IPs are retained.
    let mut window = Instant::now();
    let mut accepted = 0;
    for mut request in server.incoming_requests() {
        if request.method() == &Method::Get && request.url() == "/healthz" {
            let _ = request.respond(Response::from_string("ok"));
            continue;
        }
        if request.method() != &Method::Post || request.url() != "/v1/events" {
            let _ = request
                .respond(Response::from_string("Not found").with_status_code(StatusCode(404)));
            continue;
        }
        if window.elapsed() > Duration::from_secs(60) {
            window = Instant::now();
            accepted = 0;
        }
        if accepted >= 120 {
            let _ = request
                .respond(Response::from_string("Try later").with_status_code(StatusCode(429)));
            continue;
        }
        accepted += 1;
        let mut bytes = Vec::new();
        if request.body_length().is_some_and(|n| n as u64 > BODY_LIMIT)
            || request
                .as_reader()
                .take(BODY_LIMIT + 1)
                .read_to_end(&mut bytes)
                .is_err()
            || bytes.len() as u64 > BODY_LIMIT
        {
            let _ = request
                .respond(Response::from_string("Body too large").with_status_code(StatusCode(413)));
            continue;
        }
        match validate(&bytes) {
            Ok(batch) => {
                if let Ok(mut m) = metrics.lock() {
                    for event in &batch.events {
                        m.observe(event);
                    }
                }
                for event in batch.events {
                    if event.outcome == Outcome::Failed
                        && sender.try_send(event).is_err()
                        && let Ok(mut m) = metrics.lock()
                    {
                        m.report_failed += 1;
                    }
                }
                let header = Header::from_bytes("Content-Type", "application/json")
                    .map_err(|_| "Invalid response header")?;
                let _ = request
                    .respond(Response::from_string("{\"accepted\":true}").with_header(header));
            }
            Err(_) => {
                if let Ok(mut m) = metrics.lock() {
                    m.rejected += 1;
                }
                let _ = request.respond(
                    Response::from_string("Invalid telemetry").with_status_code(StatusCode(400)),
                );
            }
        }
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_unknown_fields_and_unbounded_batches() {
        assert!(validate(br#"{"schema":1,"events":[],"token":"private"}"#).is_err());
        assert!(validate(br#"{"schema":1,"events":[]}"#).is_err());
    }
    #[test]
    fn versions_and_metrics_are_bounded() {
        let mut metrics = Metrics::default();
        for v in 0..100 {
            let event = Event {
                schema: 1,
                at: 0,
                release: format!("1.0.{v}"),
                game: None,
                operation: glitter_boys_core::diagnostics::Operation::Startup,
                outcome: Outcome::Succeeded,
                failure: None,
                duration_ms: 500,
                bytes: 10,
            };
            metrics.observe(&event);
        }
        assert_eq!(metrics.releases.len(), 32);
        assert_eq!(metrics.series.len(), 33);
        assert!(metrics.render().contains("le=\"+Inf\""));
    }
}
