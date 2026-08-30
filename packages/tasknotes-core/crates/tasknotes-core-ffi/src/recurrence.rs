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
    recurrence::{
        CommonRecurrenceDraft, DateWindow, Frequency, Recurrence, build_common_recurrence,
        completion_target_date, parse_common_recurrence,
    },
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

/// Parse a rule into the closed common-pattern editor model.
///
/// `None` means the rule cannot be represented losslessly. The host must keep
/// the raw rule authoritative until the user explicitly replaces it.
#[uniffi::export]
#[must_use]
pub fn recurrence_parse_common(text: &str, start: &str) -> Option<CommonRecurrenceDraft> {
    parse_common_recurrence(text, start)
}

/// Return the effective Gregorian start date used to interpret a task rule.
///
/// Native editors use this for implicit calendar selectors. It follows the
/// same embedded `DTSTART`, `scheduled`, and `dateCreated` precedence as every
/// other recurrence operation in the core.
#[uniffi::export]
#[must_use]
pub fn recurrence_resolved_start(
    text: &str,
    scheduled: Option<String>,
    date_created: Option<String>,
) -> Option<String> {
    Fallbacks {
        scheduled,
        date_created,
    }
    .rule(text)
    .resolved_start()
    .map(render_iso_date)
}

/// Validate and canonically serialize the common-pattern editor model.
///
/// # Errors
///
/// Returns [`CoreError::Validation`] when any date or numeric constraint is
/// invalid.
#[uniffi::export]
pub fn recurrence_build_common(
    draft: CommonRecurrenceDraft,
    start: &str,
) -> Result<String, CoreError> {
    Ok(build_common_recurrence(
        &CommonRecurrenceDraft {
            interval: draft.interval,
            pattern: draft.pattern,
            ending: draft.ending,
        },
        start,
    )?)
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

/// The rule as a sentence — `"Every 2 weeks on Mon, Wed"`.
///
/// The one recurrence question a shell cannot answer for itself.
/// [`recurrence_frequency`] carries `FREQ` and nothing else, so a sentence
/// assembled from it drops `INTERVAL`, `BYDAY`, `BYMONTHDAY`, `BYMONTH`,
/// `BYSETPOS`, `COUNT` and `UNTIL` — printing "Weekly" over a rule that fires
/// every *other* Tuesday, which is a thing the reader would believe and then
/// be wrong about. Restating the RFC 5545 grammar per platform is the
/// duplication this core exists to delete.
///
/// The sentence is read off the **normalised, expandable** rule rather than off
/// the raw text, so it cannot disagree with the days
/// [`recurrence_occurrences`] produces.
///
/// `None` means "no honest sentence", and covers three situations a shell
/// should render identically — by showing the raw `RRULE`:
///
/// * the rule is empty, unparsable, or has no resolvable `DTSTART`, exactly as
///   [`recurrence_is_expandable`] reports;
/// * it uses a part with no unambiguous one-line reading — `BYWEEKNO`,
///   `BYYEARDAY`, `BYEASTER`, an explicit `BYHOUR`/`BYMINUTE`/`BYSECOND`, or a
///   weekday selector crossed with a day-of-month selector, which is an
///   intersection that a comma-joined list would misread as a union;
/// * it fires zero times.
///
/// English and locale-independent, the same posture as
/// [`crate::calendar::calendar_month_title`] and the weekday headers; embedded
/// dates are ISO `YYYY-MM-DD`, like every other date on this boundary.
#[uniffi::export]
#[must_use]
pub fn recurrence_summary(
    text: &str,
    scheduled: Option<String>,
    date_created: Option<String>,
) -> Option<String> {
    Fallbacks {
        scheduled,
        date_created,
    }
    .rule(text)
    .summary()
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
/// ## ⚠️ `None` means "no knowable number", **not** "repeats forever"
///
/// This is the one place on this boundary where the obvious rendering of `None`
/// is wrong, so it is stated rather than left to be inferred. `None` covers four
/// situations the reference conflates, and only the first of them is "unbounded":
///
/// 1. the rule has no `COUNT` and no `UNTIL`;
/// 2. its `UNTIL` precedes its `DTSTART`, so the series is *empty* — the
///    opposite of endless;
/// 3. the series is longer than the reference's own 10,000-instance ceiling,
///    which is a refusal to count, not a statement that counting is impossible;
/// 4. `COUNT` is present but not a number — `COUNT=abc` — which this function
///    reads with a digits-only regex and gives up on, while the expansion
///    decrements it to `NaN` and stops after **exactly one** occurrence.
///
/// A host that prints "Repeats indefinitely" for `None` therefore contradicts
/// [`recurrence_summary`], which reads the *normalised* rule and answers "Every
/// day, once" for case 4 and "until 2030-12-31" for case 3.
///
/// **The summary is the authority on whether and when a rule stops; this
/// function is a supplementary number, and it should be shown only when it is
/// one.** The disagreement is not a porting defect and is deliberately not
/// repaired here: `getFiniteRecurringInstanceCount` lives in `@tasknotes/model`,
/// a third-party package this repository does not own, and
/// `@tasknotes/fixtures` records its answers — case 4 is pinned by
/// `0313-malformed-freq-daily-count-abc` as `finiteInstanceCount: null` beside
/// `occurrenceCount: 1`. Moving this function would make the corpus disagree
/// with the oracle that generates it.
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

/// The occurrence date a completion gesture on a **recurring** task targets.
///
/// The single most consequential thing a task list can get wrong: a recurring
/// task completes its *scheduled occurrence*, not the calendar day of the
/// click. Completing a rule that fires on the 1st while it is the 12th must
/// record `…-01`; recording `…-12` orphans the entry against a day the rule
/// never fires on, so the occurrence still reads as open and the task reappears
/// as if untouched.
///
/// Exported because there is no honest way for a shell to compute it: it reads
/// `scheduled`/`due` with the reference's own `getDatePart`, which is a
/// *written-date* reading and diverges from [`crate::dates::date_parse_local`]
/// for zoned values. Two shells reimplementing that divergence is the failure
/// mode this core exists to remove.
///
/// `anchor` is the task's, and `None` reads as
/// [`RecurrenceAnchor::Scheduled`] — a completion-anchored series measures from
/// when you finished, so its target is `today`. `today` is the host's, because
/// only the host knows the device's calendar.
///
/// Callers gate on the task actually being recurring; for a plain task the
/// gesture sets `status`, and no date is involved.
///
/// # Errors
///
/// Returns [`CoreError::Validation`] when `today` is not a `YYYY-MM-DD` date.
#[uniffi::export]
pub fn recurrence_completion_target_date(
    scheduled: Option<String>,
    due: Option<String>,
    anchor: Option<RecurrenceAnchor>,
    today: &str,
) -> Result<String, CoreError> {
    // Same shape and same reason as `Fallbacks` above: UniFFI lifts arguments
    // out of the buffer owned, and the core wants `Option<&str>`, so the owned
    // values need a named place to outlive the borrow.
    let fields = TargetFields { scheduled, due };
    Ok(render_iso_date(completion_target_date(
        fields.scheduled.as_deref(),
        fields.due.as_deref(),
        anchor,
        parse_iso_date(today)?,
    )))
}

/// The two task fields a completion target is read from.
struct TargetFields {
    /// The task's `scheduled` field, exactly as stored.
    scheduled: Option<String>,
    /// The task's `due` field, exactly as stored.
    due: Option<String>,
}

#[cfg(test)]
mod tests {
    use tasknotes_core::{domain::RecurrenceAnchor, recurrence::Frequency};

    /// A Monday, so the weekly rules below start on their own `BYDAY`.
    const SCHEDULED: &str = "2026-08-03";

    use super::{
        recurrence_completion_target_date, recurrence_finite_instance_count, recurrence_frequency,
        recurrence_is_expandable, recurrence_next_uncompleted_occurrence, recurrence_occurrences,
        recurrence_occurs_on, recurrence_resolved_start, recurrence_summary,
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
    fn a_rule_crosses_as_a_sentence_or_as_nothing_at_all() {
        assert_eq!(
            recurrence_summary(
                "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE",
                Some(scheduled()),
                None
            )
            .as_deref(),
            Some("Every 2 weeks on Mon, Wed"),
            "the string the task inspector needs, and cannot build from Frequency alone"
        );
        assert_eq!(
            recurrence_summary("FREQ=MONTHLY;BYDAY=-1FR;COUNT=6", Some(scheduled()), None)
                .as_deref(),
            Some("Every month on the last Friday, 6 times")
        );
        // Every failure the shell must render as the raw rule, in one shape.
        assert_eq!(recurrence_summary("", Some(scheduled()), None), None);
        assert_eq!(recurrence_summary("garbage", Some(scheduled()), None), None);
        assert_eq!(recurrence_summary("FREQ=DAILY", None, None), None);
        assert_eq!(
            recurrence_summary("FREQ=YEARLY;BYWEEKNO=20", Some(scheduled()), None),
            None,
            "a part with no honest one-line reading declines rather than guessing"
        );
    }

    #[test]
    fn a_common_editor_uses_the_core_effective_start() {
        assert_eq!(
            recurrence_resolved_start("FREQ=WEEKLY", None, Some("2026-08-04T12:00:00Z".to_owned()))
                .as_deref(),
            Some("2026-08-04")
        );
        assert_eq!(
            recurrence_resolved_start(
                "FREQ=WEEKLY",
                Some("2026-08-05".to_owned()),
                Some("2026-08-04".to_owned())
            )
            .as_deref(),
            Some("2026-08-05")
        );
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

    /// The count and the summary disagree, and the disagreement is pinned here
    /// so no shell rediscovers it by drawing "Repeats indefinitely" beside
    /// "Every day, once".
    ///
    /// `getFiniteRecurringInstanceCount` reads `COUNT` out of the raw text with
    /// a digits-only regex; the expansion normalises `COUNT=abc` to `NaN` and
    /// stops after one occurrence. `@tasknotes/fixtures` records the *reference's*
    /// answer for both — `finiteInstanceCount: null` beside `occurrenceCount: 1`
    /// in `0313-malformed-freq-daily-count-abc` — so this is parity, not a bug
    /// the port introduced, and the summary is the accurate half.
    #[test]
    fn the_count_declines_where_the_summary_can_still_answer() {
        assert_eq!(
            recurrence_finite_instance_count("FREQ=DAILY;COUNT=abc", Some(scheduled()), None)
                .unwrap(),
            None,
            "no knowable number — which is not the same as 'no end'"
        );
        assert_eq!(
            recurrence_summary("FREQ=DAILY;COUNT=abc", Some(scheduled()), None).as_deref(),
            Some("Every day, once"),
            "…and the rule in fact fires exactly once"
        );

        // The same shape one ceiling up: a daily rule running to 3000 is far
        // past the reference's 10,000-instance limit, so the count declines
        // while the summary still names the end date.
        assert_eq!(
            recurrence_finite_instance_count("FREQ=DAILY;UNTIL=30000101", Some(scheduled()), None)
                .unwrap(),
            None
        );
        assert_eq!(
            recurrence_summary("FREQ=DAILY;UNTIL=30000101", Some(scheduled()), None).as_deref(),
            Some("Every day, until 3000-01-01")
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
    fn a_completion_targets_the_scheduled_occurrence_and_not_the_day_of_the_click() {
        // The rent case, end to end across the boundary: the rule fires on the
        // 1st, it is the 12th, and the date recorded must be the 1st.
        assert_eq!(
            recurrence_completion_target_date(
                Some("2026-07-01".to_owned()),
                None,
                None,
                "2026-07-12"
            )
            .unwrap(),
            "2026-07-01"
        );
        // A completion-anchored series measures from when you finished.
        assert_eq!(
            recurrence_completion_target_date(
                Some("2026-07-01".to_owned()),
                None,
                Some(RecurrenceAnchor::Completion),
                "2026-07-12"
            )
            .unwrap(),
            "2026-07-12"
        );
        // `due` is the fallback; today is the last resort.
        assert_eq!(
            recurrence_completion_target_date(
                None,
                Some("2026-07-03".to_owned()),
                None,
                "2026-07-12"
            )
            .unwrap(),
            "2026-07-03"
        );
        assert_eq!(
            recurrence_completion_target_date(None, None, None, "2026-07-12").unwrap(),
            "2026-07-12"
        );
    }

    #[test]
    fn a_malformed_today_is_a_validation_failure_rather_than_a_guess() {
        let error = recurrence_completion_target_date(None, None, None, "07/12/2026").unwrap_err();
        assert!(
            matches!(error, CoreError::Validation { ref message } if message.contains("YYYY-MM-DD")),
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
