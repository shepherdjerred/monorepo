//! The common recurrence patterns editable by native clients.
//!
//! This deliberately is not a second general RRULE parser. The expansion
//! engine remains authoritative for arbitrary stored rules; this module only
//! accepts the closed subset that the editor can round-trip without losing
//! meaning and serializes that subset into one canonical representation.

use std::collections::BTreeMap;

use chrono::{Datelike, NaiveDate, Weekday};

use crate::{Error, Result};

/// A weekday in calendar order, Monday first.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum CommonWeekday {
    /// Monday.
    Monday,
    /// Tuesday.
    Tuesday,
    /// Wednesday.
    Wednesday,
    /// Thursday.
    Thursday,
    /// Friday.
    Friday,
    /// Saturday.
    Saturday,
    /// Sunday.
    Sunday,
}

impl CommonWeekday {
    const fn code(self) -> &'static str {
        match self {
            Self::Monday => "MO",
            Self::Tuesday => "TU",
            Self::Wednesday => "WE",
            Self::Thursday => "TH",
            Self::Friday => "FR",
            Self::Saturday => "SA",
            Self::Sunday => "SU",
        }
    }

    fn parse(value: &str) -> Option<Self> {
        match value {
            "MO" => Some(Self::Monday),
            "TU" => Some(Self::Tuesday),
            "WE" => Some(Self::Wednesday),
            "TH" => Some(Self::Thursday),
            "FR" => Some(Self::Friday),
            "SA" => Some(Self::Saturday),
            "SU" => Some(Self::Sunday),
            _ => None,
        }
    }
}

impl From<Weekday> for CommonWeekday {
    fn from(value: Weekday) -> Self {
        match value {
            Weekday::Mon => Self::Monday,
            Weekday::Tue => Self::Tuesday,
            Weekday::Wed => Self::Wednesday,
            Weekday::Thu => Self::Thursday,
            Weekday::Fri => Self::Friday,
            Weekday::Sat => Self::Saturday,
            Weekday::Sun => Self::Sunday,
        }
    }
}

/// Which occurrence of a weekday a monthly rule selects.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum MonthlyOrdinal {
    /// The first occurrence.
    First,
    /// The second occurrence.
    Second,
    /// The third occurrence.
    Third,
    /// The fourth occurrence.
    Fourth,
    /// The fifth occurrence.
    Fifth,
    /// The final occurrence, whether fourth or fifth.
    Last,
}

impl MonthlyOrdinal {
    const fn number(self) -> i8 {
        match self {
            Self::First => 1,
            Self::Second => 2,
            Self::Third => 3,
            Self::Fourth => 4,
            Self::Fifth => 5,
            Self::Last => -1,
        }
    }

    fn parse(value: &str) -> Option<Self> {
        match value {
            "1" => Some(Self::First),
            "2" => Some(Self::Second),
            "3" => Some(Self::Third),
            "4" => Some(Self::Fourth),
            "5" => Some(Self::Fifth),
            "-1" => Some(Self::Last),
            _ => None,
        }
    }
}

/// The calendar pattern for a common recurrence.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CommonRecurrencePattern {
    /// Every N days.
    Daily,
    /// Every N weeks on one or more weekdays.
    Weekly {
        /// Selected weekdays. Serialization orders and de-duplicates them.
        weekdays: Vec<CommonWeekday>,
    },
    /// Every N months on a numbered day.
    MonthlyDayOfMonth {
        /// The day number, from 1 through 31.
        day: u8,
    },
    /// Every N months on an ordinal weekday.
    MonthlyOrdinalWeekday {
        /// The weekday occurrence in the month.
        ordinal: MonthlyOrdinal,
        /// The selected weekday.
        weekday: CommonWeekday,
    },
    /// Every N years on a month and day.
    YearlyMonthDay {
        /// The month number, from 1 through 12.
        month: u8,
        /// A valid day in that month; February 29 is supported.
        day: u8,
    },
}

/// When a common recurrence ends.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CommonRecurrenceEnd {
    /// It has no declared end.
    Never,
    /// It ends on the named inclusive ISO date.
    OnDate(String),
    /// It ends after this many total occurrences.
    AfterOccurrences(u32),
}

/// A losslessly editable common recurrence.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CommonRecurrenceDraft {
    /// A strictly positive interval.
    pub interval: u32,
    /// The calendar pattern.
    pub pattern: CommonRecurrencePattern,
    /// The stopping condition.
    pub ending: CommonRecurrenceEnd,
}

/// Serialize a validated common recurrence into canonical RRULE text.
///
/// `start` is the task's effective Scheduled date. It validates end dates and
/// makes the builder's required anchor explicit even when the chosen pattern
/// contains all of its own calendar selectors.
///
/// # Errors
///
/// Returns [`Error::Validation`] for malformed dates, zero-valued intervals or
/// counts, empty weekly selections, and invalid month/day combinations.
pub fn build_common_recurrence(draft: &CommonRecurrenceDraft, start: &str) -> Result<String> {
    let start = parse_iso_date(start, "recurrence start")?;
    if draft.interval == 0 {
        return Err(Error::validation("recurrence interval must be positive"));
    }

    let mut parts = Vec::new();
    match &draft.pattern {
        CommonRecurrencePattern::Daily => parts.push("FREQ=DAILY".to_owned()),
        CommonRecurrencePattern::Weekly { weekdays } => {
            if weekdays.is_empty() {
                return Err(Error::validation(
                    "weekly recurrence must select at least one weekday",
                ));
            }
            parts.push("FREQ=WEEKLY".to_owned());
            let mut weekdays = weekdays.clone();
            weekdays.sort_unstable();
            weekdays.dedup();
            parts.push(format!(
                "BYDAY={}",
                weekdays
                    .into_iter()
                    .map(CommonWeekday::code)
                    .collect::<Vec<_>>()
                    .join(",")
            ));
        }
        CommonRecurrencePattern::MonthlyDayOfMonth { day } => {
            validate_day_of_month(*day)?;
            parts.push("FREQ=MONTHLY".to_owned());
            parts.push(format!("BYMONTHDAY={day}"));
        }
        CommonRecurrencePattern::MonthlyOrdinalWeekday { ordinal, weekday } => {
            parts.push("FREQ=MONTHLY".to_owned());
            parts.push(format!("BYDAY={}{}", ordinal.number(), weekday.code()));
        }
        CommonRecurrencePattern::YearlyMonthDay { month, day } => {
            validate_month_day(*month, *day)?;
            parts.push("FREQ=YEARLY".to_owned());
            parts.push(format!("BYMONTH={month}"));
            parts.push(format!("BYMONTHDAY={day}"));
        }
    }

    if draft.interval != 1 {
        parts.insert(1, format!("INTERVAL={}", draft.interval));
    }
    match &draft.ending {
        CommonRecurrenceEnd::Never => {}
        CommonRecurrenceEnd::OnDate(value) => {
            let end = parse_iso_date(value, "recurrence end")?;
            if end < start {
                return Err(Error::validation(
                    "recurrence end date must not precede its start",
                ));
            }
            parts.push(format!("UNTIL={}", end.format("%Y%m%d")));
        }
        CommonRecurrenceEnd::AfterOccurrences(count) => {
            if *count == 0 {
                return Err(Error::validation(
                    "recurrence occurrence count must be positive",
                ));
            }
            parts.push(format!("COUNT={count}"));
        }
    }
    Ok(parts.join(";"))
}

/// Parse an existing rule only when the common editor can preserve it.
///
/// The parser accepts reordered common fields and the implicit RFC defaults
/// for weekly, monthly and yearly rules. Any duplicate or unfamiliar field,
/// conflicting selector, time-valued ending, or unsupported frequency returns
/// `None`; the caller must retain the original rule unchanged.
#[must_use]
pub fn parse_common_recurrence(text: &str, start: &str) -> Option<CommonRecurrenceDraft> {
    let start = NaiveDate::parse_from_str(start, "%Y-%m-%d").ok()?;
    let body = text.strip_prefix("RRULE:").unwrap_or(text);
    if body.is_empty() || body.contains(['\n', '\r']) {
        return None;
    }
    let mut fields = BTreeMap::new();
    for part in body.split(';') {
        let (key, value) = part.split_once('=')?;
        if key.is_empty()
            || value.is_empty()
            || !matches!(
                key,
                "FREQ" | "INTERVAL" | "BYDAY" | "BYMONTHDAY" | "BYMONTH" | "COUNT" | "UNTIL"
            )
            || fields.insert(key, value).is_some()
        {
            return None;
        }
    }

    let interval = fields
        .get("INTERVAL")
        .map_or(Some(1), |value| parse_positive(value))?;
    let pattern = match *fields.get("FREQ")? {
        "DAILY" if has_no_selectors(&fields) => CommonRecurrencePattern::Daily,
        "WEEKLY" if !fields.contains_key("BYMONTH") && !fields.contains_key("BYMONTHDAY") => {
            let weekdays = match fields.get("BYDAY") {
                Some(value) => parse_weekdays(value)?,
                None => vec![start.weekday().into()],
            };
            CommonRecurrencePattern::Weekly { weekdays }
        }
        "MONTHLY" if !fields.contains_key("BYMONTH") => {
            match (fields.get("BYMONTHDAY"), fields.get("BYDAY")) {
                (None, None) => CommonRecurrencePattern::MonthlyDayOfMonth {
                    day: u8::try_from(start.day()).ok()?,
                },
                (Some(day), None) => {
                    let day = day.parse::<u8>().ok()?;
                    validate_day_of_month(day).ok()?;
                    CommonRecurrencePattern::MonthlyDayOfMonth { day }
                }
                (None, Some(value)) => {
                    let (ordinal, weekday) = parse_ordinal_weekday(value)?;
                    CommonRecurrencePattern::MonthlyOrdinalWeekday { ordinal, weekday }
                }
                (Some(_), Some(_)) => return None,
            }
        }
        "YEARLY" if !fields.contains_key("BYDAY") => {
            match (fields.get("BYMONTH"), fields.get("BYMONTHDAY")) {
                (None, None) => CommonRecurrencePattern::YearlyMonthDay {
                    month: u8::try_from(start.month()).ok()?,
                    day: u8::try_from(start.day()).ok()?,
                },
                (Some(month), Some(day)) => {
                    let month = month.parse::<u8>().ok()?;
                    let day = day.parse::<u8>().ok()?;
                    validate_month_day(month, day).ok()?;
                    CommonRecurrencePattern::YearlyMonthDay { month, day }
                }
                (None, Some(_)) | (Some(_), None) => return None,
            }
        }
        _ => return None,
    };

    let ending = match (fields.get("COUNT"), fields.get("UNTIL")) {
        (None, None) => CommonRecurrenceEnd::Never,
        (Some(count), None) => CommonRecurrenceEnd::AfterOccurrences(parse_positive(count)?),
        (None, Some(until)) => {
            let date = NaiveDate::parse_from_str(until, "%Y%m%d").ok()?;
            if date < start {
                return None;
            }
            CommonRecurrenceEnd::OnDate(date.format("%Y-%m-%d").to_string())
        }
        (Some(_), Some(_)) => return None,
    };
    Some(CommonRecurrenceDraft {
        interval,
        pattern,
        ending,
    })
}

fn parse_iso_date(value: &str, name: &str) -> Result<NaiveDate> {
    NaiveDate::parse_from_str(value, "%Y-%m-%d")
        .map_err(|_| Error::validation(format!("{name} must be a valid YYYY-MM-DD date")))
}

fn parse_positive(value: &str) -> Option<u32> {
    let value = value.parse::<u32>().ok()?;
    (value > 0).then_some(value)
}

fn has_no_selectors(fields: &BTreeMap<&str, &str>) -> bool {
    ["BYDAY", "BYMONTHDAY", "BYMONTH"]
        .into_iter()
        .all(|key| fields.get(key).is_none())
}

fn parse_weekdays(value: &str) -> Option<Vec<CommonWeekday>> {
    let mut weekdays = value
        .split(',')
        .map(CommonWeekday::parse)
        .collect::<Option<Vec<_>>>()?;
    if weekdays.is_empty() {
        return None;
    }
    weekdays.sort_unstable();
    weekdays.dedup();
    Some(weekdays)
}

fn parse_ordinal_weekday(value: &str) -> Option<(MonthlyOrdinal, CommonWeekday)> {
    if value.contains(',') || value.len() < 3 {
        return None;
    }
    let split = value.len().checked_sub(2)?;
    let ordinal = MonthlyOrdinal::parse(value.get(..split)?)?;
    let weekday = CommonWeekday::parse(value.get(split..)?)?;
    Some((ordinal, weekday))
}

fn validate_day_of_month(day: u8) -> Result<()> {
    if !(1..=31).contains(&day) {
        return Err(Error::validation(
            "monthly recurrence day must be between 1 and 31",
        ));
    }
    Ok(())
}

fn validate_month_day(month: u8, day: u8) -> Result<()> {
    if NaiveDate::from_ymd_opt(2000, u32::from(month), u32::from(day)).is_none() {
        return Err(Error::validation(
            "yearly recurrence month and day must form a valid calendar date",
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn draft(pattern: CommonRecurrencePattern) -> CommonRecurrenceDraft {
        CommonRecurrenceDraft {
            interval: 1,
            pattern,
            ending: CommonRecurrenceEnd::Never,
        }
    }

    #[test]
    fn builds_every_supported_pattern_canonically() {
        let cases = [
            (draft(CommonRecurrencePattern::Daily), "FREQ=DAILY"),
            (
                CommonRecurrenceDraft {
                    interval: 2,
                    pattern: CommonRecurrencePattern::Weekly {
                        weekdays: vec![
                            CommonWeekday::Friday,
                            CommonWeekday::Monday,
                            CommonWeekday::Friday,
                        ],
                    },
                    ending: CommonRecurrenceEnd::AfterOccurrences(7),
                },
                "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,FR;COUNT=7",
            ),
            (
                draft(CommonRecurrencePattern::MonthlyDayOfMonth { day: 31 }),
                "FREQ=MONTHLY;BYMONTHDAY=31",
            ),
            (
                draft(CommonRecurrencePattern::MonthlyOrdinalWeekday {
                    ordinal: MonthlyOrdinal::Last,
                    weekday: CommonWeekday::Tuesday,
                }),
                "FREQ=MONTHLY;BYDAY=-1TU",
            ),
            (
                CommonRecurrenceDraft {
                    interval: 1,
                    pattern: CommonRecurrencePattern::YearlyMonthDay { month: 2, day: 29 },
                    ending: CommonRecurrenceEnd::OnDate("2032-02-29".to_owned()),
                },
                "FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=29;UNTIL=20320229",
            ),
        ];
        for (draft, expected) in cases {
            assert_eq!(
                build_common_recurrence(&draft, "2028-02-29").unwrap(),
                expected
            );
        }
    }

    #[test]
    fn round_trips_every_supported_pattern() {
        for rule in [
            "FREQ=DAILY;INTERVAL=3",
            "FREQ=WEEKLY;BYDAY=MO,WE,SU",
            "FREQ=MONTHLY;BYMONTHDAY=17",
            "FREQ=MONTHLY;BYDAY=5FR",
            "FREQ=YEARLY;BYMONTH=12;BYMONTHDAY=31",
            "FREQ=DAILY;COUNT=9",
            "FREQ=DAILY;UNTIL=20261231",
        ] {
            let parsed = parse_common_recurrence(rule, "2026-08-30").unwrap();
            assert_eq!(
                build_common_recurrence(&parsed, "2026-08-30").unwrap(),
                rule
            );
        }
    }

    #[test]
    fn expands_implicit_calendar_selectors_without_losing_meaning() {
        let weekly = parse_common_recurrence("RRULE:FREQ=WEEKLY", "2026-08-30").unwrap();
        assert_eq!(
            build_common_recurrence(&weekly, "2026-08-30").unwrap(),
            "FREQ=WEEKLY;BYDAY=SU"
        );
        let monthly = parse_common_recurrence("FREQ=MONTHLY", "2026-08-30").unwrap();
        assert_eq!(
            build_common_recurrence(&monthly, "2026-08-30").unwrap(),
            "FREQ=MONTHLY;BYMONTHDAY=30"
        );
        let yearly = parse_common_recurrence("FREQ=YEARLY", "2026-08-30").unwrap();
        assert_eq!(
            build_common_recurrence(&yearly, "2026-08-30").unwrap(),
            "FREQ=YEARLY;BYMONTH=8;BYMONTHDAY=30"
        );
    }

    #[test]
    fn rejects_invalid_drafts() {
        let mut value = draft(CommonRecurrencePattern::Daily);
        value.interval = 0;
        assert!(build_common_recurrence(&value, "2026-08-30").is_err());

        value = draft(CommonRecurrencePattern::Weekly {
            weekdays: Vec::new(),
        });
        assert!(build_common_recurrence(&value, "2026-08-30").is_err());

        value = draft(CommonRecurrencePattern::YearlyMonthDay { month: 2, day: 30 });
        assert!(build_common_recurrence(&value, "2026-08-30").is_err());

        value = CommonRecurrenceDraft {
            interval: 1,
            pattern: CommonRecurrencePattern::Daily,
            ending: CommonRecurrenceEnd::OnDate("2026-08-29".to_owned()),
        };
        assert!(build_common_recurrence(&value, "2026-08-30").is_err());

        value.ending = CommonRecurrenceEnd::AfterOccurrences(0);
        assert!(build_common_recurrence(&value, "2026-08-30").is_err());
    }

    #[test]
    fn refuses_rules_the_editor_cannot_represent() {
        for rule in [
            "FREQ=HOURLY",
            "FREQ=DAILY;BYHOUR=9",
            "FREQ=MONTHLY;BYDAY=MO,WE",
            "FREQ=MONTHLY;BYDAY=MO;BYMONTHDAY=1",
            "FREQ=YEARLY;BYMONTH=2",
            "FREQ=DAILY;COUNT=3;UNTIL=20261231",
            "FREQ=DAILY;INTERVAL=0",
            "FREQ=DAILY;UNTIL=20260829",
            "FREQ=DAILY;FREQ=WEEKLY",
        ] {
            assert!(
                parse_common_recurrence(rule, "2026-08-30").is_none(),
                "accepted {rule}"
            );
        }
    }
}
