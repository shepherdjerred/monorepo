use std::collections::BTreeMap;
use std::fmt::Write as _;
use std::sync::Mutex;

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
struct RequestKey {
    protocol: String,
    namespace: String,
    op: String,
    outcome: String,
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
struct TransferKey {
    protocol: String,
    direction: &'static str,
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
struct EvictionKey {
    namespace: String,
    reason: &'static str,
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
struct TurboEventKey {
    source: String,
    event: String,
}

#[derive(Debug, Default)]
struct Counters {
    requests: BTreeMap<RequestKey, u64>,
    bytes_transferred: BTreeMap<TransferKey, u64>,
    evictions: BTreeMap<EvictionKey, u64>,
    turbo_events: BTreeMap<TurboEventKey, u64>,
    saved_duration_ms: BTreeMap<String, u64>,
}

#[derive(Debug)]
pub struct Metrics {
    counters: Mutex<Counters>,
    quota_bytes: u64,
    high_watermark_bytes: u64,
    low_watermark_bytes: u64,
}

#[derive(Debug, Clone)]
pub struct NamespaceGauge {
    pub namespace: String,
    pub entries: u64,
    pub stored_bytes: u64,
}

fn escape_label_value(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    for ch in raw.chars() {
        match ch {
            '\\' => out.push_str("\\\\"),
            '"' => out.push_str("\\\""),
            '\n' => out.push_str("\\n"),
            other => out.push(other),
        }
    }
    out
}

impl Metrics {
    pub fn new(quota_bytes: u64, high_watermark_bytes: u64, low_watermark_bytes: u64) -> Self {
        Self {
            counters: Mutex::new(Counters::default()),
            quota_bytes,
            high_watermark_bytes,
            low_watermark_bytes,
        }
    }

    pub fn record_request(&self, protocol: &str, namespace: &str, op: &str, outcome: &str) {
        if let Ok(mut guard) = self.counters.lock() {
            let key = RequestKey {
                protocol: protocol.to_owned(),
                namespace: namespace.to_owned(),
                op: op.to_owned(),
                outcome: outcome.to_owned(),
            };
            let entry = guard.requests.entry(key).or_insert(0);
            *entry = entry.saturating_add(1);
        }
    }

    pub fn record_bytes_in(&self, protocol: &str, bytes: u64) {
        if bytes == 0 {
            return;
        }
        if let Ok(mut guard) = self.counters.lock() {
            let key = TransferKey {
                protocol: protocol.to_owned(),
                direction: "in",
            };
            let entry = guard.bytes_transferred.entry(key).or_insert(0);
            *entry = entry.saturating_add(bytes);
        }
    }

    pub fn record_bytes_out(&self, protocol: &str, bytes: u64) {
        if bytes == 0 {
            return;
        }
        if let Ok(mut guard) = self.counters.lock() {
            let key = TransferKey {
                protocol: protocol.to_owned(),
                direction: "out",
            };
            let entry = guard.bytes_transferred.entry(key).or_insert(0);
            *entry = entry.saturating_add(bytes);
        }
    }

    pub fn record_evictions(&self, namespace: &str, reason: &'static str, count: u64) {
        if count == 0 {
            return;
        }
        if let Ok(mut guard) = self.counters.lock() {
            let key = EvictionKey {
                namespace: namespace.to_owned(),
                reason,
            };
            let entry = guard.evictions.entry(key).or_insert(0);
            *entry = entry.saturating_add(count);
        }
    }

    pub fn record_turbo_event(&self, source: &str, event: &str, saved_duration_ms: Option<u64>) {
        if let Ok(mut guard) = self.counters.lock() {
            let key = TurboEventKey {
                source: source.to_owned(),
                event: event.to_owned(),
            };
            let entry = guard.turbo_events.entry(key).or_insert(0);
            *entry = entry.saturating_add(1);
            if event.eq_ignore_ascii_case("HIT")
                && let Some(duration) = saved_duration_ms
                && duration > 0
            {
                let dur_entry = guard
                    .saved_duration_ms
                    .entry(source.to_owned())
                    .or_insert(0);
                *dur_entry = dur_entry.saturating_add(duration);
            }
        }
    }

    pub fn render(&self, namespace_gauges: &[NamespaceGauge]) -> String {
        let mut out = String::with_capacity(4096);

        let _ = writeln!(
            out,
            "# HELP ci_cache_requests_total Total cache protocol requests handled."
        );
        let _ = writeln!(out, "# TYPE ci_cache_requests_total counter");

        let snapshot = self.counters.lock().ok().map(|guard| Counters {
            requests: guard.requests.clone(),
            bytes_transferred: guard.bytes_transferred.clone(),
            evictions: guard.evictions.clone(),
            turbo_events: guard.turbo_events.clone(),
            saved_duration_ms: guard.saved_duration_ms.clone(),
        });

        if let Some(ref snap) = snapshot {
            for (k, val) in &snap.requests {
                let _ = writeln!(
                    out,
                    "ci_cache_requests_total{{protocol=\"{}\",namespace=\"{}\",op=\"{}\",outcome=\"{}\"}} {val}",
                    escape_label_value(&k.protocol),
                    escape_label_value(&k.namespace),
                    escape_label_value(&k.op),
                    escape_label_value(&k.outcome),
                );
            }
        }

        let _ = writeln!(
            out,
            "# HELP ci_cache_bytes_transferred_total Total artifact payload bytes streamed in or out."
        );
        let _ = writeln!(out, "# TYPE ci_cache_bytes_transferred_total counter");
        if let Some(ref snap) = snapshot {
            for (k, val) in &snap.bytes_transferred {
                let _ = writeln!(
                    out,
                    "ci_cache_bytes_transferred_total{{protocol=\"{}\",direction=\"{}\"}} {val}",
                    escape_label_value(&k.protocol),
                    k.direction,
                );
            }
        }

        let _ = writeln!(
            out,
            "# HELP ci_cache_entries Current number of stored cache entries by namespace."
        );
        let _ = writeln!(out, "# TYPE ci_cache_entries gauge");
        for gauge in namespace_gauges {
            let _ = writeln!(
                out,
                "ci_cache_entries{{namespace=\"{}\"}} {}",
                escape_label_value(&gauge.namespace),
                gauge.entries
            );
        }

        let _ = writeln!(
            out,
            "# HELP ci_cache_stored_bytes Current stored artifact bytes by namespace."
        );
        let _ = writeln!(out, "# TYPE ci_cache_stored_bytes gauge");
        for gauge in namespace_gauges {
            let _ = writeln!(
                out,
                "ci_cache_stored_bytes{{namespace=\"{}\"}} {}",
                escape_label_value(&gauge.namespace),
                gauge.stored_bytes
            );
        }

        let _ = writeln!(
            out,
            "# HELP ci_cache_evictions_total Total cache entries evicted by namespace and reason."
        );
        let _ = writeln!(out, "# TYPE ci_cache_evictions_total counter");
        if let Some(ref snap) = snapshot {
            for (k, val) in &snap.evictions {
                let _ = writeln!(
                    out,
                    "ci_cache_evictions_total{{namespace=\"{}\",reason=\"{}\"}} {val}",
                    escape_label_value(&k.namespace),
                    k.reason,
                );
            }
        }

        let _ = writeln!(
            out,
            "# HELP ci_cache_turbo_events_total Total Turborepo client cache telemetry events."
        );
        let _ = writeln!(out, "# TYPE ci_cache_turbo_events_total counter");
        if let Some(ref snap) = snapshot {
            for (k, val) in &snap.turbo_events {
                let _ = writeln!(
                    out,
                    "ci_cache_turbo_events_total{{source=\"{}\",event=\"{}\"}} {val}",
                    escape_label_value(&k.source),
                    escape_label_value(&k.event),
                );
            }
        }

        let _ = writeln!(
            out,
            "# HELP ci_cache_saved_duration_ms_total Cumulative milliseconds saved reported by Turborepo."
        );
        let _ = writeln!(out, "# TYPE ci_cache_saved_duration_ms_total counter");
        if let Some(ref snap) = snapshot {
            for (source, val) in &snap.saved_duration_ms {
                let _ = writeln!(
                    out,
                    "ci_cache_saved_duration_ms_total{{source=\"{}\"}} {val}",
                    escape_label_value(source),
                );
            }
        }

        let _ = writeln!(
            out,
            "# HELP ci_cache_quota_bytes Configured storage quota in bytes."
        );
        let _ = writeln!(out, "# TYPE ci_cache_quota_bytes gauge");
        let _ = writeln!(out, "ci_cache_quota_bytes {}", self.quota_bytes);

        let _ = writeln!(
            out,
            "# HELP ci_cache_high_watermark_bytes Configured high watermark in bytes."
        );
        let _ = writeln!(out, "# TYPE ci_cache_high_watermark_bytes gauge");
        let _ = writeln!(
            out,
            "ci_cache_high_watermark_bytes {}",
            self.high_watermark_bytes
        );

        let _ = writeln!(
            out,
            "# HELP ci_cache_low_watermark_bytes Configured low watermark in bytes."
        );
        let _ = writeln!(out, "# TYPE ci_cache_low_watermark_bytes gauge");
        let _ = writeln!(
            out,
            "ci_cache_low_watermark_bytes {}",
            self.low_watermark_bytes
        );

        out
    }
}
