//! The per-year and per-month lookup tables the expander filters days against.
//!
//! rrule.js addresses a year as a flat run of day indices — 0 is 1 January —
//! and answers "what month/day-of-month/weekday/ISO week is index *i*?" from
//! precomputed masks. Every mask runs **seven days past the end of the year**,
//! because a weekly period that starts in late December has to be describable
//! without rebuilding into the next year; the tail is always labelled as a
//! 31-day January, which is what the reference's static masks encode.
//!
//! Ported as tables rather than as arithmetic on purpose: the filter reads the
//! same index out of five different masks, and a table keeps them trivially
//! consistent with each other.

use super::instant::{self, MAX_YEAR};
use super::options::{NumberSet, Options};
use super::text::Frequency;

/// Days past the end of the year that every mask covers.
const MASK_TAIL: i32 = 7;

const COMMON_MONTH_LENGTHS: [i8; 12] = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const LEAP_MONTH_LENGTHS: [i8; 12] = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/// Everything the filter needs about one calendar year.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct YearInfo {
    pub(super) year: i32,
    pub(super) yearlen: i32,
    pub(super) nextyearlen: i32,
    /// Day ordinal of 1 January.
    pub(super) yearordinal: i64,
    /// Python weekday of 1 January.
    yearweekday: u8,
    /// Day index at which each month starts, plus a closing entry.
    mrange: [i32; 13],
    month: Vec<u8>,
    monthday: Vec<i8>,
    monthday_from_end: Vec<i8>,
    /// Empty when the rule names no `BYWEEKNO`.
    weekno: Vec<u8>,
}

fn at<T: Copy>(table: &[T], index: i32) -> Option<T> {
    usize::try_from(index)
        .ok()
        .and_then(|i| table.get(i))
        .copied()
}

impl YearInfo {
    /// `rebuildYear`.
    pub(super) fn build(year: i32, options: &Options) -> Option<Self> {
        let leap = instant::is_leap_year(year);
        let yearlen = if leap { 366 } else { 365 };
        let lengths = if leap {
            LEAP_MONTH_LENGTHS
        } else {
            COMMON_MONTH_LENGTHS
        };

        let mut mrange = [0_i32; 13];
        let mut total = 0_i32;
        for (slot, length) in mrange.iter_mut().skip(1).zip(lengths) {
            total += i32::from(length);
            *slot = total;
        }

        let capacity = usize::try_from(yearlen + MASK_TAIL).unwrap_or_default();
        let mut month = Vec::with_capacity(capacity);
        let mut monthday = Vec::with_capacity(capacity);
        let mut monthday_from_end = Vec::with_capacity(capacity);
        for (number, length) in (1_u8..=12).zip(lengths) {
            for day in 1..=length {
                month.push(number);
                monthday.push(day);
                monthday_from_end.push(day - length - 1);
            }
        }
        // The tail is always "January of a 31-day month", exactly as the
        // reference's static masks spell it.
        for day in 1..=7_i8 {
            month.push(1);
            monthday.push(day);
            monthday_from_end.push(day - 32);
        }

        let first = instant::ordinal_of_first(year, 1)?;
        let yearweekday = instant::weekday_at(first);
        let weekno = if options.weekno.is_empty() {
            Vec::new()
        } else {
            build_weekno_mask(year, yearlen, yearweekday, options.wkst, &options.weekno)
        };

        Some(Self {
            year,
            yearlen,
            nextyearlen: if instant::is_leap_year(year + 1) {
                366
            } else {
                365
            },
            yearordinal: first,
            yearweekday,
            mrange,
            month,
            monthday,
            monthday_from_end,
            weekno,
        })
    }

    /// The month, 1-12, at a day index.
    pub(super) fn month_at(&self, index: i32) -> Option<i64> {
        at(&self.month, index).map(i64::from)
    }

    /// The day of the month, 1-31, at a day index.
    pub(super) fn monthday_at(&self, index: i32) -> Option<i64> {
        at(&self.monthday, index).map(i64::from)
    }

    /// The day of the month counted back from the end, -31 to -1.
    pub(super) fn monthday_from_end_at(&self, index: i32) -> Option<i64> {
        at(&self.monthday_from_end, index).map(i64::from)
    }

    /// The python weekday at a day index. Defined for every non-negative index,
    /// since the reference's mask is long enough to cover every index it reads.
    pub(super) fn weekday_at(&self, index: i32) -> Option<u8> {
        if index < 0 {
            return None;
        }
        let offset = (i64::from(self.yearweekday) + i64::from(index)).rem_euclid(7);
        u8::try_from(offset).ok()
    }

    /// Whether a day index falls in one of the rule's `BYWEEKNO` weeks. Always
    /// false when the mask was not built, which the filter never asks about.
    pub(super) fn in_selected_week(&self, index: i32) -> bool {
        at(&self.weekno, index).is_some_and(|selected| selected != 0)
    }

    /// The half-open day-index range of `month`, or `None` when `month` is not
    /// a real month — the reference reaches the same answer by slicing its
    /// range table out of bounds and producing an unusable pair.
    pub(super) fn month_range(&self, month: i64) -> Option<(i32, i32)> {
        if !(1..=12).contains(&month) {
            return None;
        }
        let index = i32::try_from(month).ok()?;
        Some((at(&self.mrange, index - 1)?, at(&self.mrange, index)?))
    }
}

/// `rebuildYear`'s `wnomask` — the ISO-week selector.
fn build_weekno_mask(
    year: i32,
    yearlen: i32,
    yearweekday: u8,
    wkst: u8,
    weekno: &NumberSet,
) -> Vec<u8> {
    let yearlen = i64::from(yearlen);
    let wkst = i64::from(wkst);
    let yearweekday = i64::from(yearweekday);
    // Seven extra days for the cross-year tail, and seven more so that the
    // mask can absorb the writes the reference makes past the end of its own
    // array — where they land, they are never read back.
    let length = usize::try_from(yearlen + i64::from(2 * MASK_TAIL)).unwrap_or_default();
    let mut mask = vec![0_u8; length];
    let weekday_at = |index: i64| (yearweekday + index).rem_euclid(7);
    let set = |mask: &mut Vec<u8>, index: i64| {
        if let Ok(index) = usize::try_from(index)
            && let Some(slot) = mask.get_mut(index)
        {
            *slot = 1;
        }
    };

    let firstwkst = (7 - yearweekday + wkst).rem_euclid(7);
    let mut no1wkst = firstwkst;
    let wyearlen = if no1wkst >= 4 {
        no1wkst = 0;
        yearlen + (yearweekday - wkst).rem_euclid(7)
    } else {
        yearlen - no1wkst
    };
    let numweeks = wyearlen.div_euclid(7) + wyearlen.rem_euclid(7) / 4;

    for &raw in weekno.numbers() {
        let number = if raw < 0 {
            raw.saturating_add(numweeks + 1)
        } else {
            raw
        };
        if !(number > 0 && number <= numweeks) {
            continue;
        }
        let mut index = if number > 1 {
            let start = no1wkst + (number - 1) * 7;
            if no1wkst == firstwkst {
                start
            } else {
                start - (7 - firstwkst)
            }
        } else {
            no1wkst
        };
        for _ in 0..7 {
            set(&mut mask, index);
            index += 1;
            if weekday_at(index) == wkst {
                break;
            }
        }
    }

    if weekno.contains(1) {
        // Week 1 of the *next* year can reach back into this one.
        let mut index = no1wkst + numweeks * 7;
        if no1wkst != firstwkst {
            index -= 7 - firstwkst;
        }
        if index < yearlen {
            for _ in 0..7 {
                set(&mut mask, index);
                index += 1;
                if weekday_at(index) == wkst {
                    break;
                }
            }
        }
    }

    if no1wkst != 0 {
        // ... and the last week of the *previous* year can reach forward.
        let lnumweeks = if weekno.contains(-1) {
            -1
        } else {
            let previous_len = if instant::is_leap_year(year - 1) {
                366
            } else {
                365
            };
            let lyearweekday = instant::ordinal_of_first(year - 1, 1)
                .map_or(0, |ordinal| i64::from(instant::weekday_at(ordinal)));
            let weekstart = if (7 - lyearweekday + wkst).rem_euclid(7) >= 4 {
                previous_len + (lyearweekday - wkst).rem_euclid(7)
            } else {
                yearlen - no1wkst
            };
            52 + weekstart.rem_euclid(7) / 4
        };
        if weekno.contains(lnumweeks) {
            for index in 0..no1wkst {
                set(&mut mask, index);
            }
        }
    }

    mask
}

/// `rebuildMonth`'s `nwdaymask` — the ordinal-weekday selector, which only
/// exists for the two frequencies that have a period long enough to count
/// "the third Wednesday" within.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct MonthInfo {
    pub(super) year: i32,
    pub(super) month: u8,
    mask: Vec<u8>,
}

impl MonthInfo {
    /// `rebuildMonth`.
    pub(super) fn build(year: i32, month: u8, info: &YearInfo, options: &Options) -> Self {
        let mut ranges = Vec::new();
        match options.freq {
            Frequency::Yearly => {
                if options.month.is_empty() {
                    ranges.push((0, info.yearlen));
                } else {
                    ranges.extend(
                        options
                            .month
                            .numbers()
                            .iter()
                            .filter_map(|number| info.month_range(*number)),
                    );
                }
            }
            Frequency::Monthly => ranges.extend(info.month_range(i64::from(month))),
            Frequency::Weekly
            | Frequency::Daily
            | Frequency::Hourly
            | Frequency::Minutely
            | Frequency::Secondly => {}
        }

        let mut mask = Vec::new();
        if !ranges.is_empty() {
            mask = vec![0_u8; usize::try_from(info.yearlen).unwrap_or_default()];
            for (first, end) in ranges {
                let last = end - 1;
                for &(weekday, ordinal) in &options.nth_weekday {
                    if let Some(index) = nth_weekday_index(info, first, last, weekday, ordinal)
                        && (first..=last).contains(&index)
                        && let Ok(position) = usize::try_from(index)
                        && let Some(slot) = mask.get_mut(position)
                    {
                        *slot = 1;
                    }
                }
            }
        }

        Self { year, month, mask }
    }

    /// Whether the ordinal-weekday selector is in use at all.
    pub(super) fn is_empty(&self) -> bool {
        self.mask.is_empty()
    }

    /// Whether a day index is one of the selected ordinal weekdays.
    pub(super) fn selects(&self, index: i32) -> bool {
        at(&self.mask, index).is_some_and(|selected| selected != 0)
    }
}

/// The day index of the `ordinal`-th `weekday` inside `first..=last`.
///
/// `None` stands for the reference's `NaN`, which it reaches by indexing its
/// weekday mask outside the array; every such case also fails the containment
/// test that follows, so the two are interchangeable.
fn nth_weekday_index(
    info: &YearInfo,
    first: i32,
    last: i32,
    weekday: u8,
    ordinal: i64,
) -> Option<i32> {
    let weekday = i64::from(weekday);
    if ordinal < 0 {
        let start = i64::from(last) + (ordinal + 1) * 7;
        let anchor = i32::try_from(start).ok()?;
        let at_anchor = i64::from(info.weekday_at(anchor)?);
        i32::try_from(start - (at_anchor - weekday).rem_euclid(7)).ok()
    } else {
        let start = i64::from(first) + (ordinal - 1) * 7;
        let anchor = i32::try_from(start).ok()?;
        let at_anchor = i64::from(info.weekday_at(anchor)?);
        i32::try_from(start + (7 - at_anchor + weekday).rem_euclid(7)).ok()
    }
}

/// The reference gives up once the counter passes `MAXYEAR`.
pub(super) const fn past_max_year(year: i32) -> bool {
    year > MAX_YEAR
}

#[cfg(test)]
mod tests {
    use super::YearInfo;
    use crate::recurrence::{instant, options, text};

    fn info_for(year: i32, rule: &str) -> YearInfo {
        let dtstart = instant::from_parts(i64::from(year), 0, 1, 0, 0, 0, 0).expect("an instant");
        let raw = text::parse_rule_string(rule).expect("the rule lexes");
        let options = options::build(&raw, dtstart).expect("the rule normalises");
        YearInfo::build(year, &options).expect("a representable year")
    }

    #[test]
    fn masks_label_every_day_of_a_common_year() {
        let info = info_for(2026, "FREQ=DAILY");
        assert_eq!(info.yearlen, 365);
        assert_eq!(info.month_at(0), Some(1));
        assert_eq!(info.monthday_at(0), Some(1));
        assert_eq!(info.monthday_from_end_at(0), Some(-31));
        // 31 December is index 364.
        assert_eq!(info.month_at(364), Some(12));
        assert_eq!(info.monthday_at(364), Some(31));
        assert_eq!(info.monthday_from_end_at(364), Some(-1));
        // The seven-day tail is a January.
        assert_eq!(info.month_at(365), Some(1));
        assert_eq!(info.monthday_at(365), Some(1));
        assert_eq!(info.monthday_from_end_at(365), Some(-31));
        assert_eq!(info.month_at(371), Some(1));
        assert_eq!(info.monthday_at(371), Some(7));
        assert_eq!(info.month_at(372), None);
    }

    #[test]
    fn a_leap_year_has_a_29_february() {
        let info = info_for(2024, "FREQ=DAILY");
        assert_eq!(info.yearlen, 366);
        assert_eq!(
            (info.month_at(59), info.monthday_at(59)),
            (Some(2), Some(29))
        );
        assert_eq!(info.month_range(2), Some((31, 60)));
    }

    #[test]
    fn weekdays_run_from_the_first_of_january() {
        // 2026-01-01 is a Thursday, python weekday 3.
        let info = info_for(2026, "FREQ=DAILY");
        assert_eq!(info.weekday_at(0), Some(3));
        assert_eq!(info.weekday_at(4), Some(0));
        assert_eq!(info.weekday_at(-1), None);
    }
}
