//! The supervisor's tray icon and the platform event loop it needs.
//!
//! `tray-icon` needs a running event loop: on Windows a message loop on the
//! thread that created the icon, on macOS the main thread's run loop. Neither
//! needs a window or a graphics context, so the supervisor runs a windowless
//! `winit` event loop on its main thread for the tray and does its own work on
//! another thread. On Linux the KSNI backend runs its own D-Bus thread, so no
//! event loop is needed there.

use tokio::sync::mpsc::UnboundedSender;
use tray_icon::menu::{Menu, MenuEvent, MenuItem};
use tray_icon::{Icon, TrayIcon, TrayIconBuilder};

use crate::supervisor::{Control, SupervisorExit};

/// The supervisor's work, given whether a tray icon exists.
pub type Supervise = Box<dyn FnOnce(bool) -> SupervisorExit + Send>;

/// Create the tray and run `supervise` until it returns.
#[cfg(any(target_os = "windows", target_os = "macos"))]
pub fn run(control: UnboundedSender<Control>, supervise: Supervise) -> SupervisorExit {
    use winit::application::ApplicationHandler;
    use winit::event::{StartCause, WindowEvent};
    use winit::event_loop::{ActiveEventLoop, EventLoop, EventLoopProxy};
    use winit::window::WindowId;

    struct Shell {
        control: UnboundedSender<Control>,
        supervise: Option<Supervise>,
        proxy: EventLoopProxy<SupervisorExit>,
        tray: Option<TrayIcon>,
        exit: Option<SupervisorExit>,
    }

    impl ApplicationHandler<SupervisorExit> for Shell {
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
            let tray_available = self.tray.is_some();
            let proxy = self.proxy.clone();
            std::thread::spawn(move || {
                let exit = supervise(tray_available);
                if proxy.send_event(exit).is_err() {
                    tracing::warn!("the Scout Client event loop had already stopped");
                }
            });
        }

        fn user_event(&mut self, event_loop: &ActiveEventLoop, exit: SupervisorExit) {
            self.exit = Some(exit);
            self.tray = None;
            event_loop.exit();
        }

        fn resumed(&mut self, _event_loop: &ActiveEventLoop) {}

        fn window_event(&mut self, _: &ActiveEventLoop, _: WindowId, _: WindowEvent) {}
    }

    let mut builder = EventLoop::<SupervisorExit>::with_user_event();
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
            // Without an event loop there is no tray; supervise anyway, so the
            // window always opens and closing it quits.
            tracing::warn!(%error, "could not start the tray event loop");
            return supervise(false);
        }
    };
    let mut shell = Shell {
        control,
        supervise: Some(supervise),
        proxy: event_loop.create_proxy(),
        tray: None,
        exit: None,
    };
    if let Err(error) = event_loop.run_app(&mut shell) {
        tracing::warn!(%error, "the tray event loop failed");
    }
    shell.exit.unwrap_or(SupervisorExit::ControlClosed)
}

/// Create the tray and run `supervise` until it returns.
#[cfg(not(any(target_os = "windows", target_os = "macos")))]
pub fn run(control: UnboundedSender<Control>, supervise: Supervise) -> SupervisorExit {
    let tray = create_tray(control);
    let exit = supervise(tray.is_some());
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
        .with_tooltip("Scout Client")
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
