//! Turning a parsed rule into a sentence a person can read.
//!
//! ## Why this is in the core and not in a shell
//!
//! [`Frequency`] carries `FREQ` and nothing else, so a sentence assembled in
//! Swift or C# from it alone silently drops `INTERVAL`, `BYDAY`, `BYMONTHDAY`,
//! `BYMONTH` and `BYSETPOS` — printing "Weekly" over a rule that fires every
//! *other* Tuesday. That is not a cosmetic error: the reader believes something
//! false about when their task repeats and finds out by missing it. The
//! alternative is restating the RFC 5545 grammar once per platform, which is
//! the duplication this core exists to delete.
//!
//! ## It describes the *expansion*, not the text
//!
//! Every phrase below is read off the normalised [`Options`], never off the raw
//! rule string. That is deliberate and it is what makes the sentence
//! unfalsifiable: the same option set decides which days the engine emits, so
//! the summary cannot disagree with the list. It also means the `DTSTART`
//! inheritance quirks are *described* rather than hidden — a bare
//! `FREQ=WEEKLY` anchored to a Monday reads "Every week on Mon", because that
//! is precisely what it does.
//!
//! ## `None` is a refusal, not a failure
//!
//! A rule using `BYWEEKNO`, `BYYEARDAY`, `BYEASTER`, an explicit
//! `BYHOUR`/`BYMINUTE`/`BYSECOND`, a month or weekday index that names nothing,
//! a day-of-week selector crossed with a day-of-month selector, or one that
//! fires zero times, answers `None`. Those either have no unambiguous
//! one-sentence English reading or would need a paraphrase this module cannot
//! guarantee is true. The shell then shows the raw `RRULE`, which is honest —
//! a wrong summary is strictly worse than no summary.
//!
//! ## English, deliberately
//!
//! Same posture as [`crate::calendar::CalendarMonth::title`] and
//! [`crate::calendar::WEEKDAYS`]: hard-coded English, because the app already
//! ships hard-coded English there and a shared core cannot ask a platform for
//! its locale. Dates inside the sentence are ISO `YYYY-MM-DD`, matching every
//! other date on this boundary. A shell that wants a localized rule string
//! should build one from the same [`Options`]-level facts, not reformat this.

use crate::dates::to_iso_date;

use super::instant::{self, MS_PER_DAY};
use super::options::{CountLimit, NumberSet, Options};
use super::text::Frequency;

/// Weekday names by python weekday index, Monday first — matching the
/// numbering [`super::text`] parses `BYDAY` into.
const WEEKDAY_SHORT: [&str; 7] = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/// The same seven, spelled out, for the ordinal `BYDAY` phrases where an
/// abbreviation reads badly ("the 1st Mon").
const WEEKDAY_LONG: [&str; 7] = [
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
    "Sunday",
];

/// Month names by `BYMONTH` value minus one.
const MONTHS: [&str; 12] = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
];

/// Describe a normalised rule, or decline.
///
/// See the module docs for exactly which rules are declined and why that is the
/// right answer rather than a gap.
pub(super) fn describe(options: &Options) -> Option<String> {
    if !is_describable(options) {
        return None;
    }

    let mut sentence = cadence(options);
    for (lead, clause) in [
        (" in ", month_phrase(&options.month)),
        (" on ", day_phrase(options)),
        (", keeping only the ", setpos_phrase(&options.setpos)),
        (", ", bound_phrase(options)),
    ] {
        match clause {
            Clause::Undescribable => return None,
            Clause::Absent => {}
            Clause::Text(text) => {
                sentence.push_str(lead);
                sentence.push_str(&text);
            }
        }
    }
    Some(sentence)
}

/// One optional clause of the sentence.
///
/// A three-state answer rather than an `Option<Option<String>>`, because the
/// two `None`s are not the same thing and reading them off a nested option at a
/// call site is exactly the kind of quiet mix-up this module is meant not to
/// make.
enum Clause {
    /// No honest phrasing exists for this part, so the whole summary declines.
    Undescribable,
    /// The rule says nothing on this subject.
    Absent,
    /// The clause text, ready to append.
    Text(String),
}

/// Whether every part of this rule has an unambiguous English reading.
fn is_describable(options: &Options) -> bool {
    // Parts with no defensible one-line paraphrase.
    if !options.yearday.is_empty() || !options.weekno.is_empty() || options.easter.is_some() {
        return false;
    }
    // A time-of-day set changes an instance count without changing a day, so a
    // day-shaped sentence cannot report the length honestly. See
    // `Options::time_parts_specified`.
    if options.time_parts_specified {
        return false;
    }
    // Rules that never fire. "Every 0 weeks" and "0 times" are not sentences;
    // the raw rule is the honest thing to show.
    if options.interval == 0 || options.count == CountLimit::Zero {
        return false;
    }
    // A weekday selector crossed with a day-of-month selector is an
    // *intersection* — `BYDAY=FR;BYMONTHDAY=13` is Friday the 13th, not "Fri
    // or the 13th". A comma-joined list would read as the union, so decline
    // rather than assert the wrong one. Only reachable when the rule names both
    // itself: `DTSTART` inheritance never adds a second selector.
    let names_weekday = !options.weekday.is_empty() || !options.nth_weekday.is_empty();
    let names_monthday = !options.monthday.is_empty() || !options.monthday_from_end.is_empty();
    !(names_weekday && names_monthday)
}

/// "Every week" / "Every 2 weeks".
fn cadence(options: &Options) -> String {
    let (singular, plural) = match options.freq {
        Frequency::Yearly => ("year", "years"),
        Frequency::Monthly => ("month", "months"),
        Frequency::Weekly => ("week", "weeks"),
        Frequency::Daily => ("day", "days"),
        Frequency::Hourly => ("hour", "hours"),
        Frequency::Minutely => ("minute", "minutes"),
        Frequency::Secondly => ("second", "seconds"),
    };
    if options.interval == 1 {
        format!("Every {singular}")
    } else {
        format!("Every {} {plural}", options.interval)
    }
}

/// "January, March".
///
/// [`Clause::Undescribable`] for a value that is no month at all —
/// `BYMONTH=13` parses, survives normalisation, and then matches nothing, so
/// there is no month to name and no honest sentence to build around it.
fn month_phrase(months: &NumberSet) -> Clause {
    if months.numbers().is_empty() {
        return Clause::Absent;
    }
    let mut named = Vec::with_capacity(months.numbers().len());
    for month in months.numbers() {
        let Some(name) = month
            .checked_sub(1)
            .and_then(|index| usize::try_from(index).ok())
            .and_then(|index| MONTHS.get(index))
        else {
            return Clause::Undescribable;
        };
        named.push(*name);
    }
    Clause::Text(named.join(", "))
}

/// The day-selecting clause: "Mon, Wed", "the last Friday", "day 1, 15".
fn day_phrase(options: &Options) -> Clause {
    let mut parts: Vec<String> = Vec::new();

    for (weekday, ordinal) in &options.nth_weekday {
        let (Some(name), Some(position)) = (
            WEEKDAY_LONG.get(usize::from(*weekday)),
            ordinal_word(*ordinal),
        ) else {
            return Clause::Undescribable;
        };
        parts.push(format!("the {position} {name}"));
    }
    for weekday in &options.weekday {
        let Some(name) = WEEKDAY_SHORT.get(usize::from(*weekday)) else {
            return Clause::Undescribable;
        };
        parts.push((*name).to_owned());
    }
    if !options.monthday.numbers().is_empty() {
        let days: Vec<String> = options
            .monthday
            .numbers()
            .iter()
            .map(i64::to_string)
            .collect();
        parts.push(format!("day {}", days.join(", ")));
    }
    for day in options.monthday_from_end.numbers() {
        let Some(magnitude) = day.checked_neg() else {
            return Clause::Undescribable;
        };
        if magnitude == 1 {
            parts.push("the last day".to_owned());
        } else {
            let Some(position) = english_ordinal(magnitude) else {
                return Clause::Undescribable;
            };
            parts.push(format!("the {position}-to-last day"));
        }
    }

    if parts.is_empty() {
        Clause::Absent
    } else {
        Clause::Text(parts.join(", "))
    }
}

/// "last", or "1st, 3rd" — what `BYSETPOS` keeps out of each period's matches.
fn setpos_phrase(setpos: &[i64]) -> Clause {
    if setpos.is_empty() {
        return Clause::Absent;
    }
    let mut words = Vec::with_capacity(setpos.len());
    for position in setpos {
        let Some(word) = ordinal_word(*position) else {
            return Clause::Undescribable;
        };
        words.push(word);
    }
    Clause::Text(words.join(", "))
}

/// "5 times", "once", or "until 2030-12-31".
///
/// `COUNT` wins over `UNTIL` when a rule carries both, matching the expansion:
/// the iterator stops at whichever arrives first, and a count is the tighter
/// statement to make in a sentence.
fn bound_phrase(options: &Options) -> Clause {
    match options.count {
        // `COUNT=abc` decrements to `NaN` on the first step, so the rule fires
        // exactly once. Saying so is more useful than saying nothing, and it is
        // one of the two cases `finite_instance_count` reports as "unbounded".
        CountLimit::Single | CountLimit::Limit(1) => {
            return Clause::Text("once".to_owned());
        }
        CountLimit::Limit(count) => return Clause::Text(format!("{count} times")),
        // Already refused by `is_describable`; a zero-instance rule has no
        // sentence, and restating that here keeps the match total.
        CountLimit::Zero => return Clause::Undescribable,
        CountLimit::Unbounded => {}
    }
    let Some(until) = options.until else {
        return Clause::Absent;
    };
    match instant::date_at(until.div_euclid(MS_PER_DAY)) {
        Some(date) => Clause::Text(format!("until {}", to_iso_date(date))),
        None => Clause::Undescribable,
    }
}

/// A `BYSETPOS`/`BYDAY` ordinal as a word: `1` → `1st`, `-1` → `last`,
/// `-2` → `2nd-to-last`.
fn ordinal_word(value: i64) -> Option<String> {
    if value > 0 {
        return english_ordinal(value);
    }
    let magnitude = value.checked_neg()?;
    if magnitude == 1 {
        return Some("last".to_owned());
    }
    Some(format!("{}-to-last", english_ordinal(magnitude)?))
}

/// `1` → `1st`, `2` → `2nd`, `11` → `11th`, `21` → `21st`.
fn english_ordinal(value: i64) -> Option<String> {
    if value <= 0 {
        return None;
    }
    let suffix = match (value % 100, value % 10) {
        (11..=13, _) => "th",
        (_, 1) => "st",
        (_, 2) => "nd",
        (_, 3) => "rd",
        _ => "th",
    };
    Some(format!("{value}{suffix}"))
}

#[cfg(test)]
mod tests {
    use super::english_ordinal;
    use crate::recurrence::Recurrence;

    /// A Monday, so a bare weekly rule inherits `MO`.
    const MONDAY: &str = "2026-08-03";

    fn summary(rule: &str) -> Option<String> {
        Recurrence::parse(rule, Some(MONDAY), None).summary()
    }

    #[test]
    fn the_plain_frequencies_read_as_sentences() {
        assert_eq!(summary("FREQ=DAILY").as_deref(), Some("Every day"));
        assert_eq!(
            summary("FREQ=WEEKLY;BYDAY=MO,WE").as_deref(),
            Some("Every week on Mon, Wed")
        );
        assert_eq!(
            summary("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE").as_deref(),
            Some("Every 2 weeks on Mon, Wed"),
            "the sentence the task inspector asked for"
        );
    }

    #[test]
    fn a_bare_weekly_rule_describes_the_weekday_it_inherited() {
        // Not a leak of an implementation detail: the rule genuinely fires on
        // Mondays, and a summary that said only "Every week" would be less
        // true than this one.
        assert_eq!(summary("FREQ=WEEKLY").as_deref(), Some("Every week on Mon"));
    }

    #[test]
    fn ordinal_weekdays_and_month_days_are_named() {
        assert_eq!(
            summary("FREQ=MONTHLY;BYDAY=-1FR").as_deref(),
            Some("Every month on the last Friday")
        );
        assert_eq!(
            summary("FREQ=MONTHLY;BYDAY=1MO,3MO").as_deref(),
            Some("Every month on the 1st Monday, the 3rd Monday")
        );
        assert_eq!(
            summary("FREQ=MONTHLY;BYMONTHDAY=1,15").as_deref(),
            Some("Every month on day 1, 15")
        );
        assert_eq!(
            summary("FREQ=MONTHLY;BYMONTHDAY=-1").as_deref(),
            Some("Every month on the last day")
        );
        assert_eq!(
            summary("FREQ=MONTHLY;BYMONTHDAY=-2").as_deref(),
            Some("Every month on the 2nd-to-last day")
        );
    }

    #[test]
    fn a_yearly_rule_names_the_month_and_day_it_inherited() {
        assert_eq!(
            summary("FREQ=YEARLY").as_deref(),
            Some("Every year in August on day 3")
        );
    }

    #[test]
    fn setpos_is_described_rather_than_dropped() {
        assert_eq!(
            summary("FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1").as_deref(),
            Some("Every month on Mon, Tue, Wed, Thu, Fri, keeping only the last")
        );
    }

    #[test]
    fn count_and_until_end_the_sentence() {
        assert_eq!(
            summary("FREQ=DAILY;COUNT=5").as_deref(),
            Some("Every day, 5 times")
        );
        assert_eq!(
            summary("FREQ=DAILY;COUNT=1").as_deref(),
            Some("Every day, once")
        );
        assert_eq!(
            summary("FREQ=DAILY;UNTIL=20301231").as_deref(),
            Some("Every day, until 2030-12-31")
        );
        // `COUNT=abc` is the case `finite_instance_count` calls unbounded and
        // the expansion calls exactly one. The sentence follows the expansion.
        assert_eq!(
            summary("FREQ=DAILY;COUNT=abc").as_deref(),
            Some("Every day, once")
        );
    }

    #[test]
    fn a_rule_with_no_honest_sentence_declines_to_invent_one() {
        for rule in [
            // No defensible paraphrase.
            "FREQ=YEARLY;BYWEEKNO=20",
            "FREQ=YEARLY;BYYEARDAY=100",
            "FREQ=YEARLY;BYEASTER=0",
            // A time-of-day set changes a COUNT without changing a day.
            "FREQ=DAILY;BYHOUR=9,17;COUNT=5",
            // Fires zero times.
            "FREQ=DAILY;INTERVAL=0",
            "FREQ=DAILY;COUNT=0",
            // An intersection a comma-joined list would misread as a union.
            "FREQ=MONTHLY;BYDAY=FR;BYMONTHDAY=13",
            // A month index that names no month.
            "FREQ=YEARLY;BYMONTH=13",
        ] {
            assert_eq!(summary(rule), None, "{rule} should have no summary");
        }
    }

    #[test]
    fn a_rule_the_engine_cannot_expand_has_no_summary() {
        assert_eq!(summary(""), None, "an empty rule is not a rule");
        assert_eq!(summary("garbage"), None);
        assert_eq!(
            Recurrence::parse("FREQ=DAILY", None, None).summary(),
            None,
            "a rule with no resolvable DTSTART is not expandable"
        );
    }

    #[test]
    fn english_ordinals_handle_the_teens_and_the_twenty_firsts() {
        let cases = [
            (1, "1st"),
            (2, "2nd"),
            (3, "3rd"),
            (4, "4th"),
            (11, "11th"),
            (12, "12th"),
            (13, "13th"),
            (21, "21st"),
            (22, "22nd"),
            (23, "23rd"),
            (111, "111th"),
        ];
        for (value, expected) in cases {
            assert_eq!(english_ordinal(value).as_deref(), Some(expected));
        }
        assert_eq!(english_ordinal(0), None);
        assert_eq!(english_ordinal(-1), None);
    }
}
