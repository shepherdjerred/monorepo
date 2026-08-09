//! Normalising raw rule parts into an expandable option set — a port of
//! rrule.js's `parseOptions`.
//!
//! This is where most of the corpus's stranger answers are actually decided,
//! because `parseOptions` both *fills in defaults from `DTSTART`* and *rejects*
//! a handful of shapes:
//!
//! * A rule with no day-selecting part at all inherits one from `DTSTART` —
//!   which is why a `DTSTART`-only rule silently becomes "yearly, on that
//!   month and day".
//! * `BYMONTH=0` is falsy, so it loses that inheritance test and gets
//!   *overwritten* with `DTSTART`'s month; the rule fires. `BYMONTH=13` is
//!   truthy, survives, and then matches no month at all. Two adjacent nonsense
//!   inputs, two completely different outcomes.
//! * An unknown weekday code survives lexing and only becomes a failure here.
//!
//! One deliberate divergence, on inputs the model cannot produce and rrule.js
//! itself cannot answer:
//!
//! * A non-integer `BYHOUR`/`BYMINUTE`/`BYSECOND`, and a surviving `TZID`, are
//!   treated as unparsable (fail open). In rrule.js the first is a `TypeError`
//!   for every daily-or-greater frequency and a non-terminating loop for every
//!   sub-daily one; the second needs a rule carrying two `DTSTART:` values,
//!   since the model strips the first before parsing.

use super::instant::{self, MS_PER_DAY};
use super::text::{
    EasterOffset, Frequency, PartValue, RawOptions, RawPart, Slot, Unparsable, WeekdaySpec,
};

/// A rule part's integer values, plus how many of its values were not integers.
///
/// The count matters on its own: rrule.js treats "present but unmatchable" and
/// "absent" completely differently — the first suppresses the `DTSTART`
/// defaults and then filters every day out, the second inherits a default.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(super) struct NumberSet {
    numbers: Vec<i64>,
    unmatchable: usize,
}

impl NumberSet {
    /// The reference's `empty(value)`.
    pub(super) const fn is_empty(&self) -> bool {
        self.numbers.is_empty() && self.unmatchable == 0
    }

    /// The reference's `includes(value, candidate)`.
    pub(super) fn contains(&self, candidate: i64) -> bool {
        self.numbers.contains(&candidate)
    }

    /// The integer values, in the order they were written.
    pub(super) fn numbers(&self) -> &[i64] {
        &self.numbers
    }

    /// `isPresent(v) && !isArray(v) ? [v] : v` — a scalar of any type becomes a
    /// one-element array, so even an unusable scalar counts as present.
    fn wrapping(part: Option<&RawPart>) -> Self {
        match part {
            None => Self::default(),
            Some(RawPart::Scalar(value)) => Self::from_values(core::slice::from_ref(value)),
            Some(RawPart::List(values)) => Self::from_values(values),
        }
    }

    /// `isPresent(v) && !isArray(v) && isNumber(v) ? [v] : v` — a scalar that is
    /// *not* a number is left as a bare string, whose emptiness is then its
    /// character length.
    fn wrapping_numbers_only(part: Option<&RawPart>) -> Self {
        match part {
            Some(RawPart::Scalar(PartValue::Text(text))) => Self {
                numbers: Vec::new(),
                unmatchable: usize::from(!text.is_empty()),
            },
            other => Self::wrapping(other),
        }
    }

    fn from_values(values: &[PartValue]) -> Self {
        let mut set = Self::default();
        for value in values {
            match value {
                PartValue::Number(number) => set.numbers.push(*number),
                PartValue::Text(_) => set.unmatchable = set.unmatchable.saturating_add(1),
            }
        }
        set
    }
}

/// How `COUNT` terminates the expansion.
///
/// The reference decrements a raw JavaScript value and stops when it becomes
/// falsy, so the interesting states are not "some" and "none".
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum CountLimit {
    /// No `COUNT`, or one that can never reach zero: a negative `COUNT` is
    /// truthy and decrements away from zero forever, so it is simply ignored.
    Unbounded,
    /// `COUNT=0`, which returns before the iterator starts.
    Zero,
    /// A positive `COUNT`.
    Limit(u64),
    /// A `COUNT` that is not a number: `--count` is `NaN`, which is falsy, so
    /// the expansion stops after exactly one occurrence.
    Single,
}

/// A fully normalised rule, ready to expand.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct Options {
    pub(super) freq: Frequency,
    /// `DTSTART` as an instant, and pre-split into the fields the iterator's
    /// counter and default time-of-day need.
    pub(super) dtstart: i64,
    pub(super) start: DtStart,
    /// Always non-negative. Zero yields nothing; negative and non-numeric
    /// values are rejected during parsing because they make rrule.js spin.
    pub(super) interval: i64,
    pub(super) count: CountLimit,
    pub(super) until: Option<i64>,
    /// Week start, python-numbered.
    pub(super) wkst: u8,
    pub(super) setpos: Vec<i64>,
    pub(super) month: NumberSet,
    pub(super) monthday: NumberSet,
    /// `BYMONTHDAY`'s negative half, counted back from the end of the month.
    pub(super) monthday_from_end: NumberSet,
    pub(super) yearday: NumberSet,
    pub(super) weekno: NumberSet,
    pub(super) weekday: Vec<u8>,
    /// `BYDAY` entries that carried an ordinal and kept it, which only happens
    /// for `MONTHLY` and `YEARLY`.
    pub(super) nth_weekday: Vec<(u8, i64)>,
    pub(super) hour: Vec<i64>,
    pub(super) minute: Vec<i64>,
    pub(super) second: Vec<i64>,
    pub(super) easter: Option<EasterOffset>,
}

/// `DTSTART` split into calendar fields.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct DtStart {
    pub(super) year: i32,
    pub(super) month: u8,
    pub(super) day: i64,
    pub(super) hour: i64,
    pub(super) minute: i64,
    pub(super) second: i64,
    pub(super) millisecond: i64,
    pub(super) weekday: u8,
}

impl DtStart {
    /// `DateTime.fromDate`.
    fn split(dtstart: i64) -> Option<Self> {
        let ordinal = dtstart.div_euclid(MS_PER_DAY);
        let time = dtstart.rem_euclid(MS_PER_DAY);
        let date = instant::date_at(ordinal)?;
        let month = u8::try_from(chrono::Datelike::month(&date)).ok()?;
        Some(Self {
            year: chrono::Datelike::year(&date),
            month,
            day: i64::from(chrono::Datelike::day(&date)),
            hour: time / 3_600_000,
            minute: (time / 60_000) % 60,
            second: (time / 1_000) % 60,
            // The reference uses `date.valueOf() % 1000`, which is a truncating
            // remainder and so negative before the epoch. Matched exactly.
            millisecond: dtstart % 1_000,
            weekday: instant::weekday_of(date),
        })
    }
}

/// Normalise a lexed rule against the resolved `DTSTART`.
pub(super) fn build(raw: &RawOptions, dtstart: i64) -> Result<Options, Unparsable> {
    if raw.tzid {
        return Err(Unparsable);
    }
    let start = DtStart::split(dtstart).ok_or(Unparsable)?;

    // `if (isPresent(opts.byeaster)) opts.freq = RRule.YEARLY` runs *before* the
    // frequency is validated, so `BYEASTER` rescues an otherwise invalid FREQ.
    let freq = if raw.easter.is_some() {
        Frequency::Yearly
    } else {
        match raw.freq {
            Slot::Absent => Frequency::Yearly,
            Slot::Undefined => return Err(Unparsable),
            Slot::Present(freq) => freq,
        }
    };

    let (month, monthday, weekday) = apply_dtstart_defaults(raw, freq, start);
    let weekdays = split_weekdays(weekday.as_deref(), freq)?;
    let (monthday, monthday_from_end) = split_monthdays(monthday.as_ref());

    Ok(Options {
        freq,
        dtstart,
        start,
        interval: interval_of(raw.interval.as_ref())?,
        count: count_of(raw.count.as_ref()),
        until: raw.until,
        wkst: raw.wkst.as_present().copied().unwrap_or(0),
        setpos: setpos_of(raw.setpos.as_ref())?,
        month: NumberSet::wrapping(month.as_ref()),
        monthday,
        monthday_from_end,
        yearday: NumberSet::wrapping_numbers_only(raw.yearday.as_ref()),
        weekno: NumberSet::wrapping(raw.weekno.as_ref()),
        weekday: weekdays.plain,
        nth_weekday: weekdays.nth,
        hour: time_part_of(raw.hour.as_ref(), freq < Frequency::Hourly, start.hour)?,
        minute: time_part_of(
            raw.minute.as_ref(),
            freq < Frequency::Minutely,
            start.minute,
        )?,
        second: time_part_of(
            raw.second.as_ref(),
            freq < Frequency::Secondly,
            start.second,
        )?,
        easter: raw.easter,
    })
}

/// The `DTSTART` inheritance rule: a rule that names no day at all borrows one.
///
/// Returns the possibly-substituted `BYMONTH`, `BYMONTHDAY` and `BYDAY`.
fn apply_dtstart_defaults(
    raw: &RawOptions,
    freq: Frequency,
    start: DtStart,
) -> (Option<RawPart>, Option<RawPart>, Option<Vec<WeekdaySpec>>) {
    let month = raw.month.clone();
    let monthday = raw.monthday.clone();
    let weekday = raw.weekday.clone();

    let names_a_day = raw
        .weekno
        .as_ref()
        .is_some_and(|part| part.is_truthy() || part.is_not_empty())
        || raw.yearday.as_ref().is_some_and(RawPart::is_not_empty)
        || raw
            .monthday
            .as_ref()
            .is_some_and(|part| part.is_truthy() || part.is_not_empty())
        || raw.weekday.is_some()
        || raw.easter.is_some();
    if names_a_day {
        return (month, monthday, weekday);
    }

    let day = RawPart::Scalar(PartValue::Number(start.day));
    match freq {
        Frequency::Yearly => {
            let month = if month.as_ref().is_some_and(RawPart::is_truthy) {
                month
            } else {
                Some(RawPart::Scalar(PartValue::Number(i64::from(start.month))))
            };
            (month, Some(day), weekday)
        }
        Frequency::Monthly => (month, Some(day), weekday),
        Frequency::Weekly => (
            month,
            monthday,
            Some(vec![WeekdaySpec::Plain(start.weekday)]),
        ),
        Frequency::Daily | Frequency::Hourly | Frequency::Minutely | Frequency::Secondly => {
            (month, monthday, weekday)
        }
    }
}

/// `BYDAY` split into its two halves.
#[derive(Debug, Default)]
struct Weekdays {
    plain: Vec<u8>,
    nth: Vec<(u8, i64)>,
}

/// `BYDAY` splits into plain weekdays and ordinal weekdays, and an ordinal is
/// only kept for the two frequencies that have a containing period to count it
/// within — everything weekly or shorter throws its ordinal away.
fn split_weekdays(specs: Option<&[WeekdaySpec]>, freq: Frequency) -> Result<Weekdays, Unparsable> {
    let mut split = Weekdays::default();
    for spec in specs.unwrap_or_default() {
        match *spec {
            // `Days[code]` was `undefined`, and `parseOptions` is where the
            // reference finally dereferences it.
            WeekdaySpec::Unknown => return Err(Unparsable),
            WeekdaySpec::Plain(weekday) => split.plain.push(weekday),
            WeekdaySpec::Nth(weekday, ordinal) => {
                if freq > Frequency::Monthly {
                    split.plain.push(weekday);
                } else {
                    split.nth.push((weekday, ordinal));
                }
            }
        }
    }
    Ok(split)
}

/// `BYMONTHDAY` splits by sign — but only when it was written as a list. A
/// lone non-integer stays in the positive half, while the same value inside a
/// list is dropped from both halves.
fn split_monthdays(part: Option<&RawPart>) -> (NumberSet, NumberSet) {
    match part {
        None => (NumberSet::default(), NumberSet::default()),
        Some(RawPart::List(values)) => {
            let mut positive = NumberSet::default();
            let mut negative = NumberSet::default();
            for value in values {
                match value {
                    PartValue::Number(number) if *number > 0 => positive.numbers.push(*number),
                    PartValue::Number(number) if *number < 0 => negative.numbers.push(*number),
                    PartValue::Number(_) | PartValue::Text(_) => {}
                }
            }
            (positive, negative)
        }
        Some(scalar @ RawPart::Scalar(value)) => {
            if matches!(value, PartValue::Number(number) if *number < 0) {
                (NumberSet::default(), NumberSet::wrapping(Some(scalar)))
            } else {
                (NumberSet::wrapping(Some(scalar)), NumberSet::default())
            }
        }
    }
}

/// `INTERVAL`, rejecting the two values that make rrule.js loop forever.
///
/// A negative interval never advances the counter far enough to trip the year
/// bound, and a non-numeric one turns the counter's day into a string that
/// stops advancing at all. Neither throws upstream — both hang — so there is no
/// reference answer to match and the only safe reading is "unparsable".
fn interval_of(part: Option<&RawPart>) -> Result<i64, Unparsable> {
    match part {
        None => Ok(1),
        Some(RawPart::Scalar(PartValue::Number(interval))) if *interval >= 0 => Ok(*interval),
        Some(_) => Err(Unparsable),
    }
}

fn count_of(part: Option<&RawPart>) -> CountLimit {
    match part {
        None => CountLimit::Unbounded,
        Some(RawPart::Scalar(PartValue::Number(0))) => CountLimit::Zero,
        Some(RawPart::Scalar(PartValue::Number(count))) if *count < 0 => CountLimit::Unbounded,
        Some(RawPart::Scalar(PartValue::Number(count))) => {
            u64::try_from(*count).map_or(CountLimit::Unbounded, CountLimit::Limit)
        }
        // `""` is falsy, so it is never decremented and never terminates.
        Some(RawPart::Scalar(PartValue::Text(text))) if text.is_empty() => CountLimit::Unbounded,
        Some(_) => CountLimit::Single,
    }
}

/// `BYSETPOS`, which the reference validates eagerly: zero and anything outside
/// ±366 throws, and so does any value it cannot compare numerically.
fn setpos_of(part: Option<&RawPart>) -> Result<Vec<i64>, Unparsable> {
    let values = match part {
        None => return Ok(Vec::new()),
        // A bare empty string has length zero, so the validation loop never
        // runs and the option reads as absent from then on.
        Some(RawPart::Scalar(PartValue::Text(text))) if text.is_empty() => return Ok(Vec::new()),
        Some(RawPart::Scalar(value)) => core::slice::from_ref(value),
        Some(RawPart::List(values)) => values.as_slice(),
    };
    let mut setpos = Vec::with_capacity(values.len());
    for value in values {
        let PartValue::Number(number) = value else {
            return Err(Unparsable);
        };
        if *number == 0 || !(-366..=366).contains(number) {
            return Err(Unparsable);
        }
        setpos.push(*number);
    }
    Ok(setpos)
}

/// `BYHOUR` / `BYMINUTE` / `BYSECOND`.
///
/// `inherits` is the reference's `freq < RRule.HOURLY` test and friends: below
/// that frequency the field is fixed by `DTSTART`, at or above it the field is
/// what the iterator is stepping through and is left unset.
fn time_part_of(
    part: Option<&RawPart>,
    inherits: bool,
    from_dtstart: i64,
) -> Result<Vec<i64>, Unparsable> {
    let Some(part) = part else {
        return Ok(if inherits {
            vec![from_dtstart]
        } else {
            Vec::new()
        });
    };
    match part {
        RawPart::Scalar(PartValue::Number(value)) => Ok(vec![*value]),
        RawPart::List(values) => values
            .iter()
            .map(|value| match value {
                PartValue::Number(number) => Ok(*number),
                PartValue::Text(_) => Err(Unparsable),
            })
            .collect(),
        RawPart::Scalar(PartValue::Text(_)) => Err(Unparsable),
    }
}

#[cfg(test)]
mod tests {
    use super::{CountLimit, Frequency, build};
    use crate::recurrence::instant;
    use crate::recurrence::text::parse_rule_string;

    fn options_for(rule: &str, dtstart: &str) -> super::Options {
        let year: i64 = dtstart.get(..4).and_then(|s| s.parse().ok()).expect("year");
        let month: i64 = dtstart
            .get(5..7)
            .and_then(|s| s.parse().ok())
            .expect("month");
        let day: i64 = dtstart
            .get(8..10)
            .and_then(|s| s.parse().ok())
            .expect("day");
        let start = instant::from_parts(year, month - 1, day, 0, 0, 0, 0).expect("an instant");
        let raw = parse_rule_string(rule).expect("the rule lexes");
        build(&raw, start).expect("the rule normalises")
    }

    #[test]
    fn an_empty_rule_becomes_yearly_on_the_dtstart_day() {
        let options = options_for("", "2026-01-05");
        assert_eq!(options.freq, Frequency::Yearly);
        assert_eq!(options.month.numbers(), [1]);
        assert_eq!(options.monthday.numbers(), [5]);
    }

    #[test]
    fn month_zero_is_falsy_and_gets_overwritten_but_month_thirteen_survives() {
        let zero = options_for("FREQ=YEARLY;BYMONTH=0", "2026-01-05");
        assert_eq!(zero.month.numbers(), [1], "BYMONTH=0 inherits January");
        assert_eq!(zero.monthday.numbers(), [5]);

        let thirteen = options_for("FREQ=YEARLY;BYMONTH=13", "2026-01-05");
        assert_eq!(thirteen.month.numbers(), [13]);
    }

    #[test]
    fn a_present_but_unmatchable_monthday_still_suppresses_the_defaults() {
        let options = options_for("FREQ=MONTHLY;BYMONTHDAY=32", "2026-01-05");
        assert_eq!(options.monthday.numbers(), [32]);
        assert!(options.monthday_from_end.is_empty());
    }

    #[test]
    fn a_weekly_rule_inherits_the_dtstart_weekday() {
        let options = options_for("FREQ=WEEKLY", "2026-05-08");
        // 2026-05-08 is a Friday, python weekday 4.
        assert_eq!(options.weekday, [4]);
    }

    #[test]
    fn an_ordinal_weekday_is_kept_only_below_weekly() {
        let monthly = options_for("FREQ=MONTHLY;BYDAY=-1FR", "2026-01-05");
        assert_eq!(monthly.nth_weekday, [(4, -1)]);
        assert!(monthly.weekday.is_empty());

        let weekly = options_for("FREQ=WEEKLY;BYDAY=-1FR", "2026-01-05");
        assert!(weekly.nth_weekday.is_empty());
        assert_eq!(weekly.weekday, [4]);
    }

    #[test]
    fn count_variants() {
        assert_eq!(
            options_for("FREQ=DAILY", "2026-01-05").count,
            CountLimit::Unbounded
        );
        assert_eq!(
            options_for("FREQ=DAILY;COUNT=0", "2026-01-05").count,
            CountLimit::Zero
        );
        assert_eq!(
            options_for("FREQ=DAILY;COUNT=5", "2026-01-05").count,
            CountLimit::Limit(5)
        );
        assert_eq!(
            options_for("FREQ=DAILY;COUNT=-5", "2026-01-05").count,
            CountLimit::Unbounded
        );
        assert_eq!(
            options_for("FREQ=DAILY;COUNT=abc", "2026-01-05").count,
            CountLimit::Single
        );
    }

    #[test]
    fn a_hostile_interval_is_rejected_rather_than_looped_on() {
        let raw = parse_rule_string("FREQ=DAILY;INTERVAL=-1").expect("lexes");
        assert!(build(&raw, 0).is_err());
        let raw = parse_rule_string("FREQ=DAILY;INTERVAL=abc").expect("lexes");
        assert!(build(&raw, 0).is_err());
        // Zero is a different animal: rrule.js returns an empty expansion for
        // it immediately, so it must survive parsing.
        assert_eq!(
            options_for("FREQ=DAILY;INTERVAL=0", "2026-01-05").interval,
            0
        );
    }

    #[test]
    fn an_unknown_weekday_code_is_rejected_here_not_at_lex_time() {
        let raw = parse_rule_string("FREQ=WEEKLY;BYDAY=XX").expect("lexes");
        assert!(build(&raw, 0).is_err());
    }
}
