//! Global push-to-talk and mute keys, and the in-game overlay's keys.
//!
//! `global-hotkey` needs the platform event loop: on Windows the thread that
//! created the manager must run a message loop, and on macOS the manager must
//! be created on the main thread. The supervisor's tray already runs a
//! windowless event loop on the main thread, so the manager lives there
//! ([`Registrar`], created by `tray::run`). The voice service asks for new
//! bindings through a [`HotkeyPort`]; key presses come back to it as
//! [`HotkeyEvent`]s on a channel.
//!
//! The overlay's three keys ([`OVERLAY_KEYS`]) are the only way to act on the
//! overlay, which never takes a click. They are registered only while the
//! overlay is on screen, through an [`OverlayKeyPort`], and a press goes to
//! the supervisor as [`crate::supervisor::Control::OverlayKey`].
//!
//! Keys are global-hotkey accelerators such as `F8`, `Shift+F8` or
//! `Alt+KeyV`. A global hotkey takes the key from every other app, League
//! included, so the defaults are keys League leaves unbound.

use global_hotkey::hotkey::HotKey;

/// A key press the voice service acts on.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HotkeyEvent {
    /// The push-to-talk key went down (`true`) or up (`false`).
    PushToTalk(bool),
    /// The mute key was pressed.
    ToggleMute,
    /// A binding could not be registered; safe to show.
    BindFailed(String),
}

/// An overlay key.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OverlayKey {
    /// Remove the shown card.
    Dismiss,
    /// Show the next queued card.
    Next,
    /// Show or hide the rest of the shown card.
    Expand,
}

/// The overlay's keys, beside the voice keys' default `F8`. Bound only while
/// the overlay is on screen, so they are the game's the rest of the time.
pub const OVERLAY_KEYS: [(OverlayKey, &str); 3] = [
    (OverlayKey::Dismiss, "F7"),
    (OverlayKey::Next, "Shift+F7"),
    (OverlayKey::Expand, "Alt+F7"),
];

/// The accelerator bound to `key`.
#[must_use]
pub fn overlay_accelerator(key: OverlayKey) -> &'static str {
    OVERLAY_KEYS
        .iter()
        .find(|(bound, _)| *bound == key)
        .map_or("", |(_, accelerator)| accelerator)
}

/// How the supervisor holds and releases the overlay's keys.
pub trait OverlayKeyPort: Send {
    /// Register the overlay's keys (`true`) or release them (`false`).
    fn bind_overlay(&self, bound: bool);
}

/// Which accelerators to register. `None` unbinds that action.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct HotkeyBindings {
    /// The push-to-talk key.
    pub push_to_talk: Option<String>,
    /// The mute key.
    pub mute: Option<String>,
}

/// Parse one accelerator.
///
/// # Errors
///
/// A message naming the key when global-hotkey cannot read it.
pub fn parse(accelerator: &str) -> Result<HotKey, String> {
    accelerator
        .parse::<HotKey>()
        .map_err(|error| format!("{accelerator:?} is not a key Scout can listen for: {error}"))
}

/// Check a pair of keys before they are saved: both must parse, and they must
/// differ.
///
/// # Errors
///
/// A message safe to show.
pub fn validate(push_to_talk: &str, mute: &str) -> Result<(), String> {
    let push_to_talk = parse(push_to_talk)?;
    let mute = parse(mute)?;
    if push_to_talk.id() == mute.id() {
        return Err("Push-to-talk and mute need different keys.".to_owned());
    }
    Ok(())
}

/// How the voice service changes the registered keys.
pub trait HotkeyPort: Send {
    /// Replace the registered keys. A failure arrives later as
    /// [`HotkeyEvent::BindFailed`].
    fn bind(&self, bindings: HotkeyBindings);
}

/// The manager and the keys it holds, on the event loop's thread.
#[cfg(any(target_os = "windows", target_os = "macos"))]
pub use registrar::Registrar;

#[cfg(any(target_os = "windows", target_os = "macos"))]
mod registrar {
    use std::sync::{Arc, Mutex, PoisonError};

    use global_hotkey::hotkey::HotKey;
    use global_hotkey::{GlobalHotKeyEvent, GlobalHotKeyManager, HotKeyState};
    use tokio::sync::mpsc::UnboundedSender;

    use super::{HotkeyBindings, HotkeyEvent, OVERLAY_KEYS, OverlayKey, parse};
    use crate::supervisor::Control;

    /// The ids of the keys bound now, read by the event handler.
    #[derive(Debug, Default, Clone)]
    struct Bound {
        push_to_talk: Option<u32>,
        mute: Option<u32>,
        overlay: Vec<(u32, OverlayKey)>,
    }

    /// The global-hotkey manager. Create and use it only on the event
    /// loop's thread.
    pub struct Registrar {
        manager: GlobalHotKeyManager,
        registered: Vec<HotKey>,
        overlay_registered: Vec<HotKey>,
        bound: Arc<Mutex<Bound>>,
        events: UnboundedSender<HotkeyEvent>,
    }

    impl std::fmt::Debug for Registrar {
        fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            formatter
                .debug_struct("Registrar")
                .field("registered", &self.registered.len())
                .finish_non_exhaustive()
        }
    }

    impl Registrar {
        /// Create the manager and route voice key events to `events` and
        /// overlay key presses to `control`.
        ///
        /// # Errors
        ///
        /// The platform's refusal, as text.
        pub fn new(
            events: UnboundedSender<HotkeyEvent>,
            control: UnboundedSender<Control>,
        ) -> Result<Self, String> {
            let manager = GlobalHotKeyManager::new().map_err(|error| error.to_string())?;
            let bound = Arc::new(Mutex::new(Bound::default()));
            let handler_bound = Arc::clone(&bound);
            let handler_events = events.clone();
            GlobalHotKeyEvent::set_event_handler(Some(move |event: GlobalHotKeyEvent| {
                let bound = handler_bound
                    .lock()
                    .unwrap_or_else(PoisonError::into_inner)
                    .clone();
                let pressed = event.state() == HotKeyState::Pressed;
                if let Some((_, key)) = bound.overlay.iter().find(|(id, _)| *id == event.id()) {
                    if pressed {
                        // The supervisor is gone only while Scout quits.
                        let _ = control.send(Control::OverlayKey(*key));
                    }
                    return;
                }
                let mapped = if Some(event.id()) == bound.push_to_talk {
                    Some(HotkeyEvent::PushToTalk(pressed))
                } else if Some(event.id()) == bound.mute && pressed {
                    Some(HotkeyEvent::ToggleMute)
                } else {
                    None
                };
                if let Some(mapped) = mapped {
                    // The voice service is gone only while Scout quits.
                    let _ = handler_events.send(mapped);
                }
            }));
            Ok(Self {
                manager,
                registered: Vec::new(),
                overlay_registered: Vec::new(),
                bound,
                events,
            })
        }

        /// Register the overlay's keys, or release them. A key that cannot be
        /// registered is logged and left unbound; the overlay's card still
        /// expires on its own.
        pub fn apply_overlay(&mut self, bound: bool) {
            if let Err(error) = self.manager.unregister_all(&self.overlay_registered) {
                tracing::warn!(%error, "could not release the overlay keys");
            }
            self.overlay_registered.clear();
            let mut ids = Vec::new();
            if bound {
                for (key, accelerator) in OVERLAY_KEYS {
                    match parse(accelerator).and_then(|hotkey| {
                        self.manager
                            .register(hotkey)
                            .map(|()| hotkey)
                            .map_err(|error| error.to_string())
                    }) {
                        Ok(hotkey) => {
                            ids.push((hotkey.id(), key));
                            self.overlay_registered.push(hotkey);
                        }
                        Err(error) => {
                            tracing::warn!(%error, accelerator, "could not register an overlay key");
                        }
                    }
                }
            }
            self.bound
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .overlay = ids;
        }

        /// Replace the registered keys with `bindings`. Each key that cannot
        /// be registered is reported and left unbound.
        pub fn apply(&mut self, bindings: &HotkeyBindings) {
            if let Err(error) = self.manager.unregister_all(&self.registered) {
                tracing::warn!(%error, "could not release the voice keys");
            }
            self.registered.clear();
            let mut bound = Bound::default();
            for (accelerator, slot, label) in [
                (
                    bindings.push_to_talk.as_deref(),
                    &mut bound.push_to_talk,
                    "push-to-talk",
                ),
                (bindings.mute.as_deref(), &mut bound.mute, "mute"),
            ] {
                let Some(accelerator) = accelerator else {
                    continue;
                };
                let registered = parse(accelerator).and_then(|hotkey| {
                    self.manager
                        .register(hotkey)
                        .map(|()| hotkey)
                        .map_err(|error| error.to_string())
                });
                match registered {
                    Ok(hotkey) => {
                        *slot = Some(hotkey.id());
                        self.registered.push(hotkey);
                    }
                    Err(error) => {
                        let _ = self.events.send(HotkeyEvent::BindFailed(format!(
                            "Scout could not use {accelerator} as the {label} key: {error}"
                        )));
                    }
                }
            }
            let mut held = self.bound.lock().unwrap_or_else(PoisonError::into_inner);
            held.push_to_talk = bound.push_to_talk;
            held.mute = bound.mute;
        }
    }

    impl Drop for Registrar {
        fn drop(&mut self) {
            GlobalHotKeyEvent::set_event_handler(None::<fn(GlobalHotKeyEvent)>);
            let _ = self.manager.unregister_all(&self.registered);
            let _ = self.manager.unregister_all(&self.overlay_registered);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{parse, validate};

    #[test]
    fn the_default_keys_and_common_choices_parse() {
        for accelerator in [
            "F8",
            "Shift+F8",
            "Alt+KeyV",
            "F10",
            "Shift+F10",
            "Backquote",
        ] {
            assert!(parse(accelerator).is_ok(), "{accelerator}");
        }
    }

    #[test]
    fn a_key_global_hotkey_cannot_read_is_refused_by_name() {
        let error = parse("Hyper+Q").err().unwrap_or_default();
        assert!(error.starts_with("\"Hyper+Q\" is not a key"), "{error}");
        assert!(validate("F8", "Shift+F8").is_ok());
        assert!(validate("F8", "Banana").is_err());
    }

    #[test]
    fn the_overlay_keys_parse_and_differ_from_each_other_and_the_voice_defaults() {
        use super::{OVERLAY_KEYS, OverlayKey, overlay_accelerator};
        use scout_client_core::settings::{DEFAULT_MUTE_KEY, DEFAULT_PUSH_TO_TALK_KEY};
        let mut ids = OVERLAY_KEYS
            .iter()
            .map(|(_, accelerator)| parse(accelerator).map(|hotkey| hotkey.id()))
            .collect::<Result<Vec<_>, _>>()
            .unwrap_or_default();
        for voice in [DEFAULT_PUSH_TO_TALK_KEY, DEFAULT_MUTE_KEY] {
            ids.extend(parse(voice).map(|hotkey| hotkey.id()));
        }
        let count = ids.len();
        ids.sort_unstable();
        ids.dedup();
        assert_eq!((count, ids.len()), (5, 5));
        assert_eq!(overlay_accelerator(OverlayKey::Next), "Shift+F7");
    }

    #[test]
    fn push_to_talk_and_mute_need_different_keys() {
        assert_eq!(
            validate("F8", "f8"),
            Err("Push-to-talk and mute need different keys.".to_owned())
        );
    }
}
