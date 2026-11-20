//! The supervisor's tray icon and the platform event loop it needs.
//!
//! `tray-icon` needs a running event loop: on Windows a message loop on the
//! thread that created the icon, on macOS the main thread's run loop. Neither
//! needs a window or a graphics context, so the supervisor runs a windowless
//! `winit` event loop on its main thread for the tray and does its own work on
//! another thread. On Linux the KSNI backend runs its own D-Bus thread, so no
//! event loop is needed there.
//!
//! The same loop holds the global push-to-talk and mute keys
//! ([`crate::hotkeys::Registrar`]), which need it for the same reason.

use scout_client_core::profile::ReleaseProfile;
use tokio::sync::mpsc::UnboundedSender;
use tray_icon::menu::{Menu, MenuEvent, MenuItem};
use tray_icon::{Icon, TrayIcon, TrayIconBuilder};

use crate::hotkeys::{HotkeyEvent, HotkeyPort};
use crate::supervisor::{Control, SupervisorExit};

/// What the platform event loop offers the supervisor.
pub struct TrayContext {
    /// Whether a tray icon exists.
    pub tray_available: bool,
    /// The global keys, when the event loop could create them.
    pub hotkeys: Option<Box<dyn HotkeyPort>>,
}

/// The supervisor's work, given what the event loop offers.
pub type Supervise = Box<dyn FnOnce(TrayContext) -> SupervisorExit + Send>;

/// Create the tray and the global keys and run `supervise` until it
/// returns. Key presses go to `hotkey_events`.
#[cfg(any(target_os = "windows", target_os = "macos"))]
pub fn run(
    control: UnboundedSender<Control>,
    hotkey_events: UnboundedSender<HotkeyEvent>,
    supervise: Supervise,
) -> SupervisorExit {
    use winit::event_loop::EventLoop;

    use shell::{Shell, ShellEvent};

    let mut builder = EventLoop::<ShellEvent>::with_user_event();
    // The supervisor has no window of its own, so it stays out of the Dock and
    // the app switcher; the window process is the app the user sees.
    #[cfg(target_os = "macos")]
    {
        use winit::platform::macos::{ActivationPolicy, EventLoopBuilderExtMacOS};
        builder
            .with_activation_policy(ActivationPolicy::Accessory)
            .with_default_menu(false);
    }
    let event_loop = match builder.build() {
        Ok(event_loop) => event_loop,
        Err(error) => {
            // Without an event loop there is no tray and there are no global
            // keys; supervise anyway, so the window always opens and closing
            // it quits.
            tracing::warn!(%error, "could not start the tray event loop");
            let _ = hotkey_events.send(HotkeyEvent::BindFailed(
                "Push-to-talk and mute keys are unavailable on this computer.".to_owned(),
            ));
            return supervise(TrayContext {
                tray_available: false,
                hotkeys: None,
            });
        }
    };
    let mut shell = Shell {
        control,
        hotkey_events,
        supervise: Some(supervise),
        proxy: event_loop.create_proxy(),
        tray: None,
        hotkeys: None,
        exit: None,
    };
    if let Err(error) = event_loop.run_app(&mut shell) {
        tracing::warn!(%error, "the tray event loop failed");
    }
    shell.exit.unwrap_or(SupervisorExit::ControlClosed)
}

/// Create the tray and run `supervise` until it returns. Linux builds have
/// no voice, so there are no global keys.
#[cfg(not(any(target_os = "windows", target_os = "macos")))]
pub fn run(
    control: UnboundedSender<Control>,
    _hotkey_events: UnboundedSender<HotkeyEvent>,
    supervise: Supervise,
) -> SupervisorExit {
    let tray = create_tray(control);
    let exit = supervise(TrayContext {
        tray_available: tray.is_some(),
        hotkeys: None,
    });
    drop(tray);
    exit
}

fn create_tray(control: UnboundedSender<Control>) -> Option<TrayIcon> {
    let menu = Menu::new();
    let open = MenuItem::new("Open Scout", true, None);
    let quit = MenuItem::new("Quit Scout", true, None);
    if let Err(error) = menu.append(&open).and_then(|()| menu.append(&quit)) {
        tracing::warn!(%error, "could not build the Scout Client tray menu");
        return None;
    }
    let open_id = open.id().clone();
    let quit_id = quit.id().clone();
    MenuEvent::set_event_handler(Some(move |event: MenuEvent| {
        let command = if event.id == open_id {
            Control::OpenWindow
        } else if event.id == quit_id {
            Control::Quit
        } else {
            return;
        };
        if control.send(command).is_err() {
            tracing::info!("the Scout Client supervisor had already stopped");
        }
    }));
    let icon_pixels = [59, 130, 246, 255].repeat(32 * 32);
    let icon = match Icon::from_rgba(icon_pixels, 32, 32) {
        Ok(icon) => icon,
        Err(error) => {
            tracing::warn!(%error, "could not build the Scout Client tray icon");
            return None;
        }
    };
    match TrayIconBuilder::new()
        .with_menu(Box::new(menu))
        .with_tooltip(ReleaseProfile::compiled().product_name)
        .with_icon(icon)
        .build()
    {
        Ok(tray) => Some(tray),
        Err(error) => {
            tracing::warn!(%error, "could not create the Scout Client tray icon");
            None
        }
    }
}

/// The windowless event loop's application: the tray, the global keys, and
/// the thread the supervisor runs on.
#[cfg(any(target_os = "windows", target_os = "macos"))]
mod shell {
    use tokio::sync::mpsc::UnboundedSender;
    use tray_icon::TrayIcon;
    use winit::application::ApplicationHandler;
    use winit::event::{StartCause, WindowEvent};
    use winit::event_loop::{ActiveEventLoop, EventLoopProxy};
    use winit::window::WindowId;

    use super::{Supervise, TrayContext, create_tray};
    use crate::hotkeys::{HotkeyBindings, HotkeyEvent, HotkeyPort, Registrar};
    use crate::supervisor::{Control, SupervisorExit};

    pub(super) enum ShellEvent {
        /// The supervisor finished.
        Exit(SupervisorExit),
        /// Register these keys.
        Bind(HotkeyBindings),
    }

    /// Asks the event loop's thread to change the registered keys.
    struct ProxyHotkeys(EventLoopProxy<ShellEvent>);

    impl HotkeyPort for ProxyHotkeys {
        fn bind(&self, bindings: HotkeyBindings) {
            if self.0.send_event(ShellEvent::Bind(bindings)).is_err() {
                tracing::info!("the Scout Client event loop had already stopped");
            }
        }
    }

    pub(super) struct Shell {
        pub(super) control: UnboundedSender<Control>,
        pub(super) hotkey_events: UnboundedSender<HotkeyEvent>,
        pub(super) supervise: Option<Supervise>,
        pub(super) proxy: EventLoopProxy<ShellEvent>,
        pub(super) tray: Option<TrayIcon>,
        pub(super) hotkeys: Option<Registrar>,
        pub(super) exit: Option<SupervisorExit>,
    }

    impl ApplicationHandler<ShellEvent> for Shell {
        fn new_events(&mut self, _event_loop: &ActiveEventLoop, cause: StartCause) {
            // The earliest point the tray may be created on macOS: the loop is
            // running, not just built.
            if cause != StartCause::Init {
                return;
            }
            let Some(supervise) = self.supervise.take() else {
                return;
            };
            self.tray = create_tray(self.control.clone());
            self.hotkeys = match Registrar::new(self.hotkey_events.clone()) {
                Ok(registrar) => Some(registrar),
                Err(error) => {
                    let _ = self.hotkey_events.send(HotkeyEvent::BindFailed(format!(
                        "Push-to-talk and mute keys are unavailable: {error}"
                    )));
                    None
                }
            };
            let context = TrayContext {
                tray_available: self.tray.is_some(),
                hotkeys: self
                    .hotkeys
                    .is_some()
                    .then(|| Box::new(ProxyHotkeys(self.proxy.clone())) as Box<dyn HotkeyPort>),
            };
            let proxy = self.proxy.clone();
            std::thread::spawn(move || {
                let exit = supervise(context);
                if proxy.send_event(ShellEvent::Exit(exit)).is_err() {
                    tracing::warn!("the Scout Client event loop had already stopped");
                }
            });
        }

        fn user_event(&mut self, event_loop: &ActiveEventLoop, event: ShellEvent) {
            match event {
                ShellEvent::Exit(exit) => {
                    self.exit = Some(exit);
                    self.tray = None;
                    self.hotkeys = None;
                    event_loop.exit();
                }
                ShellEvent::Bind(bindings) => {
                    if let Some(hotkeys) = self.hotkeys.as_mut() {
                        hotkeys.apply(&bindings);
                    }
                }
            }
        }

        fn resumed(&mut self, _event_loop: &ActiveEventLoop) {}

        fn window_event(&mut self, _: &ActiveEventLoop, _: WindowId, _: WindowEvent) {}
    }
}
