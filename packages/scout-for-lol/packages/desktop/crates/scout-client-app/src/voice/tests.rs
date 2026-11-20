//! The voice service end to end, with fakes for every port: the engine
//! reports what the test says, the voice route answers with scripted
//! events, the speaker records what it was given, and the settings live in
//! memory. No device, thread or socket is opened; every wait has a deadline.

use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;

use scout_client_core::live::gameflow::GameflowPhase;
use scout_client_core::live::snapshot::{
    LiveGameInfo, LiveParticipant, LiveSnapshot, OwnStats, Team,
};
use scout_client_core::settings::VoiceSettings;
use scout_client_runtime::runtime::RuntimeState;
use scout_desktop_ipc::{
    ChatCommand, ChatParts, VoiceCommand, VoiceConsent, VoiceSnapshot, VoiceState, VoiceTurnView,
};
use scout_explore_client::relay::{ChatRelay, RelayCommand};
use scout_explore_client::voice::{
    SpeechEncoding, VoiceTrigger, VoiceTurnEvent, VoiceTurnOutcome, WakeVerification,
};
use scout_voice::{EndReason, EngineCommand, EngineEvent, SpeechOutput, Trigger, Utterance};
use tokio::sync::{mpsc, watch};
use uuid::Uuid;

use super::capture::SpokenTurn;
use super::controller::TurnUpdate;
use super::turns::{TurnHandle, TurnRunner};
use super::{EnginePort, EngineStarter, VoiceHandle, VoiceInputs, VoicePorts, VoiceStore, spawn};
use crate::hotkeys::{HotkeyBindings, HotkeyEvent, HotkeyPort};
use crate::supervisor::Control;

type TestResult = Result<(), Box<dyn std::error::Error>>;

const DEADLINE: Duration = Duration::from_secs(5);
const CONVERSATION: Uuid = Uuid::from_u128(0x0b5e_4a1c_7f00_4e5a_9c1d_2f3e_4a5b_6c7d);

fn read<T: Clone>(value: &Arc<Mutex<T>>) -> T {
    value.lock().unwrap_or_else(PoisonError::into_inner).clone()
}

/// Records commands; the test plays the engine's events through `events`.
#[derive(Clone, Default)]
struct FakeEngine {
    commands: Arc<Mutex<Vec<EngineCommand>>>,
    events: Arc<Mutex<Option<mpsc::UnboundedSender<EngineEvent>>>>,
    starts: Arc<Mutex<u32>>,
}

impl EnginePort for FakeEngine {
    fn send(&self, command: EngineCommand) {
        self.commands
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .push(command);
    }
}

impl EngineStarter for FakeEngine {
    fn start(&mut self, events: mpsc::UnboundedSender<EngineEvent>) -> Box<dyn EnginePort> {
        *self.starts.lock().unwrap_or_else(PoisonError::into_inner) += 1;
        *self.events.lock().unwrap_or_else(PoisonError::into_inner) = Some(events);
        Box::new(self.clone())
    }
}

impl FakeEngine {
    fn emit(&self, event: EngineEvent) -> TestResult {
        read(&self.events)
            .ok_or("the engine was never started")?
            .send(event)?;
        Ok(())
    }
}

/// What a spoken turn carried, without the recording itself.
#[derive(Debug, Clone, PartialEq)]
struct Asked {
    trigger: VoiceTrigger,
    conversation_id: Option<Uuid>,
    with_game: bool,
    duration_ms: u32,
}

/// Records each turn and hands the test its update channel.
#[derive(Clone, Default)]
struct FakeTurns {
    asked: Arc<Mutex<Vec<Asked>>>,
    updates: Arc<Mutex<Option<mpsc::UnboundedSender<TurnUpdate>>>>,
}

impl TurnRunner for FakeTurns {
    fn run(&self, turn: SpokenTurn, updates: mpsc::UnboundedSender<TurnUpdate>) -> TurnHandle {
        self.asked
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .push(Asked {
                trigger: turn.trigger,
                conversation_id: turn.conversation_id,
                with_game: turn.game.is_some(),
                duration_ms: turn.utterance.get().duration_ms(),
            });
        *self.updates.lock().unwrap_or_else(PoisonError::into_inner) = Some(updates);
        TurnHandle::detached()
    }
}

impl FakeTurns {
    fn answer(&self, event: VoiceTurnEvent) -> TestResult {
        read(&self.updates)
            .ok_or("no turn is running")?
            .send(TurnUpdate::Event(event))?;
        Ok(())
    }
}

/// Each chunk played: its rate and samples.
type Played = Arc<Mutex<Vec<(u32, Vec<i16>)>>>;

/// Records what it was asked to play; `pending` is what the test says.
#[derive(Clone, Default)]
struct FakeSpeaker {
    played: Played,
    pending: Arc<Mutex<Duration>>,
    stops: Arc<Mutex<u32>>,
}

impl SpeechOutput for FakeSpeaker {
    fn enqueue(&mut self, sample_rate_hz: u32, pcm: &[i16]) -> Result<(), scout_voice::VoiceError> {
        self.played
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .push((sample_rate_hz, pcm.to_vec()));
        Ok(())
    }

    fn pending(&self) -> Duration {
        read(&self.pending)
    }

    fn stop(&mut self) {
        *self.stops.lock().unwrap_or_else(PoisonError::into_inner) += 1;
    }
}

#[derive(Clone)]
struct MemoryStore(Arc<Mutex<Result<VoiceSettings, String>>>);

impl VoiceStore for MemoryStore {
    fn load(&self) -> Result<VoiceSettings, String> {
        read(&self.0)
    }

    fn save(&self, settings: &VoiceSettings) -> Result<(), String> {
        *self.0.lock().unwrap_or_else(PoisonError::into_inner) = Ok(settings.clone());
        Ok(())
    }
}

#[derive(Clone, Default)]
struct FakeHotkeys(Arc<Mutex<Vec<HotkeyBindings>>>);

impl HotkeyPort for FakeHotkeys {
    fn bind(&self, bindings: HotkeyBindings) {
        self.0
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .push(bindings);
    }
}

struct Harness {
    voice: VoiceHandle,
    engine: FakeEngine,
    turns: FakeTurns,
    speaker: FakeSpeaker,
    store: MemoryStore,
    hotkeys: FakeHotkeys,
    phase: watch::Sender<GameflowPhase>,
    keys: mpsc::UnboundedSender<HotkeyEvent>,
    control: mpsc::UnboundedReceiver<Control>,
    relayed: mpsc::UnboundedReceiver<RelayCommand>,
    snapshot: watch::Receiver<VoiceSnapshot>,
    turn: watch::Receiver<Option<VoiceTurnView>>,
    _state: watch::Sender<RuntimeState>,
    _parts: watch::Sender<ChatParts>,
}

fn live_snapshot() -> LiveSnapshot {
    LiveSnapshot {
        game: LiveGameInfo {
            mode: "CLASSIC".to_owned(),
            map: "Map11".to_owned(),
            game_time_secs: 600,
        },
        own: OwnStats {
            gold: 0,
            max_health: 1.0,
            health: 1.0,
            resource: "MANA".to_owned(),
            max_resource: 1.0,
            current_resource: 1.0,
            armor: 0.0,
            magic_resist: 0.0,
            attack_damage: 0.0,
            ability_power: 0.0,
            attack_speed: 1.0,
            move_speed: 340.0,
            crit_chance: 0.0,
        },
        participants: vec![LiveParticipant {
            team: Team::Order,
            is_self: true,
            champion: "Ahri".to_owned(),
            level: 9,
            kills: 3,
            deaths: 1,
            assists: 2,
            creep_score: 70,
            items: Vec::new(),
            summoner_spells: ["Flash".to_owned(), "Heal".to_owned()],
            keystone: None,
        }],
        event_count: 0,
        latest_event: None,
    }
}

fn start(stored: VoiceSettings) -> Harness {
    let engine = FakeEngine::default();
    let turns = FakeTurns::default();
    let speaker = FakeSpeaker::default();
    let store = MemoryStore(Arc::new(Mutex::new(Ok(stored))));
    let hotkeys = FakeHotkeys::default();
    let (phase, phase_receiver) = watch::channel(GameflowPhase::None);
    let mut runtime = RuntimeState::default();
    runtime.live_game = Some(live_snapshot());
    let (state, state_receiver) = watch::channel(runtime);
    let (keys, key_receiver) = mpsc::unbounded_channel();
    let (control_sender, control) = mpsc::unbounded_channel();
    let (relay, relayed, parts) = ChatRelay::detached();
    let mut open = ChatParts::default();
    open.status.open_conversation = Some(CONVERSATION);
    parts.send_replace(open);
    let voice = spawn(
        VoicePorts {
            engine: Box::new(engine.clone()),
            turns: Box::new(turns.clone()),
            speaker: Box::new(speaker.clone()),
            store: Box::new(store.clone()),
            hotkeys: Some(Box::new(hotkeys.clone())),
        },
        VoiceInputs {
            phase: phase_receiver,
            state: state_receiver,
            hotkeys: key_receiver,
            chat: Some(relay),
            control: control_sender,
        },
    );
    Harness {
        snapshot: voice.snapshot(),
        turn: voice.turn(),
        voice,
        engine,
        turns,
        speaker,
        store,
        hotkeys,
        phase,
        keys,
        control,
        relayed,
        _state: state,
        _parts: parts,
    }
}

impl Harness {
    async fn until_snapshot(
        &mut self,
        mut condition: impl FnMut(&VoiceSnapshot) -> bool,
    ) -> Result<VoiceSnapshot, Box<dyn std::error::Error>> {
        let snapshot = tokio::time::timeout(DEADLINE, self.snapshot.wait_for(|s| condition(s)))
            .await??
            .clone();
        Ok(snapshot)
    }

    async fn until(&self, mut condition: impl FnMut() -> bool) -> TestResult {
        tokio::time::timeout(DEADLINE, async {
            while !condition() {
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
        })
        .await?;
        Ok(())
    }

    fn engine_commands(&self) -> Vec<EngineCommand> {
        read(&self.engine.commands)
    }
}

fn agreed() -> VoiceSettings {
    VoiceSettings {
        consent: Some(true),
        ..VoiceSettings::default()
    }
}

#[tokio::test]
async fn the_first_game_asks_before_anything_listens_and_agreeing_starts_it() -> TestResult {
    let mut harness = start(VoiceSettings::default());
    harness.phase.send_replace(GameflowPhase::GameStart);
    let asked = harness.until_snapshot(|s| s.consent_requested).await?;
    assert_eq!(
        (asked.state, asked.consent),
        (VoiceState::Off, VoiceConsent::NotAsked)
    );
    // The window comes forward for the question; nothing has started.
    assert_eq!(
        tokio::time::timeout(DEADLINE, harness.control.recv()).await?,
        Some(Control::OpenWindow)
    );
    assert_eq!(read(&harness.engine.starts), 0);

    harness.voice.send(VoiceCommand::Consent { accepted: true });
    harness.until(|| read(&harness.engine.starts) == 1).await?;
    assert_eq!(read(&harness.store.0), Ok(agreed()));
    harness.engine.emit(EngineEvent::Ready)?;
    harness
        .until(|| harness.engine_commands() == [EngineCommand::Conversation(true)])
        .await?;
    harness.engine.emit(EngineEvent::State {
        state: scout_voice::VoiceState::Armed,
        microphone_open: true,
    })?;
    let listening = harness
        .until_snapshot(|s| s.state == VoiceState::Listening)
        .await?;
    assert_eq!(listening.consent, VoiceConsent::Accepted);
    assert!(!listening.consent_requested);
    // The keys were bound at start and again with the saved choice.
    assert_eq!(read(&harness.hotkeys.0).len(), 2);
    Ok(())
}

#[tokio::test]
async fn a_push_to_talk_question_is_sent_with_the_live_game_and_its_answer_plays() -> TestResult {
    let mut harness = start(VoiceSettings {
        conversation_mode: false,
        ..agreed()
    });
    harness.until(|| read(&harness.engine.starts) == 1).await?;
    harness.engine.emit(EngineEvent::Ready)?;
    harness.phase.send_replace(GameflowPhase::InProgress);
    harness.keys.send(HotkeyEvent::PushToTalk(true))?;
    harness
        .until(|| harness.engine_commands() == [EngineCommand::PushToTalk(true)])
        .await?;
    harness.keys.send(HotkeyEvent::PushToTalk(false))?;
    harness.engine.emit(EngineEvent::Utterance(Utterance {
        samples: vec![0.25; 32_000],
        trigger: Trigger::PushToTalk,
        reason: EndReason::PushToTalkReleased,
        wake_score: None,
    }))?;
    harness
        .until(|| !read(&harness.turns.asked).is_empty())
        .await?;
    assert_eq!(
        read(&harness.turns.asked),
        [Asked {
            trigger: VoiceTrigger::PushToTalk,
            conversation_id: Some(CONVERSATION),
            with_game: true,
            duration_ms: 2_000,
        }]
    );
    harness
        .until_snapshot(|s| s.state == VoiceState::Thinking)
        .await?;
    answer_and_play(&mut harness).await
}

/// Scout answers the question in flight aloud; the turn ends once the
/// answer has played, and chat opens the conversation that holds it.
async fn answer_and_play(harness: &mut Harness) -> TestResult {
    harness.turns.answer(VoiceTurnEvent::Transcript {
        text: "What should I build?".to_owned(),
        trigger: VoiceTrigger::PushToTalk,
        wake: WakeVerification::NotRequired,
    })?;
    harness.turns.answer(VoiceTurnEvent::Run {
        run_id: Uuid::from_u128(1),
        conversation_id: CONVERSATION,
        question_message_id: Uuid::from_u128(2),
    })?;
    harness.turns.answer(VoiceTurnEvent::Answer {
        message_id: Uuid::from_u128(3),
        text: "Zhonya's Hourglass.".to_owned(),
        spoken_text: "Zhonya's.".to_owned(),
    })?;
    *harness
        .speaker
        .pending
        .lock()
        .unwrap_or_else(PoisonError::into_inner) = Duration::from_millis(400);
    harness.turns.answer(VoiceTurnEvent::Audio {
        sequence: 0,
        encoding: SpeechEncoding::PcmS16le,
        sample_rate_hz: 24_000,
        base64: "AQD//w==".to_owned(),
    })?;
    harness.turns.answer(VoiceTurnEvent::Done {
        outcome: VoiceTurnOutcome::Succeeded,
    })?;
    harness
        .until_snapshot(|s| s.state == VoiceState::Speaking)
        .await?;
    assert_eq!(read(&harness.speaker.played), [(24_000, vec![1, -1])]);
    let view = tokio::time::timeout(
        DEADLINE,
        harness
            .turn
            .wait_for(|turn| turn.as_ref().is_some_and(|turn| turn.answer.is_some())),
    )
    .await??
    .clone();
    assert_eq!(
        view,
        Some(VoiceTurnView {
            heard: Some("What should I build?".to_owned()),
            answer: Some("Zhonya's Hourglass.".to_owned()),
            error: None,
        })
    );
    // The turn ends only once the answer has played out.
    assert!(
        !harness
            .engine_commands()
            .contains(&EngineCommand::FinishTurn)
    );
    *harness
        .speaker
        .pending
        .lock()
        .unwrap_or_else(PoisonError::into_inner) = Duration::ZERO;
    harness
        .until(|| {
            harness
                .engine_commands()
                .contains(&EngineCommand::FinishTurn)
        })
        .await?;
    // Chat shows the conversation that now holds the spoken turn.
    let opened = tokio::time::timeout(DEADLINE, harness.relayed.recv())
        .await?
        .ok_or("chat heard nothing")?;
    assert_eq!(
        opened.command,
        ChatCommand::Open {
            conversation_id: CONVERSATION
        }
    );
    Ok(())
}

#[tokio::test]
async fn a_tap_too_short_to_hold_a_question_never_reaches_scout() -> TestResult {
    let mut harness = start(agreed());
    harness.until(|| read(&harness.engine.starts) == 1).await?;
    harness.engine.emit(EngineEvent::Ready)?;
    harness.engine.emit(EngineEvent::Utterance(Utterance {
        samples: vec![0.25; 160],
        trigger: Trigger::PushToTalk,
        reason: EndReason::PushToTalkReleased,
        wake_score: None,
    }))?;
    let view = tokio::time::timeout(
        DEADLINE,
        harness
            .turn
            .wait_for(|turn| turn.as_ref().is_some_and(|turn| turn.error.is_some())),
    )
    .await??
    .clone();
    assert!(
        view.and_then(|view| view.error)
            .is_some_and(|error| error.contains("too short"))
    );
    assert_eq!(read(&harness.turns.asked), Vec::<Asked>::new());
    harness
        .until(|| {
            harness
                .engine_commands()
                .contains(&EngineCommand::FinishTurn)
        })
        .await?;
    Ok(())
}

#[tokio::test]
async fn the_mute_key_closes_the_microphone_mid_game() -> TestResult {
    let mut harness = start(agreed());
    harness.until(|| read(&harness.engine.starts) == 1).await?;
    harness.engine.emit(EngineEvent::Ready)?;
    harness.phase.send_replace(GameflowPhase::InProgress);
    harness
        .until(|| harness.engine_commands() == [EngineCommand::Conversation(true)])
        .await?;
    harness.keys.send(HotkeyEvent::ToggleMute)?;
    let muted = harness.until_snapshot(|s| s.muted).await?;
    assert_eq!(muted.state, VoiceState::Muted);
    harness
        .until(|| {
            harness.engine_commands()
                == [
                    EngineCommand::Conversation(true),
                    EngineCommand::Conversation(false),
                ]
        })
        .await?;
    // Unmuting from the window opens it again.
    harness.voice.send(VoiceCommand::SetMuted { muted: false });
    harness.until_snapshot(|s| !s.muted).await?;
    harness
        .until(|| {
            harness.engine_commands()
                == [
                    EngineCommand::Conversation(true),
                    EngineCommand::Conversation(false),
                    EngineCommand::Conversation(true),
                ]
        })
        .await?;
    Ok(())
}
