//! Explicit agenda policies. Existing date scopes retain their own contracts.

use chrono::NaiveDate;
use tasknotes_core::recurrence::{DateWindow, Recurrence};

use crate::{
    Result, RuntimeError,
    engine::occurrence_relations::Index,
    types::{AgendaDateKind, AgendaSection, Query, TaskSnapshot},
};

#[derive(Clone, Copy)]
struct Reason {
    day: NaiveDate,
    kind: AgendaDateKind,
}

#[derive(Clone, Copy)]
struct AgendaDay {
    local: NaiveDate,
    // Occurrence identities are canonical written civil days, independent of
    // the viewer's display timezone and the selected agenda reason.
    identity: NaiveDate,
}

impl AgendaDay {
    fn literal(day: NaiveDate) -> Self {
        Self {
            local: day,
            identity: day,
        }
    }
}

pub(crate) fn project(
    task: &mut TaskSnapshot,
    query: &Query,
    recurrence: &Recurrence,
    occurrences: &Index,
) -> Result<()> {
    let today = query
        .today
        .as_deref()
        .ok_or_else(|| RuntimeError::Validation("date scope requires local today".into()))
        .and_then(|day| tasknotes_vault::temporal::parse_day(day).map_err(Into::into))?;
    task.effective_date = None;
    task.agenda_section = None;
    task.agenda_date_kind = None;
    if task.completed {
        return Ok(());
    }
    let upcoming = query.scope.as_deref() == Some("upcomingAgenda");
    let timezone = query
        .timezone
        .as_deref()
        .ok_or_else(|| RuntimeError::Validation("agenda scope requires viewer timezone".into()))?;
    let scheduled = property_day(task, "scheduled", timezone)?;
    let due = property_day(task, "due", timezone)?;
    let mut planned = scheduled;
    let mut deadline = due;
    let mut completion_day = None;
    if task.is_recurring {
        let complete = crate::projections::instance_days(task, "completeInstances")?;
        let skipped = crate::projections::instance_days(task, "skippedInstances")?;
        let processed = |day| complete.contains(&day) || skipped.contains(&day);
        let covered = |day: NaiveDate| occurrences.covers(&task.path, &day.to_string());
        let current = scheduled.or(due).map(|day| day.identity);
        if upcoming {
            let current_processed = current.is_some_and(|day| processed(day) || covered(day));
            planned = scheduled.filter(|day| !processed(day.identity) && !covered(day.identity));
            deadline = due.filter(|day| {
                !current_processed && !processed(day.identity) && !covered(day.identity)
            });
            if current_processed || current.is_none() {
                planned = next_occurrence(
                    recurrence,
                    today,
                    query.upcoming_days.unwrap_or(366),
                    &complete,
                    &skipped,
                    &covered,
                )?
                .map(AgendaDay::literal);
            }
            completion_day = planned
                .map(|day| day.identity)
                .or(current)
                .or(deadline.map(|day| day.identity));
        } else {
            planned = scheduled.filter(|day| !processed(day.identity) && !covered(day.identity));
            if scheduled.is_none()
                && occurrence_on(recurrence, today)?
                && !processed(today)
                && !covered(today)
            {
                planned = Some(AgendaDay::literal(today));
            }
            // A materialized child is the sole owner of its occurrence. Do not
            // recreate a second virtual row through a parent's due-date reason.
            if current.is_some_and(covered) {
                return Ok(());
            }
            completion_day = if task
                .properties
                .get("recurrenceAnchor")
                .and_then(serde_json::Value::as_str)
                == Some("completion")
            {
                Some(today)
            } else {
                planned
                    .filter(|day| day.local <= today)
                    .map(|day| day.identity)
                    .or(current)
                    .or(Some(today))
            };
        }
        if completion_day.is_some_and(|day| processed(day) || covered(day)) {
            return Ok(());
        }
    }
    let eligible = |day: &AgendaDay| {
        if upcoming {
            day.local > today
        } else {
            day.local <= today
        }
    };
    let planned = planned.filter(eligible).map(|day| Reason {
        day: day.local,
        kind: AgendaDateKind::Planned,
    });
    let deadline = deadline.filter(eligible).map(|day| Reason {
        day: day.local,
        kind: AgendaDateKind::Deadline,
    });
    publish(task, today, upcoming, planned, deadline, completion_day);
    Ok(())
}

fn publish(
    task: &mut TaskSnapshot,
    today: NaiveDate,
    upcoming: bool,
    planned: Option<Reason>,
    deadline: Option<Reason>,
    completion_day: Option<NaiveDate>,
) {
    let primary = [planned, deadline]
        .into_iter()
        .flatten()
        .min_by_key(|reason| (reason.day, reason.kind == AgendaDateKind::Deadline));
    if let Some(primary) = primary {
        task.effective_date = Some(primary.day.to_string());
        task.agenda_date_kind = Some(primary.kind);
        if !upcoming {
            task.agenda_section = Some(if primary.day < today {
                AgendaSection::Overdue
            } else if planned.is_some() {
                AgendaSection::ScheduledToday
            } else {
                AgendaSection::DueToday
            });
        }
        if task.is_recurring {
            task.occurrence_date = completion_day.map(|day| day.to_string());
        }
    }
}

fn property_day(task: &TaskSnapshot, key: &str, timezone: &str) -> Result<Option<AgendaDay>> {
    task.properties
        .get(key)
        .and_then(serde_json::Value::as_str)
        .map(|value| {
            Ok(AgendaDay {
                local: tasknotes_vault::temporal::parse_local_day(value, timezone)?,
                identity: tasknotes_vault::temporal::date_part(value)?,
            })
        })
        .transpose()
}

fn occurrence_on(recurrence: &Recurrence, day: NaiveDate) -> Result<bool> {
    let window = DateWindow::new(day, day)
        .map_err(|_| RuntimeError::Validation("invalid recurrence query range".into()))?;
    Ok(!recurrence
        .bounded_occurrences(window, crate::RECURRENCE_WORK_LIMIT)
        .map_err(|_| RuntimeError::Validation("occurrence_expansion_resource_limit".into()))?
        .is_empty())
}

fn next_occurrence(
    recurrence: &Recurrence,
    today: NaiveDate,
    days: u32,
    complete: &[NaiveDate],
    skipped: &[NaiveDate],
    covered: &impl Fn(NaiveDate) -> bool,
) -> Result<Option<NaiveDate>> {
    if days == 0 {
        return Ok(None);
    }
    let start = today
        .succ_opt()
        .ok_or_else(|| RuntimeError::Validation("query date range overflow".into()))?;
    let end = today
        .checked_add_days(chrono::Days::new(u64::from(days)))
        .ok_or_else(|| RuntimeError::Validation("query date range overflow".into()))?;
    let window = DateWindow::new(start, end)
        .map_err(|_| RuntimeError::Validation("invalid recurrence query range".into()))?;
    Ok(recurrence
        .bounded_occurrences(window, crate::RECURRENCE_WORK_LIMIT)
        .map_err(|_| RuntimeError::Validation("occurrence_expansion_resource_limit".into()))?
        .into_iter()
        .find(|day| !complete.contains(day) && !skipped.contains(day) && !covered(*day)))
}
