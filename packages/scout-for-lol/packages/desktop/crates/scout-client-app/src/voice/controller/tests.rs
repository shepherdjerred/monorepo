use scout_client_core::live::gameflow::GameflowPhase;
use scout_client_core::settings::VoiceSettings;
use scout_desktop_ipc::{
    VoiceCommand, VoiceConsent, VoiceSettings as WireSettings, VoiceState, VoiceTurnView,
};
use scout_explore_client::voice::{
    SpeechEncoding, VoiceTrigger, VoiceTurnErrorCode, VoiceTurnEvent, VoiceTurnOutcome,
    WakeVerification,
};
use scout_voice::{EndReason, EngineCommand, EngineEvent, Trigger, Utterance};
use uuid::Uuid;

use super::{Controller, Effect, Input, TurnUpdate};
use crate::hotkeys::{HotkeyBindings, HotkeyEvent};

/// No effects.
const NOTHING: [Effect; 0] = [];

const CONVERSATION: Uuid = Uuid::from_u128(0x0b5e_4a1c_7f00_4e5a_9c1d_2f3e_4a5b_6c7d);

fn agreed() -> VoiceSettings {
    VoiceSettings {
        consent: Some(true),
        ..VoiceSettings::default()
    }
}

fn default_keys() -> HotkeyBindings {
    HotkeyBindings {
        push_to_talk: Some("F8".to_owned()),
        mute: Some("Shift+F8".to_owned()),
    }
}

fn utterance(trigger: Trigger) -> Utterance {
    Utterance {
        samples: vec![0.1; 16_000],
        trigger,
        reason: EndReason::EndOfSpeech,
        wake_score: Some(0.9),
    }
}

fn listening() -> EngineEvent {
    EngineEvent::State {
        state: scout_voice::VoiceState::Armed,
        microphone_open: true,
    }
}

/// A controller whose player agreed, with the engine ready and a game on.
fn in_game() -> Controller {
    let (mut controller, effects) = Controller::new(Ok(agreed()));
    assert_eq!(effects, [Effect::Bind(default_keys()), Effect::StartEngine]);
    assert_eq!(
        controller.handle(Input::Engine(EngineEvent::Ready)),
        NOTHING
    );
    assert_eq!(
        controller.handle(Input::Phase(GameflowPhase::GameStart)),
        [Effect::Engine(EngineCommand::Conversation(true))]
    );
    controller.handle(Input::Engine(listening()));
    controller
}

fn event(event: VoiceTurnEvent) -> Input {
    Input::Turn(TurnUpdate::Event(event))
}

#[test]
fn nothing_listens_and_no_engine_starts_before_the_player_agrees() {
    let (mut controller, effects) = Controller::new(Ok(VoiceSettings::default()));
    // Push-to-talk is bound so pressing it can ask; nothing else happens.
    assert_eq!(effects, [Effect::Bind(default_keys())]);
    let snapshot = controller.snapshot();
    assert_eq!(
        (snapshot.state, snapshot.consent, snapshot.consent_requested),
        (VoiceState::Off, VoiceConsent::NotAsked, false)
    );
    // A game starting in conversation mode asks, once, and opens nothing.
    assert_eq!(
        controller.handle(Input::Phase(GameflowPhase::GameStart)),
        [Effect::ShowWindow]
    );
    assert!(controller.snapshot().consent_requested);
    assert_eq!(
        controller.handle(Input::Phase(GameflowPhase::InProgress)),
        NOTHING
    );
    assert_eq!(
        controller.handle(Input::Hotkey(HotkeyEvent::PushToTalk(true))),
        NOTHING
    );
}

#[test]
fn push_to_talk_before_agreeing_asks_instead_of_recording() {
    let (mut controller, _) = Controller::new(Ok(VoiceSettings::default()));
    assert_eq!(
        controller.handle(Input::Hotkey(HotkeyEvent::PushToTalk(true))),
        [Effect::ShowWindow]
    );
    assert!(controller.snapshot().consent_requested);
}

#[test]
fn agreeing_saves_the_choice_and_starts_listening_in_game() {
    let (mut controller, _) = Controller::new(Ok(VoiceSettings::default()));
    controller.handle(Input::Phase(GameflowPhase::InProgress));
    let effects = controller.handle(Input::Window(VoiceCommand::Consent { accepted: true }));
    assert_eq!(
        effects,
        [
            Effect::Save(agreed()),
            Effect::Bind(default_keys()),
            Effect::StartEngine
        ]
    );
    assert!(!controller.snapshot().consent_requested);
    assert_eq!(
        controller.handle(Input::Engine(EngineEvent::Ready)),
        [Effect::Engine(EngineCommand::Conversation(true))]
    );
    controller.handle(Input::Engine(listening()));
    assert_eq!(controller.snapshot().state, VoiceState::Listening);
}

#[test]
fn declining_keeps_the_microphone_closed_and_gives_the_keys_back() {
    let (mut controller, _) = Controller::new(Ok(VoiceSettings::default()));
    controller.handle(Input::Phase(GameflowPhase::InProgress));
    let effects = controller.handle(Input::Window(VoiceCommand::Consent { accepted: false }));
    assert_eq!(
        effects,
        [
            Effect::Save(VoiceSettings {
                consent: Some(false),
                ..VoiceSettings::default()
            }),
            Effect::Bind(HotkeyBindings::default())
        ]
    );
    // Declined is not asked again by a game or a key.
    controller.handle(Input::Phase(GameflowPhase::EndOfGame));
    assert_eq!(
        controller.handle(Input::Phase(GameflowPhase::GameStart)),
        NOTHING
    );
    let snapshot = controller.snapshot();
    assert_eq!(
        (snapshot.state, snapshot.consent, snapshot.consent_requested),
        (VoiceState::Off, VoiceConsent::Declined, false)
    );
}

#[test]
fn conversation_mode_follows_the_game_from_loading_to_the_end() {
    let mut controller = in_game();
    assert_eq!(controller.snapshot().state, VoiceState::Listening);
    assert_eq!(
        controller.handle(Input::Phase(GameflowPhase::InProgress)),
        NOTHING
    );
    for phase in [
        GameflowPhase::WaitingForStats,
        GameflowPhase::EndOfGame,
        GameflowPhase::None,
    ] {
        let effects = controller.handle(Input::Phase(phase.clone()));
        if phase == GameflowPhase::WaitingForStats {
            assert_eq!(
                effects,
                [Effect::Engine(EngineCommand::Conversation(false))],
                "{phase:?}"
            );
        } else {
            assert!(effects.is_empty(), "{phase:?}");
        }
    }
}

#[test]
fn conversation_mode_off_listens_only_while_push_to_talk_is_held() {
    let (mut controller, _) = Controller::new(Ok(VoiceSettings {
        conversation_mode: false,
        ..agreed()
    }));
    controller.handle(Input::Engine(EngineEvent::Ready));
    assert_eq!(
        controller.handle(Input::Phase(GameflowPhase::InProgress)),
        NOTHING
    );
    assert_eq!(
        controller.handle(Input::Hotkey(HotkeyEvent::PushToTalk(true))),
        [Effect::Engine(EngineCommand::PushToTalk(true))]
    );
    controller.handle(Input::Engine(EngineEvent::State {
        state: scout_voice::VoiceState::Capturing {
            trigger: Trigger::PushToTalk,
            verified: true,
        },
        microphone_open: true,
    }));
    assert_eq!(controller.snapshot().state, VoiceState::Capturing);
    assert_eq!(
        controller.handle(Input::Hotkey(HotkeyEvent::PushToTalk(false))),
        [Effect::Engine(EngineCommand::PushToTalk(false))]
    );
}

#[test]
fn a_spoken_turn_runs_from_the_utterance_to_the_end_of_the_answer() {
    let mut controller = in_game();
    let heard = utterance(Trigger::Wake);
    assert_eq!(
        controller.handle(Input::Engine(EngineEvent::Utterance(heard.clone()))),
        [Effect::Ask(heard)]
    );
    assert_eq!(controller.snapshot().state, VoiceState::Thinking);
    assert_eq!(controller.turn_view(), Some(VoiceTurnView::default()));

    controller.handle(event(VoiceTurnEvent::Transcript {
        text: "What should I build next?".to_owned(),
        trigger: VoiceTrigger::WakeWord,
        wake: WakeVerification::Verified,
    }));
    controller.handle(event(VoiceTurnEvent::Run {
        run_id: Uuid::from_u128(1),
        conversation_id: CONVERSATION,
        question_message_id: Uuid::from_u128(2),
    }));
    controller.handle(event(VoiceTurnEvent::Answer {
        message_id: Uuid::from_u128(3),
        text: "Zhonya's Hourglass: their Zed has two items.".to_owned(),
        spoken_text: "Zhonya's next.".to_owned(),
    }));
    // Two samples, 1 and -1, little-endian.
    let effects = controller.handle(event(VoiceTurnEvent::Audio {
        sequence: 0,
        encoding: SpeechEncoding::PcmS16le,
        sample_rate_hz: 24_000,
        base64: "AQD//w==".to_owned(),
    }));
    assert_eq!(
        effects,
        [Effect::Play {
            sample_rate_hz: 24_000,
            pcm: vec![1, -1]
        }]
    );
    assert_eq!(controller.snapshot().state, VoiceState::Speaking);
    assert_eq!(
        controller.handle(event(VoiceTurnEvent::Done {
            outcome: VoiceTurnOutcome::Succeeded
        })),
        [Effect::AwaitDrain]
    );
    assert_eq!(controller.snapshot().state, VoiceState::Speaking);
    assert_eq!(
        controller.handle(Input::Drained),
        [
            Effect::Engine(EngineCommand::FinishTurn),
            Effect::OpenConversation(CONVERSATION)
        ]
    );
    controller.handle(Input::Engine(listening()));
    assert_eq!(controller.snapshot().state, VoiceState::Listening);
    assert_eq!(
        controller.turn_view(),
        Some(VoiceTurnView {
            heard: Some("What should I build next?".to_owned()),
            answer: Some("Zhonya's Hourglass: their Zed has two items.".to_owned()),
            error: None,
            #[cfg(scout_proactive_coach)]
            app_initiated: false,
        })
    );
}

#[test]
fn a_refused_turn_ends_at_once_and_says_why() {
    let mut controller = in_game();
    controller.handle(Input::Engine(EngineEvent::Utterance(utterance(
        Trigger::Wake,
    ))));
    controller.handle(event(VoiceTurnEvent::Error {
        code: VoiceTurnErrorCode::WakeNotVerified,
        message: "Scout did not hear \"hey scout\".".to_owned(),
        retry_after_seconds: None,
    }));
    assert_eq!(
        controller.handle(event(VoiceTurnEvent::Done {
            outcome: VoiceTurnOutcome::Refused
        })),
        [Effect::Engine(EngineCommand::FinishTurn)]
    );
    assert_eq!(
        controller.turn_view().and_then(|view| view.error),
        Some("Scout did not hear \"hey scout\".".to_owned())
    );
    // A transport failure ends the turn the same way.
    controller.handle(Input::Engine(EngineEvent::Utterance(utterance(
        Trigger::PushToTalk,
    ))));
    assert_eq!(
        controller.handle(Input::Turn(TurnUpdate::Refused(
            "Pair Scout Client to use voice.".to_owned()
        ))),
        [Effect::Engine(EngineCommand::FinishTurn)]
    );
    // Updates after the end belong to no turn.
    assert_eq!(
        controller.handle(Input::Turn(TurnUpdate::Broken("late".to_owned()))),
        NOTHING
    );
}

#[test]
fn mute_closes_the_microphone_and_drops_a_question_in_progress() {
    let mut controller = in_game();
    assert_eq!(
        controller.handle(Input::Hotkey(HotkeyEvent::ToggleMute)),
        [Effect::Engine(EngineCommand::Conversation(false))]
    );
    assert_eq!(controller.snapshot().state, VoiceState::Muted);
    assert!(controller.snapshot().muted);
    // Push-to-talk does nothing while muted.
    assert_eq!(
        controller.handle(Input::Hotkey(HotkeyEvent::PushToTalk(true))),
        NOTHING
    );
    // A recording that finished as mute was pressed is never sent.
    assert_eq!(
        controller.handle(Input::Engine(EngineEvent::Utterance(utterance(
            Trigger::Wake
        )))),
        [Effect::Engine(EngineCommand::FinishTurn)]
    );
    assert_eq!(
        controller.handle(Input::Window(VoiceCommand::SetMuted { muted: false })),
        [Effect::Engine(EngineCommand::Conversation(true))]
    );
}

#[test]
fn muting_while_push_to_talk_is_held_releases_it() {
    let mut controller = in_game();
    controller.handle(Input::Hotkey(HotkeyEvent::PushToTalk(true)));
    assert_eq!(
        controller.handle(Input::Window(VoiceCommand::SetMuted { muted: true })),
        [
            Effect::Engine(EngineCommand::PushToTalk(false)),
            Effect::Engine(EngineCommand::Conversation(false))
        ]
    );
}

#[test]
fn talking_over_the_answer_cuts_it_off() {
    let mut controller = in_game();
    controller.handle(Input::Engine(EngineEvent::Utterance(utterance(
        Trigger::Wake,
    ))));
    controller.handle(event(VoiceTurnEvent::Audio {
        sequence: 0,
        encoding: SpeechEncoding::PcmS16le,
        sample_rate_hz: 24_000,
        base64: "AQA=".to_owned(),
    }));
    assert_eq!(
        controller.handle(Input::Hotkey(HotkeyEvent::PushToTalk(true))),
        [
            Effect::StopPlayback,
            Effect::Engine(EngineCommand::FinishTurn),
            Effect::Engine(EngineCommand::PushToTalk(true))
        ]
    );
}

#[test]
fn a_failed_microphone_shows_an_error_until_the_next_game() {
    let mut controller = in_game();
    assert_eq!(
        controller.handle(Input::Engine(EngineEvent::Failed(
            "no default input device".to_owned()
        ))),
        NOTHING
    );
    controller.handle(Input::Engine(EngineEvent::State {
        state: scout_voice::VoiceState::Idle,
        microphone_open: false,
    }));
    let snapshot = controller.snapshot();
    assert_eq!(snapshot.state, VoiceState::Error);
    assert_eq!(
        snapshot.detail.as_deref(),
        Some("The microphone stopped: no default input device")
    );
    controller.handle(Input::Phase(GameflowPhase::EndOfGame));
    assert_eq!(
        controller.handle(Input::Phase(GameflowPhase::GameStart)),
        [Effect::Engine(EngineCommand::Conversation(true))]
    );
}

#[test]
fn models_that_fail_to_load_leave_voice_unavailable() {
    let (mut controller, _) = Controller::new(Ok(agreed()));
    controller.handle(Input::Engine(EngineEvent::Failed(
        "voice model file is missing: kws/encoder.onnx".to_owned(),
    )));
    assert_eq!(
        controller.handle(Input::Phase(GameflowPhase::InProgress)),
        NOTHING
    );
    let snapshot = controller.snapshot();
    assert_eq!(snapshot.state, VoiceState::Error);
    assert_eq!(
        snapshot.detail.as_deref(),
        Some(
            "Voice could not start on this computer: voice model file is missing: kws/encoder.onnx"
        )
    );
}

#[test]
fn settings_change_only_when_the_keys_are_usable() {
    let mut controller = in_game();
    let bad = WireSettings {
        conversation_mode: true,
        push_to_talk: true,
        push_to_talk_key: "F9".to_owned(),
        mute_key: "F9".to_owned(),
    };
    assert_eq!(
        controller.handle(Input::Window(VoiceCommand::SetSettings { settings: bad })),
        NOTHING
    );
    assert_eq!(
        controller.snapshot().detail.as_deref(),
        Some("Push-to-talk and mute need different keys.")
    );
    let good = WireSettings {
        conversation_mode: false,
        push_to_talk: true,
        push_to_talk_key: "Alt+KeyV".to_owned(),
        mute_key: "F9".to_owned(),
    };
    let effects = controller.handle(Input::Window(VoiceCommand::SetSettings {
        settings: good.clone(),
    }));
    assert_eq!(
        effects,
        [
            Effect::Save(VoiceSettings {
                consent: Some(true),
                conversation_mode: false,
                push_to_talk: true,
                push_to_talk_key: "Alt+KeyV".to_owned(),
                mute_key: "F9".to_owned(),
            }),
            Effect::Bind(HotkeyBindings {
                push_to_talk: Some("Alt+KeyV".to_owned()),
                mute: Some("F9".to_owned()),
            }),
            // Conversation mode off closes the microphone mid-game.
            Effect::Engine(EngineCommand::Conversation(false)),
        ]
    );
    assert_eq!(controller.snapshot().settings, Some(good));
    assert_eq!(controller.snapshot().detail, None);
}

#[test]
fn a_key_that_cannot_be_registered_is_shown() {
    let mut controller = in_game();
    controller.handle(Input::Hotkey(HotkeyEvent::BindFailed(
        "Scout could not use F8 as the push-to-talk key: in use".to_owned(),
    )));
    assert_eq!(
        controller.snapshot().detail.as_deref(),
        Some("Scout could not use F8 as the push-to-talk key: in use")
    );
}

#[test]
fn an_unreadable_settings_file_keeps_voice_off_and_unbound() {
    let (mut controller, effects) = Controller::new(Err("settings file is not valid".to_owned()));
    assert_eq!(effects, [Effect::Bind(HotkeyBindings::default())]);
    assert_eq!(
        controller.handle(Input::Window(VoiceCommand::Consent { accepted: true })),
        NOTHING
    );
    assert_eq!(
        controller.handle(Input::Phase(GameflowPhase::InProgress)),
        NOTHING
    );
    let snapshot = controller.snapshot();
    assert_eq!(snapshot.state, VoiceState::Error);
    assert_eq!(
        snapshot.detail.as_deref(),
        Some("Voice is off: Scout could not read its settings (settings file is not valid).")
    );
}

/// A proactive answer's speech: `samples` 16-bit samples of silence.
#[cfg(scout_proactive_coach)]
fn proactive_speech(samples: usize) -> scout_explore_client::proactive::ProactiveSpeech {
    scout_explore_client::proactive::ProactiveSpeech {
        message_id: Uuid::from_u128(0xa2),
        spoken_text: "Zed finished Eclipse.".to_owned(),
        sample_rate_hz: 24_000,
        pcm: vec![0; samples * 2],
    }
}

#[cfg(scout_proactive_coach)]
const RUN: Uuid = Uuid::from_u128(0xa1);

#[cfg(scout_proactive_coach)]
#[test]
fn a_proactive_answer_is_spoken_in_conversation_mode_labelled_as_scouts_own() {
    let mut controller = in_game();
    // The microphone closes while Scout says it.
    assert_eq!(
        controller.handle(Input::ProactiveAnswer(RUN)),
        [
            Effect::FetchProactiveSpeech(RUN),
            Effect::Engine(EngineCommand::Conversation(false))
        ]
    );
    assert_eq!(controller.snapshot().state, VoiceState::Thinking);
    assert_eq!(
        controller.turn_view(),
        Some(VoiceTurnView {
            app_initiated: true,
            ..VoiceTurnView::default()
        })
    );
    assert_eq!(
        controller.handle(Input::ProactiveSpeech(Ok(proactive_speech(4)))),
        [
            Effect::Play {
                sample_rate_hz: 24_000,
                pcm: vec![0; 4]
            },
            Effect::AwaitDrain
        ]
    );
    assert_eq!(controller.snapshot().state, VoiceState::Speaking);
    let view = controller.turn_view();
    assert_eq!(
        view.as_ref().and_then(|view| view.answer.as_deref()),
        Some("Zed finished Eclipse.")
    );
    assert!(view.is_some_and(|view| view.app_initiated && view.heard.is_none()));
    // Once it has played, listening resumes; no engine turn was held.
    assert_eq!(
        controller.handle(Input::Drained),
        [Effect::Engine(EngineCommand::Conversation(true))]
    );
}

#[cfg(scout_proactive_coach)]
#[test]
fn a_proactive_answer_is_not_spoken_muted_or_outside_conversation_mode() {
    let mut muted = in_game();
    muted.handle(Input::Window(VoiceCommand::SetMuted { muted: true }));
    assert_eq!(muted.handle(Input::ProactiveAnswer(RUN)), NOTHING);

    let (mut off, _) = Controller::new(Ok(VoiceSettings {
        conversation_mode: false,
        ..agreed()
    }));
    off.handle(Input::Engine(EngineEvent::Ready));
    off.handle(Input::Phase(GameflowPhase::InProgress));
    assert_eq!(off.handle(Input::ProactiveAnswer(RUN)), NOTHING);

    let (mut declined, _) = Controller::new(Ok(VoiceSettings {
        consent: Some(false),
        ..VoiceSettings::default()
    }));
    declined.handle(Input::Phase(GameflowPhase::InProgress));
    assert_eq!(declined.handle(Input::ProactiveAnswer(RUN)), NOTHING);

    let mut after = in_game();
    after.handle(Input::Phase(GameflowPhase::EndOfGame));
    assert_eq!(after.handle(Input::ProactiveAnswer(RUN)), NOTHING);
    assert_eq!(after.turn_view(), None);
}

#[cfg(scout_proactive_coach)]
#[test]
fn a_proactive_answer_never_joins_a_question_of_the_players() {
    let mut controller = in_game();
    controller.handle(Input::Engine(EngineEvent::Utterance(utterance(
        Trigger::Wake,
    ))));
    assert_eq!(controller.snapshot().state, VoiceState::Thinking);
    // The player's turn is running: Scout keeps its note to the window.
    assert_eq!(controller.handle(Input::ProactiveAnswer(RUN)), NOTHING);
    assert!(
        controller
            .turn_view()
            .is_some_and(|view| !view.app_initiated)
    );

    // While the player is talking, too.
    let mut talking = in_game();
    talking.handle(Input::Engine(EngineEvent::State {
        state: scout_voice::VoiceState::Capturing {
            trigger: Trigger::Wake,
            verified: true,
        },
        microphone_open: true,
    }));
    assert_eq!(talking.handle(Input::ProactiveAnswer(RUN)), NOTHING);
}

#[cfg(scout_proactive_coach)]
#[test]
fn the_players_push_to_talk_or_mute_cuts_scout_off() {
    let mut controller = in_game();
    controller.handle(Input::ProactiveAnswer(RUN));
    controller.handle(Input::ProactiveSpeech(Ok(proactive_speech(4))));
    let effects = controller.handle(Input::Hotkey(HotkeyEvent::PushToTalk(true)));
    assert_eq!(
        effects,
        [
            Effect::StopPlayback,
            Effect::Engine(EngineCommand::PushToTalk(true)),
            Effect::Engine(EngineCommand::Conversation(true))
        ]
    );
    assert_eq!(controller.snapshot().state, VoiceState::Listening);

    let mut muting = in_game();
    muting.handle(Input::ProactiveAnswer(RUN));
    let effects = muting.handle(Input::Window(VoiceCommand::SetMuted { muted: true }));
    assert!(effects.contains(&Effect::StopPlayback));
    // Speech that arrives after being cut off is not played.
    assert_eq!(
        muting.handle(Input::ProactiveSpeech(Ok(proactive_speech(4)))),
        NOTHING
    );
}

#[cfg(scout_proactive_coach)]
#[test]
fn speech_that_could_not_be_had_says_nothing_and_listening_resumes() {
    let mut controller = in_game();
    controller.handle(Input::ProactiveAnswer(RUN));
    assert_eq!(
        controller.handle(Input::ProactiveSpeech(Err("budget".to_owned()))),
        [Effect::Engine(EngineCommand::Conversation(true))]
    );
    assert_eq!(controller.turn_view(), None);
    assert_eq!(controller.snapshot().state, VoiceState::Listening);
}
