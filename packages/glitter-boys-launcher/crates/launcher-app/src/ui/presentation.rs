use super::*;
use glitter_boys_core::scheduler::GameStatus;

pub(super) struct CardCopy {
    pub status: &'static str,
    pub helper: &'static str,
    pub action: &'static str,
}
pub(super) fn card_copy(g: &GameStatus, busy: bool) -> CardCopy {
    if g.pausing {
        return CardCopy {
            status: "Pausing…",
            helper: "Saving downloads…",
            action: "Pausing…",
        };
    }
    let mut copy = match g.phase {
        Phase::Paused if g.queued => CardCopy {
            status: "Paused",
            helper: "Downloads saved.",
            action: "Resume",
        },
        Phase::Paused => CardCopy {
            status: "Not installed",
            helper: "",
            action: "Install",
        },
        Phase::Waiting => CardCopy {
            status: "Waiting",
            helper: "Waiting for another installation to finish.",
            action: "Pause",
        },
        Phase::Downloading => CardCopy {
            status: if g.progress.phase == "Checking download" {
                "Checking files"
            } else {
                "Downloading"
            },
            helper: "Connecting to the download…",
            action: "Pause",
        },
        Phase::Extracting => CardCopy {
            status: "Setting up your game",
            helper: "",
            action: "Pause",
        },
        Phase::Preparing => CardCopy {
            status: "Getting ready",
            helper: "",
            action: "Pause",
        },
        Phase::Launching => CardCopy {
            status: "Opening your game",
            helper: "",
            action: "Opening…",
        },
        Phase::Failed => CardCopy {
            status: "Setup couldn't finish",
            helper: "Choose Get help for the next step.",
            action: "Try again",
        },
        Phase::Ready => CardCopy {
            status: "Ready to play",
            helper: if busy {
                "Pause installations to play."
            } else {
                ""
            },
            action: "Play",
        },
    };
    if let Some(problem) = &g.error {
        copy.status = problem.title;
        copy.helper = problem.next_step;
        copy.action = "Try again";
    }
    copy
}
pub(super) fn time_left(g: &GameStatus) -> Option<String> {
    if g.pausing
        || g.error.is_some()
        || !matches!(
            g.phase,
            Phase::Downloading | Phase::Extracting | Phase::Preparing
        )
    {
        return None;
    }
    if g.progress.total == 0 {
        return None;
    }
    let Some(remaining) = g.timing.remaining else {
        return Some("Estimating time remaining…".into());
    };
    let minutes = remaining.as_secs().div_ceil(60).max(1);
    let duration = if minutes < 60 {
        format!("{minutes} minute{}", if minutes == 1 { "" } else { "s" })
    } else {
        let hours = minutes.div_ceil(60);
        format!("{hours} hour{}", if hours == 1 { "" } else { "s" })
    };
    let stage = match g.phase {
        Phase::Downloading if g.progress.phase == "Checking download" => "check files",
        Phase::Downloading => "download",
        _ => "finish this step",
    };
    Some(format!("About {duration} left to {stage}."))
}
