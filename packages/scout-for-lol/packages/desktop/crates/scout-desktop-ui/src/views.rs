//! The four pages, rendered from their view models with the Scout kit, and
//! voice's pieces: the microphone indicator, the first-use question, and the
//! Settings section.

use scout_desktop_ipc::WindowMessage;

use crate::kit::prelude::{IntoElement, ParentElement as _};
use crate::kit::{
    ButtonStyle, Handler, KeyValueTable, MicPill, MonoLine, Page, ScoutButton, ScoutToggle,
    ScrollLog, StatusRow, action_row, body_text, error_notice, modal, note_text, section_heading,
};
use crate::view_model::{
    Action, ActivityModel, DiagnosticsModel, OBSERVATION_NOTE, OverviewModel, PRIVACY_NOTE,
    PRIVACY_SWITCHES_NOTE, SEND_ERROR_REPORTS_LABEL, SEND_USAGE_DATA_LABEL, START_AT_LOGIN_LABEL,
    SettingsModel,
};
use crate::voice_model::{
    CONVERSATION_MODE_LABEL, ConsentDialog, KeyOption, MicIndicator, PUSH_TO_TALK_LABEL,
    VOICE_NOTE, VoiceAction, VoiceSettingsModel,
};

/// Builds the handler that sends one command to the supervisor.
pub type Send = dyn Fn(WindowMessage) -> Handler;

/// The button for `action`, sending its message.
pub fn button(action: &Action, send: &Send) -> ScoutButton {
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

/// The microphone indicator for the sidebar.
pub fn mic_pill(indicator: Option<MicIndicator>, send: &Send) -> Option<MicPill> {
    indicator.map(|indicator| {
        MicPill::new(
            indicator.label,
            indicator.tone,
            indicator.toggle.map(|message| send(message)),
        )
    })
}

fn voice_button(action: &VoiceAction, style: ButtonStyle, send: &Send) -> ScoutButton {
    ScoutButton::new(action.id, action.label, style, send(action.message.clone()))
}

/// The first-use question, over the whole window.
pub fn consent_dialog(
    dialog: Option<ConsentDialog>,
    send: &Send,
) -> Option<crate::kit::prelude::AnyElement> {
    dialog.map(|dialog| {
        modal(
            dialog.title,
            dialog.body,
            [
                voice_button(&dialog.accept, ButtonStyle::Primary, send),
                voice_button(&dialog.decline, ButtonStyle::Secondary, send),
            ],
        )
    })
}

fn key_row(label: &'static str, keys: &[KeyOption], send: &Send) -> impl IntoElement {
    action_row()
        .child(body_text(label).into_any_element())
        .children(keys.iter().map(|key| {
            ScoutButton::new(
                key.id.clone(),
                key.label.clone(),
                if key.selected {
                    ButtonStyle::Primary
                } else {
                    ButtonStyle::Secondary
                },
                send(key.message.clone()),
            )
        }))
}

/// The Settings page's voice section.
fn voice_section(model: VoiceSettingsModel, send: &Send) -> Vec<crate::kit::prelude::AnyElement> {
    let mut elements = vec![
        section_heading("Voice").into_any_element(),
        body_text(model.status).into_any_element(),
        action_row()
            .child(voice_button(&model.consent, ButtonStyle::Secondary, send))
            .into_any_element(),
        ScoutToggle::new(
            "voice-conversation-mode",
            CONVERSATION_MODE_LABEL,
            model.conversation_mode.0,
            send(model.conversation_mode.1),
        )
        .into_any_element(),
        ScoutToggle::new(
            "voice-push-to-talk",
            PUSH_TO_TALK_LABEL,
            model.push_to_talk.0,
            send(model.push_to_talk.1),
        )
        .into_any_element(),
        key_row("Push-to-talk key", &model.push_to_talk_keys, send).into_any_element(),
        key_row("Mute key", &model.mute_keys, send).into_any_element(),
        note_text(VOICE_NOTE).into_any_element(),
    ];
    if let Some(detail) = model.detail {
        elements.push(error_notice(detail).into_any_element());
    }
    elements
}

/// The Settings page, with the voice section when this build has voice.
pub fn settings(
    model: &SettingsModel,
    voice: Option<VoiceSettingsModel>,
    send: &Send,
) -> impl IntoElement {
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
        .children(voice.map_or_default(|voice| voice_section(voice, send)))
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
