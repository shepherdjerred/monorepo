//! The recurrence parity gate.
//!
//! Runs the whole differential corpus at
//! `packages/tasknotes-fixtures/recurrence/` — 338 cases, 323 distinct rule
//! strings, 69,017 occurrence dates over 2021-01-01…2030-12-31 — against this
//! crate's engine and asserts an exact match.
//!
//! The corpus is the **oracle**, not a convenience: it was snapshotted from
//! `@tasknotes/model` (which wraps rrule.js 2.8.1), which is what the shipping
//! TypeScript client actually calls. A divergence here is a divergence a user
//! would see as a task appearing on the wrong day, so this test asserts set
//! equality rather than a count, and reports the offending dates.
//!
//! Fixtures are read from the repository rather than vendored: `@tasknotes/fixtures`
//! is a zero-dependency, data-only package precisely so that both the Rust core
//! and the TypeScript client can consume the same bytes, and copying them here
//! would reintroduce the drift the shared corpus exists to prevent.

use std::collections::BTreeSet;
use std::error::Error;
use std::path::PathBuf;

/// Every test returns a `Result` so that a missing or malformed fixture is
/// reported as an error rather than as a panic inside a helper — which also
/// keeps the shared loaders free of `unwrap`, since they are ordinary functions
/// in an integration crate and not test bodies.
type Check = Result<(), Box<dyn Error>>;

use chrono::NaiveDate;
use tasknotes_core::domain::RecurrenceAnchor;
use tasknotes_core::recurrence::{DateWindow, Recurrence};

/// One line of `corpus.jsonl`. Field names are the corpus's, not Rust's.
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Case {
    id: String,
    group: String,
    source: String,
    note: Option<String>,
    recurrence: String,
    scheduled: Option<String>,
    date_created: Option<String>,
    outcome: String,
    occurrence_count: usize,
    occurrences: Vec<NaiveDate>,
    first_occurrence: Option<NaiveDate>,
    last_occurrence: Option<NaiveDate>,
    finite_instance_count: Option<usize>,
    generator_day_count: usize,
    next_uncompleted_scheduled_anchor: Option<NaiveDate>,
    next_uncompleted_completion_anchor: Option<NaiveDate>,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Manifest {
    anchor_date: NaiveDate,
    case_count: usize,
    corpus_sha256: String,
    edge_case_count: usize,
    fail_open_case_count: usize,
    fail_open_probe_date: NaiveDate,
    generated_by: String,
    generated_case_count: usize,
    harvested_case_count: usize,
    model_entry_point: String,
    occurrence_date_count: usize,
    window_days: usize,
    window_end: NaiveDate,
    window_start: NaiveDate,
}

fn fixture_dir() -> PathBuf {
    // crates/tasknotes-core -> packages/tasknotes-core -> packages
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../tasknotes-fixtures/recurrence")
}

fn load() -> Result<(Manifest, Vec<Case>), Box<dyn Error>> {
    let dir = fixture_dir();
    let manifest: Manifest =
        serde_json::from_str(&std::fs::read_to_string(dir.join("manifest.json"))?)?;
    let corpus = std::fs::read_to_string(dir.join("corpus.jsonl"))?;
    let cases = corpus
        .lines()
        .filter(|line| !line.is_empty())
        .map(serde_json::from_str)
        .collect::<Result<Vec<Case>, _>>()?;
    Ok((manifest, cases))
}

fn date(iso: &str) -> Result<NaiveDate, Box<dyn Error>> {
    Ok(iso.parse()?)
}

impl Case {
    fn parse(&self) -> Recurrence {
        Recurrence::parse(
            &self.recurrence,
            self.scheduled.as_deref(),
            self.date_created.as_deref(),
        )
    }

    /// A label that names the case well enough to act on a failure without
    /// opening the fixture.
    fn label(&self) -> String {
        format!(
            "{} [{}/{}] recurrence={:?} scheduled={:?} dateCreated={:?}{}",
            self.id,
            self.group,
            self.source,
            self.recurrence,
            self.scheduled,
            self.date_created,
            self.note
                .as_ref()
                .map(|note| format!("\n    note: {note}"))
                .unwrap_or_default()
        )
    }
}

fn window(manifest: &Manifest) -> Result<DateWindow, Box<dyn Error>> {
    Ok(DateWindow::new(manifest.window_start, manifest.window_end)?)
}

/// Report at most this many differing dates per case; the point is to identify
/// the failure, not to dump five years of calendar.
const MAX_REPORTED: usize = 12;

fn describe(label: &str, expected: &BTreeSet<NaiveDate>, actual: &BTreeSet<NaiveDate>) -> String {
    let missing: Vec<_> = expected.difference(actual).take(MAX_REPORTED).collect();
    let extra: Vec<_> = actual.difference(expected).take(MAX_REPORTED).collect();
    format!(
        "{label}\n    expected {} dates, produced {}\n    missing: {missing:?}\n    extra:   {extra:?}",
        expected.len(),
        actual.len()
    )
}

#[test]
fn the_corpus_is_the_one_this_engine_was_written_against() -> Check {
    let (manifest, cases) = load()?;
    assert_eq!(cases.len(), manifest.case_count, "corpus line count");
    assert_eq!(manifest.case_count, 338);
    assert_eq!(manifest.window_start, date("2021-01-01")?);
    assert_eq!(manifest.window_end, date("2030-12-31")?);
    assert_eq!(manifest.window_days, window(&manifest)?.dates().count());
    assert_eq!(manifest.anchor_date, date("2026-01-01")?);
    assert_eq!(manifest.fail_open_probe_date, date("2019-01-01")?);
    assert_eq!(
        manifest.model_entry_point,
        "tasknotes-types/v2 -> @tasknotes/model"
    );
    assert_eq!(
        manifest.generated_by,
        "packages/tasks-for-obsidian/scripts/build-recurrence-corpus.ts"
    );
    assert_eq!(manifest.corpus_sha256.len(), 64);

    let distinct: BTreeSet<&str> = cases.iter().map(|case| case.recurrence.as_str()).collect();
    assert_eq!(distinct.len(), 323, "distinct rule strings");
    assert_eq!(
        cases
            .iter()
            .map(|case| case.occurrences.len())
            .sum::<usize>(),
        manifest.occurrence_date_count
    );
    assert_eq!(manifest.occurrence_date_count, 69_017);

    let by_source = |source: &str| cases.iter().filter(|case| case.source == source).count();
    assert_eq!(by_source("edge"), manifest.edge_case_count);
    assert_eq!(by_source("generated"), manifest.generated_case_count);
    assert_eq!(by_source("harvested"), manifest.harvested_case_count);
    assert_eq!(
        cases.iter().filter(|case| case.outcome == "always").count(),
        manifest.fail_open_case_count
    );
    Ok(())
}

/// The gate: every case's whole-window expansion, exactly.
#[test]
fn every_case_expands_to_exactly_the_recorded_dates() -> Check {
    let (manifest, cases) = load()?;
    let window = window(&manifest)?;
    let mut failures = Vec::new();

    for case in &cases {
        let recurrence = case.parse();
        let expected: BTreeSet<NaiveDate> = match case.outcome.as_str() {
            "always" => window.dates().collect(),
            "expanded" => case.occurrences.iter().copied().collect(),
            other => {
                failures.push(format!("{}: unknown outcome {other:?}", case.id));
                continue;
            }
        };
        let actual: BTreeSet<NaiveDate> = recurrence.occurrences(window).into_iter().collect();
        if actual != expected {
            failures.push(describe(&case.label(), &expected, &actual));
        }
        if actual.len() != case.occurrence_count {
            failures.push(format!(
                "{}\n    occurrenceCount is {}, produced {}",
                case.label(),
                case.occurrence_count,
                actual.len()
            ));
        }
    }

    assert!(
        failures.is_empty(),
        "{} of {} corpus cases diverged:\n\n{}",
        failures.len(),
        cases.len(),
        failures.join("\n\n")
    );
    Ok(())
}

/// The fail-open / fail-closed discriminator, asserted on its own because the
/// two directions are asymmetric and easy to collapse into one.
///
/// The probe date is strictly before every `DTSTART` the corpus can resolve, so
/// a `true` answer there can only have come from the engine's catch-all.
#[test]
fn the_fail_open_probe_separates_the_two_failure_directions() -> Check {
    let (manifest, cases) = load()?;
    let mut failures = Vec::new();
    for case in &cases {
        let expected = case.outcome == "always";
        let actual = case.parse().occurs_on(manifest.fail_open_probe_date);
        if actual != expected {
            failures.push(format!(
                "{}\n    at the probe date expected {expected}, produced {actual}",
                case.label()
            ));
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n\n"));
    Ok(())
}

/// `occurrences` must agree with `occurs_on` day by day, or the fast whole-window
/// path has drifted from the one the UI actually calls.
///
/// Probed rather than exhaustive: 338 cases x 3,652 days is 1.2M single-day
/// expansions, and the boundaries are where an inclusive/exclusive slip shows.
#[test]
fn the_single_day_query_agrees_with_the_whole_window_expansion() -> Check {
    let (manifest, cases) = load()?;
    let window = window(&manifest)?;
    let mut failures = Vec::new();

    for case in &cases {
        let recurrence = case.parse();
        let expanded: BTreeSet<NaiveDate> = recurrence.occurrences(window).into_iter().collect();
        let mut probes: BTreeSet<NaiveDate> = BTreeSet::new();
        probes.insert(manifest.window_start);
        probes.insert(manifest.window_end);
        for offset in -3..=3 {
            for anchor in [
                Some(manifest.anchor_date),
                case.first_occurrence,
                case.last_occurrence,
            ]
            .into_iter()
            .flatten()
            {
                if let Some(date) = anchor.checked_add_signed(chrono::Duration::days(offset))
                    && (manifest.window_start..=manifest.window_end).contains(&date)
                {
                    probes.insert(date);
                }
            }
        }
        for date in probes {
            let expected = expanded.contains(&date);
            let actual = recurrence.occurs_on(date);
            if actual != expected {
                failures.push(format!(
                    "{}\n    on {date} the window expansion says {expected} but occurs_on says {actual}",
                    case.label()
                ));
            }
        }
    }

    assert!(failures.is_empty(), "{}", failures.join("\n\n"));
    Ok(())
}

/// The first and last dates of the *raw* expansion.
///
/// For a fail-open case these describe the reference's second entry point
/// (`generateRecurringInstances`), which covers the whole window — except for
/// the empty rule, where that generator returns nothing at all while the
/// show-check returns true on every date. That divergence is real, is recorded
/// in the corpus, and is carved out here rather than papered over.
#[test]
fn the_expansion_bounds_and_generator_day_count_match() -> Check {
    let (manifest, cases) = load()?;
    let window = window(&manifest)?;
    let mut failures = Vec::new();

    for case in &cases {
        let empty_rule = case.recurrence.is_empty();
        let dates = if case.outcome == "always" && empty_rule {
            Vec::new()
        } else {
            case.parse().occurrences(window)
        };
        if dates.first().copied() != case.first_occurrence
            || dates.last().copied() != case.last_occurrence
            || dates.len() != case.generator_day_count
        {
            failures.push(format!(
                "{}\n    expected first={:?} last={:?} generatorDayCount={}\n    produced first={:?} last={:?} count={}",
                case.label(),
                case.first_occurrence,
                case.last_occurrence,
                case.generator_day_count,
                dates.first(),
                dates.last(),
                dates.len()
            ));
        }
    }

    assert!(failures.is_empty(), "{}", failures.join("\n\n"));
    Ok(())
}

#[test]
fn finite_instance_counts_match() -> Check {
    let (_, cases) = load()?;
    let mut failures = Vec::new();
    for case in &cases {
        let actual = case.parse().finite_instance_count();
        if actual != case.finite_instance_count {
            failures.push(format!(
                "{}\n    expected finiteInstanceCount {:?}, produced {actual:?}",
                case.label(),
                case.finite_instance_count
            ));
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n\n"));
    Ok(())
}

#[test]
fn the_next_uncompleted_occurrence_matches_for_both_anchors() -> Check {
    let (manifest, cases) = load()?;
    let mut failures = Vec::new();
    for case in &cases {
        let recurrence = case.parse();
        for (anchor, expected) in [
            (
                RecurrenceAnchor::Scheduled,
                case.next_uncompleted_scheduled_anchor,
            ),
            (
                RecurrenceAnchor::Completion,
                case.next_uncompleted_completion_anchor,
            ),
        ] {
            let actual =
                recurrence.next_uncompleted_occurrence(manifest.anchor_date, anchor, &[], &[]);
            if actual != expected {
                failures.push(format!(
                    "{}\n    {anchor:?} anchor: expected {expected:?}, produced {actual:?}",
                    case.label()
                ));
            }
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n\n"));
    Ok(())
}
