//! Durable device-local focus timer transitions with an explicit caller clock.

use crate::{Result, RuntimeError, features::timestamp};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum Status {
    Idle,
    Running,
    Paused,
    Completed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct State {
    pub status: Status,
    pub task_path: Option<String>,
    pub duration_seconds: u64,
    pub elapsed_seconds: u64,
    pub started_at: Option<String>,
    pub updated_at: Option<String>,
}
impl Default for State {
    fn default() -> Self {
        Self {
            status: Status::Idle,
            task_path: None,
            duration_seconds: 1_500,
            elapsed_seconds: 0,
            started_at: None,
            updated_at: None,
        }
    }
}

pub(crate) fn reading(mut state: State, at: &str) -> Result<State> {
    let now = timestamp(at)?;
    if state
        .updated_at
        .as_deref()
        .map(timestamp)
        .transpose()?
        .is_some_and(|updated| now < updated)
    {
        return Err(RuntimeError::Validation(
            "clock precedes the durable timer transition".to_owned(),
        ));
    }
    if state.status == Status::Running {
        let start = timestamp(state.started_at.as_deref().ok_or_else(|| {
            RuntimeError::Storage("running timer has no start timestamp".to_owned())
        })?)?;
        let delta = u64::try_from((now - start).num_seconds())
            .map_err(|_| RuntimeError::Validation("clock precedes timer start".to_owned()))?;
        state.elapsed_seconds = state
            .elapsed_seconds
            .checked_add(delta)
            .ok_or_else(|| {
                RuntimeError::Validation("timer elapsed duration is too large".to_owned())
            })?
            .min(state.duration_seconds);
        if state.elapsed_seconds == state.duration_seconds {
            state.status = Status::Completed;
        }
    }
    Ok(state)
}

pub(crate) fn transition(
    previous: State,
    action: &str,
    task_path: Option<&str>,
    duration: u64,
    at: &str,
) -> Result<State> {
    if duration == 0 || duration > 86_400 {
        return Err(RuntimeError::Validation(
            "focus duration must be between1 and86,400 seconds".to_owned(),
        ));
    }
    let mut state = reading(previous, at)?;
    match action {
        "start" => {
            if matches!(state.status, Status::Running | Status::Paused) {
                return Err(RuntimeError::Validation(
                    "a focus interval is already active".to_owned(),
                ));
            }
            state = State {
                status: Status::Running,
                task_path: task_path.map(str::to_owned),
                duration_seconds: duration,
                elapsed_seconds: 0,
                started_at: Some(at.to_owned()),
                updated_at: Some(at.to_owned()),
            };
        }
        "pause" => {
            if state.status != Status::Running {
                return Err(RuntimeError::Validation(
                    "only a running focus interval can be paused".to_owned(),
                ));
            }
            state.status = Status::Paused;
            state.started_at = None;
        }
        "resume" => {
            if state.status != Status::Paused {
                return Err(RuntimeError::Validation(
                    "only a paused focus interval can resume".to_owned(),
                ));
            }
            state.status = Status::Running;
            state.started_at = Some(at.to_owned());
        }
        "stop" => {
            state.status = Status::Idle;
            state.started_at = None;
        }
        _ => {
            return Err(RuntimeError::Validation(
                "unknown Pomodoro action".to_owned(),
            ));
        }
    }
    state.updated_at = Some(at.to_owned());
    Ok(state)
}
