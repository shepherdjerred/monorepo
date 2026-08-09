//! Recurrence expansion, as free functions over ISO dates.
//!
//! ## Why free functions and not an object
//!
//! [`tasknotes_core::recurrence::Recurrence`] holds a boxed private options
//! struct, so it cannot be a UniFFI `Record`; the obvious alternative is an
//! `Object` handle the host parses once and reuses. Phase 2 recommended against
//! it and Phase 6 agreed, for a reason that is about lifetimes rather than
//! performance: a `Recurrence` is derived from three *fields of a task*
//! (`recurrence`, `scheduled`, `dateCreated`), and a task is replaced wholesale
//! every time the store rebases. A handle would therefore need invalidating on
//! every snapshot, and a stale one answers questions about a task that no longer
//! exists — silently, because the rule that produced it is still perfectly
//! valid text. Passing the three fields per call makes staleness
//! unrepresentable.
//!
//! Parsing is cheap and the alternative is a correctness hazard, so the trade is
//! not close.
//!
//! ## ISO strings, and one place they are deliberately not parsed
//!
//! Dates cross as `YYYY-MM-DD`, matching [`crate::dates`] and the vocabulary
//! `Task` already uses. But `scheduled` and `date_created` are passed through
//! **raw**: they are the task's stored values, which may be a bare date, a full
//! instant, or something a human typed by hand, and the core's `DTSTART`
//! resolution has its own exact reading of each shape — including which
//! malformed values fail *open* and which fail *closed*. Validating them here
//! would answer a question the reference answers differently.
//!
//! ## Fail open
//!
//! An empty or unparsable rule means **show the task**. A port that returns
//! `false` there makes tasks silently vanish. The one asymmetric exception —
//! a rule with no resolvable `DTSTART` fails *closed* — is the reference's own
//! behaviour and is reproduced, not smoothed over.

use tasknotes_core::{
    domain::RecurrenceAnchor,
    recurrence::{DateWindow, Frequency, Recurrence},
};

use crate::{
    dates::{parse_iso_date, render_iso_date},
    error::CoreError,
};

/// The two `DTSTART` fallbacks, owned for as long as the parse borrows them.
///
/// UniFFI lifts arguments *out of* the FFI buffer, so a `String` arrives owned
/// and there is no borrow on the far side to hand across. `Recurrence::parse`
/// wants `Option<&str>`, so the owned values have to outlive the call; grouping
/// them here is what gives them a name to live in.
struct Fallbacks {
    /// The task's `scheduled` field, exactly as stored.
    scheduled: Option<String>,
    /// The task's `dateCreated` field, exactly as stored.
    date_created: Option<String>,
}

impl Fallbacks {
    /// Parse `text` against these fallbacks.
    ///
    /// `scheduled` wins over `date_created`, and an embedded `DTSTART:` wins
    /// over both. Never fails: every unparsable input resolves to one of the
    /// two documented failure behaviours instead.
    fn rule(&self, text: &str) -> Recurrence {
        Recurrence::parse(
            text,
            self.scheduled.as_deref(),
            self.date_created.as_deref(),
        )
    }
}

/// Whether the task has an occurrence on `date`.
///
/// The parity surface: this answers exactly what the reference's
/// `shouldShowRecurringTaskOnDate` answers, including both failure directions.
///
/// # Errors
///
/// Returns [`CoreError::Validation`] when `date` is not a `YYYY-MM-DD` date.
#[uniffi::export]
pub fn recurrence_occurs_on(
    text: &str,
    scheduled: Option<String>,
    date_created: Option<String>,
    date: &str,
) -> Result<bool, CoreError> {
    Ok(Fallbacks {
        scheduled,
        date_created,
    }
    .rule(text)
    .occurs_on(parse_iso_date(date)?))
}

/// Every date in `start..=end` on which the task has an occurrence.
///
/// **Inclusive on both ends**, matching rrule.js's `between` with `inc` true.
/// Expanded in one pass rather than one query per day, because the reference
/// scans to its year bound before conceding a rule has no occurrences — which
/// makes a per-day loop quadratic in exactly the cases that are already
/// slowest.
///
/// # Errors
///
/// Returns [`CoreError::Validation`] when either bound is not a `YYYY-MM-DD`
/// date, or [`CoreError::Invariant`] when `end` precedes `start`.
#[uniffi::export]
pub fn recurrence_occurrences(
    text: &str,
    scheduled: Option<String>,
    date_created: Option<String>,
    start: &str,
    end: &str,
) -> Result<Vec<String>, CoreError> {
    let window = DateWindow::new(parse_iso_date(start)?, parse_iso_date(end)?)?;
    Ok(Fallbacks {
        scheduled,
        date_created,
    }
    .rule(text)
    .occurrences(window)
    .into_iter()
    .map(render_iso_date)
    .collect())
}

/// The rule's frequency, or `None` when it did not parse.
#[uniffi::export]
#[must_use]
pub fn recurrence_frequency(
    text: &str,
    scheduled: Option<String>,
    date_created: Option<String>,
) -> Option<Frequency> {
    Fallbacks {
        scheduled,
        date_created,
    }
    .rule(text)
    .frequency()
}

/// Whether the rule is one the engine could expand at all.
///
/// `false` covers both failure directions — an unparsable rule and one with no
/// resolvable `DTSTART` — which behave differently in
/// [`recurrence_occurs_on`], so this is a diagnostic rather than a predicate to
/// branch display on.
#[uniffi::export]
#[must_use]
pub fn recurrence_is_expandable(
    text: &str,
    scheduled: Option<String>,
    date_created: Option<String>,
) -> bool {
    Fallbacks {
        scheduled,
        date_created,
    }
    .rule(text)
    .is_expandable()
}

/// How many instances the series has in total, when that is finite and knowable.
///
/// `None` covers three situations the reference also conflates: the rule is
/// unbounded, its `UNTIL` precedes its `DTSTART`, or the series is longer than
/// the reference's own 10,000-instance ceiling.
///
/// # Errors
///
/// Returns [`CoreError::Invariant`] if a count somehow exceeds its exported
/// width — unreachable below that ceiling, and reported rather than clamped
/// because a clamped count is a lie the UI would render as a number.
#[uniffi::export]
pub fn recurrence_finite_instance_count(
    text: &str,
    scheduled: Option<String>,
    date_created: Option<String>,
) -> Result<Option<u32>, CoreError> {
    Fallbacks {
        scheduled,
        date_created,
    }
    .rule(text)
    .finite_instance_count()
    .map(|count| {
        u32::try_from(count).map_err(|_| CoreError::Invariant {
            message: format!("the finite instance count {count} does not fit in a u32"),
        })
    })
    .transpose()
}

/// The next occurrence at or after `today` that has neither been completed nor
/// skipped.
///
/// The two anchors search different ranges on purpose: a scheduled-anchored
/// series reaches back to its `DTSTART` so a long-overdue occurrence still
/// surfaces, while a completion-anchored one starts at the `DTSTART` the last
/// completion rewrote and skips it.
///
/// `complete_instances` and `skipped_instances` are the task's stored lists.
/// An entry that is not a `YYYY-MM-DD` date is **ignored**, and that is not a
/// swallowed error: the reference compares these lists as *strings* against a
/// rendered occurrence date, so a value that is not a date can never match one.
/// Filtering it out is provably the same computation, not a fallback.
///
/// # Errors
///
/// Returns [`CoreError::Validation`] when `today` is not a `YYYY-MM-DD` date.
#[uniffi::export]
pub fn recurrence_next_uncompleted_occurrence(
    text: &str,
    scheduled: Option<String>,
    date_created: Option<String>,
    today: &str,
    anchor: RecurrenceAnchor,
    complete_instances: Vec<String>,
    skipped_instances: Vec<String>,
) -> Result<Option<String>, CoreError> {
    let dates = |values: Vec<String>| {
        values
            .iter()
            .filter_map(|value| parse_iso_date(value).ok())
            .collect::<Vec<_>>()
    };
    Ok(Fallbacks {
        scheduled,
        date_created,
    }
    .rule(text)
    .next_uncompleted_occurrence(
        parse_iso_date(today)?,
        anchor,
        &dates(complete_instances),
        &dates(skipped_instances),
    )
    .map(render_iso_date))
}

#[cfg(test)]
mod tests {
    use tasknotes_core::{domain::RecurrenceAnchor, recurrence::Frequency};

    /// A Monday, so the weekly rules below start on their own `BYDAY`.
    const SCHEDULED: &str = "2026-08-03";

    use super::{
        recurrence_finite_instance_count, recurrence_frequency, recurrence_is_expandable,
        recurrence_next_uncompleted_occurrence, recurrence_occurrences, recurrence_occurs_on,
    };
    use crate::error::CoreError;

    /// The `scheduled` fallback every rule below resolves its `DTSTART` from.
    fn scheduled() -> String {
        SCHEDULED.to_owned()
    }

    #[test]
    fn a_weekly_rule_expands_inclusively_on_both_ends() {
        let dates = recurrence_occurrences(
            "FREQ=WEEKLY;BYDAY=MO",
            Some(scheduled()),
            None,
            "2026-08-03",
            "2026-08-24",
        )
        .unwrap();
        assert_eq!(
            dates,
            ["2026-08-03", "2026-08-10", "2026-08-17", "2026-08-24"],
            "both bounds are included"
        );
        assert!(
            recurrence_occurs_on(
                "FREQ=WEEKLY;BYDAY=MO",
                Some(scheduled()),
                None,
                "2026-08-10"
            )
            .unwrap()
        );
        assert!(
            !recurrence_occurs_on(
                "FREQ=WEEKLY;BYDAY=MO",
                Some(scheduled()),
                None,
                "2026-08-11"
            )
            .unwrap()
        );
        assert_eq!(
            recurrence_frequency("FREQ=WEEKLY;BYDAY=MO", Some(scheduled()), None),
            Some(Frequency::Weekly)
        );
        assert!(recurrence_is_expandable(
            "FREQ=WEEKLY;BYDAY=MO",
            Some(scheduled()),
            None
        ));
    }

    #[test]
    fn an_unparsable_rule_fails_open_and_a_rootless_one_fails_closed() {
        // Fail open: the rule is empty, so the task shows.
        assert!(recurrence_occurs_on("", Some(scheduled()), None, "2026-08-11").unwrap());
        // Fail closed: no DTSTART can be resolved at all, so it does not.
        assert!(!recurrence_occurs_on("garbage", None, None, "2026-08-11").unwrap());
        assert!(!recurrence_is_expandable("garbage", None, None));
        assert_eq!(recurrence_frequency("garbage", None, None), None);
    }

    #[test]
    fn a_counted_rule_reports_its_length_and_an_unbounded_one_does_not() {
        assert_eq!(
            recurrence_finite_instance_count("FREQ=DAILY;COUNT=5", Some(scheduled()), None)
                .unwrap(),
            Some(5)
        );
        assert_eq!(
            recurrence_finite_instance_count("FREQ=DAILY", Some(scheduled()), None).unwrap(),
            None
        );
    }

    #[test]
    fn the_next_occurrence_skips_the_dates_the_task_already_recorded() {
        let next = recurrence_next_uncompleted_occurrence(
            "FREQ=WEEKLY;BYDAY=MO",
            Some(scheduled()),
            None,
            "2026-08-10",
            RecurrenceAnchor::Scheduled,
            vec!["2026-08-10".to_owned()],
            vec![],
        )
        .unwrap();
        assert_eq!(next.as_deref(), Some("2026-08-17"));
    }

    #[test]
    fn a_non_date_in_a_stored_instance_list_cannot_match_and_is_ignored() {
        // Identical to the reference's string comparison: a value that is not a
        // rendered date never equals one, so dropping it changes nothing.
        let with_junk = recurrence_next_uncompleted_occurrence(
            "FREQ=WEEKLY;BYDAY=MO",
            Some(scheduled()),
            None,
            "2026-08-10",
            RecurrenceAnchor::Scheduled,
            vec!["not-a-date".to_owned(), "2026-08-10".to_owned()],
            vec![],
        )
        .unwrap();
        let without_junk = recurrence_next_uncompleted_occurrence(
            "FREQ=WEEKLY;BYDAY=MO",
            Some(scheduled()),
            None,
            "2026-08-10",
            RecurrenceAnchor::Scheduled,
            vec!["2026-08-10".to_owned()],
            vec![],
        )
        .unwrap();
        assert_eq!(with_junk, without_junk);
    }

    #[test]
    fn an_inverted_window_is_rejected_rather_than_silently_empty() {
        let error = recurrence_occurrences(
            "FREQ=DAILY",
            Some(scheduled()),
            None,
            "2026-08-10",
            "2026-08-01",
        )
        .unwrap_err();
        assert!(
            matches!(error, CoreError::Invariant { ref message } if message.contains("date window")),
            "unexpected error: {error:?}"
        );
    }

    #[test]
    fn a_malformed_boundary_date_is_a_validation_failure() {
        let error =
            recurrence_occurs_on("FREQ=DAILY", Some(scheduled()), None, "08/10/2026").unwrap_err();
        assert!(
            matches!(error, CoreError::Validation { ref message } if message.contains("YYYY-MM-DD")),
            "unexpected error: {error:?}"
        );
    }
}
