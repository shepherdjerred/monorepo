//! Naive-date helpers: parsing a stored date value, the today/overdue/upcoming
//! predicates, and the list-grouping buckets.
//!
//! ## "The user's today" versus "a date on a timeline"
//!
//! The TypeScript original ([`src/lib/dates.ts`]) works in `Date` objects and
//! reads the ambient clock, which quietly conflates two different things. This
//! port keeps them apart, in the types:
//!
//! * **A civil date** — [`chrono::NaiveDate`]. `2026-07-10` is the day written
//!   on the task. It carries no instant and no zone, and it names the same day
//!   for every reader. Everything a task *stores* is a civil date.
//! * **The viewer's today** — also a `NaiveDate`, but one that only the host
//!   can compute, because it depends on the host's UTC offset. It is never read
//!   here; every function that needs it takes a `today: NaiveDate` parameter.
//!
//! Collapsing the two caused a production bug where a local-midnight `Date`
//! was handed to a component that read it back with UTC
//! getters — making every recurring task a day late east of Greenwich. Making
//! "today" an argument means that class of mistake has to be written down at a
//! call site rather than hiding inside a helper.
//!
//! The one place the offset genuinely matters is [`parse_local_date`], because
//! a stored value *may* be a full instant rather than a civil date, and an
//! instant lands on different days for different viewers. That function is the
//! only one here that takes an offset, and it takes it explicitly.
//!
//! An offset is also not a property of a viewer alone — it is a property of a
//! viewer *at an instant*, since most zones change theirs twice a year. So
//! [`parse_instant_millis`] exists beside it: the host owns the timezone
//! database and resolves the offset, and this says which instant to resolve it
//! for. Handing back "the offset now" for a timestamp in the other half of the
//! year is the same off-by-one-day class as everything above.
//!
//! ## What deliberately is not here
//!
//! `formatDate`, `formatDayHeading`, and `formatRelativeDate`'s fallback branch
//! all go through `toLocaleDateString`. Locale formatting belongs to the shell:
//! macOS should render a date the way the user's Language & Region settings
//! say, which a hard-coded English format cannot do and a shared core has no
//! business deciding. [`DateGroup`] therefore names its buckets and leaves
//! [`DateGroup::Later`] for the shell to format.
//!
//! [`src/lib/dates.ts`]: https://github.com/shepherdjerred/monorepo/blob/main/packages/tasks-for-obsidian/src/lib/dates.ts

use chrono::{DateTime, Datelike, Days, FixedOffset, NaiveDate, NaiveDateTime, Weekday};

/// The `isUpcoming` window when the caller does not choose one.
pub const DEFAULT_UPCOMING_DAYS: u32 = 7;

/// How far ahead [`is_upcoming`] looks.
///
/// The TypeScript signature is `days = 7` on a `number`, so callers pass
/// `Number.POSITIVE_INFINITY` for "no limit" and the function tests
/// `Number.isFinite`. An enum says the same thing without a sentinel, and it
/// makes the two cases exhaustive rather than a runtime branch on a float.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum UpcomingHorizon {
    /// Anything strictly after `today` and no more than this many days out.
    ///
    /// Unsigned on purpose: a negative window admits nothing at all, so it is
    /// never a question a caller means to ask.
    Days(u32),
    /// Anything strictly after `today`, however far out.
    Unbounded,
}

impl Default for UpcomingHorizon {
    fn default() -> Self {
        Self::Days(DEFAULT_UPCOMING_DAYS)
    }
}

/// Which heading a date sorts under in a grouped task list.
///
/// The unit variants carry the exact strings the TypeScript `getDateGroup`
/// returns, so a grouped list reads identically on both clients.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum DateGroup {
    /// Strictly before the viewer's today.
    Overdue,
    /// The viewer's today.
    Today,
    /// The day after the viewer's today.
    Tomorrow,
    /// Later than tomorrow, but no later than the coming Sunday.
    ThisWeek,
    /// Beyond the current week. The heading is the date itself, which only the
    /// shell can format for the user's locale.
    Later,
}

impl DateGroup {
    /// The heading text, or `None` for [`DateGroup::Later`].
    ///
    /// `None` is not a missing value — it is the statement that this bucket's
    /// heading is a formatted date, and formatting is the shell's job.
    #[must_use]
    pub const fn heading(self) -> Option<&'static str> {
        match self {
            Self::Overdue => Some("Overdue"),
            Self::Today => Some("Today"),
            Self::Tomorrow => Some("Tomorrow"),
            Self::ThisWeek => Some("This Week"),
            Self::Later => None,
        }
    }
}

/// Resolve a stored date value to the civil date it falls on for a viewer at
/// `viewer_offset`.
///
/// Three shapes are accepted, and which one a value has changes whether the
/// offset is consulted at all:
///
/// | shape | reading | offset used? |
/// |---|---|---|
/// | `2026-07-10`, `2026-7-1` | that civil date | no |
/// | `2026-07-10T15:30` (no zone) | wall-clock, so that civil date | no |
/// | `2026-07-10T15:30:00Z`, `…+09:00` | an instant, shifted into the viewer's zone | **yes** |
///
/// The date-only row is the whole reason this function exists. JavaScript's
/// `new Date("2026-07-10")` parses a bare date as **UTC** midnight, so reading
/// its local components in any negative-UTC zone yields the 9th — a task due
/// today classifies as overdue, and tomorrow's shows as today.
///
/// Unpadded components are accepted because the original accepts them too, by a
/// route that is easy to miss: its regex requires two digits, so `2026-7-1`
/// misses the date-only branch entirely and lands in `new Date(…)`, whose
/// legacy parser reads it as *local* midnight — the same civil date this
/// returns. Hand-edited frontmatter is where such a value comes from, and it
/// should not silently mean a different day on macOS than on iOS.
///
/// # One deliberate divergence from the TypeScript
///
/// **Out-of-range days are rejected, not rolled over.** `new Date(2026, 1, 30)`
/// silently becomes 2 March; this returns `None`. The TypeScript quick-add
/// parser already treats rollover as a bug — `resolveMonthDay` explicitly
/// rejects `feb 30` — so `None` is the reading the original author chose
/// wherever they thought about it, and a silent one-to-three-day shift is
/// exactly the failure this core exists to prevent.
///
/// One more difference that is not a divergence: **a zoneless datetime is a
/// wall-clock reading, not UTC.** [`crate::domain::filters`] reads the same
/// shape as UTC. Both match their own TypeScript counterparts, and the two
/// answer different questions: sorting needs one global ordering every client
/// agrees on, while bucketing needs the day the user believes they wrote down.
#[must_use]
pub fn parse_local_date(raw: &str, viewer_offset: FixedOffset) -> Option<NaiveDate> {
    match classify(raw)? {
        StoredDate::Civil(date) => Some(date),
        StoredDate::Instant(instant) => Some(instant.with_timezone(&viewer_offset).date_naive()),
        StoredDate::WallClock(naive) => Some(naive.date()),
    }
}

/// The instant a stored value names, in milliseconds since the epoch, or `None`
/// when it names no instant at all.
///
/// ## Why a host needs this
///
/// [`parse_local_date`] takes a *fixed* offset, and a viewer's offset is not
/// fixed: most zones change it twice a year. The offset that resolves a value
/// is the one its own instant falls under, which is not necessarily the one the
/// reader is standing in — in Los Angeles in January, `2026-07-10T07:30:00Z` is
/// 00:30 on the 10th under PDT (`-07:00`) and 23:30 on the *9th* under the
/// reader's current PST (`-08:00`). Reusing "the offset now" therefore files a
/// task under the wrong day for half the year.
///
/// The timezone database belongs to the host — macOS's is the one the user's
/// own clock reads, and shipping a second copy in this crate would make the two
/// disagree — so the host resolves the offset. This is the other half of that
/// exchange: it says which instant to resolve it *for*.
///
/// `None` is not a failure. It says this value names a civil date or a
/// wall-clock reading, which are the two shapes [`parse_local_date`] resolves
/// without consulting an offset at all, so there is nothing for a host to
/// resolve.
#[must_use]
pub fn parse_instant_millis(raw: &str) -> Option<i64> {
    match classify(raw)? {
        StoredDate::Instant(instant) => Some(instant.timestamp_millis()),
        StoredDate::Civil(_) | StoredDate::WallClock(_) => None,
    }
}

/// Which of the three shapes a stored date value is in.
///
/// One classifier rather than a shape test per question, because
/// [`parse_local_date`] and [`parse_instant_millis`] are read together — a host
/// resolves an offset with the second and spends it on the first — and two
/// copies of "is this zoned" could answer differently for the same string. Then
/// an offset would be resolved for a value that is read as a wall-clock time,
/// or not resolved for one that needs it.
enum StoredDate {
    /// `2026-07-10`, `2026-7-1` — a civil date, the same day for every reader.
    Civil(NaiveDate),
    /// `2026-07-10T15:30:00Z`, `…+09:00` — an instant, which lands on different
    /// days for different readers.
    Instant(DateTime<FixedOffset>),
    /// `2026-07-10T15:30` — a wall-clock reading, so the civil date it is
    /// written on, whoever reads it.
    WallClock(NaiveDateTime),
}

fn classify(raw: &str) -> Option<StoredDate> {
    // First, because no other shape can also parse as a bare date: chrono
    // rejects trailing input, so a datetime never reaches this branch.
    if let Ok(date) = NaiveDate::parse_from_str(raw, "%Y-%m-%d") {
        return Some(StoredDate::Civil(date));
    }
    if let Ok(instant) = DateTime::parse_from_rfc3339(raw) {
        return Some(StoredDate::Instant(instant));
    }
    for format in ["%Y-%m-%dT%H:%M:%S%.f", "%Y-%m-%dT%H:%M"] {
        if let Ok(naive) = NaiveDateTime::parse_from_str(raw, format) {
            return Some(StoredDate::WallClock(naive));
        }
    }
    None
}

/// Render a civil date as `YYYY-MM-DD`, the form every TaskNotes field stores.
#[must_use]
pub fn to_iso_date(date: NaiveDate) -> String {
    date.format("%Y-%m-%d").to_string()
}

/// `date` shifted by whole days, forward for a positive count and backward for
/// a negative one.
///
/// ## Why the shell must not do this itself
///
/// "Tomorrow" is the smallest possible piece of date arithmetic, and it is
/// exactly the size of mistake that shipped: a whole class of recurring tasks
/// arrived a day late because one side built a local-midnight `Date` and the
/// other read it back with UTC getters. Adding `86_400_000` milliseconds to an
/// instant is *not* adding a day — across a DST boundary it is 23 or 25 hours —
/// and every host date API invites that shape. Civil-date arithmetic on a
/// [`NaiveDate`] has no instants in it and therefore no offset to get wrong.
///
/// Returns `None` when the result falls outside the representable calendar,
/// matching [`next_saturday`] and [`next_weekday`]: there is no honest date to
/// answer with, and saturating would put a task on a day nobody asked for.
#[must_use]
pub fn add_days(date: NaiveDate, days: i32) -> Option<NaiveDate> {
    // `unsigned_abs` rather than `-days`, because `i32::MIN` has no positive
    // counterpart and negating it is the one input that would overflow.
    let magnitude = Days::new(u64::from(days.unsigned_abs()));
    if days < 0 {
        date.checked_sub_days(magnitude)
    } else {
        date.checked_add_days(magnitude)
    }
}

/// The upcoming Saturday — Todoist's "this weekend".
///
/// On a Saturday this is *today*, which is how "this weekend" reads when you
/// say it mid-weekend.
///
/// Returns `None` only when `from` sits within a week of [`NaiveDate::MAX`],
/// which no four-digit year can reach; it is `Option` rather than a saturating
/// answer because there is no honest date to return there.
#[must_use]
pub fn next_saturday(from: NaiveDate) -> Option<NaiveDate> {
    advance_to(from, Weekday::Sat, Inclusivity::AllowsToday)
}

/// The next Monday, always strictly in the future — Todoist's "next week".
///
/// Never `+7 days`: on a Wednesday it is five days out, not seven. On a Monday
/// it is the *following* Monday.
///
/// See [`next_saturday`] for when this returns `None`.
#[must_use]
pub fn next_monday(from: NaiveDate) -> Option<NaiveDate> {
    next_weekday(from, Weekday::Mon)
}

/// The next `weekday` strictly after `from`.
///
/// "Strictly" is what makes a bare weekday in the quick-add box mean something:
/// typing `monday` on a Monday asks for next Monday, not for today, because a
/// task you are creating right now is not one you would date to a day that is
/// already most of the way over.
///
/// See [`next_saturday`] for when this returns `None`.
#[must_use]
pub fn next_weekday(from: NaiveDate, weekday: Weekday) -> Option<NaiveDate> {
    advance_to(from, weekday, Inclusivity::RequiresFuture)
}

/// Whether landing on `from`'s own weekday counts as a match.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Inclusivity {
    /// Zero days ahead is a valid answer (`nextSaturday`).
    AllowsToday,
    /// Zero days ahead becomes a full week (`nextMonday`, `resolveSingleWord`).
    RequiresFuture,
}

/// The next `target` weekday at or after `from`.
///
/// Mirrors the TypeScript `(target - current + 7) % 7` and its `|| 7` tail,
/// which is where the two functions differ and nowhere else.
fn advance_to(from: NaiveDate, target: Weekday, inclusivity: Inclusivity) -> Option<NaiveDate> {
    let ahead = days_ahead(from.weekday(), target, inclusivity);
    from.checked_add_days(Days::new(u64::from(ahead)))
}

/// Days from `current` forward to `target`, in `0..=7`.
fn days_ahead(current: Weekday, target: Weekday, inclusivity: Inclusivity) -> u32 {
    let delta = (target.num_days_from_sunday() + 7 - current.num_days_from_sunday()) % 7;
    if delta == 0 && inclusivity == Inclusivity::RequiresFuture {
        7
    } else {
        delta
    }
}

/// Whether `date` is the viewer's today.
#[must_use]
pub fn is_today(date: NaiveDate, today: NaiveDate) -> bool {
    date == today
}

/// Whether `date` has already passed for the viewer.
///
/// Today is *not* overdue: a task due today is still due.
#[must_use]
pub fn is_overdue(date: NaiveDate, today: NaiveDate) -> bool {
    date < today
}

/// Whether `date` falls strictly after today and within `horizon`.
///
/// Today is excluded on purpose — the Upcoming screen is what is *coming*, and
/// today already has a screen of its own.
#[must_use]
pub fn is_upcoming(date: NaiveDate, today: NaiveDate, horizon: UpcomingHorizon) -> bool {
    if date <= today {
        return false;
    }
    match horizon {
        UpcomingHorizon::Unbounded => true,
        // A window that runs off the end of the calendar admits every
        // representable date, which is the same answer `Unbounded` gives — not
        // a fallback, just the arithmetic saturating where dates stop.
        UpcomingHorizon::Days(days) => today
            .checked_add_days(Days::new(u64::from(days)))
            .is_none_or(|limit| date <= limit),
    }
}

/// The heading `date` sorts under in a grouped list.
///
/// "This week" runs through the **coming Sunday**, matching the TypeScript
/// `today + (7 - today.getDay())`: on a Sunday that is a full week out, and on
/// a Saturday it is tomorrow.
#[must_use]
pub fn date_group(date: NaiveDate, today: NaiveDate) -> DateGroup {
    if date < today {
        return DateGroup::Overdue;
    }
    if date == today {
        return DateGroup::Today;
    }
    if today.checked_add_days(Days::new(1)) == Some(date) {
        return DateGroup::Tomorrow;
    }
    let days_to_sunday = 7 - today.weekday().num_days_from_sunday();
    let end_of_week = today.checked_add_days(Days::new(u64::from(days_to_sunday)));
    if end_of_week.is_none_or(|end| date <= end) {
        return DateGroup::ThisWeek;
    }
    DateGroup::Later
}

#[cfg(test)]
mod tests {
    use chrono::{FixedOffset, NaiveDate};

    use super::{
        DateGroup, UpcomingHorizon, add_days, date_group, is_overdue, is_today, is_upcoming,
        next_monday, next_saturday, parse_instant_millis, parse_local_date, to_iso_date,
    };

    /// Every date test in the TypeScript suite is written against "now" plus an
    /// offset. Here "now" is a fixed Wednesday, which is the same assertion
    /// with the ambient clock removed.
    fn today() -> NaiveDate {
        ymd(2026, 7, 22)
    }

    fn ymd(year: i32, month: u32, day: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(year, month, day).unwrap()
    }

    fn days_from(today: NaiveDate, offset: i64) -> NaiveDate {
        today + chrono::Duration::days(offset)
    }

    fn utc() -> FixedOffset {
        FixedOffset::east_opt(0).unwrap()
    }

    // ── isToday ────────────────────────────────────────────────────────────

    #[test]
    fn is_today_accepts_todays_date() {
        assert!(is_today(today(), today()));
    }

    #[test]
    fn is_today_rejects_yesterday() {
        assert!(!is_today(days_from(today(), -1), today()));
    }

    #[test]
    fn is_today_rejects_tomorrow() {
        assert!(!is_today(days_from(today(), 1), today()));
    }

    /// Ports both "returns false for undefined" and "returns false for empty
    /// string": in TypeScript those reach `isToday` and fall out false, and
    /// here they cannot construct a date at all.
    #[test]
    fn an_absent_or_empty_value_never_parses_into_a_date() {
        assert_eq!(parse_local_date("", utc()), None);
        assert_eq!(parse_local_date("not a date", utc()), None);
    }

    // ── isOverdue ──────────────────────────────────────────────────────────

    #[test]
    fn is_overdue_accepts_yesterday() {
        assert!(is_overdue(days_from(today(), -1), today()));
    }

    #[test]
    fn is_overdue_accepts_the_distant_past() {
        assert!(is_overdue(ymd(2020, 1, 1), today()));
    }

    #[test]
    fn is_overdue_rejects_today() {
        assert!(!is_overdue(today(), today()));
    }

    #[test]
    fn is_overdue_rejects_tomorrow() {
        assert!(!is_overdue(days_from(today(), 1), today()));
    }

    // ── isUpcoming ─────────────────────────────────────────────────────────

    #[test]
    fn is_upcoming_accepts_a_date_inside_the_default_window() {
        assert!(is_upcoming(
            days_from(today(), 3),
            today(),
            UpcomingHorizon::default()
        ));
    }

    #[test]
    fn is_upcoming_accepts_the_last_day_of_the_default_window() {
        assert!(is_upcoming(
            days_from(today(), 7),
            today(),
            UpcomingHorizon::default()
        ));
    }

    #[test]
    fn is_upcoming_rejects_today() {
        assert!(!is_upcoming(today(), today(), UpcomingHorizon::default()));
    }

    #[test]
    fn is_upcoming_rejects_yesterday() {
        assert!(!is_upcoming(
            days_from(today(), -1),
            today(),
            UpcomingHorizon::default()
        ));
    }

    #[test]
    fn is_upcoming_rejects_the_day_after_the_default_window() {
        assert!(!is_upcoming(
            days_from(today(), 8),
            today(),
            UpcomingHorizon::default()
        ));
    }

    #[test]
    fn is_upcoming_respects_a_custom_window() {
        assert!(!is_upcoming(
            days_from(today(), 3),
            today(),
            UpcomingHorizon::Days(2)
        ));
        assert!(is_upcoming(
            days_from(today(), 3),
            today(),
            UpcomingHorizon::Days(5)
        ));
    }

    #[test]
    fn an_unbounded_horizon_accepts_the_far_future() {
        assert!(is_upcoming(
            days_from(today(), 400),
            today(),
            UpcomingHorizon::Unbounded
        ));
    }

    #[test]
    fn an_unbounded_horizon_still_excludes_today_and_the_past() {
        assert!(!is_upcoming(today(), today(), UpcomingHorizon::Unbounded));
        assert!(!is_upcoming(
            days_from(today(), -30),
            today(),
            UpcomingHorizon::Unbounded
        ));
    }

    // ── getDateGroup ───────────────────────────────────────────────────────

    #[test]
    fn date_group_buckets_today() {
        assert_eq!(date_group(today(), today()), DateGroup::Today);
        assert_eq!(DateGroup::Today.heading(), Some("Today"));
    }

    #[test]
    fn date_group_buckets_tomorrow() {
        assert_eq!(
            date_group(days_from(today(), 1), today()),
            DateGroup::Tomorrow
        );
        assert_eq!(DateGroup::Tomorrow.heading(), Some("Tomorrow"));
    }

    #[test]
    fn date_group_buckets_the_past_as_overdue() {
        assert_eq!(
            date_group(days_from(today(), -3), today()),
            DateGroup::Overdue
        );
        assert_eq!(DateGroup::Overdue.heading(), Some("Overdue"));
    }

    #[test]
    fn date_group_leaves_the_far_future_to_the_shell() {
        assert_eq!(
            date_group(days_from(today(), 60), today()),
            DateGroup::Later
        );
        assert_eq!(DateGroup::Later.heading(), None);
    }

    /// Not in the TypeScript suite: the week boundary is `today + (7 -
    /// weekday)`, which is the only non-obvious arithmetic in the function.
    #[test]
    fn this_week_runs_through_the_coming_sunday() {
        // Wednesday 2026-07-22 → Sunday 2026-07-26.
        assert_eq!(date_group(ymd(2026, 7, 26), today()), DateGroup::ThisWeek);
        assert_eq!(date_group(ymd(2026, 7, 27), today()), DateGroup::Later);
        assert_eq!(DateGroup::ThisWeek.heading(), Some("This Week"));

        // On a Sunday the window is a full week, not zero days.
        let sunday = ymd(2026, 7, 26);
        assert_eq!(date_group(ymd(2026, 8, 2), sunday), DateGroup::ThisWeek);
        assert_eq!(date_group(ymd(2026, 8, 3), sunday), DateGroup::Later);
    }

    // ── parseLocalDate ─────────────────────────────────────────────────────

    #[test]
    fn parses_a_date_only_string_as_that_civil_date() {
        let parsed = parse_local_date("2026-07-10", utc()).unwrap();
        assert_eq!(parsed, ymd(2026, 7, 10));
    }

    /// The TypeScript test asserts a date-only "today" classifies as Today
    /// rather than Overdue. Here the offset is varied instead of the ambient
    /// zone, which is the same claim stated where it can actually be checked.
    #[test]
    fn a_date_only_value_is_offset_independent() {
        for offset_hours in [-12, -8, 0, 5, 14] {
            let offset = FixedOffset::east_opt(offset_hours * 3600).unwrap();
            let parsed = parse_local_date("2026-07-22", offset).unwrap();
            assert_eq!(parsed, today(), "shifted at UTC{offset_hours:+}");
            assert!(is_today(parsed, today()));
            assert!(!is_overdue(parsed, today()));
        }
    }

    #[test]
    fn a_full_timestamp_lands_on_the_viewers_day() {
        let raw = "2026-07-10T15:30:00Z";
        assert_eq!(
            parse_local_date(raw, utc()).unwrap(),
            ymd(2026, 7, 10),
            "UTC"
        );
        // 15:30Z is 07:30 in Los Angeles — still the 10th.
        let los_angeles = FixedOffset::east_opt(-8 * 3600).unwrap();
        assert_eq!(
            parse_local_date(raw, los_angeles).unwrap(),
            ymd(2026, 7, 10)
        );
        // …and 00:30 the next day in Tokyo, which is the whole point.
        let tokyo = FixedOffset::east_opt(9 * 3600).unwrap();
        assert_eq!(parse_local_date(raw, tokyo).unwrap(), ymd(2026, 7, 11));
    }

    #[test]
    fn a_zoneless_datetime_is_read_as_wall_clock() {
        let tokyo = FixedOffset::east_opt(9 * 3600).unwrap();
        for raw in [
            "2026-07-10T15:30",
            "2026-07-10T15:30:00",
            "2026-07-10T15:30:00.500",
        ] {
            assert_eq!(
                parse_local_date(raw, tokyo).unwrap(),
                ymd(2026, 7, 10),
                "{raw}"
            );
        }
    }

    /// The documented divergence: JavaScript rolls `2026-02-30` into March,
    /// this rejects it.
    #[test]
    fn an_impossible_calendar_date_is_rejected_rather_than_rolled_over() {
        assert_eq!(parse_local_date("2026-02-30", utc()), None);
        assert_eq!(parse_local_date("2026-13-01", utc()), None);
        assert_eq!(parse_local_date("2027-02-29", utc()), None);
        assert_eq!(
            parse_local_date("2028-02-29", utc()),
            Some(ymd(2028, 2, 29))
        );
    }

    /// Hand-edited frontmatter writes these, and the original resolves them —
    /// through its `new Date(…)` fallback rather than its regex, which is why
    /// it is easy to assume otherwise. A differential run against the
    /// TypeScript is what settled it.
    #[test]
    fn an_unpadded_date_is_still_a_civil_date() {
        assert_eq!(parse_local_date("2026-2-3", utc()), Some(ymd(2026, 2, 3)));
        assert_eq!(parse_local_date("2026-07-1", utc()), Some(ymd(2026, 7, 1)));
        // …and the offset still does not enter into it.
        let tokyo = FixedOffset::east_opt(9 * 3600).unwrap();
        assert_eq!(parse_local_date("2026-2-3", tokyo), Some(ymd(2026, 2, 3)));
    }

    // ── parseInstantMillis ─────────────────────────────────────────────────

    #[test]
    fn only_a_zoned_value_names_an_instant() {
        // The same moment, spelled three ways.
        for raw in [
            "2026-07-10T15:30:00Z",
            "2026-07-11T00:30:00+09:00",
            "2026-07-10T08:30:00-07:00",
        ] {
            assert_eq!(parse_instant_millis(raw), Some(1_783_697_400_000), "{raw}");
        }
        // A civil date and a wall-clock reading name no instant, which is the
        // same statement as `parse_local_date` not consulting the offset for
        // them.
        for raw in ["2026-07-10", "2026-7-1", "2026-07-10T15:30", "nonsense", ""] {
            assert_eq!(parse_instant_millis(raw), None, "{raw}");
        }
    }

    /// The reason the offset cannot be captured once and reused: a host reading
    /// a July timestamp in January would otherwise resolve it at its *winter*
    /// offset and file the task a day early.
    #[test]
    fn an_instants_own_offset_is_what_decides_its_day() {
        let raw = "2026-07-10T07:30:00Z";
        let instant = parse_instant_millis(raw).expect("a zoned value names an instant");
        assert_eq!(instant, 1_783_668_600_000);

        // What Los Angeles is at that instant — daylight time.
        let summer = FixedOffset::east_opt(-7 * 3600).unwrap();
        assert_eq!(parse_local_date(raw, summer).unwrap(), ymd(2026, 7, 10));
        // What Los Angeles is in January, which is what a snapshot taken then
        // would have captured. Same instant, wrong day.
        let winter = FixedOffset::east_opt(-8 * 3600).unwrap();
        assert_eq!(parse_local_date(raw, winter).unwrap(), ymd(2026, 7, 9));
    }

    // ── toISODate ──────────────────────────────────────────────────────────

    #[test]
    fn to_iso_date_pads_month_and_day() {
        assert_eq!(to_iso_date(ymd(2026, 1, 5)), "2026-01-05");
        assert_eq!(to_iso_date(ymd(2026, 12, 31)), "2026-12-31");
    }

    #[test]
    fn to_iso_date_round_trips_through_parse_local_date() {
        let date = ymd(2026, 7, 22);
        assert_eq!(parse_local_date(&to_iso_date(date), utc()), Some(date));
    }

    // ── addDays ────────────────────────────────────────────────────────────

    #[test]
    fn add_days_walks_forward_and_backward_across_month_and_year_ends() {
        assert_eq!(add_days(today(), 1), Some(ymd(2026, 7, 23)), "tomorrow");
        assert_eq!(add_days(today(), -1), Some(ymd(2026, 7, 21)), "yesterday");
        assert_eq!(add_days(today(), 0), Some(today()));
        assert_eq!(add_days(ymd(2026, 7, 31), 1), Some(ymd(2026, 8, 1)));
        assert_eq!(add_days(ymd(2026, 12, 31), 1), Some(ymd(2027, 1, 1)));
        assert_eq!(add_days(ymd(2027, 1, 1), -1), Some(ymd(2026, 12, 31)));
        // A leap day is reached by counting, not by month arithmetic.
        assert_eq!(add_days(ymd(2028, 2, 28), 1), Some(ymd(2028, 2, 29)));
        assert_eq!(add_days(ymd(2027, 2, 28), 1), Some(ymd(2027, 3, 1)));
    }

    #[test]
    fn add_days_declines_to_run_off_the_end_of_the_calendar() {
        assert_eq!(add_days(NaiveDate::MAX, 1), None);
        assert_eq!(add_days(NaiveDate::MIN, -1), None);
        // `i32::MIN` is the one magnitude that has no positive counterpart, so
        // it is the input a naive negation would overflow on.
        assert_eq!(add_days(today(), i32::MIN), None);
        assert_eq!(add_days(today(), i32::MAX), None);
    }

    // ── nextSaturday ───────────────────────────────────────────────────────

    #[test]
    fn next_saturday_from_midweek_is_the_upcoming_saturday() {
        // 2026-07-22 is a Wednesday.
        assert_eq!(next_saturday(today()), Some(ymd(2026, 7, 25)));
    }

    #[test]
    fn next_saturday_on_a_saturday_is_today() {
        assert_eq!(next_saturday(ymd(2026, 7, 25)), Some(ymd(2026, 7, 25)));
    }

    #[test]
    fn next_saturday_on_a_sunday_is_the_following_saturday() {
        assert_eq!(next_saturday(ymd(2026, 7, 26)), Some(ymd(2026, 8, 1)));
    }

    // ── nextMonday ─────────────────────────────────────────────────────────

    #[test]
    fn next_monday_from_midweek_is_five_days_out_not_seven() {
        assert_eq!(next_monday(today()), Some(ymd(2026, 7, 27)));
    }

    #[test]
    fn next_monday_on_a_monday_is_strictly_the_next_one() {
        assert_eq!(next_monday(ymd(2026, 7, 27)), Some(ymd(2026, 8, 3)));
    }

    #[test]
    fn next_monday_on_a_sunday_is_tomorrow() {
        assert_eq!(next_monday(ymd(2026, 7, 26)), Some(ymd(2026, 7, 27)));
    }

    /// Not in the TypeScript suite, which cannot reach the end of the calendar.
    /// `next_monday` is the unconditional case: it always advances at least one
    /// day, so from the last representable date it has nowhere to go.
    #[test]
    fn weekday_arithmetic_declines_to_run_off_the_end_of_the_calendar() {
        assert_eq!(next_monday(NaiveDate::MAX), None);
        assert!(!is_upcoming(
            NaiveDate::MAX,
            NaiveDate::MAX,
            UpcomingHorizon::Days(u32::MAX)
        ));
        assert!(is_upcoming(
            NaiveDate::MAX,
            days_from(NaiveDate::MAX, -1),
            UpcomingHorizon::Days(u32::MAX)
        ));
    }
}
