//! The four pages, rendered from their view models with the Scout kit.

use scout_desktop_ipc::WindowMessage;

use crate::kit::prelude::{IntoElement, ParentElement as _};
use crate::kit::{
    ButtonStyle, Handler, KeyValueTable, MonoLine, Page, ScoutButton, ScoutToggle, ScrollLog,
    StatusRow, action_row, body_text, error_notice, note_text, section_heading,
};
use crate::view_model::{
    Action, ActivityModel, DiagnosticsModel, OBSERVATION_NOTE, OverviewModel, PRIVACY_NOTE,
    PRIVACY_SWITCHES_NOTE, SEND_ERROR_REPORTS_LABEL, SEND_USAGE_DATA_LABEL, START_AT_LOGIN_LABEL,
    SettingsModel,
};

/// Builds the handler that sends one command to the supervisor.
pub type Send = dyn Fn(WindowMessage) -> Handler;

fn button(action: &Action, send: &Send) -> ScoutButton {
    let style = if action.destructive {
        ButtonStyle::Destructive
    } else if action.primary {
        ButtonStyle::Primary
    } else {
        ButtonStyle::Secondary
    };
    ScoutButton::new(action.id, action.label, style, send(action.message.clone()))
}

/// The Overview page.
pub fn overview(model: OverviewModel) -> impl IntoElement {
    Page::new("League observer")
        .children(
            model
                .rows
                .into_iter()
                .map(|row| StatusRow::new(row.label, row.value, row.tone)),
        )
        .children(model.error.map(error_notice))
}

/// The Activity page.
pub fn activity(model: ActivityModel) -> impl IntoElement {
    Page::new("Activity").child(body_text(model.summary))
}

/// The Settings page.
pub fn settings(model: &SettingsModel, send: &Send) -> impl IntoElement {
    Page::new("Settings")
        .child(body_text(model.pairing_status.clone()))
        .child(
            action_row().children(
                model
                    .pairing_actions
                    .iter()
                    .map(|action| button(action, send)),
            ),
        )
        .child(section_heading("Startup"))
        .child(ScoutToggle::new(
            "start-at-login",
            START_AT_LOGIN_LABEL,
            model.start_at_login,
            send(model.toggle_start_at_login()),
        ))
        .child(note_text(OBSERVATION_NOTE))
        .child(section_heading("Privacy"))
        .child(ScoutToggle::new(
            "send-error-reports",
            SEND_ERROR_REPORTS_LABEL,
            model.send_error_reports,
            send(model.toggle_error_reports()),
        ))
        .child(ScoutToggle::new(
            "send-usage-data",
            SEND_USAGE_DATA_LABEL,
            model.send_usage_data,
            send(model.toggle_usage_data()),
        ))
        .child(note_text(PRIVACY_SWITCHES_NOTE))
        .child(section_heading("Scout"))
        .child(action_row().child(button(&model.quit, send)))
}

/// The Diagnostics page.
pub fn diagnostics(model: DiagnosticsModel, send: &Send) -> impl IntoElement {
    let events = if model.recent_events.is_empty() {
        body_text("Nothing recorded yet.").into_any_element()
    } else {
        ScrollLog::new("recent-events", model.recent_events).into_any_element()
    };
    Page::new("Diagnostics")
        .children(model.facts.into_iter().map(MonoLine::new))
        .child(action_row().children(model.actions.iter().map(|action| button(action, send))))
        .child(section_heading("Counters"))
        .child(KeyValueTable::new(model.counters))
        .child(section_heading("Recent activity"))
        .child(events)
        .child(note_text(PRIVACY_NOTE))
}
