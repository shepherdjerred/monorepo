//! Global push-to-talk and mute keys.
//!
//! `global-hotkey` needs the platform event loop: on Windows the thread that
//! created the manager must run a message loop, and on macOS the manager must
//! be created on the main thread. The supervisor's tray already runs a
//! windowless event loop on the main thread, so the manager lives there
//! ([`Registrar`], created by `tray::run`). The voice service asks for new
//! bindings through a [`HotkeyPort`]; key presses come back to it as
//! [`HotkeyEvent`]s on a channel.
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

    use super::{HotkeyBindings, HotkeyEvent, parse};

    /// The ids of the keys bound now, read by the event handler.
    #[derive(Debug, Default, Clone, Copy)]
    struct Bound {
        push_to_talk: Option<u32>,
        mute: Option<u32>,
    }

    /// The global-hotkey manager. Create and use it only on the event
    /// loop's thread.
    pub struct Registrar {
        manager: GlobalHotKeyManager,
        registered: Vec<HotKey>,
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
        /// Create the manager and route its events to `events`.
        ///
        /// # Errors
        ///
        /// The platform's refusal, as text.
        pub fn new(events: UnboundedSender<HotkeyEvent>) -> Result<Self, String> {
            let manager = GlobalHotKeyManager::new().map_err(|error| error.to_string())?;
            let bound = Arc::new(Mutex::new(Bound::default()));
            let handler_bound = Arc::clone(&bound);
            let handler_events = events.clone();
            GlobalHotKeyEvent::set_event_handler(Some(move |event: GlobalHotKeyEvent| {
                let bound = *handler_bound.lock().unwrap_or_else(PoisonError::into_inner);
                let pressed = event.state() == HotKeyState::Pressed;
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
                bound,
                events,
            })
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
            *self.bound.lock().unwrap_or_else(PoisonError::into_inner) = bound;
        }
    }

    impl Drop for Registrar {
        fn drop(&mut self) {
            GlobalHotKeyEvent::set_event_handler(None::<fn(GlobalHotKeyEvent)>);
            let _ = self.manager.unregister_all(&self.registered);
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
    fn push_to_talk_and_mute_need_different_keys() {
        assert_eq!(
            validate("F8", "f8"),
            Err("Push-to-talk and mute need different keys.".to_owned())
        );
    }
}
