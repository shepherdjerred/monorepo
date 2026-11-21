//! Which UI toolkit the window process runs.
//!
//! This is bootstrap, not product behaviour: it picks the process the
//! supervisor launches before any configuration or flag client exists, and
//! both windows render the same IPC state and send the same commands. So it
//! is an environment variable or a command-line flag, not a feature flag.
//! The gpui window is the default wherever the build contains it (Windows and
//! macOS); `--ui=egui` remains an explicit fallback until egui is deleted.

/// The environment variable that selects the window toolkit.
pub const UI_ENVIRONMENT: &str = "SCOUT_DESKTOP_UI";
/// The flag that selects the window toolkit; it wins over the environment.
const UI_FLAG: &str = "--ui=";

/// The toolkit the window process renders with.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WindowToolkit {
    /// The egui window (`scout-client-app/src/ui.rs`): the fallback, and the
    /// only window on Linux.
    Egui,
    /// The gpui-kit window (`scout-desktop-ui`), on Windows and macOS.
    Gpui,
}

impl Default for WindowToolkit {
    /// The gpui window wherever this build contains it, otherwise egui.
    ///
    /// Every launch path starts the supervisor without `--ui=`: start at
    /// login, the installer's shortcuts, the updater's relaunch, and a user
    /// opening the app. So this default is what a user sees; the supervisor
    /// then hands its choice to every window it starts or relaunches.
    fn default() -> Self {
        if scout_desktop_ui::AVAILABLE {
            Self::Gpui
        } else {
            Self::Egui
        }
    }
}

impl WindowToolkit {
    fn parse(value: &str, source: &str) -> Result<Self, String> {
        match value {
            "egui" => Ok(Self::Egui),
            "gpui" => Ok(Self::Gpui),
            other => Err(format!(
                "{source} is {other:?}; Scout Client knows \"egui\" and \"gpui\""
            )),
        }
    }

    /// Choose from `--ui=` in `arguments`, then `environment` (the value of
    /// [`UI_ENVIRONMENT`]), then the default.
    ///
    /// # Errors
    /// A message naming the source when a value is not a known toolkit.
    pub fn select(arguments: &[String], environment: Option<&str>) -> Result<Self, String> {
        if let Some(value) = arguments
            .iter()
            .rev()
            .find_map(|argument| argument.strip_prefix(UI_FLAG))
        {
            return Self::parse(value, "--ui");
        }
        match environment {
            None | Some("") => Ok(Self::default()),
            Some(value) => Self::parse(value, UI_ENVIRONMENT),
        }
    }

    /// The flag that makes the window process render with this toolkit. The
    /// supervisor always passes it, so the window never depends on the
    /// environment it inherits.
    #[must_use]
    pub const fn argument(self) -> &'static str {
        match self {
            Self::Egui => "--ui=egui",
            Self::Gpui => "--ui=gpui",
        }
    }

    /// Whether this build contains the toolkit.
    #[must_use]
    pub const fn available(self) -> bool {
        match self {
            Self::Egui => true,
            Self::Gpui => scout_desktop_ui::AVAILABLE,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::WindowToolkit;

    fn arguments(values: &[&str]) -> Vec<String> {
        values.iter().map(|&value| value.to_owned()).collect()
    }

    /// What a launch without `--ui=` opens: start at login passes only
    /// `--background --server=…`, and the installer's shortcuts and the
    /// updater's relaunch pass nothing.
    const DEFAULT: WindowToolkit = if cfg!(any(windows, target_os = "macos")) {
        WindowToolkit::Gpui
    } else {
        WindowToolkit::Egui
    };

    #[test]
    fn gpui_is_the_default_wherever_it_is_built() {
        assert_eq!(WindowToolkit::default(), DEFAULT);
        assert_eq!(WindowToolkit::select(&[], None), Ok(DEFAULT));
        assert_eq!(WindowToolkit::select(&[], Some("")), Ok(DEFAULT));
        assert_eq!(
            WindowToolkit::select(
                &arguments(&["--background", "--server=https://scout.invalid"]),
                None
            ),
            Ok(DEFAULT)
        );
        assert!(DEFAULT.available());
    }

    #[test]
    fn the_environment_or_the_flag_selects_either_toolkit() {
        assert_eq!(
            WindowToolkit::select(&[], Some("gpui")),
            Ok(WindowToolkit::Gpui)
        );
        assert_eq!(
            WindowToolkit::select(&arguments(&["--background", "--ui=gpui"]), None),
            Ok(WindowToolkit::Gpui)
        );
        assert_eq!(
            WindowToolkit::select(&[], Some("egui")),
            Ok(WindowToolkit::Egui)
        );
        assert_eq!(
            WindowToolkit::select(&arguments(&["--ui=egui"]), None),
            Ok(WindowToolkit::Egui)
        );
    }

    #[test]
    fn the_flag_wins_over_the_environment() {
        assert_eq!(
            WindowToolkit::select(&arguments(&["--ui=egui"]), Some("gpui")),
            Ok(WindowToolkit::Egui)
        );
        assert_eq!(
            WindowToolkit::select(&arguments(&["--ui=egui", "--ui=gpui"]), None),
            Ok(WindowToolkit::Gpui)
        );
    }

    #[test]
    fn an_unknown_toolkit_is_an_error() {
        assert!(
            WindowToolkit::select(&arguments(&["--ui=qt"]), None)
                .is_err_and(|error| error.contains("--ui") && error.contains("\"qt\""))
        );
        assert!(
            WindowToolkit::select(&[], Some("GPUI"))
                .is_err_and(|error| error.contains("SCOUT_DESKTOP_UI"))
        );
    }

    #[test]
    fn the_window_argument_round_trips() {
        for toolkit in [WindowToolkit::Egui, WindowToolkit::Gpui] {
            assert_eq!(
                WindowToolkit::select(&arguments(&[toolkit.argument()]), Some("egui")),
                Ok(toolkit)
            );
        }
        assert!(WindowToolkit::Egui.available());
        assert_eq!(
            WindowToolkit::Gpui.available(),
            cfg!(any(windows, target_os = "macos"))
        );
    }
}
