//! The expansion loop — a port of rrule.js's `iter` plus the `between` result
//! collector it drives.
//!
//! The shape is dateutil's: walk a **counter** forward one period at a time,
//! and for each period build the set of candidate day indices, strike out the
//! days the `BY*` parts reject, then cross the survivors with the set of
//! times-of-day. `BYSETPOS` replaces that final cross product with a positional
//! pick out of it, which is why it can only ever select from within one period.
//!
//! ## Termination
//!
//! The reference walks to the year 9999 before conceding that a rule has no
//! occurrences, which costs seconds per query. That is reproduced only as a
//! backstop: the real bound is the caller's window. Once the *earliest day the
//! next period could possibly produce* is past the end of the window, no later
//! period can produce anything inside it either — every day set is contained in
//! its own period — so the walk stops there. The answer is identical; only the
//! wasted years are gone.
//!
//! That leaves exactly one way to loop forever, and it is closed explicitly:
//! the sub-daily `add*` helpers skip forward until the clock lands on a
//! permitted `BYHOUR`/`BYMINUTE`/`BYSECOND`, which never happens if none is
//! reachable. The clock state cycles, so "no match within one full cycle" is a
//! proof that there is no match at all, and the helpers stop rather than spin.
//! rrule.js hangs on those inputs, so there is no reference answer to diverge
//! from.

use super::instant::{self, MS_PER_DAY};
use super::options::{CountLimit, DtStart, Options};
use super::text::Frequency;
use super::year::{MonthInfo, YearInfo, past_max_year};

/// Whether the expansion should keep going after an emitted instant.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Flow {
    Continue,
    Stop,
}

/// Expand `options` and return every occurrence instant inside the inclusive
/// millisecond window `[min, max]`, in generation order.
pub(super) fn expand(options: &Options, min: i64, max: i64) -> Vec<i64> {
    let mut found = Vec::new();
    if options.count == CountLimit::Zero || options.interval == 0 {
        return found;
    }
    let mut walk = Walk {
        options,
        min,
        max,
        count: options.count,
        counter: Counter::from(options.start),
        year: None,
        month: None,
        easter_day: None,
    };
    walk.run(&mut found);
    found
}

struct Walk<'a> {
    options: &'a Options,
    min: i64,
    max: i64,
    count: CountLimit,
    counter: Counter,
    year: Option<YearInfo>,
    month: Option<MonthInfo>,
    easter_day: Option<i64>,
}

impl Walk<'_> {
    fn run(&mut self, found: &mut Vec<i64>) {
        if self.rebuild().is_none() {
            return;
        }
        let Some(mut timeset) = self.initial_timeset() else {
            return;
        };
        loop {
            let Some(year) = self.year.as_ref() else {
                return;
            };
            let Some((mut days, start, end)) = day_set(self.options, &self.counter, year) else {
                return;
            };
            let filtered = self.strike_filtered_days(&mut days, start, end);
            if self.emit(&days, start, end, &timeset, found) == Flow::Stop {
                return;
            }
            if self.counter.add(self.options, filtered) == Flow::Stop {
                return;
            }
            if past_max_year(self.counter.year) {
                return;
            }
            if !self.options.freq.is_daily_or_greater() {
                let Some(next) = time_set_for(self.options, &self.counter, 0) else {
                    return;
                };
                timeset = next;
            }
            match earliest_instant(self.options.freq, &self.counter) {
                Some(earliest) if earliest <= self.max => {}
                _ => return,
            }
            if self.rebuild().is_none() {
                return;
            }
        }
    }

    /// `Iterinfo.rebuild`, plus the easter day index that hangs off the year.
    fn rebuild(&mut self) -> Option<()> {
        let year = self.counter.year;
        if self.year.as_ref().is_none_or(|info| info.year != year) {
            self.year = Some(YearInfo::build(year, self.options)?);
            self.easter_day = self
                .options
                .easter
                .and_then(|offset| super::easter_day_index(year, offset));
        }
        if !self.options.nth_weekday.is_empty() {
            let month = self.counter.month;
            let stale = self
                .month
                .as_ref()
                .is_none_or(|info| info.year != year || info.month != month);
            if stale {
                let info = self.year.as_ref()?;
                self.month = Some(MonthInfo::build(year, month, info, self.options));
            }
        }
        Some(())
    }

    fn initial_timeset(&self) -> Option<Vec<i64>> {
        let options = self.options;
        if options.freq.is_daily_or_greater() {
            return Some(build_timeset(options));
        }
        let clock_rejected = (options.freq >= Frequency::Hourly
            && !options.hour.is_empty()
            && !options.hour.contains(&self.counter.hour))
            || (options.freq >= Frequency::Minutely
                && !options.minute.is_empty()
                && !options.minute.contains(&self.counter.minute))
            || (options.freq >= Frequency::Secondly
                && !options.second.is_empty()
                && !options.second.contains(&self.counter.second));
        if clock_rejected {
            return Some(Vec::new());
        }
        time_set_for(options, &self.counter, self.counter.millisecond)
    }

    /// `removeFilteredDays`. Returns the *last* day's verdict — not whether any
    /// day was struck — which is what the reference feeds back into the
    /// sub-daily skip-ahead, so the distinction is load-bearing.
    ///
    /// Every day set fills `start..end` densely and nothing is struck ahead of
    /// the cursor, so the empty slot below is unreachable; it exists because the
    /// day set is addressed by index rather than iterated.
    fn strike_filtered_days(&self, days: &mut [Option<i32>], start: i32, end: i32) -> bool {
        let mut filtered = false;
        for index in start..end {
            let Some(day) = day_at(days, index) else {
                continue;
            };
            filtered = self.is_filtered(day);
            if filtered {
                clear_day(days, day);
            }
        }
        filtered
    }

    fn is_filtered(&self, day: i32) -> bool {
        let Some(year) = self.year.as_ref() else {
            return true;
        };
        let options = self.options;
        let by_month = !options.month.is_empty()
            && !year
                .month_at(day)
                .is_some_and(|m| options.month.contains(m));
        let by_weekno = !options.weekno.is_empty() && !year.in_selected_week(day);
        let by_weekday = !options.weekday.is_empty()
            && !year
                .weekday_at(day)
                .is_some_and(|w| options.weekday.contains(&w));
        let by_nth_weekday = self
            .month
            .as_ref()
            .is_some_and(|month| !month.is_empty() && !month.selects(day));
        let by_easter = options.easter.is_some() && self.easter_day != Some(i64::from(day));
        let by_monthday = (!options.monthday.is_empty() || !options.monthday_from_end.is_empty())
            && !year
                .monthday_at(day)
                .is_some_and(|d| options.monthday.contains(d))
            && !year
                .monthday_from_end_at(day)
                .is_some_and(|d| options.monthday_from_end.contains(d));
        by_month
            || by_weekno
            || by_weekday
            || by_nth_weekday
            || by_easter
            || by_monthday
            || is_yearday_filtered(options, year, day)
    }

    fn emit(
        &mut self,
        days: &[Option<i32>],
        start: i32,
        end: i32,
        timeset: &[i64],
        found: &mut Vec<i64>,
    ) -> Flow {
        let Some(yearordinal) = self.year.as_ref().map(|year| year.yearordinal) else {
            return Flow::Stop;
        };
        if self.options.setpos.is_empty() {
            for index in start..end {
                let Some(day) = day_at(days, index) else {
                    continue;
                };
                let Some(midnight) = day_instant(yearordinal, day) else {
                    continue;
                };
                for time in timeset {
                    let Some(res) = midnight.checked_add(*time) else {
                        continue;
                    };
                    if self.accept(res, found) == Flow::Stop {
                        return Flow::Stop;
                    }
                }
            }
        } else {
            for res in build_poslist(self.options, timeset, days, start, end, yearordinal) {
                if self.accept(res, found) == Flow::Stop {
                    return Flow::Stop;
                }
            }
        }
        Flow::Continue
    }

    /// The reference's `until` guard, `res >= dtstart` guard, and
    /// `IterResult.accept` for a `between` query, in that order.
    fn accept(&mut self, res: i64, found: &mut Vec<i64>) -> Flow {
        if self.options.until.is_some_and(|until| res > until) {
            return Flow::Stop;
        }
        if res < self.options.dtstart {
            return Flow::Continue;
        }
        if res > self.max {
            return Flow::Stop;
        }
        if res >= self.min {
            found.push(res);
        }
        match &mut self.count {
            CountLimit::Unbounded | CountLimit::Zero => Flow::Continue,
            CountLimit::Single => Flow::Stop,
            CountLimit::Limit(remaining) => {
                *remaining = remaining.saturating_sub(1);
                if *remaining == 0 {
                    Flow::Stop
                } else {
                    Flow::Continue
                }
            }
        }
    }
}

fn day_at(days: &[Option<i32>], index: i32) -> Option<i32> {
    usize::try_from(index)
        .ok()
        .and_then(|index| days.get(index))
        .copied()
        .flatten()
}

fn clear_day(days: &mut [Option<i32>], index: i32) {
    if let Ok(index) = usize::try_from(index)
        && let Some(slot) = days.get_mut(index)
    {
        *slot = None;
    }
}

fn day_instant(yearordinal: i64, day: i32) -> Option<i64> {
    yearordinal
        .checked_add(i64::from(day))?
        .checked_mul(MS_PER_DAY)
}

/// The `BYYEARDAY` clause, which is the only filter that has to look at both
/// this year's length and the next one's — a weekly period can straddle them.
fn is_yearday_filtered(options: &Options, year: &YearInfo, day: i32) -> bool {
    if options.yearday.is_empty() {
        return false;
    }
    let day = i64::from(day);
    let yearlen = i64::from(year.yearlen);
    if day < yearlen {
        !options.yearday.contains(day + 1) && !options.yearday.contains(-yearlen + day)
    } else {
        let nextyearlen = i64::from(year.nextyearlen);
        !options.yearday.contains(day + 1 - yearlen)
            && !options.yearday.contains(-nextyearlen + day - yearlen)
    }
}

/// `Iterinfo.getdayset`: the candidate day indices for the counter's period.
fn day_set(
    options: &Options,
    counter: &Counter,
    year: &YearInfo,
) -> Option<(Vec<Option<i32>>, i32, i32)> {
    let yearlen = year.yearlen;
    match options.freq {
        Frequency::Yearly => Some(((0..yearlen).map(Some).collect(), 0, yearlen)),
        Frequency::Monthly => {
            let (start, end) = year.month_range(i64::from(counter.month))?;
            let mut days = vec![None; usize::try_from(yearlen).ok()?];
            for index in start..end {
                set_day(&mut days, index);
            }
            Some((days, start, end))
        }
        Frequency::Weekly => {
            let mut days = vec![None; usize::try_from(yearlen + 7).ok()?];
            let mut index = counter.day_index(year)?;
            let start = index;
            for _ in 0..7 {
                set_day(&mut days, index);
                index += 1;
                if year.weekday_at(index) == Some(options.wkst) {
                    break;
                }
            }
            Some((days, start, index))
        }
        Frequency::Daily | Frequency::Hourly | Frequency::Minutely | Frequency::Secondly => {
            let mut days = vec![None; usize::try_from(yearlen).ok()?];
            let index = counter.day_index(year)?;
            set_day(&mut days, index);
            Some((days, index, index + 1))
        }
    }
}

fn set_day(days: &mut [Option<i32>], index: i32) {
    if let Ok(position) = usize::try_from(index)
        && let Some(slot) = days.get_mut(position)
    {
        *slot = Some(index);
    }
}

/// `buildTimeset`: the fixed cross product of `BYHOUR`, `BYMINUTE` and
/// `BYSECOND` used by every daily-or-greater frequency. Deliberately **not**
/// sorted — the reference emits it in the order the rule wrote it.
fn build_timeset(options: &Options) -> Vec<i64> {
    let millisecond = options.dtstart % 1_000;
    let mut times = Vec::new();
    for hour in &options.hour {
        for minute in &options.minute {
            for second in &options.second {
                times.push(clock_ms(*hour, *minute, *second, millisecond));
            }
        }
    }
    times
}

/// `Iterinfo.gettimeset`: the per-step time set for a sub-daily frequency.
fn time_set_for(options: &Options, counter: &Counter, millisecond: i64) -> Option<Vec<i64>> {
    let mut times = match options.freq {
        Frequency::Hourly => {
            let mut times = Vec::new();
            for minute in &options.minute {
                for second in &options.second {
                    times.push(clock_ms(counter.hour, *minute, *second, millisecond));
                }
            }
            times
        }
        Frequency::Minutely => options
            .second
            .iter()
            .map(|second| clock_ms(counter.hour, counter.minute, *second, millisecond))
            .collect(),
        Frequency::Secondly => vec![clock_ms(
            counter.hour,
            counter.minute,
            counter.second,
            millisecond,
        )],
        Frequency::Yearly | Frequency::Monthly | Frequency::Weekly | Frequency::Daily => {
            return None;
        }
    };
    times.sort_unstable();
    Some(times)
}

fn clock_ms(hour: i64, minute: i64, second: i64, millisecond: i64) -> i64 {
    hour.saturating_mul(3_600_000)
        .saturating_add(minute.saturating_mul(60_000))
        .saturating_add(second.saturating_mul(1_000))
        .saturating_add(millisecond)
}

/// `buildPoslist`.
///
/// An out-of-range position produces `NaN` upstream, which then fails every
/// comparison and contributes nothing — dropped here instead. An empty time set
/// makes the reference read `timeset[NaN]`, fall back to the *date* object, and
/// then read local-time getters off it; that answer depends on the host's
/// timezone, so there is nothing deterministic to reproduce and the position is
/// dropped too.
fn build_poslist(
    options: &Options,
    timeset: &[i64],
    days: &[Option<i32>],
    start: i32,
    end: i32,
    yearordinal: i64,
) -> Vec<i64> {
    let mut poslist = Vec::new();
    let Ok(times) = i64::try_from(timeset.len()) else {
        return poslist;
    };
    if times == 0 {
        return poslist;
    }
    let present: Vec<i32> = (start..end)
        .filter_map(|index| day_at(days, index))
        .collect();
    let Ok(count) = i64::try_from(present.len()) else {
        return poslist;
    };
    for &position in &options.setpos {
        let zero_based = if position < 0 { position } else { position - 1 };
        let daypos = zero_based.div_euclid(times);
        let timepos = zero_based.rem_euclid(times);
        let index = if daypos < 0 {
            count.saturating_add(daypos).max(0)
        } else {
            daypos
        };
        let Some(day) = usize::try_from(index).ok().and_then(|i| present.get(i)) else {
            continue;
        };
        let Some(time) = usize::try_from(timepos).ok().and_then(|i| timeset.get(i)) else {
            continue;
        };
        let Some(res) = day_instant(yearordinal, *day).and_then(|ms| ms.checked_add(*time)) else {
            continue;
        };
        poslist.push(res);
    }
    poslist.sort_unstable();
    poslist
}

/// The earliest instant the day set of the counter's *current* period could
/// possibly contain. Used only for the window bound; see the module docs.
fn earliest_instant(freq: Frequency, counter: &Counter) -> Option<i64> {
    match freq {
        Frequency::Yearly => instant::from_parts(i64::from(counter.year), 0, 1, 0, 0, 0, 0),
        Frequency::Monthly => instant::from_parts(
            i64::from(counter.year),
            i64::from(counter.month) - 1,
            1,
            0,
            0,
            0,
            0,
        ),
        Frequency::Weekly
        | Frequency::Daily
        | Frequency::Hourly
        | Frequency::Minutely
        | Frequency::Secondly => counter.ordinal()?.checked_mul(MS_PER_DAY),
    }
}

/// The walking cursor — rrule.js's `DateTime`.
///
/// `day` is deliberately allowed to exceed the length of `month`: `addMonths`
/// does not normalise it, and the two frequencies that use `addMonths` address
/// days by month range rather than by the cursor's own day.
struct Counter {
    year: i32,
    month: u8,
    day: i64,
    hour: i64,
    minute: i64,
    second: i64,
    millisecond: i64,
}

impl Counter {
    fn from(start: DtStart) -> Self {
        Self {
            year: start.year,
            month: start.month,
            day: start.day,
            hour: start.hour,
            minute: start.minute,
            second: start.second,
            millisecond: start.millisecond,
        }
    }

    fn ordinal(&self) -> Option<i64> {
        let instant = instant::from_parts(
            i64::from(self.year),
            i64::from(self.month) - 1,
            self.day,
            0,
            0,
            0,
            0,
        )?;
        Some(instant.div_euclid(MS_PER_DAY))
    }

    fn day_index(&self, year: &YearInfo) -> Option<i32> {
        i32::try_from(self.ordinal()?.checked_sub(year.yearordinal)?).ok()
    }

    fn weekday(&self) -> Option<u8> {
        self.ordinal().map(instant::weekday_at)
    }

    /// `DateTime.add`.
    fn add(&mut self, options: &Options, filtered: bool) -> Flow {
        let interval = options.interval;
        match options.freq {
            Frequency::Yearly => {
                self.year = self.year.saturating_add(saturating_i32(interval));
                Flow::Continue
            }
            Frequency::Monthly => self.add_months(interval),
            Frequency::Weekly => self.add_weekly(interval, options.wkst),
            Frequency::Daily => {
                self.day = self.day.saturating_add(interval);
                self.fix_day();
                Flow::Continue
            }
            Frequency::Hourly => self.add_hours(interval, filtered, &options.hour),
            Frequency::Minutely => {
                self.add_minutes(interval, filtered, &options.hour, &options.minute)
            }
            Frequency::Secondly => self.add_seconds(
                interval,
                filtered,
                &options.hour,
                &options.minute,
                &options.second,
            ),
        }
    }

    fn add_months(&mut self, months: i64) -> Flow {
        let mut month = i64::from(self.month).saturating_add(months);
        if month > 12 {
            let years = month.div_euclid(12);
            month = month.rem_euclid(12);
            self.year = self.year.saturating_add(saturating_i32(years));
            if month == 0 {
                month = 12;
                self.year = self.year.saturating_sub(1);
            }
        }
        match u8::try_from(month) {
            Ok(month) => {
                self.month = month;
                Flow::Continue
            }
            Err(_) => Flow::Stop,
        }
    }

    fn add_weekly(&mut self, weeks: i64, wkst: u8) -> Flow {
        let Some(weekday) = self.weekday() else {
            return Flow::Stop;
        };
        let (weekday, wkst) = (i64::from(weekday), i64::from(wkst));
        let step = if wkst > weekday {
            -(weekday + 1 + (6 - wkst)) + weeks * 7
        } else {
            -(weekday - wkst) + weeks * 7
        };
        self.day = self.day.saturating_add(step);
        self.fix_day();
        Flow::Continue
    }

    /// `DateTime.fixDay`, which carries an overlong day into the next month.
    fn fix_day(&mut self) {
        if self.day <= 28 {
            return;
        }
        let mut length = month_length(self.year, self.month);
        while self.day > length {
            self.day -= length;
            self.month = self.month.saturating_add(1);
            if self.month == 13 {
                self.month = 1;
                self.year = self.year.saturating_add(1);
                if past_max_year(self.year) {
                    return;
                }
            }
            length = month_length(self.year, self.month);
        }
    }

    fn add_hours(&mut self, hours: i64, filtered: bool, byhour: &[i64]) -> Flow {
        if hours <= 0 {
            return Flow::Stop;
        }
        if filtered {
            self.hour += (23 - self.hour).div_euclid(hours) * hours;
        }
        // The hour cycles modulo 24 under a fixed step, so a full cycle without
        // a match proves there is none.
        for _ in 0..=24 {
            self.hour += hours;
            let days = self.hour.div_euclid(24);
            if days != 0 {
                self.hour = self.hour.rem_euclid(24);
                self.day = self.day.saturating_add(days);
                self.fix_day();
            }
            if byhour.is_empty() || byhour.contains(&self.hour) {
                return Flow::Continue;
            }
        }
        Flow::Stop
    }

    fn add_minutes(
        &mut self,
        minutes: i64,
        filtered: bool,
        byhour: &[i64],
        byminute: &[i64],
    ) -> Flow {
        if minutes <= 0 {
            return Flow::Stop;
        }
        if filtered {
            let elapsed = self.hour * 60 + self.minute;
            self.minute += (1439 - elapsed).div_euclid(minutes) * minutes;
        }
        for _ in 0..=1440 {
            self.minute += minutes;
            let hours = self.minute.div_euclid(60);
            if hours != 0 {
                self.minute = self.minute.rem_euclid(60);
                if self.add_hours(hours, false, byhour) == Flow::Stop {
                    return Flow::Stop;
                }
            }
            let hour_ok = byhour.is_empty() || byhour.contains(&self.hour);
            let minute_ok = byminute.is_empty() || byminute.contains(&self.minute);
            if hour_ok && minute_ok {
                return Flow::Continue;
            }
        }
        Flow::Stop
    }

    fn add_seconds(
        &mut self,
        seconds: i64,
        filtered: bool,
        byhour: &[i64],
        byminute: &[i64],
        bysecond: &[i64],
    ) -> Flow {
        if seconds <= 0 {
            return Flow::Stop;
        }
        if filtered {
            let elapsed = self.hour * 3600 + self.minute * 60 + self.second;
            self.second += (86_399 - elapsed).div_euclid(seconds) * seconds;
        }
        for _ in 0..=86_400 {
            self.second += seconds;
            let minutes = self.second.div_euclid(60);
            if minutes != 0 {
                self.second = self.second.rem_euclid(60);
                if self.add_minutes(minutes, false, byhour, byminute) == Flow::Stop {
                    return Flow::Stop;
                }
            }
            let hour_ok = byhour.is_empty() || byhour.contains(&self.hour);
            let minute_ok = byminute.is_empty() || byminute.contains(&self.minute);
            let second_ok = bysecond.is_empty() || bysecond.contains(&self.second);
            if hour_ok && minute_ok && second_ok {
                return Flow::Continue;
            }
        }
        Flow::Stop
    }
}

fn saturating_i32(value: i64) -> i32 {
    i32::try_from(value).unwrap_or(i32::MAX)
}

fn month_length(year: i32, month: u8) -> i64 {
    match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if instant::is_leap_year(year) => 29,
        _ => 28,
    }
}
