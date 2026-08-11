//! The month grid a date picker draws.
//!
//! Three things a shell should not have to re-derive: how many leading blanks a
//! month starts with, how many days it has, and where the trailing blanks fall.
//! All three are calendar arithmetic, identical on every platform, and getting
//! any of them wrong is an off-by-one the user sees immediately.
//!
//! ## Two things UniFFI cannot express, and what they became
//!
//! * **`[CalendarCell; 7]`.** UniFFI has no fixed-length array, so a week is a
//!   [`CalendarWeek`] record wrapping a `Vec`. The core's return type made "every
//!   row is a whole week" an invariant the compiler checked; that guarantee does
//!   not survive the boundary, so [`calendar_month_grid`] re-checks it and
//!   reports a violation as [`CoreError::Invariant`] rather than handing the
//!   shell a short row.
//! * **`&'static str` fields.** [`tasknotes_core::calendar::WeekdayHeader`]
//!   borrows its `key` and `label`; the exported [`WeekdayHeader`] owns them.
//!
//! ## Months are one-indexed
//!
//! Matching the stored `YYYY-MM-DD` form, not the JavaScript `Date`
//! constructor's zero-indexed month. The zero-indexed convention is a wart that
//! exists nowhere in the data and is a reliable source of off-by-one bugs at
//! every boundary between the two — of which this is one.

use tasknotes_core::calendar::{self, CalendarMonth};

use crate::{
    dates::{parse_iso_date, render_iso_date},
    error::CoreError,
};

/// How many cells a week of the grid holds. Sunday through Saturday.
const DAYS_PER_WEEK: usize = 7;

/// A column header for the weekday row above a month grid.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct WeekdayHeader {
    /// A stable identifier for the column, independent of the label.
    pub key: String,
    /// The single-letter heading shown above the column.
    ///
    /// English, and deliberately so: it is the abbreviation the existing app
    /// ships. A shell that wants the user's locale should ask the platform for
    /// weekday symbols instead — `key` is what stays fixed.
    pub label: String,
}

/// One cell of a month grid.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct CalendarCell {
    /// A stable identifier, unique within one grid.
    ///
    /// Opaque: it exists so a list view can track cells across re-renders, and
    /// nothing may parse it. Real days use their `YYYY-MM-DD`; padding uses its
    /// grid position, because two padding cells are otherwise indistinguishable.
    pub key: String,
    /// The day this cell shows as `YYYY-MM-DD`, or `None` when it pads a
    /// partial week.
    pub date: Option<String>,
}

/// One row of a month grid: always a whole Sunday-started week.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct CalendarWeek {
    /// Seven cells, Sunday first.
    pub cells: Vec<CalendarCell>,
}

/// A calendar month, as a validated year and one-indexed month.
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Record)]
pub struct CalendarMonthRef {
    /// The year, in [`calendar_min_year`]`..=`[`calendar_max_year`].
    pub year: i32,
    /// The month, one-indexed.
    pub month: u32,
}

impl From<CalendarMonth> for CalendarMonthRef {
    fn from(month: CalendarMonth) -> Self {
        Self {
            year: month.year(),
            month: month.month(),
        }
    }
}

/// Resolve an exported month reference, validating it exactly as the core does.
fn resolve(reference: CalendarMonthRef) -> Result<CalendarMonth, CoreError> {
    CalendarMonth::new(reference.year, reference.month).map_err(CoreError::from)
}

/// The first year the calendar accepts.
#[uniffi::export]
#[must_use]
pub fn calendar_min_year() -> i32 {
    calendar::MIN_YEAR
}

/// The last year the calendar accepts.
///
/// Together with [`calendar_min_year`] this is exactly the range in which every
/// date rendered here is a well-formed ten-character `YYYY-MM-DD`.
#[uniffi::export]
#[must_use]
pub fn calendar_max_year() -> i32 {
    calendar::MAX_YEAR
}

/// The seven column headers, Sunday first, matching the grid.
#[uniffi::export]
#[must_use]
pub fn calendar_weekdays() -> Vec<WeekdayHeader> {
    calendar::WEEKDAYS
        .iter()
        .map(|header| WeekdayHeader {
            key: header.key.to_owned(),
            label: header.label.to_owned(),
        })
        .collect()
}

/// The month a date falls in.
///
/// # Errors
///
/// Returns [`CoreError::Validation`] when `date` is not a `YYYY-MM-DD` date,
/// or [`CoreError::Invariant`] when its year is outside the supported range.
#[uniffi::export]
pub fn calendar_month_of(date: &str) -> Result<CalendarMonthRef, CoreError> {
    CalendarMonth::of(parse_iso_date(date)?)
        .map(CalendarMonthRef::from)
        .map_err(CoreError::from)
}

/// The first day of a month, as `YYYY-MM-DD`.
///
/// # Errors
///
/// Returns [`CoreError::Invariant`] when the month is not a real one.
#[uniffi::export]
pub fn calendar_month_first_day(month: CalendarMonthRef) -> Result<String, CoreError> {
    Ok(render_iso_date(resolve(month)?.first_day()))
}

/// The month `delta` months away — negative to step backwards.
///
/// # Errors
///
/// Returns [`CoreError::Invariant`] when the argument is not a real month, or
/// when the result leaves the supported year range. A picker that walks off the
/// end of the calendar should stop, not wrap silently to a year whose ISO form
/// no longer has four digits.
#[uniffi::export]
pub fn calendar_month_add(
    month: CalendarMonthRef,
    delta: i32,
) -> Result<CalendarMonthRef, CoreError> {
    resolve(month)?
        .add_months(delta)
        .map(CalendarMonthRef::from)
        .map_err(CoreError::from)
}

/// The month's heading, as the existing app renders it: `"July 2026"`.
///
/// English, because the TypeScript hard-codes the `en-US` locale rather than
/// following the user's. A shell that wants a localized heading should format
/// [`calendar_month_first_day`] itself; this is the parity string.
///
/// # Errors
///
/// Returns [`CoreError::Invariant`] when the month is not a real one.
#[uniffi::export]
pub fn calendar_month_title(month: CalendarMonthRef) -> Result<String, CoreError> {
    Ok(resolve(month)?.title())
}

/// How many days the month has.
///
/// # Errors
///
/// Returns [`CoreError::Invariant`] when the month is not a real one.
#[uniffi::export]
pub fn calendar_month_day_count(month: CalendarMonthRef) -> Result<u8, CoreError> {
    Ok(resolve(month)?.day_count())
}

/// The month as Sunday-started weeks, with padding cells outside it.
///
/// # Errors
///
/// Returns [`CoreError::Invariant`] when the month is not a real one, or if a
/// row ever arrives with something other than seven cells — which the core's
/// `[CalendarCell; 7]` return type makes impossible, and which this re-checks
/// because that guarantee cannot cross the boundary.
#[uniffi::export]
pub fn calendar_month_grid(month: CalendarMonthRef) -> Result<Vec<CalendarWeek>, CoreError> {
    let grid = resolve(month)?.grid();
    grid.into_iter()
        .map(|week| {
            let cells: Vec<CalendarCell> = week
                .into_iter()
                .map(|cell| CalendarCell {
                    key: cell.key,
                    date: cell.date.map(render_iso_date),
                })
                .collect();
            if cells.len() == DAYS_PER_WEEK {
                Ok(CalendarWeek { cells })
            } else {
                Err(CoreError::Invariant {
                    message: format!(
                        "a calendar row must hold {DAYS_PER_WEEK} cells, got {}",
                        cells.len()
                    ),
                })
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::{
        CalendarMonthRef, DAYS_PER_WEEK, calendar_max_year, calendar_min_year, calendar_month_add,
        calendar_month_day_count, calendar_month_first_day, calendar_month_grid, calendar_month_of,
        calendar_month_title, calendar_weekdays,
    };
    use crate::error::CoreError;

    const JULY_2026: CalendarMonthRef = CalendarMonthRef {
        year: 2026,
        month: 7,
    };

    #[test]
    fn the_headers_are_sunday_first_and_keyed_independently_of_their_labels() {
        let headers = calendar_weekdays();
        assert_eq!(headers.len(), DAYS_PER_WEEK);
        assert_eq!(
            headers.first().map(|header| header.key.as_str()),
            Some("sun")
        );
        assert_eq!(
            headers.first().map(|header| header.label.as_str()),
            Some("S")
        );
        assert_eq!(
            headers.last().map(|header| header.key.as_str()),
            Some("sat")
        );
    }

    #[test]
    fn a_month_reports_its_first_day_title_and_length() {
        assert_eq!(calendar_month_first_day(JULY_2026).unwrap(), "2026-07-01");
        assert_eq!(calendar_month_title(JULY_2026).unwrap(), "July 2026");
        assert_eq!(calendar_month_day_count(JULY_2026).unwrap(), 31);
        assert_eq!(calendar_month_of("2026-07-10").unwrap(), JULY_2026);
    }

    #[test]
    fn every_grid_row_is_a_whole_week_and_the_days_are_in_order() {
        let grid = calendar_month_grid(JULY_2026).unwrap();
        assert!(grid.iter().all(|week| week.cells.len() == DAYS_PER_WEEK));

        let days: Vec<String> = grid
            .iter()
            .flat_map(|week| week.cells.iter())
            .filter_map(|cell| cell.date.clone())
            .collect();
        assert_eq!(days.len(), 31);
        assert_eq!(days.first().map(String::as_str), Some("2026-07-01"));
        assert_eq!(days.last().map(String::as_str), Some("2026-07-31"));

        // 1 July 2026 is a Wednesday, so three padding cells lead the grid.
        let leading = grid.first().map(|week| {
            week.cells
                .iter()
                .take_while(|cell| cell.date.is_none())
                .count()
        });
        assert_eq!(leading, Some(3));
    }

    #[test]
    fn stepping_off_the_end_of_the_calendar_is_reported_not_wrapped() {
        assert_eq!(
            calendar_month_add(JULY_2026, -7).unwrap(),
            CalendarMonthRef {
                year: 2025,
                month: 12
            }
        );
        let edge = CalendarMonthRef {
            year: calendar_max_year(),
            month: 12,
        };
        let error = calendar_month_add(edge, 1).unwrap_err();
        assert!(
            matches!(error, CoreError::Invariant { .. }),
            "unexpected error: {error:?}"
        );
        assert!(calendar_min_year() >= 1);
    }

    #[test]
    fn an_impossible_month_is_rejected_at_the_boundary() {
        let error = calendar_month_title(CalendarMonthRef {
            year: 2026,
            month: 13,
        })
        .unwrap_err();
        assert!(
            matches!(error, CoreError::Invariant { ref message } if message.contains("1..=12")),
            "unexpected error: {error:?}"
        );
    }
}
