//! The naive-date helpers, with ISO `YYYY-MM-DD` as the boundary vocabulary.
//!
//! ## Why strings and not a date type
//!
//! UniFFI has no calendar type, and inventing a `{year, month, day}` record
//! would be a third spelling of a date on a boundary that already has one:
//! every date a task *stores* — `due`, `scheduled`, `completeInstances`,
//! `completedDate` — already crosses as `YYYY-MM-DD`, because that is what the
//! vault's frontmatter holds. Phase 2 and Phase 6 agreed on ISO strings for the
//! same reason, and using anything else here would make a host convert twice to
//! ask whether a task it just read is overdue.
//!
//! Every parse is validating, never lenient: an out-of-range day is rejected
//! rather than rolled over, matching [`tasknotes_core::dates::parse_local_date`]
//! and the quick-add parser's `feb 30` refusal. A silent one-to-three-day shift
//! is exactly the failure a shared core exists to prevent.
//!
//! ## "Today" is always a parameter
//!
//! Nothing here reads a clock. The viewer's today depends on the host's UTC
//! offset, so only the host can compute it — and making it an argument means
//! that class of mistake has to be written down at a call site rather than
//! hiding inside a helper. The one function that needs the offset itself,
//! [`date_parse_local`], takes it explicitly and in seconds.

use chrono::{FixedOffset, NaiveDate};
use tasknotes_core::dates::{self, DateGroup, UpcomingHorizon};

use crate::error::CoreError;

/// Parse an ISO `YYYY-MM-DD` civil date, or fail loudly.
///
/// Shared by every module on this boundary that takes a date. Rejects a
/// non-existent calendar date (`2026-02-30`) rather than rolling it over, and
/// names the offending value in the message so a host can surface it.
///
/// Unpadded components (`2026-7-1`) are **accepted**, deliberately and to match
/// [`tasknotes_core::dates::parse_local_date`], which accepts them because the
/// TypeScript does — by a route that is easy to miss, but with the same
/// resulting civil date. Hand-edited frontmatter is where such a value comes
/// from, and it must not mean a different day on macOS than on iOS.
///
/// # Errors
///
/// Returns [`CoreError::Validation`] for anything that is not a real
/// `YYYY-MM-DD` date.
pub(crate) fn parse_iso_date(raw: &str) -> Result<NaiveDate, CoreError> {
    NaiveDate::parse_from_str(raw, "%Y-%m-%d").map_err(|error| CoreError::Validation {
        message: format!("{raw:?} is not a YYYY-MM-DD calendar date: {error}"),
    })
}

/// Render a civil date as `YYYY-MM-DD`.
pub(crate) fn render_iso_date(date: NaiveDate) -> String {
    dates::to_iso_date(date)
}

/// The `is_upcoming` window when the caller does not choose one.
#[uniffi::export]
#[must_use]
pub fn date_default_upcoming_days() -> u32 {
    dates::DEFAULT_UPCOMING_DAYS
}

/// Resolve a stored date value to the civil date it falls on for a viewer at
/// `viewer_utc_offset_seconds`.
///
/// Three shapes are accepted, and which one a value has changes whether the
/// offset is consulted at all:
///
/// | shape | reading | offset used? |
/// |---|---|---|
/// | `2026-07-10` | that civil date | no |
/// | `2026-07-10T15:30` (no zone) | wall-clock, so that civil date | no |
/// | `2026-07-10T15:30:00Z`, `…+09:00` | an instant, shifted into the viewer's zone | **yes** |
///
/// The date-only row is why this exists: JavaScript's `new Date("2026-07-10")`
/// parses a bare date as **UTC** midnight, so reading its local components west
/// of Greenwich yields the 9th — a task due today classifies as overdue.
///
/// Answers `None` for a value in no recognised shape. That is not a swallowed
/// error: a frontmatter date can be anything a human typed, and "this is not a
/// date" is a normal reading the shell renders as "no due date".
///
/// # Errors
///
/// Returns [`CoreError::Validation`] when `viewer_utc_offset_seconds` is
/// outside the ±24h range a UTC offset can occupy.
#[uniffi::export]
pub fn date_parse_local(
    raw: &str,
    viewer_utc_offset_seconds: i32,
) -> Result<Option<String>, CoreError> {
    let offset =
        FixedOffset::east_opt(viewer_utc_offset_seconds).ok_or_else(|| CoreError::Validation {
            message: format!(
                "{viewer_utc_offset_seconds} is not a usable UTC offset in seconds; \
                 the range is -86400..=86400 exclusive"
            ),
        })?;
    Ok(dates::parse_local_date(raw, offset).map(render_iso_date))
}

/// The instant a stored date value names, in milliseconds since the epoch, or
/// `None` when it names no instant at all.
///
/// ## What a host does with it
///
/// [`date_parse_local`] takes one fixed offset, and a viewer's offset is not
/// fixed — most zones change theirs twice a year. The offset that resolves a
/// value is the one **its own instant** falls under: in Los Angeles in January,
/// `2026-07-10T07:30:00Z` is the 10th under that instant's `-07:00` and the 9th
/// under the reader's current `-08:00`. So a host asks this which instant a
/// value names, resolves its timezone database at that instant, and spends the
/// answer on [`date_parse_local`].
///
/// The timezone database stays on the host deliberately. macOS's is the one the
/// user's own clock reads; a second copy compiled into this core would disagree
/// with it every time a government moved a transition.
///
/// `None` means the value is a civil date or a wall-clock reading — the two
/// shapes [`date_parse_local`] resolves without consulting an offset — so there
/// is nothing to resolve and the viewer's current offset is exact.
#[uniffi::export]
#[must_use]
pub fn date_instant_millis(raw: &str) -> Option<i64> {
    dates::parse_instant_millis(raw)
}

/// Whether `date` is the viewer's today.
///
/// # Errors
///
/// Returns [`CoreError::Validation`] when either argument is not a
/// `YYYY-MM-DD` date.
#[uniffi::export]
pub fn date_is_today(date: &str, today: &str) -> Result<bool, CoreError> {
    Ok(dates::is_today(
        parse_iso_date(date)?,
        parse_iso_date(today)?,
    ))
}

/// Whether `date` has already passed for the viewer.
///
/// Today is *not* overdue: a task due today is still due.
///
/// # Errors
///
/// Returns [`CoreError::Validation`] when either argument is not a
/// `YYYY-MM-DD` date.
#[uniffi::export]
pub fn date_is_overdue(date: &str, today: &str) -> Result<bool, CoreError> {
    Ok(dates::is_overdue(
        parse_iso_date(date)?,
        parse_iso_date(today)?,
    ))
}

/// Whether `date` falls strictly after today and within `horizon`.
///
/// Today is excluded on purpose — the Upcoming screen is what is *coming*, and
/// today already has a screen of its own.
///
/// # Errors
///
/// Returns [`CoreError::Validation`] when either date argument is not a
/// `YYYY-MM-DD` date.
#[uniffi::export]
pub fn date_is_upcoming(
    date: &str,
    today: &str,
    horizon: UpcomingHorizon,
) -> Result<bool, CoreError> {
    Ok(dates::is_upcoming(
        parse_iso_date(date)?,
        parse_iso_date(today)?,
        horizon,
    ))
}

/// The heading `date` sorts under in a grouped list.
///
/// "This week" runs through the **coming Sunday**: on a Sunday that is a full
/// week out, and on a Saturday it is tomorrow.
///
/// # Errors
///
/// Returns [`CoreError::Validation`] when either argument is not a
/// `YYYY-MM-DD` date.
#[uniffi::export]
pub fn date_group(date: &str, today: &str) -> Result<DateGroup, CoreError> {
    Ok(dates::date_group(
        parse_iso_date(date)?,
        parse_iso_date(today)?,
    ))
}

/// The heading text for a group, or `None` for [`DateGroup::Later`].
///
/// `None` is not a missing value — it is the statement that this bucket's
/// heading is a *formatted date*, and locale formatting belongs to the shell.
#[uniffi::export]
#[must_use]
pub fn date_group_heading(group: DateGroup) -> Option<String> {
    group.heading().map(str::to_owned)
}

/// `from` shifted by whole days, forward for a positive count and backward for
/// a negative one — the core's answer to "tomorrow".
///
/// Exported because a shell computing it itself is date arithmetic in a place
/// with a clock and a timezone nearby, which is precisely how the off-by-one in
/// The local/UTC recurrence bug happened by adding a
/// day's worth of *milliseconds* to an instant is 23 or 25 hours across a DST
/// boundary, and every host date API offers that shape first. Civil-date
/// arithmetic has no instant in it, so there is no offset to get wrong.
///
/// `None` when the result falls outside the representable calendar, matching
/// [`date_next_saturday`] and [`date_next_monday`].
///
/// # Errors
///
/// Returns [`CoreError::Validation`] when `from` is not a `YYYY-MM-DD` date.
#[uniffi::export]
pub fn date_add_days(from: &str, days: i32) -> Result<Option<String>, CoreError> {
    Ok(dates::add_days(parse_iso_date(from)?, days).map(render_iso_date))
}

/// The upcoming Saturday — Todoist's "this weekend".
///
/// On a Saturday this is *today*, which is how "this weekend" reads when you
/// say it mid-weekend. `None` only when `from` sits within a week of the end of
/// the representable calendar.
///
/// # Errors
///
/// Returns [`CoreError::Validation`] when `from` is not a `YYYY-MM-DD` date.
#[uniffi::export]
pub fn date_next_saturday(from: &str) -> Result<Option<String>, CoreError> {
    Ok(dates::next_saturday(parse_iso_date(from)?).map(render_iso_date))
}

/// The next Monday, always strictly in the future — Todoist's "next week".
///
/// Never `+7 days`: on a Wednesday it is five days out, not seven.
///
/// # Errors
///
/// Returns [`CoreError::Validation`] when `from` is not a `YYYY-MM-DD` date.
#[uniffi::export]
pub fn date_next_monday(from: &str) -> Result<Option<String>, CoreError> {
    Ok(dates::next_monday(parse_iso_date(from)?).map(render_iso_date))
}

/// The next `weekday` strictly after `from`.
///
/// "Strictly" is what makes a bare weekday in the quick-add box mean something:
/// typing `monday` on a Monday asks for next Monday, not for today.
///
/// # Errors
///
/// Returns [`CoreError::Validation`] when `from` is not a `YYYY-MM-DD` date.
#[uniffi::export]
pub fn date_next_weekday(
    from: &str,
    weekday: chrono::Weekday,
) -> Result<Option<String>, CoreError> {
    Ok(dates::next_weekday(parse_iso_date(from)?, weekday).map(render_iso_date))
}

#[cfg(test)]
mod tests {
    use chrono::Weekday;
    use tasknotes_core::dates::{DateGroup, UpcomingHorizon};

    use super::{
        date_add_days, date_group, date_group_heading, date_instant_millis, date_is_overdue,
        date_is_today, date_is_upcoming, date_next_monday, date_next_saturday, date_next_weekday,
        date_parse_local, parse_iso_date,
    };
    use crate::error::CoreError;

    #[test]
    fn a_malformed_date_fails_at_the_boundary_rather_than_rolling_over() {
        for raw in [
            "2026-02-30",
            "2026-13-01",
            "not a date",
            "2026-08-08T00:00:00Z",
            "",
        ] {
            let error = parse_iso_date(raw).unwrap_err();
            assert!(
                matches!(error, CoreError::Validation { ref message } if message.contains("YYYY-MM-DD")),
                "unexpected error for {raw:?}: {error:?}"
            );
        }
    }

    #[test]
    fn unpadded_components_parse_to_the_same_civil_date_the_core_reads() {
        // Not laxity: `parse_local_date` accepts these too, because the
        // TypeScript does, and hand-edited frontmatter must not mean a
        // different day on macOS than on iOS.
        assert_eq!(
            parse_iso_date("2026-7-1").unwrap(),
            parse_iso_date("2026-07-01").unwrap()
        );
    }

    #[test]
    fn the_predicates_agree_with_the_core() {
        assert!(date_is_today("2026-08-08", "2026-08-08").unwrap());
        assert!(!date_is_overdue("2026-08-08", "2026-08-08").unwrap());
        assert!(date_is_overdue("2026-08-07", "2026-08-08").unwrap());
        assert!(date_is_upcoming("2026-08-10", "2026-08-08", UpcomingHorizon::Days(7)).unwrap());
        assert!(!date_is_upcoming("2026-08-30", "2026-08-08", UpcomingHorizon::Days(7)).unwrap());
        assert!(date_is_upcoming("2036-08-30", "2026-08-08", UpcomingHorizon::Unbounded).unwrap());
    }

    #[test]
    fn grouping_names_its_buckets_and_leaves_later_to_the_shell() {
        // 2026-08-08 is a Saturday, so "this week" ends on the 9th.
        assert_eq!(
            date_group("2026-08-07", "2026-08-08").unwrap(),
            DateGroup::Overdue
        );
        assert_eq!(
            date_group("2026-08-08", "2026-08-08").unwrap(),
            DateGroup::Today
        );
        assert_eq!(
            date_group("2026-08-09", "2026-08-08").unwrap(),
            DateGroup::Tomorrow
        );
        assert_eq!(
            date_group("2026-08-20", "2026-08-08").unwrap(),
            DateGroup::Later
        );
        assert_eq!(
            date_group_heading(DateGroup::Overdue).as_deref(),
            Some("Overdue")
        );
        assert_eq!(date_group_heading(DateGroup::Later), None);
    }

    #[test]
    fn tomorrow_and_yesterday_cross_as_whole_civil_days() {
        assert_eq!(
            date_add_days("2026-08-08", 1).unwrap().as_deref(),
            Some("2026-08-09")
        );
        assert_eq!(
            date_add_days("2026-08-08", -1).unwrap().as_deref(),
            Some("2026-08-07")
        );
        assert_eq!(
            date_add_days("2026-12-31", 1).unwrap().as_deref(),
            Some("2027-01-01")
        );
        // 2028 is a leap year, so counting one day past 28 February lands on
        // the 29th — which month arithmetic on an instant would have missed.
        assert_eq!(
            date_add_days("2028-02-28", 1).unwrap().as_deref(),
            Some("2028-02-29")
        );
        assert_eq!(
            date_add_days("2026-08-08", 0).unwrap().as_deref(),
            Some("2026-08-08")
        );
        assert_eq!(
            date_add_days("2026-08-08", i32::MIN).unwrap(),
            None,
            "off the end of the calendar has no honest answer"
        );

        let error = date_add_days("08/08/2026", 1).unwrap_err();
        assert!(
            matches!(error, CoreError::Validation { ref message } if message.contains("YYYY-MM-DD")),
            "unexpected error: {error:?}"
        );
    }

    #[test]
    fn the_weekday_walks_match_todoists_readings() {
        // 2026-08-08 is a Saturday.
        assert_eq!(
            date_next_saturday("2026-08-08").unwrap().as_deref(),
            Some("2026-08-08")
        );
        assert_eq!(
            date_next_monday("2026-08-08").unwrap().as_deref(),
            Some("2026-08-10")
        );
        assert_eq!(
            date_next_weekday("2026-08-08", Weekday::Sat)
                .unwrap()
                .as_deref(),
            Some("2026-08-15"),
            "a bare weekday is always strictly in the future"
        );
    }

    #[test]
    fn a_bare_date_ignores_the_offset_and_an_instant_does_not() {
        assert_eq!(
            date_parse_local("2026-07-10", -8 * 3600)
                .unwrap()
                .as_deref(),
            Some("2026-07-10"),
            "a bare date must not be read as UTC midnight"
        );
        assert_eq!(
            date_parse_local("2026-07-10T02:00:00Z", -8 * 3600)
                .unwrap()
                .as_deref(),
            Some("2026-07-09")
        );
        assert_eq!(date_parse_local("nonsense", 0).unwrap(), None);
    }

    /// The pair a host uses together: ask which instant a value names, resolve
    /// the offset the device's timezone database had *then*, and spend it here.
    /// Reusing the offset the host is standing in today is the bug — a July
    /// timestamp read in January would be filed a day early.
    #[test]
    fn a_zoned_value_names_the_instant_a_host_resolves_its_offset_for() {
        let raw = "2026-07-10T07:30:00Z";
        assert_eq!(date_instant_millis(raw), Some(1_783_668_600_000));
        assert_eq!(
            date_parse_local(raw, -7 * 3600).unwrap().as_deref(),
            Some("2026-07-10"),
            "resolved at the offset Los Angeles had at that instant"
        );
        assert_eq!(
            date_parse_local(raw, -8 * 3600).unwrap().as_deref(),
            Some("2026-07-09"),
            "resolved at the offset Los Angeles has in January"
        );

        // A value that names no instant needs no resolution, which is the same
        // statement as `date_parse_local` ignoring the offset for it.
        for bare in ["2026-07-10", "2026-07-10T15:30", "nonsense"] {
            assert_eq!(date_instant_millis(bare), None, "{bare}");
        }
    }

    #[test]
    fn an_impossible_utc_offset_is_reported_rather_than_clamped() {
        let error = date_parse_local("2026-07-10", 200_000).unwrap_err();
        assert!(
            matches!(error, CoreError::Validation { ref message } if message.contains("UTC offset")),
            "unexpected error: {error:?}"
        );
    }
}
