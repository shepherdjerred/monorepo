//! Hand-rolled RFC 5545 recurrence expansion.
//!
//! Deliberately **not** built on the `rrule` crate: that crate has had no
//! commit in 16 months and carries an open two-year-old bug where
//! `FREQ=YEARLY;BYMONTHDAY=N` expands monthly.
//!
//! ## What "correct" means here
//!
//! Correctness is defined by the corpus at
//! `packages/tasknotes-fixtures/recurrence/` — 338 cases and 69,017 occurrence
//! dates snapshotted from `@tasknotes/model` (which wraps rrule.js 2.8.1) over
//! 2021-01-01…2030-12-31. **Not** by RFC 5545, and not by the current
//! TypeScript app. Where the three disagree the corpus wins, because the point
//! of this engine is that a task shows up on the same days on every platform,
//! not that it is a conforming RFC implementation. The clearest example is
//! quirk 4 below, which the RFC would answer differently.
//!
//! ## The parity contract
//!
//! * **Timezone-free naive-date arithmetic.** The reference never sets a
//!   `tzid`, substitutes a UTC midnight for `DTSTART`, and reads results back
//!   with UTC getters. There is no DST here, and no host timezone can change an
//!   answer. See [`instant`].
//! * **Inclusive on both ends.** rrule.js's `between` is asked with `inc`
//!   true, so a window includes both of its bounds.
//! * **Fail open.** An empty or unparsable rule means *show the task*
//!   ([`Recurrence::occurs_on`] returns `true`). A port that returns `false`
//!   makes tasks silently vanish.
//! * **…except one asymmetric fail-CLOSED path.** When no `DTSTART:` is
//!   embedded and neither `scheduled` nor `dateCreated` is set, the reference
//!   returns `false` *before parsing anything* — so even `"garbage"` is
//!   fail-closed in that shape. The empty rule is the sole exception, because
//!   it short-circuits earlier still.
//!
//! ## Quirks the corpus pins down
//!
//! 1. A `DTSTART`-only rule silently becomes `FREQ=YEARLY` on that month and
//!    day, because the option set ends up empty and rrule.js defaults it.
//! 2. `WKST=XX` and `BYMONTH=0` are ignored and the rule still fires, while
//!    `BYMONTH=13` and `BYMONTHDAY=32` parse fine and then match nothing.
//! 3. `COUNT=-5` is ignored and leaves the rule unbounded, but `COUNT=abc`
//!    collapses it to exactly one occurrence.
//! 4. `FREQ=YEARLY;BYMONTHDAY=20` expands across **every** month, not just
//!    `DTSTART`'s — 60 occurrences in five years, where the RFC wants 5.
//! 5. Invalid dates roll over rather than being rejected: `UNTIL=20260231` is
//!    3 March. A *leading* `;` is stripped and the rule parses; a *trailing* one
//!    fails open. `DTSTART:notadate` misses the date regex entirely and falls
//!    back to `scheduled` without complaint.
//!
//! ## Two inputs that are rejected rather than reproduced
//!
//! `FREQ=DAILY;INTERVAL=-1` and `FREQ=DAILY;INTERVAL=abc` make rrule.js **loop
//! forever** — not throw, not return empty. An unbounded loop driven by a value
//! parsed out of user text is a hang, not a wrong answer, so both are rejected
//! during parsing and fail open. `INTERVAL=0` is *not* in that class: it
//! returns an empty expansion immediately, so it parses and yields nothing.
//! The corpus excludes the two hanging rules through its own guard, so there is
//! no reference answer to diverge from.

mod describe;
mod expand;
mod instant;
mod options;
mod text;
mod year;

use chrono::NaiveDate;

use crate::domain::RecurrenceAnchor;
use crate::{Error, Result};

use self::instant::{MS_PER_DAY, MS_PER_DAY_END};
use self::options::Options;
use self::text::{EasterOffset, Unparsable};

pub use self::text::Frequency;

/// `getFiniteRecurringInstanceCount`'s own ceiling: past this many instances it
/// reports "not finite" rather than a number.
const MAX_FINITE_INSTANCE_COUNT: usize = 10_000;

/// An inclusive range of dates.
///
/// A parsed value: `start` is known to be no later than `end`, so nothing
/// downstream re-checks and an empty or inverted window is unrepresentable.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct DateWindow {
    start: NaiveDate,
    end: NaiveDate,
}

impl DateWindow {
    /// Build a window covering `start..=end`.
    ///
    /// # Errors
    ///
    /// Returns [`Error::Invariant`] when `end` is before `start`.
    pub fn new(start: NaiveDate, end: NaiveDate) -> Result<Self> {
        if end < start {
            return Err(Error::invariant(format!(
                "a date window must not end before it starts, got {start}..={end}"
            )));
        }
        Ok(Self { start, end })
    }

    /// The window covering exactly one day.
    #[must_use]
    pub const fn on(date: NaiveDate) -> Self {
        Self {
            start: date,
            end: date,
        }
    }

    /// The first date in the window.
    #[must_use]
    pub const fn start(&self) -> NaiveDate {
        self.start
    }

    /// The last date in the window.
    #[must_use]
    pub const fn end(&self) -> NaiveDate {
        self.end
    }

    /// Every date in the window, ascending.
    pub fn dates(&self) -> impl Iterator<Item = NaiveDate> + use<> {
        let (start, end) = (self.start, self.end);
        core::iter::successors(Some(start), NaiveDate::succ_opt)
            .take_while(move |date| *date <= end)
    }

    /// The inclusive millisecond bounds of the window.
    fn bounds(self) -> (i64, i64) {
        (
            instant::ordinal_of(self.start) * MS_PER_DAY,
            instant::ordinal_of(self.end) * MS_PER_DAY + MS_PER_DAY_END,
        )
    }
}

/// How a rule behaves once its `DTSTART` has been resolved and its text parsed.
#[derive(Debug, Clone, PartialEq, Eq)]
enum Behaviour {
    /// The rule text is empty. The reference short-circuits to `true` before
    /// any parsing — and its *generator* entry point returns nothing at all,
    /// which is the one place the two disagree.
    Empty,
    /// The reference threw while resolving `DTSTART` or parsing the rule, and
    /// its `catch` answers `true`.
    Unparsed,
    /// No `DTSTART` could be resolved. The reference answers `false` for every
    /// date, before parsing.
    Rootless,
    /// A rule that parsed.
    Rule(Box<Options>),
}

/// A task's `recurrence` field, parsed together with the two fields that can
/// supply its `DTSTART`.
///
/// Parsing is done once, up front, and the result is one of three closed
/// behaviours — so no caller has to remember which failure mode means "show the
/// task" and which means "hide it".
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Recurrence {
    /// Retained because the reference's finite-instance count and look-ahead
    /// window read `COUNT`, `UNTIL` and `INTERVAL` back out of the raw text
    /// with their own regexes rather than from the parsed rule.
    text: String,
    /// The resolved `DTSTART`, or `None` when it could not be resolved *or*
    /// resolving it threw — which the reference conflates too.
    dtstart: Option<i64>,
    behaviour: Behaviour,
}

impl Recurrence {
    /// Parse a `recurrence` field against its two `DTSTART` fallbacks.
    ///
    /// `scheduled` wins over `date_created`, and an embedded `DTSTART:` wins
    /// over both. Only the date part of a fallback is used, so a time component
    /// is discarded.
    ///
    /// This never fails: every unparsable input resolves to one of the two
    /// documented failure behaviours instead.
    #[must_use]
    pub fn parse(text: &str, scheduled: Option<&str>, date_created: Option<&str>) -> Self {
        let owned = text.to_owned();
        if text.is_empty() {
            return Self {
                text: owned,
                dtstart: None,
                behaviour: Behaviour::Empty,
            };
        }
        // `createRRule` resolves DTSTART *before* it parses, which is what makes
        // a missing DTSTART fail closed even for a garbage rule.
        let dtstart = match resolve_dtstart(text, scheduled, date_created) {
            Err(Unparsable) => {
                return Self {
                    text: owned,
                    dtstart: None,
                    behaviour: Behaviour::Unparsed,
                };
            }
            Ok(None) => {
                return Self {
                    text: owned,
                    dtstart: None,
                    behaviour: Behaviour::Rootless,
                };
            }
            Ok(Some(dtstart)) => dtstart,
        };
        let behaviour = text::parse_rule_string(&rule_body(text))
            .and_then(|raw| options::build(&raw, dtstart))
            .map_or(Behaviour::Unparsed, |options| {
                Behaviour::Rule(Box::new(options))
            });
        Self {
            text: owned,
            dtstart: Some(dtstart),
            behaviour,
        }
    }

    /// Whether the task has an occurrence on `date`.
    ///
    /// This is the parity surface: it answers exactly what
    /// `shouldShowRecurringTaskOnDate` answers, including both failure
    /// directions.
    #[must_use]
    pub fn occurs_on(&self, date: NaiveDate) -> bool {
        match &self.behaviour {
            Behaviour::Empty | Behaviour::Unparsed => true,
            Behaviour::Rootless => false,
            Behaviour::Rule(options) => {
                let (min, max) = DateWindow::on(date).bounds();
                !expand::expand(options, min, max).is_empty()
            }
        }
    }

    /// Every date in `window` on which [`Recurrence::occurs_on`] is true.
    ///
    /// Expanded in one pass rather than one query per day: the reference scans
    /// to its year bound before conceding that a rule has no occurrences, which
    /// makes a per-day loop quadratic in exactly the cases that are already
    /// slowest.
    #[must_use]
    pub fn occurrences(&self, window: DateWindow) -> Vec<NaiveDate> {
        match &self.behaviour {
            Behaviour::Empty | Behaviour::Unparsed => window.dates().collect(),
            Behaviour::Rootless => Vec::new(),
            Behaviour::Rule(options) => {
                let (min, max) = window.bounds();
                let mut dates: Vec<NaiveDate> = expand::expand(options, min, max)
                    .into_iter()
                    .filter_map(date_of)
                    .collect();
                dates.sort_unstable();
                dates.dedup();
                dates
            }
        }
    }

    /// The rule's frequency, or `None` when it did not parse.
    #[must_use]
    pub fn frequency(&self) -> Option<Frequency> {
        match &self.behaviour {
            Behaviour::Empty | Behaviour::Unparsed | Behaviour::Rootless => None,
            Behaviour::Rule(options) => Some(options.freq),
        }
    }

    /// Whether the rule is one the engine could expand at all.
    #[must_use]
    pub const fn is_expandable(&self) -> bool {
        matches!(self.behaviour, Behaviour::Rule(_))
    }

    /// The rule as a sentence — `"Every 2 weeks on Mon, Wed"`.
    ///
    /// `None` for a rule the engine cannot expand, and for one whose parts have
    /// no unambiguous one-sentence reading; the shell shows the raw `RRULE`
    /// there, because a wrong summary is worse than no summary. See
    /// [`describe`] for the exact contract, the case-by-case reasoning, and why
    /// this belongs in the core rather than in each shell.
    #[must_use]
    pub fn summary(&self) -> Option<String> {
        match &self.behaviour {
            Behaviour::Empty | Behaviour::Unparsed | Behaviour::Rootless => None,
            Behaviour::Rule(options) => describe::describe(options),
        }
    }

    /// How many instances the series has in total, when that is a finite and
    /// knowable number.
    ///
    /// `None` covers three different situations the reference also conflates:
    /// the rule is unbounded, its `UNTIL` precedes its `DTSTART` (which is
    /// `None`, not `0`), or the series is longer than the reference's own
    /// 10,000-instance ceiling.
    #[must_use]
    pub fn finite_instance_count(&self) -> Option<usize> {
        if self.text.is_empty() {
            return None;
        }
        if let Some(count) = rule_part(&self.text, "COUNT") {
            let count: usize = digits_only(count)?.parse().ok()?;
            return (count > 0).then_some(count);
        }
        rule_part(&self.text, "UNTIL")?;
        let dtstart = self.dtstart?;
        let until = until_instant(&self.text)?;
        if until < dtstart {
            return None;
        }
        let instances = self.generated_instances(dtstart, until);
        if instances.len() >= MAX_FINITE_INSTANCE_COUNT {
            return None;
        }
        (!instances.is_empty()).then_some(instances.len())
    }

    /// The next occurrence at or after `today` that has neither been completed
    /// nor skipped, as `getNextUncompletedOccurrence` computes it.
    ///
    /// The two anchors search different ranges on purpose: a scheduled-anchored
    /// series reaches back to its `DTSTART` so a long-overdue occurrence still
    /// surfaces, while a completion-anchored one starts at the `DTSTART` the
    /// last completion rewrote and skips it.
    #[must_use]
    pub fn next_uncompleted_occurrence(
        &self,
        today: NaiveDate,
        anchor: RecurrenceAnchor,
        complete: &[NaiveDate],
        skipped: &[NaiveDate],
    ) -> Option<NaiveDate> {
        if self.text.is_empty() {
            return None;
        }
        let today_ms = instant::ordinal_of(today) * MS_PER_DAY;
        let horizon = i64::from(look_ahead_days(&self.text)) * MS_PER_DAY;
        let embedded = embedded_dtstart(&self.text);

        let (from, to, floor) = match anchor {
            RecurrenceAnchor::Scheduled => {
                let from = embedded
                    .filter(|start| *start < today_ms)
                    .unwrap_or(today_ms);
                (from, today_ms + horizon, None)
            }
            RecurrenceAnchor::Completion => {
                let from = embedded.unwrap_or(today_ms);
                (from, from + horizon, Some(embedded.unwrap_or(0)))
            }
        };

        for occurrence in self.generated_instances(from, to) {
            if occurrence < today_ms || floor.is_some_and(|floor| occurrence <= floor) {
                continue;
            }
            let Some(date) = date_of(occurrence) else {
                continue;
            };
            let processed =
                skipped.contains(&date) || (floor.is_none() && complete.contains(&date));
            if !processed {
                return Some(date);
            }
        }
        None
    }

    /// `generateRecurringInstances`: the reference's *other* expansion entry
    /// point, over a raw instant range.
    ///
    /// It is not the same function as [`Recurrence::occurrences`], and the
    /// difference is recorded in the corpus rather than smoothed over: for an
    /// empty rule the show-check reports an occurrence on every date while this
    /// generator reports none at all. Its `catch` branch also walks whole days
    /// from the *raw* start instant, where its success path snaps the range out
    /// to whole days first.
    fn generated_instances(&self, from: i64, to: i64) -> Vec<i64> {
        match &self.behaviour {
            Behaviour::Empty | Behaviour::Rootless => Vec::new(),
            Behaviour::Unparsed => {
                core::iter::successors(Some(from), |instant| instant.checked_add(MS_PER_DAY))
                    .take_while(|instant| *instant <= to)
                    .collect()
            }
            Behaviour::Rule(options) => {
                let min = from.div_euclid(MS_PER_DAY) * MS_PER_DAY;
                let max = to.div_euclid(MS_PER_DAY) * MS_PER_DAY + MS_PER_DAY_END;
                expand::expand(options, min, max)
            }
        }
    }
}

fn date_of(instant: i64) -> Option<NaiveDate> {
    instant::date_at(instant.div_euclid(MS_PER_DAY))
}

/// The occurrence a completion gesture targets on a **recurring** task.
///
/// ## This is correctness, not cosmetics
///
/// A recurring task completes its *scheduled occurrence*, never the calendar
/// day the user happened to click. The TaskNotes plugin records completion as a
/// date in `complete_instances` and reads an occurrence as done only when that
/// occurrence's **own** date is in the list — so completing a rent task that
/// recurs on the 1st while it is the 12th must write `…-01`. Writing `…-12`
/// files the completion under a day the rule never fires on: the entry is
/// orphaned, the occurrence still reads as open, and the task reappears as if
/// untouched. That was a real bug in the TypeScript app, fixed by
/// `completionTargetDate`, which this ports.
///
/// ## Why the anchor flips it
///
/// A completion-anchored series means "N days after each completion", so its
/// next occurrence is computed from *when you completed it*. Today is then the
/// correct and only meaningful target. A scheduled-anchored series keeps its
/// cadence regardless of when you got to it, so the target is the occurrence
/// the task is sitting on. `None` reads as [`RecurrenceAnchor::Scheduled`],
/// matching the reference's `task.recurrence_anchor === "completion"` test.
///
/// ## The date is *written down*, not observed
///
/// `scheduled` and `due` are read with [`date_part`] — the calendar date the
/// value spells — and deliberately **not** with
/// [`crate::dates::parse_local_date`], which shifts a zoned instant into the
/// viewer's offset. The plugin keys occurrences off the written date, so a
/// viewer-shifted reading would target a neighbouring day for anyone east or
/// west of whoever wrote the task, which is the same orphaned-completion bug
/// arriving by a different route.
///
/// `today` is the caller's — only the host knows the device's calendar — and is
/// the fallback when neither field carries a usable date.
#[must_use]
pub fn completion_target_date(
    scheduled: Option<&str>,
    due: Option<&str>,
    anchor: Option<RecurrenceAnchor>,
    today: NaiveDate,
) -> NaiveDate {
    if anchor == Some(RecurrenceAnchor::Completion) {
        return today;
    }
    scheduled
        .and_then(valid_date_part)
        .or_else(|| due.and_then(valid_date_part))
        .unwrap_or(today)
}

/// `extractValidDatePartOrUndefined`: [`date_part`] narrowed to values that are
/// also real calendar dates.
///
/// The two halves are the reference's two calls — `getDatePart` then
/// `validateDateString` — and reusing them rather than restating the rule is
/// what keeps this in step with [`resolve_dtstart`], which reads the same
/// fields through the same parser.
fn valid_date_part(value: &str) -> Option<NaiveDate> {
    date_part(value)
        .ok()
        .and_then(|head| parse_date_only(head).ok())
        .and_then(date_of)
}

/// `getRRuleDtstart`: the embedded `DTSTART:`, then `scheduled`, then
/// `dateCreated`.
///
/// The chain is short-circuiting *and* throwing: an unreadable `scheduled` is
/// an error, not a reason to try `dateCreated`.
fn resolve_dtstart(
    text: &str,
    scheduled: Option<&str>,
    date_created: Option<&str>,
) -> core::result::Result<Option<i64>, Unparsable> {
    if let Some(embedded) = embedded_dtstart(text) {
        return Ok(Some(embedded));
    }
    for fallback in [scheduled, date_created] {
        let Some(fallback) = fallback.filter(|value| !value.is_empty()) else {
            continue;
        };
        return parse_date_only(date_part(fallback)?).map(Some);
    }
    Ok(None)
}

/// `getDatePart`: everything before a `T`, or before a space that follows a
/// bare date, or the value itself when it already is one.
fn date_part(value: &str) -> core::result::Result<&str, Unparsable> {
    let trimmed = value.trim();
    if is_date_only(trimmed) {
        return Ok(trimmed);
    }
    if let Some(index) = trimmed.find('T') {
        return trimmed.get(..index).ok_or(Unparsable);
    }
    if let Some(index) = trimmed.find(' ')
        && let Some(head) = trimmed.get(..index)
        && is_date_only(head)
    {
        return Ok(head);
    }
    // The reference falls through to `parseDateToUTC` on the whole string,
    // which needs a `T` to be a valid datetime and therefore always throws.
    Err(Unparsable)
}

fn is_date_only(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() == 10
        && bytes.iter().enumerate().all(|(index, byte)| {
            if index == 4 || index == 7 {
                *byte == b'-'
            } else {
                byte.is_ascii_digit()
            }
        })
}

/// `parseDateToUTC` for a bare `YYYY-MM-DD`, which validates the calendar date
/// rather than rolling it over.
fn parse_date_only(value: &str) -> core::result::Result<i64, Unparsable> {
    if !is_date_only(value) {
        return Err(Unparsable);
    }
    let number = |range: core::ops::Range<usize>| -> Option<u32> {
        value.get(range).and_then(|slice| slice.parse().ok())
    };
    let (Some(year), Some(month), Some(day)) = (number(0..4), number(5..7), number(8..10)) else {
        return Err(Unparsable);
    };
    let year = i32::try_from(year).map_err(|_| Unparsable)?;
    let date = NaiveDate::from_ymd_opt(year, month, day).ok_or(Unparsable)?;
    Ok(instant::ordinal_of(date) * MS_PER_DAY)
}

/// `/DTSTART:(\d{8}(?:T\d{6}Z?)?)/`, read with `parseRRuleDateValue`.
fn embedded_dtstart(text: &str) -> Option<i64> {
    for (index, _) in text.match_indices("DTSTART:") {
        let rest = text.get(index.saturating_add("DTSTART:".len())..)?;
        if let Some(value) = basic_date_value(rest) {
            return rrule_date_value(value, false);
        }
    }
    None
}

/// The longest prefix of `rest` matching `\d{8}(?:T\d{6}Z?)?`.
fn basic_date_value(rest: &str) -> Option<&str> {
    let digits = |range: core::ops::Range<usize>| {
        rest.get(range)
            .is_some_and(|slice| slice.bytes().all(|byte| byte.is_ascii_digit()))
    };
    if !digits(0..8) {
        return None;
    }
    if rest.as_bytes().get(8) == Some(&b'T') && digits(9..15) {
        let length = if rest.as_bytes().get(15) == Some(&b'Z') {
            16
        } else {
            15
        };
        return rest.get(..length);
    }
    rest.get(..8)
}

/// `parseRRuleDateValue`. A date-only value becomes either midnight or the last
/// millisecond of the day, depending on which end of a range it describes.
fn rrule_date_value(value: &str, end_of_day: bool) -> Option<i64> {
    let number = |range: core::ops::Range<usize>| -> i64 {
        value
            .get(range)
            .and_then(|slice| slice.parse::<i64>().ok())
            .unwrap_or(0)
    };
    let (year, month, day) = (number(0..4), number(4..6) - 1, number(6..8));
    if value.len() == 8 {
        return if end_of_day {
            instant::from_parts(year, month, day, 23, 59, 59, 999)
        } else {
            instant::from_parts(year, month, day, 0, 0, 0, 0)
        };
    }
    instant::from_parts(
        year,
        month,
        day,
        number(9..11),
        number(11..13),
        number(13..15),
        0,
    )
}

/// `recurrence.replace(/DTSTART:[^;]+;?/, "").replace(/^;/, "").trim()`.
///
/// Only a *leading* separator is stripped, which is why `;FREQ=DAILY` parses
/// and `FREQ=DAILY;` does not.
fn rule_body(text: &str) -> String {
    let mut body = text.to_owned();
    for (index, _) in text.match_indices("DTSTART:") {
        let after = index.saturating_add("DTSTART:".len());
        let Some(rest) = text.get(after..) else {
            continue;
        };
        let value_length = rest.find(';').unwrap_or(rest.len());
        if value_length == 0 {
            continue;
        }
        let consumed = if rest.as_bytes().get(value_length) == Some(&b';') {
            value_length.saturating_add(1)
        } else {
            value_length
        };
        let mut stripped = text.get(..index).unwrap_or_default().to_owned();
        stripped.push_str(
            text.get(after.saturating_add(consumed)..)
                .unwrap_or_default(),
        );
        body = stripped;
        break;
    }
    body.strip_prefix(';').unwrap_or(&body).trim().to_owned()
}

/// The value of a top-level `KEY=` part, as the reference's
/// `/(?:^|;)KEY=.../` regexes address it.
fn rule_part<'a>(text: &'a str, key: &str) -> Option<&'a str> {
    text.split(';')
        .find_map(|part| part.strip_prefix(key)?.strip_prefix('='))
}

fn digits_only(value: &str) -> Option<&str> {
    (!value.is_empty() && value.bytes().all(|byte| byte.is_ascii_digit())).then_some(value)
}

/// `parseUntilFromRecurrence`, which reads the end of the range as the last
/// millisecond of the named day.
fn until_instant(text: &str) -> Option<i64> {
    let value = rule_part(text, "UNTIL")?;
    let matched = basic_date_value(value)?;
    if matched.len() != value.len() {
        return None;
    }
    rrule_date_value(matched, true)
}

/// `getLookAheadDays`: how far past `today` the next-occurrence search reaches.
///
/// The reference matches `FREQ=` as a plain substring of the raw rule, in a
/// fixed order, so `FREQ=DAILY` wins even in a rule that also mentions another.
fn look_ahead_days(text: &str) -> i32 {
    let interval = interval_hint(text);
    if text.contains("FREQ=DAILY") {
        30.max(interval.saturating_mul(2))
    } else if text.contains("FREQ=WEEKLY") {
        90.max(interval.saturating_mul(14))
    } else if text.contains("FREQ=MONTHLY") {
        400.max(interval.saturating_mul(62))
    } else if text.contains("FREQ=YEARLY") {
        800.max(interval.saturating_mul(732))
    } else {
        365
    }
}

/// `/INTERVAL=(\d+)/`, which is unanchored and so matches anywhere.
fn interval_hint(text: &str) -> i32 {
    for (index, _) in text.match_indices("INTERVAL=") {
        let Some(rest) = text.get(index.saturating_add("INTERVAL=".len())..) else {
            continue;
        };
        let digits = rest.len() - rest.trim_start_matches(|c: char| c.is_ascii_digit()).len();
        if let Some(parsed) = rest
            .get(..digits)
            .and_then(|value| value.parse::<i32>().ok())
        {
            return parsed;
        }
    }
    1
}

/// The day index within `year` of Easter Sunday plus `offset`, for `BYEASTER`.
fn easter_day_index(year: i32, offset: EasterOffset) -> Option<i64> {
    let EasterOffset::Days(offset) = offset else {
        return None;
    };
    // Meeus/Jones/Butcher, transcribed from the reference's `easter.js` so the
    // two agree digit for digit rather than merely in spirit.
    let year = i64::from(year);
    let metonic = year % 19;
    let century = year / 100;
    let year_in_century = year % 100;
    let century_leaps = century / 4;
    let century_rest = century % 4;
    let lunar_shift = (century + 8) / 25;
    let solar_shift = (century - lunar_shift + 1) / 3;
    let epact = (19 * metonic + century - century_leaps - solar_shift + 15) % 30;
    let year_leaps = year_in_century / 4;
    let year_rest = year_in_century % 4;
    let weekday_shift = (32 + 2 * century_rest + 2 * year_leaps - epact - year_rest) % 7;
    let correction = (metonic + 11 * epact + 22 * weekday_shift) / 451;
    let march_day = epact + weekday_shift - 7 * correction + 114;
    let month = march_day / 31;
    let day = (march_day % 31) + 1;
    let easter = instant::from_parts(year, month - 1, day + offset, 0, 0, 0, 0)?;
    let year_start = instant::from_parts(year, 0, 1, 0, 0, 0, 0)?;
    Some((easter - year_start).div_euclid(MS_PER_DAY))
}

#[cfg(test)]
mod tests;
