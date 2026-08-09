//! Unit tests for the pieces of the engine that the corpus exercises only
//! indirectly.
//!
//! The corpus itself is asserted from `tests/recurrence_corpus.rs`, which is
//! the actual parity gate; what lives here is the handful of behaviours worth
//! naming so a regression says *which* rule it broke.

use chrono::NaiveDate;

use super::{DateWindow, Frequency, Recurrence, completion_target_date};
use crate::domain::RecurrenceAnchor;

/// The corpus's default `scheduled`, a Monday.
const SCHEDULED: &str = "2026-01-05";

fn ymd(year: i32, month: u32, day: u32) -> NaiveDate {
    NaiveDate::from_ymd_opt(year, month, day).expect("a real calendar date")
}

fn parse(rule: &str) -> Recurrence {
    Recurrence::parse(rule, Some(SCHEDULED), None)
}

fn window(start: NaiveDate, end: NaiveDate) -> DateWindow {
    DateWindow::new(start, end).expect("an ordered window")
}

#[test]
fn a_window_cannot_be_inverted() {
    assert!(DateWindow::new(ymd(2026, 1, 2), ymd(2026, 1, 1)).is_err());
    assert_eq!(window(ymd(2026, 1, 1), ymd(2026, 1, 3)).dates().count(), 3);
}

#[test]
fn an_empty_rule_shows_the_task_on_every_date() {
    let recurrence = parse("");
    assert!(recurrence.occurs_on(ymd(2019, 1, 1)));
    assert!(recurrence.occurs_on(ymd(2030, 12, 31)));
    assert!(!recurrence.is_expandable());
}

#[test]
fn an_unparsable_rule_fails_open() {
    for rule in [
        "garbage",
        "FREQ=NONSENSE",
        "FREQ=DAILY;",
        "FREQ=DAILY;UNTIL=notadate",
    ] {
        assert!(
            parse(rule).occurs_on(ymd(2019, 1, 1)),
            "{rule} should fail open"
        );
    }
}

#[test]
fn a_missing_dtstart_fails_closed_even_for_garbage() {
    for rule in ["garbage", "FREQ=NONSENSE", "FREQ=DAILY"] {
        let recurrence = Recurrence::parse(rule, None, None);
        assert!(
            !recurrence.occurs_on(ymd(2026, 1, 5)),
            "{rule} should fail closed without a DTSTART source"
        );
    }
    // The empty rule is the sole exception: it short-circuits earlier still.
    assert!(Recurrence::parse("", None, None).occurs_on(ymd(2026, 1, 5)));
}

#[test]
fn scheduled_wins_over_date_created_and_an_embedded_dtstart_wins_over_both() {
    let by_created = Recurrence::parse("FREQ=WEEKLY;BYDAY=MO", None, Some("2026-01-07"));
    assert!(by_created.occurs_on(ymd(2026, 1, 12)));

    let embedded = Recurrence::parse(
        "DTSTART:20260220;FREQ=MONTHLY;BYMONTHDAY=20",
        Some("2026-06-15"),
        None,
    );
    assert!(embedded.occurs_on(ymd(2026, 2, 20)));
    assert!(!embedded.occurs_on(ymd(2026, 1, 20)));
}

#[test]
fn a_time_component_on_scheduled_is_discarded() {
    let recurrence = Recurrence::parse("FREQ=WEEKLY;BYDAY=MO", Some("2026-01-05T09:30:00Z"), None);
    assert!(recurrence.occurs_on(ymd(2026, 1, 5)));
    assert!(recurrence.occurs_on(ymd(2026, 1, 12)));
}

#[test]
fn a_dtstart_only_rule_becomes_yearly() {
    let recurrence = parse("DTSTART:20260105");
    assert_eq!(recurrence.frequency(), Some(Frequency::Yearly));
    assert_eq!(
        recurrence.occurrences(window(ymd(2026, 1, 1), ymd(2028, 12, 31))),
        vec![ymd(2026, 1, 5), ymd(2027, 1, 5), ymd(2028, 1, 5)]
    );
}

#[test]
fn yearly_bymonthday_expands_across_every_month() {
    // The corpus, not the RFC: rrule.js treats this as monthly.
    let dates =
        parse("FREQ=YEARLY;BYMONTHDAY=20").occurrences(window(ymd(2026, 1, 1), ymd(2026, 12, 31)));
    assert_eq!(dates.len(), 12);
    assert_eq!(dates.first(), Some(&ymd(2026, 1, 20)));
    assert_eq!(dates.last(), Some(&ymd(2026, 12, 20)));
}

#[test]
fn hostile_but_harmless_parts_still_fire() {
    for rule in ["FREQ=DAILY;WKST=XX", "FREQ=YEARLY;BYMONTH=0", ";FREQ=DAILY"] {
        assert!(parse(rule).is_expandable(), "{rule} should parse");
    }
    assert!(parse("FREQ=DAILY;WKST=XX").occurs_on(ymd(2026, 1, 6)));
    assert!(parse("FREQ=YEARLY;BYMONTH=0").occurs_on(ymd(2027, 1, 5)));
}

#[test]
fn hostile_parts_that_match_nothing_produce_no_occurrences() {
    for rule in [
        "FREQ=YEARLY;BYMONTH=13",
        "FREQ=MONTHLY;BYMONTHDAY=32",
        "FREQ=MONTHLY;BYMONTHDAY=0",
        "FREQ=DAILY;INTERVAL=0",
        "FREQ=DAILY;COUNT=0",
    ] {
        let dates = parse(rule).occurrences(window(ymd(2021, 1, 1), ymd(2030, 12, 31)));
        assert!(dates.is_empty(), "{rule} unexpectedly produced {dates:?}");
    }
}

#[test]
fn a_negative_count_is_ignored_but_a_non_numeric_one_collapses_to_one() {
    let unbounded =
        parse("FREQ=DAILY;COUNT=-5").occurrences(window(ymd(2026, 1, 5), ymd(2026, 1, 9)));
    assert_eq!(unbounded.len(), 5);

    let single =
        parse("FREQ=DAILY;COUNT=abc").occurrences(window(ymd(2026, 1, 5), ymd(2026, 1, 9)));
    assert_eq!(single, vec![ymd(2026, 1, 5)]);
}

#[test]
fn an_invalid_until_rolls_over_instead_of_being_rejected() {
    // 31 February 2026 is 3 March.
    let dates =
        parse("FREQ=DAILY;UNTIL=20260231").occurrences(window(ymd(2026, 2, 27), ymd(2026, 3, 10)));
    assert_eq!(dates.last(), Some(&ymd(2026, 3, 3)));
}

#[test]
fn a_hanging_interval_is_rejected_rather_than_expanded() {
    for rule in ["FREQ=DAILY;INTERVAL=-1", "FREQ=DAILY;INTERVAL=abc"] {
        let recurrence = parse(rule);
        assert!(!recurrence.is_expandable(), "{rule} must not expand");
        assert!(
            recurrence.occurs_on(ymd(2019, 1, 1)),
            "{rule} must fail open"
        );
    }
}

#[test]
fn expanding_a_rule_with_no_occurrences_is_bounded_by_the_window() {
    // The reference scans to the year 9999 here. The answer is the same; the
    // point of the test is that it returns at all.
    let dates =
        parse("FREQ=MONTHLY;BYMONTHDAY=32").occurrences(window(ymd(2021, 1, 1), ymd(2030, 12, 31)));
    assert!(dates.is_empty());
}

#[test]
fn finite_instance_counts() {
    assert_eq!(parse("FREQ=DAILY;COUNT=5").finite_instance_count(), Some(5));
    assert_eq!(parse("FREQ=DAILY;COUNT=0").finite_instance_count(), None);
    assert_eq!(parse("FREQ=DAILY").finite_instance_count(), None);
    // An UNTIL before DTSTART is None, not zero.
    assert_eq!(
        parse("FREQ=DAILY;UNTIL=20211231").finite_instance_count(),
        None
    );
}

#[test]
fn the_next_uncompleted_occurrence_skips_processed_instances() {
    let recurrence = parse("FREQ=DAILY");
    let today = ymd(2026, 1, 5);
    assert_eq!(
        recurrence.next_uncompleted_occurrence(today, RecurrenceAnchor::Scheduled, &[], &[]),
        Some(ymd(2026, 1, 5))
    );
    assert_eq!(
        recurrence.next_uncompleted_occurrence(
            today,
            RecurrenceAnchor::Scheduled,
            &[ymd(2026, 1, 5)],
            &[ymd(2026, 1, 6)],
        ),
        Some(ymd(2026, 1, 7))
    );
}

// ── completionTargetDate ───────────────────────────────────────────────────

#[test]
fn a_scheduled_anchored_completion_targets_the_scheduled_occurrence() {
    // The rent case: the rule fires on the 1st and it is the 12th. Targeting
    // the 12th would orphan the completion and the task would reappear.
    assert_eq!(
        completion_target_date(Some("2026-07-01"), None, None, ymd(2026, 7, 12)),
        ymd(2026, 7, 1)
    );
    assert_eq!(
        completion_target_date(
            Some("2026-07-01"),
            None,
            Some(RecurrenceAnchor::Scheduled),
            ymd(2026, 7, 12)
        ),
        ymd(2026, 7, 1)
    );
}

#[test]
fn a_completion_anchored_series_targets_today_instead() {
    assert_eq!(
        completion_target_date(
            Some("2026-07-01"),
            Some("2026-07-02"),
            Some(RecurrenceAnchor::Completion),
            ymd(2026, 7, 12)
        ),
        ymd(2026, 7, 12)
    );
}

#[test]
fn due_is_the_fallback_and_today_is_the_last_resort() {
    assert_eq!(
        completion_target_date(None, Some("2026-07-03"), None, ymd(2026, 7, 12)),
        ymd(2026, 7, 3)
    );
    assert_eq!(
        completion_target_date(None, None, None, ymd(2026, 7, 12)),
        ymd(2026, 7, 12)
    );
    // A value that carries no usable date falls through to the next field
    // rather than failing — the reference's `undefined` branch, not an error.
    assert_eq!(
        completion_target_date(Some("someday"), Some("2026-07-03"), None, ymd(2026, 7, 12)),
        ymd(2026, 7, 3)
    );
    assert_eq!(
        completion_target_date(Some(""), None, None, ymd(2026, 7, 12)),
        ymd(2026, 7, 12)
    );
}

#[test]
fn a_datetime_target_is_the_day_it_writes_down() {
    // Read as the written date, never shifted into a viewer's zone: the
    // occurrence list the plugin matches against is keyed on the former.
    assert_eq!(
        completion_target_date(Some("2026-07-11T02:00:00Z"), None, None, ymd(2026, 7, 12)),
        ymd(2026, 7, 11)
    );
    assert_eq!(
        completion_target_date(Some("2026-07-10 15:30"), None, None, ymd(2026, 7, 12)),
        ymd(2026, 7, 10)
    );
    // Unpadded and impossible dates are not usable date parts.
    assert_eq!(
        completion_target_date(Some("2026-7-1"), None, None, ymd(2026, 7, 12)),
        ymd(2026, 7, 12)
    );
    assert_eq!(
        completion_target_date(Some("2026-02-30"), None, None, ymd(2026, 7, 12)),
        ymd(2026, 7, 12)
    );
}
