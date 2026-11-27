//! The in-game overlay, from the supervisor's side.
//!
//! When a game reaches `InProgress` the supervisor starts the overlay process
//! (this executable with `--overlay`, a GPUI pop-up in `scout-desktop-ui`) and
//! closes it when the game ends. The [`OverlayController`] lives here, not in
//! the overlay: the supervisor offers it cards from what the main window
//! already shows (the coach's game plan, the beta build's proactive answer,
//! and the spoken turn), applies the overlay hotkeys to it, expires cards on
//! its clock, and sends the overlay only the card to draw.
//!
//! The overlay is never the only place a card appears: the main window keeps
//! the coach panel and the voice strip whether or not the overlay runs. So an
//! overlay that cannot start, reports itself unavailable, or dies is recorded
//! and left down until the next game; nothing moves back.
//!
//! A post-game review that becomes ready after the game is held for the next
//! game's overlay as a `review_ready` card; the expand key on that card opens
//! the review in the main window.
//!
//! Proactive cards follow the build split: [`proactive_policy`] admits them
//! only in the beta profile, and a stable build has no proactive coach panel
//! to make one from.

use std::collections::HashMap;
use std::process::ExitStatus;
use std::sync::{Mutex, PoisonError};
use std::time::{Duration, Instant};

use scout_client_core::diagnostics::{
    DiagnosticCategory, DiagnosticEvent, DiagnosticLevel, DiagnosticOutcome, Diagnostics,
};
use scout_client_runtime::runtime::GameflowPhase;
use scout_desktop_ipc::{
    ChatCoachKind, ChatParts, ChatRole, OverlayCommand, OverlayFrame, OverlayKeys, OverlayReport,
    PROTOCOL_VERSION, VoiceState, VoiceTurnView, check_protocol, decode_line, encode_line,
};
use scout_overlay::text::{fit_lines, fit_title};
use scout_overlay::{
    CardKind, CardPriority, ControllerConfig, HotkeyEvent, OverlayCard, OverlayController,
    ProactivePolicy,
};
use sha2::{Digest as _, Sha256};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, Lines};
use tokio::process::{Child, ChildStdin, ChildStdout};
use uuid::Uuid;

use super::WindowLauncher;
use crate::hotkeys::{OverlayKey, OverlayKeyPort, overlay_accelerator};

/// How long a closing overlay gets to exit before it is killed.
const CLOSE_TIMEOUT: Duration = Duration::from_secs(5);
/// An overlay that cannot take a frame this long is hung.
const WRITE_TIMEOUT: Duration = Duration::from_secs(5);
/// How long to wait for buffered stdout reports after stdin breaks, so an
/// `Unavailable` report emitted right before exit wins over the broken-pipe
/// fallback without letting a wedged stdout stall the supervisor.
const DRAIN_TIMEOUT: Duration = Duration::from_millis(250);

/// How long each card stays queued.
const PLAN_TTL_SECS: u32 = 120;
const ANSWER_TTL_SECS: u32 = 60;
const STATUS_TTL_SECS: u32 = 30;
const REVIEW_TTL_SECS: u32 = 120;
#[cfg(scout_proactive_coach)]
const PROACTIVE_TTL_SECS: u32 = 30;

/// Whether this build's overlay may show proactive cards: only the beta
/// profile's. Riot's published policy prohibits unprompted alerts from live
/// game state, so a stable build never does.
#[must_use]
pub(super) const fn proactive_policy() -> ProactivePolicy {
    #[cfg(scout_proactive_coach)]
    {
        ProactivePolicy::allowing()
    }
    #[cfg(not(scout_proactive_coach))]
    {
        ProactivePolicy::production()
    }
}

/// Whether the overlay belongs on screen in `phase`: a game is being played.
/// `Reconnect` keeps it, so a dropped connection does not lose the queue.
const fn in_game(phase: &GameflowPhase) -> bool {
    matches!(phase, GameflowPhase::InProgress | GameflowPhase::Reconnect)
}

/// The overlay card for the coach panel, if it is one the overlay shows: the
/// game plan, or (beta only) what Scout noticed. Champion-select advice
/// stays in the main window.
#[must_use]
pub(super) fn coach_card(parts: &ChatParts) -> Option<OverlayCard> {
    let coach = parts.coach?;
    let (kind, title, priority, ttl_secs) = match coach.kind {
        ChatCoachKind::ChampSelect => return None,
        ChatCoachKind::Pregame => (
            CardKind::PregamePlan,
            "Your game plan",
            CardPriority::Normal,
            PLAN_TTL_SECS,
        ),
        #[cfg(scout_proactive_coach)]
        ChatCoachKind::Proactive => (
            CardKind::Proactive,
            "Scout noticed",
            CardPriority::Normal,
            PROACTIVE_TTL_SECS,
        ),
    };
    let transcript = parts
        .transcript
        .as_ref()
        .filter(|transcript| Some(transcript.conversation_id) == parts.status.open_conversation)?;
    let message = transcript
        .messages
        .iter()
        .find(|message| message.id == coach.message_id && message.role == ChatRole::Assistant)?;
    let lines = fit_lines(&message.content);
    (!lines.is_empty()).then(|| OverlayCard {
        id: format!("coach-{}", coach.message_id.simple()),
        kind,
        title: title.to_owned(),
        lines,
        priority,
        ttl_secs,
    })
}

/// The overlay card for the spoken turn: Scout thinking about the question,
/// its answer, or why it could not answer. A turn keeps one id from question
/// to answer, so the answer replaces the thinking card.
#[must_use]
pub(super) fn voice_card(state: VoiceState, turn: Option<&VoiceTurnView>) -> Option<OverlayCard> {
    let turn = turn?;
    // Scout speaking what it noticed is the proactive card's, not an answer.
    #[cfg(scout_proactive_coach)]
    if turn.app_initiated {
        return None;
    }
    let heard = turn.heard.as_deref()?;
    let digest = Sha256::digest(heard.as_bytes());
    let id = format!("voice-{}", hex::encode(&digest[..8]));
    let (kind, title, lines, priority, ttl_secs) = if let Some(answer) = &turn.answer {
        (
            CardKind::Answer,
            fit_title(heard)?,
            fit_lines(answer),
            CardPriority::High,
            ANSWER_TTL_SECS,
        )
    } else if let Some(error) = &turn.error {
        (
            CardKind::Status,
            "Scout couldn't answer".to_owned(),
            fit_lines(error),
            CardPriority::Normal,
            STATUS_TTL_SECS,
        )
    } else if state == VoiceState::Thinking {
        (
            CardKind::Status,
            "Scout is thinking".to_owned(),
            fit_lines(heard),
            CardPriority::Low,
            STATUS_TTL_SECS,
        )
    } else {
        return None;
    };
    (!lines.is_empty()).then_some(OverlayCard {
        id,
        kind,
        title,
        lines,
        priority,
        ttl_secs,
    })
}

/// Which spoken turns belong to the game being played. Voice keeps its last
/// turn across games, so the turn standing when a game's overlay begins is an
/// earlier game's and is not offered; any turn that differs from it is.
#[derive(Debug, Default)]
enum VoiceBaseline {
    /// No game yet, or the next observation sets the baseline.
    #[default]
    Unset,
    /// The turn as it stood when this game's overlay began.
    Turn(Option<VoiceTurnView>),
}

impl VoiceBaseline {
    /// Whether `turn` happened in this game. The first call of a game sets
    /// the baseline and admits nothing.
    fn admit(&mut self, turn: Option<&VoiceTurnView>) -> bool {
        match self {
            Self::Unset => {
                *self = Self::Turn(turn.cloned());
                false
            }
            Self::Turn(baseline) => baseline.as_ref() != turn,
        }
    }
}

/// The `review_ready` card for `match_id`'s review.
#[must_use]
pub(super) fn review_card(match_id: &str) -> OverlayCard {
    OverlayCard {
        id: format!("review-{match_id}"),
        kind: CardKind::ReviewReady,
        title: "Your last game's review is ready".to_owned(),
        lines: vec![format!(
            "Press {} to open it in Scout.",
            overlay_accelerator(OverlayKey::Expand)
        )],
        priority: CardPriority::Normal,
        ttl_secs: REVIEW_TTL_SECS,
    }
}

/// A ready review waiting for, or shown on, the overlay.
struct ReadyReview {
    card: OverlayCard,
    conversation_id: Uuid,
    offered: bool,
}

/// What the overlay process said or did.
pub(super) enum OverlayEvent {
    Report(OverlayReport),
    Unreadable(String),
    Exited(ExitStatus),
}

struct OverlayProcess {
    child: Child,
    stdin: Option<ChildStdin>,
    lines: Option<Lines<BufReader<ChildStdout>>>,
    greeted: bool,
}

/// The overlay for one supervisor run.
pub(super) struct OverlayHost {
    launcher: WindowLauncher,
    /// Behind a lock only so the supervisor stays `Sync`; one task uses it.
    keys: Option<Mutex<Box<dyn OverlayKeyPort>>>,
    controller: OverlayController,
    epoch: Instant,
    playing: bool,
    process: Option<OverlayProcess>,
    /// The overlay could not be shown this game; it stays down until the
    /// next one.
    down: bool,
    keys_bound: bool,
    /// Every card offered this game, by id, so an unchanged card is not
    /// offered again after the player dismissed it or it expired.
    offered: HashMap<String, OverlayCard>,
    /// The spoken turn this game began with, which is not this game's.
    voice_baseline: VoiceBaseline,
    /// The card the running overlay draws; a new overlay draws none.
    sent: Option<OverlayFrame>,
    /// The newest ready review, until a game's overlay has shown it.
    review: Option<ReadyReview>,
}

impl OverlayHost {
    /// An overlay started with `launcher`, holding its keys through `keys`.
    pub(super) fn new(launcher: WindowLauncher, keys: Option<Box<dyn OverlayKeyPort>>) -> Self {
        Self {
            launcher,
            keys: keys.map(Mutex::new),
            controller: OverlayController::new(proactive_policy(), ControllerConfig::default()),
            epoch: Instant::now(),
            playing: false,
            process: None,
            down: false,
            keys_bound: false,
            offered: HashMap::new(),
            voice_baseline: VoiceBaseline::Unset,
            sent: None,
            review: None,
        }
    }

    fn now_ms(&self) -> u64 {
        u64::try_from(self.epoch.elapsed().as_millis()).unwrap_or(u64::MAX)
    }

    /// Start the overlay when a game begins and close it when it ends.
    pub(super) async fn follow_phase(&mut self, phase: &GameflowPhase, diagnostics: &Diagnostics) {
        let playing = in_game(phase);
        let now = self.now_ms();
        self.controller.set_in_game(playing, now);
        if playing && !self.playing {
            self.playing = true;
            self.start(diagnostics).await;
            self.offer_review();
        } else if !playing && self.playing {
            self.playing = false;
            self.stop();
            self.offered.clear();
            self.voice_baseline = VoiceBaseline::Unset;
            self.down = false;
            // A review the last game showed is not raised again.
            self.review.take_if(|review| review.offered);
        }
    }

    /// A post-game review is ready: raise its card now if a game is being
    /// played, or at the start of the next one.
    pub(super) fn review_ready(&mut self, match_id: &str, conversation_id: Uuid) {
        self.review = Some(ReadyReview {
            card: review_card(match_id),
            conversation_id,
            offered: false,
        });
        self.offer_review();
    }

    fn offer_review(&mut self) {
        if !self.playing {
            return;
        }
        let now = self.now_ms();
        if let Some(review) = self.review.as_mut().filter(|review| !review.offered) {
            review.offered = true;
            if let Err(refused) = self.controller.offer(review.card.clone(), now) {
                tracing::info!(%refused, "the overlay did not queue the review card");
            }
        }
    }

    /// Offer the cards the main window's coach panel and voice strip hold
    /// now. Only new or changed cards are offered.
    pub(super) fn observe(
        &mut self,
        parts: Option<&ChatParts>,
        voice: Option<(VoiceState, Option<&VoiceTurnView>)>,
    ) {
        if !self.playing {
            return;
        }
        let voice = voice.filter(|(_, turn)| self.voice_baseline.admit(*turn));
        let cards = [
            parts.and_then(coach_card),
            voice.and_then(|(state, turn)| voice_card(state, turn)),
        ];
        let now = self.now_ms();
        for card in cards.into_iter().flatten() {
            if self.offered.get(&card.id) == Some(&card) {
                continue;
            }
            self.offered.insert(card.id.clone(), card.clone());
            if let Err(refused) = self.controller.offer(card, now) {
                tracing::info!(%refused, "the overlay did not queue a card");
            }
        }
    }

    /// Apply an overlay key. On a `review_ready` card the expand key opens
    /// the review instead: the card goes, and the conversation to open in the
    /// main window comes back.
    pub(super) fn hotkey(&mut self, key: OverlayKey) -> Option<Uuid> {
        let now = self.now_ms();
        self.controller.tick(now);
        let shown = self.controller.view().card.map(|card| card.id.clone());
        if key == OverlayKey::Expand
            && let Some(review) = self.review.as_ref()
            && shown.as_deref() == Some(review.card.id.as_str())
        {
            let conversation_id = review.conversation_id;
            self.controller.handle(HotkeyEvent::Dismiss, now);
            self.review = None;
            return Some(conversation_id);
        }
        let event = match key {
            OverlayKey::Dismiss => HotkeyEvent::Dismiss,
            OverlayKey::Next => HotkeyEvent::Next,
            OverlayKey::Expand => HotkeyEvent::Expand,
        };
        self.controller.handle(event, now);
        None
    }

    /// Expire cards on the clock.
    pub(super) fn tick(&mut self) {
        let now = self.now_ms();
        self.controller.tick(now);
    }

    /// The frame the overlay should hold now.
    fn frame(&self) -> Option<OverlayFrame> {
        let view = self.controller.view();
        let card = view.card.filter(|_| view.visible)?;
        Some(OverlayFrame {
            card: card.clone(),
            expanded: view.expanded,
            queued: u32::try_from(view.queued).unwrap_or(u32::MAX),
            keys: OverlayKeys {
                dismiss: overlay_accelerator(OverlayKey::Dismiss).to_owned(),
                next: overlay_accelerator(OverlayKey::Next).to_owned(),
                expand: overlay_accelerator(OverlayKey::Expand).to_owned(),
            },
        })
    }

    /// Send the overlay its frame, when it changed.
    pub(super) async fn flush(&mut self, diagnostics: &Diagnostics) {
        if self.process.is_none() {
            return;
        }
        let frame = self.frame();
        if self.sent == frame {
            return;
        }
        if self
            .write(&OverlayCommand::Frame {
                frame: frame.clone(),
            })
            .await
        {
            self.sent = frame;
        } else {
            self.drain_reports(diagnostics).await;
            if !self.down {
                self.fail(diagnostics, "the overlay stopped reading frames".to_owned());
            }
        }
    }

    async fn start(&mut self, diagnostics: &Diagnostics) {
        if self.down || self.process.is_some() {
            return;
        }
        let mut child = match self.launcher.spawn() {
            Ok(child) => child,
            Err(error) => {
                self.down = true;
                record(
                    diagnostics,
                    DiagnosticLevel::Warn,
                    DiagnosticOutcome::Failed,
                    format!("could not start the overlay: {error}"),
                );
                return;
            }
        };
        let (Some(stdin), Some(stdout)) = (child.stdin.take(), child.stdout.take()) else {
            self.down = true;
            record(
                diagnostics,
                DiagnosticLevel::Warn,
                DiagnosticOutcome::Failed,
                "the overlay started without piped stdio".to_owned(),
            );
            return;
        };
        self.process = Some(OverlayProcess {
            child,
            stdin: Some(stdin),
            lines: Some(BufReader::new(stdout).lines()),
            greeted: false,
        });
        self.sent = None;
        if !self
            .write(&OverlayCommand::Hello {
                protocol: PROTOCOL_VERSION,
            })
            .await
        {
            self.drain_reports(diagnostics).await;
            if !self.down {
                self.fail(diagnostics, "the overlay did not take its hello".to_owned());
            }
        }
    }

    /// Read any stdout lines the overlay emitted before its stdin closed, so an
    /// `Unavailable` report from a fast-exiting overlay is recorded instead of a
    /// generic broken-pipe failure.
    async fn drain_reports(&mut self, diagnostics: &Diagnostics) {
        let _ = tokio::time::timeout(DRAIN_TIMEOUT, async {
            while !self.down {
                let next = {
                    let Some(lines) = self
                        .process
                        .as_mut()
                        .and_then(|process| process.lines.as_mut())
                    else {
                        break;
                    };
                    lines.next_line().await
                };
                let event = match next {
                    Ok(Some(line)) => match decode_line::<OverlayReport>(&line) {
                        Ok(report) => OverlayEvent::Report(report),
                        Err(error) => OverlayEvent::Unreadable(error.to_string()),
                    },
                    Ok(None) => {
                        if let Some(process) = self.process.as_mut() {
                            process.lines = None;
                        }
                        break;
                    }
                    Err(error) => {
                        if let Some(process) = self.process.as_mut() {
                            process.lines = None;
                        }
                        OverlayEvent::Unreadable(format!("could not read the overlay: {error}"))
                    }
                };
                self.handle(event, diagnostics);
            }
        })
        .await;
    }

    /// Close the overlay. It is reaped in the background, so the end of a
    /// game never waits on it.
    pub(super) fn stop(&mut self) {
        self.bind_keys(false);
        self.sent = None;
        let Some(mut process) = self.process.take() else {
            return;
        };
        tokio::spawn(async move {
            if let Some(mut stdin) = process.stdin.take()
                && let Ok(line) = encode_line(&OverlayCommand::Close)
            {
                let _ = tokio::time::timeout(WRITE_TIMEOUT, stdin.write_all(line.as_bytes())).await;
            }
            if tokio::time::timeout(CLOSE_TIMEOUT, process.child.wait())
                .await
                .is_err()
            {
                let _ = process.child.start_kill();
                let _ = process.child.wait().await;
            }
        });
    }

    /// The overlay is down for the rest of this game.
    fn fail(&mut self, diagnostics: &Diagnostics, detail: String) {
        record(
            diagnostics,
            DiagnosticLevel::Warn,
            DiagnosticOutcome::Failed,
            detail,
        );
        self.down = true;
        if let Some(process) = self.process.as_mut() {
            let _ = process.child.start_kill();
        }
        self.stop();
    }

    fn bind_keys(&mut self, bound: bool) {
        if self.keys_bound != bound
            && let Some(keys) = &self.keys
        {
            keys.lock()
                .unwrap_or_else(PoisonError::into_inner)
                .bind_overlay(bound);
            self.keys_bound = bound;
        }
    }

    async fn write(&mut self, command: &OverlayCommand) -> bool {
        let Some(process) = self.process.as_mut() else {
            return false;
        };
        // An exited overlay cannot read, even if a concurrently forked child
        // briefly holds the pipe's read end open between `fork` and `exec`.
        if matches!(process.child.try_wait(), Ok(Some(_))) {
            process.stdin = None;
            return false;
        }
        let Some(stdin) = process.stdin.as_mut() else {
            return false;
        };
        let Ok(line) = encode_line(command) else {
            return false;
        };
        let written = tokio::time::timeout(WRITE_TIMEOUT, async {
            stdin.write_all(line.as_bytes()).await?;
            stdin.flush().await
        })
        .await;
        matches!(written, Ok(Ok(())))
    }

    /// Apply an overlay key and redraw. Returns the review to open, when the
    /// key opened one.
    pub(super) async fn press(
        host: &mut Option<Self>,
        key: OverlayKey,
        diagnostics: &Diagnostics,
    ) -> Option<Uuid> {
        let host = host.as_mut()?;
        let open = host.hotkey(key);
        host.flush(diagnostics).await;
        open
    }

    /// Act on what the overlay said or did, and redraw.
    pub(super) async fn react(
        host: &mut Option<Self>,
        event: OverlayEvent,
        diagnostics: &Diagnostics,
    ) {
        if let Some(host) = host.as_mut() {
            host.handle(event, diagnostics);
            host.flush(diagnostics).await;
        }
    }

    /// Expire cards on the clock, and redraw.
    pub(super) async fn refresh(host: &mut Option<Self>, diagnostics: &Diagnostics) {
        if let Some(host) = host.as_mut() {
            host.tick();
            host.flush(diagnostics).await;
        }
    }

    /// The overlay's next report, or its exit. Pending forever when none
    /// runs. Cancel-safe, so a `select!` losing this branch drops nothing.
    pub(super) async fn next_event(host: &mut Option<Self>) -> OverlayEvent {
        let Some(process) = host.as_mut().and_then(|host| host.process.as_mut()) else {
            return std::future::pending().await;
        };
        if let Some(lines) = process.lines.as_mut() {
            match lines.next_line().await {
                Ok(Some(line)) => {
                    return match decode_line::<OverlayReport>(&line) {
                        Ok(report) => OverlayEvent::Report(report),
                        Err(error) => OverlayEvent::Unreadable(error.to_string()),
                    };
                }
                Ok(None) => process.lines = None,
                Err(error) => {
                    process.lines = None;
                    return OverlayEvent::Unreadable(format!(
                        "could not read the overlay: {error}"
                    ));
                }
            }
        }
        match process.child.wait().await {
            Ok(status) => OverlayEvent::Exited(status),
            Err(error) => {
                tracing::warn!(%error, "could not wait for the Scout overlay");
                std::future::pending().await
            }
        }
    }

    /// Act on what the overlay said or did.
    pub(super) fn handle(&mut self, event: OverlayEvent, diagnostics: &Diagnostics) {
        match event {
            OverlayEvent::Report(OverlayReport::Hello { protocol }) => {
                if let Err(mismatch) = check_protocol(protocol) {
                    self.fail(diagnostics, mismatch.to_string());
                } else if let Some(process) = self.process.as_mut() {
                    process.greeted = true;
                }
            }
            OverlayEvent::Report(_) if !self.process.as_ref().is_some_and(|p| p.greeted) => {
                self.fail(
                    diagnostics,
                    "the overlay reported before its hello".to_owned(),
                );
            }
            OverlayEvent::Report(OverlayReport::Ready) => {
                record(
                    diagnostics,
                    DiagnosticLevel::Info,
                    DiagnosticOutcome::Succeeded,
                    "the overlay is on screen and click-through".to_owned(),
                );
                self.bind_keys(true);
            }
            OverlayEvent::Report(OverlayReport::Unavailable { reason }) => {
                self.fail(
                    diagnostics,
                    format!("the overlay is unavailable; cards stay in the main window: {reason}"),
                );
            }
            OverlayEvent::Unreadable(detail) => self.fail(diagnostics, detail),
            OverlayEvent::Exited(status) => {
                self.process = None;
                if self.playing && !self.down {
                    self.fail(
                        diagnostics,
                        format!("the overlay exited during the game ({status})"),
                    );
                } else {
                    self.bind_keys(false);
                }
            }
        }
    }
}

fn record(
    diagnostics: &Diagnostics,
    level: DiagnosticLevel,
    outcome: DiagnosticOutcome,
    detail: String,
) {
    diagnostics.record(
        DiagnosticEvent::new(level, DiagnosticCategory::Runtime, "overlay", outcome)
            .with_detail(detail),
    );
}

#[cfg(test)]
pub(super) mod tests {
    use scout_desktop_ipc::{
        ChatCoach, ChatMessage, ChatStatus, ChatTranscript, ChatVisuals, VoiceTurnView,
    };
    use uuid::Uuid;

    use super::*;

    const CONVERSATION: Uuid = Uuid::from_u128(1);
    const PLAN: Uuid = Uuid::from_u128(2);

    /// Chat parts whose coach panel shows `content` as a `kind` answer.
    pub(in crate::supervisor) fn parts_with_coach(kind: ChatCoachKind, content: &str) -> ChatParts {
        ChatParts {
            status: ChatStatus {
                open_conversation: Some(CONVERSATION),
                ..ChatStatus::default()
            },
            transcript: Some(ChatTranscript {
                conversation_id: CONVERSATION,
                title: "Coach".to_owned(),
                messages: vec![ChatMessage {
                    id: PLAN,
                    role: ChatRole::Assistant,
                    content: content.to_owned(),
                    tools: Vec::new(),
                    caveats: Vec::new(),
                    coach_options: Vec::new(),
                    visuals: ChatVisuals::default(),
                    version: None,
                    attachments: Vec::new(),
                }],
                web_url: "https://scout-for-lol.com/app/explore".to_owned(),
                share_url: None,
            }),
            coach: Some(ChatCoach {
                kind,
                message_id: PLAN,
            }),
            ..ChatParts::default()
        }
    }

    #[test]
    fn the_game_plan_becomes_a_pregame_card() {
        let parts = parts_with_coach(ChatCoachKind::Pregame, "## Plan\n- Farm bot\n- Ward river");
        let card = coach_card(&parts);
        assert_eq!(
            card.as_ref().map(|card| (card.kind, card.lines.clone())),
            Some((
                CardKind::PregamePlan,
                vec![
                    "Plan".to_owned(),
                    "Farm bot".to_owned(),
                    "Ward river".to_owned()
                ]
            ))
        );
        assert!(card.is_some_and(|card| card.validate().is_ok()));
    }

    #[test]
    fn champion_select_advice_stays_in_the_main_window() {
        let parts = parts_with_coach(ChatCoachKind::ChampSelect, "Pick Ahri");
        assert_eq!(coach_card(&parts), None);
    }

    #[test]
    fn a_coach_answer_outside_the_open_transcript_is_not_shown() {
        let mut parts = parts_with_coach(ChatCoachKind::Pregame, "Farm bot");
        parts.status.open_conversation = Some(Uuid::from_u128(9));
        assert_eq!(coach_card(&parts), None);
    }

    #[cfg(scout_proactive_coach)]
    #[test]
    fn the_beta_build_makes_a_proactive_card_from_what_scout_noticed() {
        let parts = parts_with_coach(ChatCoachKind::Proactive, "Their Jinx has 3 kills");
        assert_eq!(
            coach_card(&parts).map(|card| card.kind),
            Some(CardKind::Proactive)
        );
    }

    #[test]
    fn only_the_beta_build_admits_proactive_cards() {
        assert_eq!(proactive_policy().allows(), cfg!(scout_proactive_coach));
        let mut controller =
            OverlayController::new(proactive_policy(), ControllerConfig::default());
        controller.set_in_game(true, 0);
        let proactive = OverlayCard {
            id: "p".to_owned(),
            kind: CardKind::Proactive,
            title: "Scout noticed".to_owned(),
            lines: vec!["Their Jinx has 3 kills".to_owned()],
            priority: CardPriority::Normal,
            ttl_secs: 30,
        };
        assert_eq!(
            controller.offer(proactive, 0).is_ok(),
            cfg!(scout_proactive_coach)
        );
    }

    fn turn(answer: Option<&str>, error: Option<&str>) -> VoiceTurnView {
        VoiceTurnView {
            heard: Some("What should I build next?".to_owned()),
            answer: answer.map(str::to_owned),
            error: error.map(str::to_owned),
            #[cfg(scout_proactive_coach)]
            app_initiated: false,
        }
    }

    #[test]
    fn a_spoken_turn_goes_from_thinking_to_its_answer_under_one_id() -> Result<(), &'static str> {
        let thinking = voice_card(VoiceState::Thinking, Some(&turn(None, None)))
            .ok_or("thinking makes a card")?;
        let answered = voice_card(
            VoiceState::Speaking,
            Some(&turn(Some("Build **Zhonya's** next."), None)),
        )
        .ok_or("the answer makes a card")?;
        assert_eq!(thinking.id, answered.id);
        assert_eq!(
            (thinking.kind, thinking.title.as_str()),
            (CardKind::Status, "Scout is thinking")
        );
        assert_eq!(
            (answered.kind, answered.title.as_str()),
            (CardKind::Answer, "What should I build next?")
        );
        assert_eq!(answered.lines, ["Build Zhonya's next."]);
        assert!(answered.validate().is_ok() && thinking.validate().is_ok());
        Ok(())
    }

    #[test]
    fn a_failed_turn_says_so_and_a_quiet_microphone_shows_nothing() {
        let failed = voice_card(
            VoiceState::Listening,
            Some(&turn(None, Some("No connection"))),
        );
        assert_eq!(failed.map(|card| card.kind), Some(CardKind::Status));
        assert_eq!(
            voice_card(VoiceState::Listening, Some(&turn(None, None))),
            None
        );
        assert_eq!(voice_card(VoiceState::Thinking, None), None);
    }

    #[test]
    fn a_spoken_turn_from_an_earlier_game_is_not_offered_again() {
        let old = turn(Some("Build Zhonya's."), None);
        let mut baseline = VoiceBaseline::default();
        // The game starts while voice still holds the last game's answer.
        assert!(!baseline.admit(Some(&old)));
        assert!(!baseline.admit(Some(&old)));
        // A new question in this game is offered, and so is its answer.
        let asked = VoiceTurnView {
            heard: Some("Where is their jungler?".to_owned()),
            ..old.clone()
        };
        assert!(baseline.admit(Some(&asked)));
        // A game that starts with no turn offers the first one.
        let mut fresh = VoiceBaseline::default();
        assert!(!fresh.admit(None));
        assert!(fresh.admit(Some(&old)));
    }

    #[test]
    fn the_review_card_fits_the_contract_and_names_the_open_key() {
        let card = review_card("NA1_5654104474");
        assert!(card.validate().is_ok());
        assert_eq!(card.kind, CardKind::ReviewReady);
        assert_eq!(card.lines, ["Press Alt+F7 to open it in Scout."]);
    }

    #[test]
    fn the_overlay_belongs_to_a_game_being_played() {
        assert!(in_game(&GameflowPhase::InProgress));
        assert!(in_game(&GameflowPhase::Reconnect));
        for phase in [
            GameflowPhase::ChampSelect,
            GameflowPhase::GameStart,
            GameflowPhase::WaitingForStats,
            GameflowPhase::EndOfGame,
        ] {
            assert!(!in_game(&phase), "{phase:?}");
        }
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn broken_stdin_drains_buffered_unavailable_report_before_recording_write_failure()
    -> Result<(), Box<dyn std::error::Error>> {
        let script = format!(
            "printf '{{\"type\":\"hello\",\"protocol\":{PROTOCOL_VERSION}}}\\n'\n\
             printf '{{\"type\":\"unavailable\",\"reason\":\"no click-through\"}}\\n'\n\
             exec 0<&-\n\
             exit 0"
        );
        let launcher = WindowLauncher::new(
            std::path::PathBuf::from("sh"),
            vec!["-c".to_owned(), script],
        );
        let mut child = launcher.spawn()?;
        let stdin = child.stdin.take().ok_or("missing child stdin")?;
        let stdout = child.stdout.take().ok_or("missing child stdout")?;
        // Wait for the child to emit Hello + Unavailable and close stdin so the
        // subsequent Hello write is guaranteed to fail with EPIPE.
        let _ = child.wait().await?;

        let diagnostics = Diagnostics::in_memory();
        let mut host = OverlayHost::new(launcher, None);
        host.playing = true;
        host.process = Some(OverlayProcess {
            child,
            stdin: Some(stdin),
            lines: Some(BufReader::new(stdout).lines()),
            greeted: false,
        });

        assert!(
            !host
                .write(&OverlayCommand::Hello {
                    protocol: PROTOCOL_VERSION,
                })
                .await,
            "writing to an already-exited overlay stdin must fail"
        );
        host.drain_reports(&diagnostics).await;
        if !host.down {
            host.fail(
                &diagnostics,
                "the overlay did not take its hello".to_owned(),
            );
        }

        let summaries: Vec<String> = diagnostics
            .events()
            .iter()
            .map(DiagnosticEvent::summary)
            .collect();
        assert!(
            summaries
                .iter()
                .any(|summary| summary.contains("no click-through")),
            "expected unavailable reason in {summaries:?}"
        );
        assert!(
            !summaries
                .iter()
                .any(|summary| summary.contains("did not take its hello")),
            "broken-pipe fallback must not mask Unavailable: {summaries:?}"
        );
        assert!(host.down);
        Ok(())
    }
}
