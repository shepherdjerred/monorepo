//! The overlay's state machine: what is on screen and why.
//!
//! The controller is pure. The caller passes the clock (`now_ms`, any
//! monotonic millisecond count) and reads an [`OverlayView`] back; there are
//! no threads, timers, or platform calls here, so every transition is
//! deterministic.
//!
//! Rules:
//! - The overlay is visible only while the game is in progress and a card is
//!   queued. When the game ends everything is torn down and the queue is
//!   emptied.
//! - Before the game starts only a `pregame_plan` card is accepted, so it is
//!   ready when the game begins. Any other card outside a game is refused
//!   rather than shown stale later.
//! - A `proactive` card is accepted only when the [`ProactivePolicy`] passed
//!   in allows it. [`ProactivePolicy::production`] never does.
//! - The overlay is click-through and never takes focus. The only input is
//!   a [`HotkeyEvent`].
//! - The shown card is the highest priority, oldest first, unless a
//!   [`HotkeyEvent::Next`] moved the selection. Cards expire after their TTL
//!   and the queue is bounded.

use thiserror::Error;

use crate::card::{CardError, CardKind, OverlayCard};

/// Whether `proactive` cards may be shown.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ProactivePolicy {
    allowed: bool,
}

impl ProactivePolicy {
    /// The production policy: proactive cards are never shown.
    #[must_use]
    pub const fn production() -> Self {
        Self { allowed: false }
    }

    /// A policy that admits proactive cards, for the beta gate and for tests.
    #[must_use]
    pub const fn allowing() -> Self {
        Self { allowed: true }
    }

    /// Whether a proactive card is admitted.
    #[must_use]
    pub const fn allows(&self) -> bool {
        self.allowed
    }
}

/// The only way a player interacts with the overlay.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HotkeyEvent {
    /// Remove the shown card.
    Dismiss,
    /// Show or hide the shown card's detail.
    Expand,
    /// Move to the next queued card, wrapping around.
    Next,
}

/// Controller tuning.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ControllerConfig {
    /// Cards held at once; the lowest priority, oldest card is dropped first.
    pub max_queued: usize,
}

impl Default for ControllerConfig {
    fn default() -> Self {
        Self { max_queued: 8 }
    }
}

/// Why a card was not queued.
#[derive(Debug, Error, PartialEq, Eq)]
pub enum OfferError {
    /// The card breaks the contract.
    #[error(transparent)]
    Invalid(#[from] CardError),
    /// A proactive card, and the policy does not allow them.
    #[error("proactive cards are not allowed")]
    ProactiveNotAllowed,
    /// Outside a game only a pregame plan is accepted.
    #[error("the game is not in progress")]
    NotInGame,
    /// The queue was full of cards that outrank this one.
    #[error("the queue is full of higher-priority cards")]
    QueueFull,
}

/// What the window should draw right now.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OverlayView<'a> {
    /// Whether the overlay window should exist at all.
    pub visible: bool,
    /// Whether mouse input passes through the window. Always true.
    pub click_through: bool,
    /// The shown card.
    pub card: Option<&'a OverlayCard>,
    /// Whether the shown card is expanded.
    pub expanded: bool,
    /// Cards queued, the shown one included.
    pub queued: usize,
}

#[derive(Debug, Clone)]
struct Entry {
    card: OverlayCard,
    expires_at_ms: u64,
    seq: u64,
}

/// The overlay state machine.
#[derive(Debug, Clone)]
pub struct OverlayController {
    policy: ProactivePolicy,
    config: ControllerConfig,
    in_game: bool,
    /// Sorted: highest priority first, then oldest.
    entries: Vec<Entry>,
    next_seq: u64,
    selected: Option<String>,
    expanded_for: Option<String>,
}

impl OverlayController {
    /// A controller with no game in progress and no cards.
    #[must_use]
    pub const fn new(policy: ProactivePolicy, config: ControllerConfig) -> Self {
        Self {
            policy,
            config,
            in_game: false,
            entries: Vec::new(),
            next_seq: 0,
            selected: None,
            expanded_for: None,
        }
    }

    /// Tell the controller whether the gameflow phase is `InProgress`.
    /// Leaving the game tears everything down.
    pub fn set_in_game(&mut self, in_game: bool, now_ms: u64) {
        self.expire(now_ms);
        if self.in_game && !in_game {
            self.entries.clear();
            self.selected = None;
            self.expanded_for = None;
        }
        self.in_game = in_game;
    }

    /// Queue a card.
    ///
    /// # Errors
    /// [`OfferError`] when the card is invalid, proactive without permission,
    /// offered outside a game when it is not a pregame plan, or outranked by
    /// a full queue.
    pub fn offer(&mut self, card: OverlayCard, now_ms: u64) -> Result<(), OfferError> {
        self.expire(now_ms);
        card.validate()?;
        if card.kind == CardKind::Proactive && !self.policy.allows() {
            return Err(OfferError::ProactiveNotAllowed);
        }
        if !self.in_game && card.kind != CardKind::PregamePlan {
            return Err(OfferError::NotInGame);
        }
        self.entries.retain(|entry| entry.card.id != card.id);
        let id = card.id.clone();
        self.next_seq += 1;
        self.entries.push(Entry {
            expires_at_ms: now_ms.saturating_add(u64::from(card.ttl_secs) * 1000),
            seq: self.next_seq,
            card,
        });
        self.entries.sort_by(|a, b| {
            b.card
                .priority
                .cmp(&a.card.priority)
                .then(a.seq.cmp(&b.seq))
        });
        if self.entries.len() > self.config.max_queued
            && let Some(dropped) = self.entries.pop()
            && dropped.card.id == id
        {
            return Err(OfferError::QueueFull);
        }
        Ok(())
    }

    /// Apply a hotkey. Returns whether it did anything: with no card shown,
    /// every hotkey is ignored.
    pub fn handle(&mut self, event: HotkeyEvent, now_ms: u64) -> bool {
        self.expire(now_ms);
        let Some(active) = self.active_index() else {
            return false;
        };
        match event {
            HotkeyEvent::Dismiss => {
                let removed = self.entries.remove(active);
                self.selected = None;
                if self.expanded_for.as_deref() == Some(removed.card.id.as_str()) {
                    self.expanded_for = None;
                }
            }
            HotkeyEvent::Expand => {
                let id = self.entries[active].card.id.clone();
                self.expanded_for = if self.expanded_for.as_deref() == Some(id.as_str()) {
                    None
                } else {
                    Some(id)
                };
            }
            HotkeyEvent::Next => {
                let next = (active + 1) % self.entries.len();
                self.selected = Some(self.entries[next].card.id.clone());
            }
        }
        true
    }

    /// Drop expired cards.
    pub fn tick(&mut self, now_ms: u64) {
        self.expire(now_ms);
    }

    /// What to draw, as of the last call that took a clock.
    #[must_use]
    pub fn view(&self) -> OverlayView<'_> {
        let card = self.active_index().map(|index| &self.entries[index].card);
        OverlayView {
            visible: self.in_game && card.is_some(),
            click_through: true,
            expanded: card
                .is_some_and(|card| self.expanded_for.as_deref() == Some(card.id.as_str())),
            card: if self.in_game { card } else { None },
            queued: self.entries.len(),
        }
    }

    fn active_index(&self) -> Option<usize> {
        if !self.in_game || self.entries.is_empty() {
            return None;
        }
        let selected = self
            .selected
            .as_ref()
            .and_then(|id| self.entries.iter().position(|entry| &entry.card.id == id));
        Some(selected.unwrap_or(0))
    }

    fn expire(&mut self, now_ms: u64) {
        self.entries.retain(|entry| entry.expires_at_ms > now_ms);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::card::CardPriority;

    fn card(id: &str, kind: CardKind, priority: CardPriority, ttl_secs: u32) -> OverlayCard {
        OverlayCard {
            id: id.to_owned(),
            kind,
            title: id.to_owned(),
            lines: vec!["line".to_owned()],
            priority,
            ttl_secs,
        }
    }

    fn answer(id: &str, priority: CardPriority) -> OverlayCard {
        card(id, CardKind::Answer, priority, 60)
    }

    fn in_game(policy: ProactivePolicy) -> OverlayController {
        let mut controller = OverlayController::new(policy, ControllerConfig::default());
        controller.set_in_game(true, 0);
        controller
    }

    fn shown(controller: &OverlayController) -> Option<&str> {
        controller.view().card.map(|card| card.id.as_str())
    }

    #[test]
    fn nothing_is_visible_until_a_card_arrives_in_a_game() {
        let mut controller =
            OverlayController::new(ProactivePolicy::production(), ControllerConfig::default());
        assert!(!controller.view().visible);
        controller.set_in_game(true, 0);
        assert!(!controller.view().visible);
        assert_eq!(
            controller.offer(answer("a", CardPriority::Normal), 0),
            Ok(())
        );
        let view = controller.view();
        assert!(view.visible && view.click_through && !view.expanded);
        assert_eq!(view.queued, 1);
    }

    #[test]
    fn a_pregame_plan_waits_for_the_game_and_other_cards_are_refused_outside_one() {
        let mut controller =
            OverlayController::new(ProactivePolicy::production(), ControllerConfig::default());
        assert_eq!(
            controller.offer(answer("a", CardPriority::Normal), 0),
            Err(OfferError::NotInGame)
        );
        let plan = card("plan", CardKind::PregamePlan, CardPriority::Normal, 120);
        assert_eq!(controller.offer(plan, 0), Ok(()));
        assert!(!controller.view().visible);
        controller.set_in_game(true, 1_000);
        assert_eq!(shown(&controller), Some("plan"));
    }

    #[test]
    fn leaving_the_game_tears_down_and_empties_the_queue() {
        let mut controller = in_game(ProactivePolicy::production());
        assert_eq!(
            controller.offer(answer("a", CardPriority::Normal), 0),
            Ok(())
        );
        controller.handle(HotkeyEvent::Expand, 0);
        controller.set_in_game(false, 5);
        let view = controller.view();
        assert!(!view.visible && view.card.is_none() && !view.expanded);
        assert_eq!(view.queued, 0);
        controller.set_in_game(true, 6);
        assert_eq!(controller.view().queued, 0);
    }

    #[test]
    fn proactive_cards_follow_the_policy() {
        let proactive = card("p", CardKind::Proactive, CardPriority::High, 20);
        let mut production = in_game(ProactivePolicy::production());
        assert!(!ProactivePolicy::production().allows());
        assert_eq!(
            production.offer(proactive.clone(), 0),
            Err(OfferError::ProactiveNotAllowed)
        );
        assert_eq!(production.view().queued, 0);
        let mut beta = in_game(ProactivePolicy::allowing());
        assert_eq!(beta.offer(proactive, 0), Ok(()));
        assert_eq!(shown(&beta), Some("p"));
    }

    #[test]
    fn invalid_cards_are_refused() {
        let mut controller = in_game(ProactivePolicy::production());
        let mut bad = answer("a", CardPriority::Normal);
        bad.lines.clear();
        assert!(matches!(
            controller.offer(bad, 0),
            Err(OfferError::Invalid(_))
        ));
    }

    #[test]
    fn priority_then_age_orders_the_queue() {
        let mut controller = in_game(ProactivePolicy::production());
        for (id, priority) in [
            ("old", CardPriority::Normal),
            ("new", CardPriority::Normal),
            ("low", CardPriority::Low),
        ] {
            assert_eq!(controller.offer(answer(id, priority), 0), Ok(()));
        }
        assert_eq!(shown(&controller), Some("old"));
        assert_eq!(
            controller.offer(answer("urgent", CardPriority::High), 0),
            Ok(())
        );
        assert_eq!(shown(&controller), Some("urgent"));
    }

    #[test]
    fn the_same_id_replaces_the_card() {
        let mut controller = in_game(ProactivePolicy::production());
        assert_eq!(controller.offer(answer("a", CardPriority::Low), 0), Ok(()));
        assert_eq!(controller.offer(answer("a", CardPriority::High), 0), Ok(()));
        assert_eq!(controller.view().queued, 1);
        assert_eq!(
            controller.view().card.map(|c| c.priority),
            Some(CardPriority::High)
        );
    }

    #[test]
    fn cards_expire_at_their_ttl() {
        let mut controller = in_game(ProactivePolicy::production());
        assert_eq!(
            controller.offer(card("a", CardKind::Answer, CardPriority::Normal, 10), 1_000),
            Ok(())
        );
        controller.tick(10_999);
        assert_eq!(shown(&controller), Some("a"));
        controller.tick(11_000);
        assert!(!controller.view().visible);
        assert_eq!(controller.view().queued, 0);
    }

    #[test]
    fn a_full_queue_drops_the_lowest_priority_oldest_card() {
        let mut controller = OverlayController::new(
            ProactivePolicy::production(),
            ControllerConfig { max_queued: 2 },
        );
        controller.set_in_game(true, 0);
        assert_eq!(
            controller.offer(answer("a", CardPriority::Normal), 0),
            Ok(())
        );
        assert_eq!(controller.offer(answer("b", CardPriority::Low), 0), Ok(()));
        assert_eq!(
            controller.offer(answer("c", CardPriority::Normal), 0),
            Ok(())
        );
        assert_eq!(controller.view().queued, 2);
        assert!(controller.handle(HotkeyEvent::Next, 0));
        assert_eq!(shown(&controller), Some("c"));
        assert_eq!(
            controller.offer(answer("d", CardPriority::Low), 0),
            Err(OfferError::QueueFull)
        );
        assert_eq!(controller.view().queued, 2);
    }

    #[test]
    fn dismiss_shows_the_next_card_and_next_wraps() {
        let mut controller = in_game(ProactivePolicy::production());
        for id in ["a", "b", "c"] {
            assert_eq!(
                controller.offer(answer(id, CardPriority::Normal), 0),
                Ok(())
            );
        }
        assert!(controller.handle(HotkeyEvent::Next, 0));
        assert_eq!(shown(&controller), Some("b"));
        assert!(controller.handle(HotkeyEvent::Next, 0));
        assert!(controller.handle(HotkeyEvent::Next, 0));
        assert_eq!(shown(&controller), Some("a"));
        assert!(controller.handle(HotkeyEvent::Dismiss, 0));
        assert_eq!(shown(&controller), Some("b"));
        assert_eq!(controller.view().queued, 2);
    }

    #[test]
    fn expand_toggles_and_follows_the_shown_card() {
        let mut controller = in_game(ProactivePolicy::production());
        for id in ["a", "b"] {
            assert_eq!(
                controller.offer(answer(id, CardPriority::Normal), 0),
                Ok(())
            );
        }
        assert!(controller.handle(HotkeyEvent::Expand, 0));
        assert!(controller.view().expanded);
        controller.handle(HotkeyEvent::Next, 0);
        assert!(!controller.view().expanded);
        controller.handle(HotkeyEvent::Next, 0);
        assert!(controller.view().expanded);
        controller.handle(HotkeyEvent::Expand, 0);
        assert!(!controller.view().expanded);
    }

    #[test]
    fn hotkeys_do_nothing_without_a_shown_card() {
        let mut controller =
            OverlayController::new(ProactivePolicy::production(), ControllerConfig::default());
        for event in [HotkeyEvent::Dismiss, HotkeyEvent::Expand, HotkeyEvent::Next] {
            assert!(!controller.handle(event, 0));
        }
        controller.set_in_game(true, 0);
        assert!(!controller.handle(HotkeyEvent::Dismiss, 0));
    }

    #[test]
    fn the_overlay_is_always_click_through() {
        let mut controller = in_game(ProactivePolicy::allowing());
        assert!(controller.view().click_through);
        assert_eq!(controller.offer(answer("a", CardPriority::High), 0), Ok(()));
        for event in [HotkeyEvent::Expand, HotkeyEvent::Next, HotkeyEvent::Dismiss] {
            controller.handle(event, 0);
            assert!(controller.view().click_through);
        }
    }

    #[test]
    fn seeded_random_sequences_keep_the_invariants() {
        let kinds = [
            CardKind::PregamePlan,
            CardKind::Answer,
            CardKind::Status,
            CardKind::Proactive,
            CardKind::ReviewReady,
        ];
        let priorities = [CardPriority::Low, CardPriority::Normal, CardPriority::High];
        let events = [HotkeyEvent::Dismiss, HotkeyEvent::Expand, HotkeyEvent::Next];
        for seed in 0..50 {
            let mut rng = fastrand::Rng::with_seed(seed);
            let mut controller = OverlayController::new(
                ProactivePolicy::production(),
                ControllerConfig { max_queued: 4 },
            );
            let mut now = 0_u64;
            for _ in 0..300 {
                now += rng.u64(0..4_000);
                match rng.u8(0..4) {
                    0 => controller.set_in_game(rng.bool(), now),
                    1 => {
                        let id = format!("c{}", rng.u8(0..6));
                        let card = card(
                            &id,
                            kinds[rng.usize(0..5)],
                            priorities[rng.usize(0..3)],
                            rng.u32(1..30),
                        );
                        let proactive = card.kind == CardKind::Proactive;
                        let result = controller.offer(card, now);
                        assert!(
                            !(proactive && result.is_ok()),
                            "production admitted a proactive card"
                        );
                    }
                    2 => {
                        controller.handle(events[rng.usize(0..3)], now);
                    }
                    _ => controller.tick(now),
                }
                let view = controller.view();
                assert!(view.click_through);
                assert!(view.queued <= 4);
                assert_eq!(view.visible, view.card.is_some());
                assert!(
                    view.card
                        .is_none_or(|card| card.kind != CardKind::Proactive)
                );
                assert!(!view.expanded || view.card.is_some());
            }
        }
    }
}
