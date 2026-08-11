//! Naive-UTC instant arithmetic, in the exact shape JavaScript `Date` gives it.
//!
//! The parity surface is timezone-free: the reference builds every instant with
//! `Date.UTC(...)` and reads it back with `getUTC*`, never setting a `tzid`.
//! So an instant here is just **milliseconds since the Unix epoch**, and a day
//! is an **ordinal** — a signed count of days since 1970-01-01. There is no DST,
//! no offset, and no calendar system other than the proleptic Gregorian one
//! `Date.UTC` implements.
//!
//! Two behaviours of `Date.UTC` are load-bearing and reproduced here rather
//! than guarded against:
//!
//! * **Out-of-range components roll over.** `Date.UTC(2026, 1, 31)` is 3 March,
//!   not an error, which is why `UNTIL=20260231` lands on 3 March and
//!   `DTSTART:20260230` lands on 2 March. [`from_parts`] normalises the same way.
//! * **Out-of-range hours roll into the next day.** Combining a day ordinal with
//!   an hour of 25 is a real instant one hour into the following day, because
//!   the combination is plain integer arithmetic.

use chrono::{Datelike as _, NaiveDate};

/// Milliseconds in one day. Every instant here is exact — no leap seconds.
pub(super) const MS_PER_DAY: i64 = 86_400_000;

/// The last millisecond of a day, added to a day ordinal to close an inclusive
/// window. The reference asks for `dayStart + 86_400_000 - 1`, which is this.
pub(super) const MS_PER_DAY_END: i64 = MS_PER_DAY - 1;

/// `NaiveDate::num_days_from_ce` of 1970-01-01.
///
/// chrono counts from 0001-01-01 and the reference counts from the Unix epoch,
/// so every conversion between the two is a shift by this constant. Pinned by
/// [`epoch_offset_is_the_unix_epoch`](tests::epoch_offset_is_the_unix_epoch).
const CE_DAYS_AT_UNIX_EPOCH: i32 = 719_163;

/// rrule.js's `MAXYEAR`, the year at which its iterator gives up.
///
/// Reproduced so a rule that never matches terminates at exactly the same
/// point the reference does, rather than at some unrelated Rust limit.
pub(super) const MAX_YEAR: i32 = 9999;

/// Whether `year` is a Gregorian leap year, by the reference's own predicate.
pub(super) const fn is_leap_year(year: i32) -> bool {
    (year % 4 == 0 && year % 100 != 0) || year % 400 == 0
}

/// The day ordinal of `date`.
pub(super) fn ordinal_of(date: NaiveDate) -> i64 {
    i64::from(date.num_days_from_ce() - CE_DAYS_AT_UNIX_EPOCH)
}

/// The date at day ordinal `ordinal`, or `None` when it falls outside the range
/// chrono can represent.
pub(super) fn date_at(ordinal: i64) -> Option<NaiveDate> {
    let ce = ordinal.checked_add(i64::from(CE_DAYS_AT_UNIX_EPOCH))?;
    NaiveDate::from_num_days_from_ce_opt(i32::try_from(ce).ok()?)
}

/// The day ordinal of the first of a month, or `None` outside chrono's range.
pub(super) fn ordinal_of_first(year: i32, month: u8) -> Option<i64> {
    NaiveDate::from_ymd_opt(year, u32::from(month), 1).map(ordinal_of)
}

/// The python-style weekday of `date`: Monday is 0, Sunday is 6.
///
/// The reference reaches the same numbering through `PY_WEEKDAYS[getUTCDay()]`;
/// chrono exposes it directly.
pub(super) fn weekday_of(date: NaiveDate) -> u8 {
    let from_monday = date.weekday().num_days_from_monday();
    u8::try_from(from_monday).unwrap_or(0)
}

/// The python-style weekday at a day ordinal.
///
/// 1970-01-01 was a Thursday, which is python weekday 3.
pub(super) fn weekday_at(ordinal: i64) -> u8 {
    let index = (ordinal + 3).rem_euclid(7);
    u8::try_from(index).unwrap_or(0)
}

/// Build an instant from raw, possibly out-of-range components, exactly as
/// `Date.UTC(year, month_index, day, hour, minute, second, millisecond)` does.
///
/// `month_index` is zero-based, matching the JavaScript argument. Every
/// component may be out of its natural range and rolls over.
///
/// Returns `None` only when the normalised date falls outside chrono's
/// representable range, which the reference would answer with an invalid
/// `Date` — a value that fails every subsequent comparison, so dropping the
/// instant and never emitting it is the same observable outcome.
pub(super) fn from_parts(
    year: i64,
    month_index: i64,
    day: i64,
    hour: i64,
    minute: i64,
    second: i64,
    millisecond: i64,
) -> Option<i64> {
    let year = year.checked_add(month_index.div_euclid(12))?;
    let month = u8::try_from(month_index.rem_euclid(12) + 1).ok()?;
    let first = ordinal_of_first(i32::try_from(year).ok()?, month)?;
    let ordinal = first.checked_add(day.checked_sub(1)?)?;
    let day_ms = ordinal.checked_mul(MS_PER_DAY)?;
    let time_ms = hour
        .checked_mul(3_600_000)?
        .checked_add(minute.checked_mul(60_000)?)?
        .checked_add(second.checked_mul(1_000)?)?
        .checked_add(millisecond)?;
    day_ms.checked_add(time_ms)
}

#[cfg(test)]
mod tests {
    use chrono::NaiveDate;

    use super::{
        MS_PER_DAY, date_at, from_parts, is_leap_year, ordinal_of, weekday_at, weekday_of,
    };

    fn ymd(year: i32, month: u32, day: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(year, month, day).expect("a real calendar date")
    }

    #[test]
    fn epoch_offset_is_the_unix_epoch() {
        assert_eq!(ordinal_of(ymd(1970, 1, 1)), 0);
        assert_eq!(date_at(0), Some(ymd(1970, 1, 1)));
        assert_eq!(ordinal_of(ymd(1969, 12, 31)), -1);
    }

    #[test]
    fn weekday_numbering_matches_python() {
        // 2026-01-05 is a Monday, the corpus's default `scheduled`.
        assert_eq!(weekday_of(ymd(2026, 1, 5)), 0);
        assert_eq!(weekday_of(ymd(2026, 1, 11)), 6);
        assert_eq!(weekday_at(ordinal_of(ymd(2026, 1, 5))), 0);
        assert_eq!(weekday_at(0), 3);
    }

    #[test]
    fn out_of_range_components_roll_over_like_date_utc() {
        // `UNTIL=20260231` is 3 March in the reference, not an error.
        let rolled = from_parts(2026, 1, 31, 0, 0, 0, 0).expect("representable");
        assert_eq!(date_at(rolled / MS_PER_DAY), Some(ymd(2026, 3, 3)));

        // `DTSTART:20260230` is 2 March.
        let rolled = from_parts(2026, 1, 30, 0, 0, 0, 0).expect("representable");
        assert_eq!(date_at(rolled / MS_PER_DAY), Some(ymd(2026, 3, 2)));

        // A month index past December rolls the year.
        let rolled = from_parts(2026, 12, 1, 0, 0, 0, 0).expect("representable");
        assert_eq!(date_at(rolled / MS_PER_DAY), Some(ymd(2027, 1, 1)));

        // An hour past midnight rolls the day.
        let rolled = from_parts(2026, 0, 5, 25, 0, 0, 0).expect("representable");
        assert_eq!(
            date_at(rolled.div_euclid(MS_PER_DAY)),
            Some(ymd(2026, 1, 6))
        );
    }

    #[test]
    fn leap_years_follow_the_gregorian_rule() {
        assert!(is_leap_year(2024));
        assert!(!is_leap_year(2100));
        assert!(is_leap_year(2000));
        assert!(!is_leap_year(2026));
    }
}
