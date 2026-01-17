use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ConsoleMessage {
    Attach {
        session_id: String,
        rows: u16,
        cols: u16,
    },
    Attached,
    Error {
        message: String,
    },
    Output {
        data: String,
    },
    Input {
        data: String,
    },
    Resize {
        rows: u16,
        cols: u16,
    },
    Signal {
        signal: SignalType,
    },
}

/// Unix signal types that can be sent to the PTY process.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SignalType {
    /// SIGINT - Interrupt signal (Ctrl+C)
    Sigint,
    /// SIGTSTP - Terminal stop signal (Ctrl+Z)
    Sigtstp,
    /// SIGQUIT - Quit with core dump (Ctrl+\)
    Sigquit,
    /// SIGTERM - Graceful termination request
    Sigterm,
    /// SIGKILL - Force kill (cannot be caught)
    Sigkill,
    /// SIGHUP - Hangup detected on controlling terminal
    Sighup,
    /// SIGUSR1 - User-defined signal 1
    Sigusr1,
    /// SIGUSR2 - User-defined signal 2
    Sigusr2,
    /// SIGCONT - Continue if stopped
    Sigcont,
}

impl SignalType {
    /// Get the Unix signal number for this signal type.
    #[must_use]
    pub const fn as_signal_number(self) -> i32 {
        match self {
            Self::Sighup => 1,
            Self::Sigint => 2,
            Self::Sigquit => 3,
            Self::Sigkill => 9,
            Self::Sigusr1 => 10,
            Self::Sigusr2 => 12,
            Self::Sigterm => 15,
            Self::Sigcont => 18,
            Self::Sigtstp => 20,
        }
    }

    /// Get display name for this signal.
    #[must_use]
    pub const fn display_name(self) -> &'static str {
        match self {
            Self::Sigint => "SIGINT (Interrupt)",
            Self::Sigquit => "SIGQUIT (Quit)",
            Self::Sigtstp => "SIGTSTP (Stop)",
            Self::Sigcont => "SIGCONT (Continue)",
            Self::Sigterm => "SIGTERM (Terminate)",
            Self::Sigkill => "SIGKILL (Force Kill)",
            Self::Sighup => "SIGHUP (Hangup)",
            Self::Sigusr1 => "SIGUSR1 (User Signal 1)",
            Self::Sigusr2 => "SIGUSR2 (User Signal 2)",
        }
    }

    /// Get description for this signal.
    #[must_use]
    pub const fn description(self) -> &'static str {
        match self {
            Self::Sigint => "Interrupt process (Ctrl+C)",
            Self::Sigquit => "Quit with core dump (Ctrl+\\)",
            Self::Sigtstp => "Suspend process (Ctrl+Z)",
            Self::Sigcont => "Resume suspended process",
            Self::Sigterm => "Graceful termination request",
            Self::Sigkill => "Force kill (cannot be caught)",
            Self::Sighup => "Terminal disconnected",
            Self::Sigusr1 => "Application-defined signal 1",
            Self::Sigusr2 => "Application-defined signal 2",
        }
    }
}
