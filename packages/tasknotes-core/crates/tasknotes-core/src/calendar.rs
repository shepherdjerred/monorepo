//! Month-grid construction for date pickers.
//!
//! A month picker needs three things a shell should not have to re-derive: how
//! many leading blanks a month starts with, how many days it has, and where the
//! trailing blanks fall. All three are calendar arithmetic, all three are the
//! same on every platform, and getting any of them wrong is an off-by-one the
//! user sees immediately.
//!
//! ## Months are one-indexed here
//!
//! The TypeScript `CalendarMonth` carries a **zero-indexed** month because
//! that is what the JavaScript `Date` constructor takes. That convention is a
//! wart, not a contract — it exists nowhere in the stored data, where every
//! date is `YYYY-MM-DD` with a one-indexed month, and it is a reliable source
//! of off-by-one bugs at every boundary between the two. [`CalendarMonth`]
//! therefore agrees with the stored form, and holds a validated
//! [`chrono::NaiveDate`] rather than a loose year/month pair, so "the first day
//! of a real month" is a property of the type rather than something each method
//! rechecks.
//!
//! `currentMonth(now)` has no counterpart here: once the clock is a parameter
//! it is [`CalendarMonth::of`] applied to the viewer's today, and a second name
//! for that would only be a second thing to keep in step.

use chrono::{Datelike, NaiveDate, Weekday};

use crate::dates::to_iso_date;
use crate::{Error, Result};

/// The first year [`CalendarMonth`] accepts.
pub const MIN_YEAR: i32 = 1;

/// The last year [`CalendarMonth`] accepts.
///
/// Together with [`MIN_YEAR`] this is exactly the range in which
/// [`crate::dates::to_iso_date`] renders ten characters, so every cell key and
/// every date this module produces is a well-formed `YYYY-MM-DD`.
pub const MAX_YEAR: i32 = 9999;

/// A column header for the weekday row above a month grid.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct WeekdayHeader {
    /// A stable identifier for the column, independent of the label.
    pub key: &'static str,
    /// The single-letter heading shown above the column.
    ///
    /// English, and deliberately so: it is the abbreviation the existing app
    /// ships. A shell that wants the user's locale should ask the platform for
    /// weekday symbols instead of using this — the `key` is what stays fixed.
    pub label: &'static str,
}

/// The seven column headers, Sunday first, matching the grid [`CalendarMonth::grid`] builds.
pub const WEEKDAYS: [WeekdayHeader; 7] = [
    WeekdayHeader {
        key: "sun",
        label: "S",
    },
    WeekdayHeader {
        key: "mon",
        label: "M",
    },
    WeekdayHeader {
        key: "tue",
        label: "T",
    },
    WeekdayHeader {
        key: "wed",
        label: "W",
    },
    WeekdayHeader {
        key: "thu",
        label: "T",
    },
    WeekdayHeader {
        key: "fri",
        label: "F",
    },
    WeekdayHeader {
        key: "sat",
        label: "S",
    },
];

/// One cell of a month grid.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct CalendarCell {
    /// A stable identifier, unique within one grid.
    ///
    /// Opaque: it exists so a list view can track cells across re-renders, and
    /// nothing may parse it. Real days use their `YYYY-MM-DD`; padding uses its
    /// grid position, because two padding cells are otherwise indistinguishable.
    pub key: String,
    /// The day this cell shows, or `None` when it pads a partial week.
    pub date: Option<NaiveDate>,
}

impl CalendarCell {
    /// Whether this cell falls outside the month it pads.
    #[must_use]
    pub const fn is_padding(&self) -> bool {
        self.date.is_none()
    }

    /// A cell for a real day of the month.
    fn day(date: NaiveDate) -> Self {
        Self {
            key: to_iso_date(date),
            date: Some(date),
        }
    }
}

/// A calendar month, represented by its first day.
///
/// Constructing one proves the month exists and is inside
/// [`MIN_YEAR`]`..=`[`MAX_YEAR`], so every accessor and every grid method below
/// is total.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct CalendarMonth {
    first_day: NaiveDate,
}

impl CalendarMonth {
    /// The month containing `year`/`month`, with `month` one-indexed.
    ///
    /// # Errors
    ///
    /// Returns [`Error::Invariant`] when `month` is outside `1..=12` or `year`
    /// is outside [`MIN_YEAR`]`..=`[`MAX_YEAR`]. Both are caller bugs rather
    /// than user input — a picker steps through months, it does not accept them
    /// as free text — so they are loud rather than clamped.
    pub fn new(year: i32, month: u32) -> Result<Self> {
        if !(MIN_YEAR..=MAX_YEAR).contains(&year) {
            return Err(Error::invariant(format!(
                "calendar year {year} is outside {MIN_YEAR}..={MAX_YEAR}"
            )));
        }
        NaiveDate::from_ymd_opt(year, month, 1)
            .map(|first_day| Self { first_day })
            .ok_or_else(|| Error::invariant(format!("calendar month {month} is outside 1..=12")))
    }

    /// The month `date` falls in.
    ///
    /// # Errors
    ///
    /// Returns [`Error::Invariant`] when `date`'s year is outside
    /// [`MIN_YEAR`]`..=`[`MAX_YEAR`].
    pub fn of(date: NaiveDate) -> Result<Self> {
        Self::new(date.year(), date.month())
    }

    /// The year.
    #[must_use]
    pub fn year(self) -> i32 {
        self.first_day.year()
    }

    /// The month, one-indexed.
    #[must_use]
    pub fn month(self) -> u32 {
        self.first_day.month()
    }

    /// The first day of the month.
    #[must_use]
    pub const fn first_day(self) -> NaiveDate {
        self.first_day
    }

    /// The month `delta` months away — negative to step backwards.
    ///
    /// # Errors
    ///
    /// Returns [`Error::Invariant`] when the result leaves
    /// [`MIN_YEAR`]`..=`[`MAX_YEAR`]. A picker that walks off the end of the
    /// supported range should stop, not wrap silently to a year whose ISO form
    /// no longer has four digits.
    pub fn add_months(self, delta: i32) -> Result<Self> {
        let magnitude = chrono::Months::new(delta.unsigned_abs());
        let shifted = if delta < 0 {
            self.first_day.checked_sub_months(magnitude)
        } else {
            self.first_day.checked_add_months(magnitude)
        };
        shifted
            .ok_or_else(|| {
                Error::invariant(format!(
                    "stepping {delta} months from {} leaves the calendar",
                    self.first_day
                ))
            })
            .and_then(Self::of)
    }

    /// The month's heading, as the existing app renders it: `"July 2026"`.
    ///
    /// English, like [`WeekdayHeader::label`], because that is what the app
    /// ships today — the TypeScript hard-codes the `en-US` locale rather than
    /// following the user's. A macOS shell that wants a localized heading
    /// should format [`Self::first_day`] itself; this is the parity string.
    #[must_use]
    pub fn title(self) -> String {
        self.first_day.format("%B %Y").to_string()
    }

    /// How many days the month has.
    #[must_use]
    pub fn day_count(self) -> u8 {
        self.first_day.num_days_in_month()
    }

    /// The month as Sunday-started weeks.
    ///
    /// Leading and trailing days outside the month become padding cells, so
    /// every row is a whole week. That is stated in the return type — a
    /// `[CalendarCell; 7]` cannot be a partial row — rather than asserted in a
    /// test, which is the difference between an invariant and a hope.
    #[must_use]
    pub fn grid(self) -> Vec<[CalendarCell; 7]> {
        let leading = sunday_offset(self.first_day.weekday());
        let day_count = usize::from(self.day_count());
        let cell_count = (leading + day_count).div_ceil(7) * 7;

        let year = self.year();
        let month = self.month();
        let pad = move |position: usize| CalendarCell {
            key: format!("{year:04}-{month:02}-pad-{position}"),
            date: None,
        };

        // Built as one sequential stream so a day cell's date comes from
        // `iter_days` rather than from arithmetic on its grid position: there
        // is no index-to-date conversion to get wrong, and none that can fail.
        let mut cells = (0..leading)
            .map(pad)
            .chain(
                self.first_day
                    .iter_days()
                    .take(day_count)
                    .map(CalendarCell::day),
            )
            .chain((leading + day_count..cell_count).map(pad));

        core::iter::from_fn(move || {
            Some([
                cells.next()?,
                cells.next()?,
                cells.next()?,
                cells.next()?,
                cells.next()?,
                cells.next()?,
                cells.next()?,
            ])
        })
        .collect()
    }
}

/// A weekday's column index in a Sunday-started grid.
///
/// Written out rather than taken from `num_days_from_sunday`, which returns a
/// `u32` that would then need a fallible conversion to index arithmetic. An
/// exhaustive match is total, and the compiler checks it.
const fn sunday_offset(weekday: Weekday) -> usize {
    match weekday {
        Weekday::Sun => 0,
        Weekday::Mon => 1,
        Weekday::Tue => 2,
        Weekday::Wed => 3,
        Weekday::Thu => 4,
        Weekday::Fri => 5,
        Weekday::Sat => 6,
    }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeSet;

    use chrono::{Datelike, NaiveDate};

    use super::{CalendarMonth, MAX_YEAR, MIN_YEAR, WEEKDAYS};

    fn month(year: i32, month: u32) -> CalendarMonth {
        CalendarMonth::new(year, month).unwrap()
    }

    fn ymds(grid: &[[super::CalendarCell; 7]]) -> Vec<Vec<Option<String>>> {
        grid.iter()
            .map(|week| {
                week.iter()
                    .map(|cell| cell.date.map(crate::dates::to_iso_date))
                    .collect()
            })
            .collect()
    }

    #[test]
    fn july_2026_starts_on_wednesday_and_spans_five_whole_weeks() {
        let grid = month(2026, 7).grid();
        assert_eq!(grid.len(), 5);

        let rendered = ymds(&grid);
        assert_eq!(
            rendered.first().unwrap(),
            &[
                None,
                None,
                None,
                Some("2026-07-01".to_owned()),
                Some("2026-07-02".to_owned()),
                Some("2026-07-03".to_owned()),
                Some("2026-07-04".to_owned()),
            ]
        );

        let last = grid.last().unwrap();
        assert_eq!(
            last.get(5).unwrap().date,
            NaiveDate::from_ymd_opt(2026, 7, 31)
        );
        assert!(last.get(6).unwrap().is_padding());
    }

    #[test]
    fn february_in_a_leap_year_has_twenty_nine_days() {
        let grid = month(2028, 2).grid();
        let days: Vec<NaiveDate> = grid.iter().flatten().filter_map(|cell| cell.date).collect();
        assert_eq!(days.len(), 29);
        assert_eq!(days.last().copied(), NaiveDate::from_ymd_opt(2028, 2, 29));
    }

    #[test]
    fn a_month_starting_on_sunday_has_no_leading_padding() {
        // 2026-02-01 is a Sunday.
        let grid = month(2026, 2).grid();
        assert_eq!(
            grid.first().unwrap().first().unwrap().date,
            NaiveDate::from_ymd_opt(2026, 2, 1)
        );
    }

    #[test]
    fn cell_keys_are_unique_within_a_month() {
        let grid = month(2026, 7).grid();
        let keys: Vec<&str> = grid
            .iter()
            .flatten()
            .map(|cell| cell.key.as_str())
            .collect();
        let unique: BTreeSet<&str> = keys.iter().copied().collect();
        assert_eq!(unique.len(), keys.len());
    }

    /// Not in the TypeScript suite: the row-of-seven claim was a test there and
    /// is a type here, so what is left to check is that no month escapes it.
    #[test]
    fn every_month_of_a_leap_and_a_common_year_is_whole_weeks_of_its_own_days() {
        for year in [2026, 2028] {
            for number in 1..=12 {
                let calendar_month = month(year, number);
                let grid = calendar_month.grid();
                let days: Vec<NaiveDate> =
                    grid.iter().flatten().filter_map(|cell| cell.date).collect();
                assert_eq!(
                    days.len(),
                    usize::from(calendar_month.day_count()),
                    "{year}-{number}"
                );
                assert!(
                    days.iter()
                        .all(|day| day.month() == number && day.year() == year),
                    "{year}-{number} leaked a day from another month"
                );
                assert!((4..=6).contains(&grid.len()), "{year}-{number}");
            }
        }
    }

    #[test]
    fn add_months_wraps_across_year_boundaries_both_ways() {
        assert_eq!(month(2026, 12).add_months(1).unwrap(), month(2027, 1));
        assert_eq!(month(2026, 1).add_months(-1).unwrap(), month(2025, 12));
    }

    #[test]
    fn month_of_a_date_agrees_with_the_explicit_constructor() {
        let date = NaiveDate::from_ymd_opt(2026, 7, 22).unwrap();
        assert_eq!(CalendarMonth::of(date).unwrap(), month(2026, 7));
        assert_eq!(month(2026, 7).year(), 2026);
        assert_eq!(month(2026, 7).month(), 7);
    }

    #[test]
    fn month_title_renders_a_human_month() {
        assert_eq!(month(2026, 7).title(), "July 2026");
        assert_eq!(month(2026, 1).title(), "January 2026");
    }

    #[test]
    fn an_impossible_month_is_rejected_loudly() {
        let error = CalendarMonth::new(2026, 13).unwrap_err();
        assert!(
            error.to_string().contains("outside 1..=12"),
            "unexpected error: {error}"
        );
        let error = CalendarMonth::new(2026, 0).unwrap_err();
        assert!(
            error.to_string().contains("outside 1..=12"),
            "unexpected error: {error}"
        );
    }

    #[test]
    fn stepping_past_the_supported_year_range_fails_rather_than_wrapping() {
        assert!(month(MAX_YEAR, 12).add_months(1).is_err());
        assert!(month(MIN_YEAR, 1).add_months(-1).is_err());
        assert!(CalendarMonth::new(0, 1).is_err());
        assert!(CalendarMonth::new(10_000, 1).is_err());
    }

    #[test]
    fn weekday_headers_are_sunday_first_and_uniquely_keyed() {
        let keys: Vec<&str> = WEEKDAYS.iter().map(|header| header.key).collect();
        assert_eq!(keys, ["sun", "mon", "tue", "wed", "thu", "fri", "sat"]);
        let labels: Vec<&str> = WEEKDAYS.iter().map(|header| header.label).collect();
        assert_eq!(labels, ["S", "M", "T", "W", "T", "F", "S"]);
    }
}
