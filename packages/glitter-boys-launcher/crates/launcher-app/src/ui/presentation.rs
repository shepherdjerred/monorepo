use super::*;
use glitter_boys_core::scheduler::GameStatus;

pub(super) struct CardCopy {
    pub status: &'static str,
    pub helper: &'static str,
    pub action: &'static str,
}
pub(super) fn card_copy(g: &GameStatus) -> CardCopy {
    if g.pausing {
        return CardCopy {
            status: "Pausing…",
            helper: "",
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
            status: "Unpacking game files",
            helper: "",
            action: "Pause",
        },
        Phase::Preparing => CardCopy {
            status: step_label(g),
            helper: "",
            action: "Pause",
        },
        Phase::Launching => CardCopy {
            status: "Launching…",
            helper: "",
            action: "Launching…",
        },
        Phase::Failed => CardCopy {
            status: "Setup couldn't finish",
            helper: "Choose Get help for the next step.",
            action: "Try again",
        },
        Phase::Ready => CardCopy {
            status: "Ready to play",
            helper: "",
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
pub(super) fn speed_text(rate: f64) -> String {
    if rate >= 999_950_000.0 {
        format!("{} GB/s", number(rate / 1e9))
    } else if rate >= 1e6 {
        format!("{} MB/s", number(rate / 1e6))
    } else {
        format!("{} KB/s", number(rate.max(0.0) / 1e3))
    }
}
fn number(value: f64) -> String {
    format!("{value:.1}")
        .trim_end_matches('0')
        .trim_end_matches('.')
        .into()
}
pub(super) fn step_label(g: &GameStatus) -> &'static str {
    if g.progress.phase == "Updating IW4x" {
        return "Updating MW2";
    }
    match g.phase {
        Phase::Preparing => match g.progress.phase {
            "Updating IW4x" => "Updating MW2",
            "Finishing installation" => "Finishing installation",
            "Installing Microsoft components" => "Installing Windows components",
            _ => "Setting up the game launcher",
        },
        Phase::Extracting => "Unpacking game files",
        Phase::Downloading if g.progress.phase == "Checking download" => "Checking game files",
        Phase::Downloading => "Downloading",
        Phase::Launching => "Launching…",
        _ => "Finishing this step",
    }
}
pub(super) fn progress_text(g: &GameStatus) -> String {
    let percent = if g.progress.total > 0 {
        format!(
            "{:.0}%",
            100.0 * (g.progress.completed as f64 / g.progress.total as f64).clamp(0.0, 1.0)
        )
    } else {
        String::new()
    };
    match g.timing.bytes_per_second {
        Some(rate)
            if g.phase == Phase::Downloading && g.progress.phase.starts_with("Downloading") =>
        {
            format!("{percent} · {}", speed_text(rate))
        }
        _ => percent,
    }
}
pub(super) fn row_progress_text(game: &GameStatus) -> String {
    let progress = progress_text(game);
    let timing = if matches!(game.phase, Phase::Preparing | Phase::Launching) {
        game.timing
            .stage_elapsed
            .map(|elapsed| format!("{} elapsed", duration_text(elapsed)))
    } else if time_left(game).is_some() {
        Some(match game.timing.remaining {
            Some(remaining) => {
                let minutes = remaining.as_secs().div_ceil(60).max(1);
                if minutes < 60 {
                    format!("About {minutes} min left")
                } else {
                    format!("About {} hr left", minutes.div_ceil(60))
                }
            }
            None => "Estimating…".into(),
        })
    } else {
        None
    };
    [Some(progress).filter(|text| !text.is_empty()), timing]
        .into_iter()
        .flatten()
        .collect::<Vec<_>>()
        .join(" · ")
}
pub(super) fn closing_text(snapshot: &Snapshot) -> String {
    let stage = snapshot.games.iter().find(|g| {
        g.pausing
            && matches!(
                g.progress.phase,
                "Updating IW4x" | "Preparing client" | "Finishing installation"
            )
    });
    if let Some(g) = stage {
        format!(
            "{} before closing · {} elapsed",
            step_label(g),
            g.timing
                .stage_elapsed
                .map(duration_text)
                .unwrap_or_else(|| "0s".into())
        )
    } else if snapshot.storage.busy {
        "Finishing file cleanup before closing…".into()
    } else {
        "Saving download progress before closing…".into()
    }
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

#[cfg(test)]
mod format_tests {
    use super::*;
    #[test]
    fn decimal_speed_units_are_consistent() {
        assert_eq!(speed_text(850e6), "850 MB/s");
        assert_eq!(speed_text(999e6), "999 MB/s");
        assert_eq!(speed_text(999_999_999.0), "1 GB/s");
        assert_eq!(speed_text(1e9), "1 GB/s");
        assert_eq!(speed_text(1.2e9), "1.2 GB/s");
    }
}
