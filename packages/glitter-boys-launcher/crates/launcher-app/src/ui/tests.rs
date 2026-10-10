use super::*;
use glitter_boys_core::{Progress, scheduler::GameStatus};

#[test]
fn mode_buttons_launch_the_clicked_mode_and_respect_disabled_state() {
    for game in [Game::T5, Game::T6] {
        for (label, expected) in [
            ("Play Multiplayer", Mode::Multiplayer),
            ("Play Zombies", Mode::Zombies),
        ] {
            for enabled in [true, false] {
                let context = egui::Context::default();
                Launcher::configure(&context);
                let mut position = egui::Pos2::ZERO;
                let mut selected = None;
                for frame in 0..4 {
                    let mut input = egui::RawInput {
                        screen_rect: Some(egui::Rect::from_min_size(
                            egui::Pos2::ZERO,
                            egui::vec2(500.0, 200.0),
                        )),
                        ..Default::default()
                    };
                    if frame >= 2 {
                        input.events = vec![
                            egui::Event::PointerMoved(position),
                            egui::Event::PointerButton {
                                pos: position,
                                button: egui::PointerButton::Primary,
                                pressed: frame == 2,
                                modifiers: egui::Modifiers::NONE,
                            },
                        ];
                    }
                    let mut output = context.run_ui(input, |ui| {
                        ui.horizontal(|ui| {
                            if let Some(mode) = play_buttons(ui, game, enabled) {
                                selected = Some(mode);
                            }
                        });
                    });
                    if frame == 1 {
                        let label_position =
                            output.shapes.iter().find_map(|shape| match &shape.shape {
                                egui::Shape::Text(text) if text.galley.text() == label => {
                                    Some(text.pos + text.galley.rect.center().to_vec2())
                                }
                                _ => None,
                            });
                        assert!(label_position.is_some(), "Missing visible button: {label}");
                        if let Some(pos) = label_position {
                            position = pos;
                        }
                    }
                    output.textures_delta.clear();
                }
                assert_eq!(selected, enabled.then_some(expected));
            }
        }
    }
}

fn game_status(phase: Phase) -> GameStatus {
    GameStatus {
        game: Game::T6,
        phase,
        queued: false,
        pausing: false,
        handoff: false,
        progress: Progress {
            phase: "Downloading",
            completed: 1_000_000_000,
            total: 2_000_000_000,
        },
        timing: glitter_boys_core::scheduler::Timing {
            elapsed: Some(Duration::from_secs(120)),
            bytes_per_second: Some(42_000_000.0),
            remaining: Some(Duration::from_secs(200)),
        },
        error: None,
    }
}

#[test]
fn simple_cards_explain_the_next_action_and_stage_not_a_total_install_eta() {
    let mut g = game_status(Phase::Paused);
    assert_eq!(card_copy(&g, false).action, "Install");
    g.queued = true;
    assert_eq!(card_copy(&g, false).action, "Resume");
    g.pausing = true;
    assert_eq!(card_copy(&g, false).action, "Pausing…");
    assert!(time_left(&g).is_none());
    g.pausing = false;
    g.phase = Phase::Downloading;
    assert_eq!(
        time_left(&g).as_deref(),
        Some("About 4 minutes left to download.")
    );
    g.progress.phase = "Checking download";
    assert_eq!(
        time_left(&g).as_deref(),
        Some("About 4 minutes left to check files.")
    );
    g.timing.remaining = None;
    assert_eq!(time_left(&g).as_deref(), Some("Estimating time remaining…"));
    g.phase = Phase::Preparing;
    g.progress.total = 0;
    assert!(time_left(&g).is_none());
    g.phase = Phase::Ready;
    assert_eq!(card_copy(&g, true).helper, "Pause installations to play.");
    g.handoff = true;
    assert_eq!(card_copy(&g, false).status, "Ready to play");
    assert!(card_copy(&g, false).helper.is_empty());
    g.error = Some(Problem::new(
        "Windows needs a restart",
        "Restart Windows, then try again.",
        "fixture",
    ));
    assert_eq!(card_copy(&g, false).action, "Try again");
    assert_eq!(
        card_copy(&g, false).helper,
        "Restart Windows, then try again."
    );
}

#[test]
fn dialogs_fit_with_long_errors_and_keyboard_escape_closes_them() -> Result<()> {
    let data = tempfile::tempdir()?;
    Settings {
        version: 1,
        library: data
            .path()
            .join("a deliberately long folder name to test truncation in the settings dialog"),
        queue: vec![],
    }
    .save(data.path())?;
    let mut app = Launcher {
        library: Ok(Library::load(data.path().into(), false)?),
        message: None,
        problem: Some(Problem::new(
            "Setup couldn't finish",
            "Try again. If this continues, save a support report from Help.",
            "file path and error ".repeat(1000),
        )),
        dialog: None,
        advanced_help: true,
        closing: false,
        updater: glitter_boys_core::updates::Updater::new(),
        healthy: false,
    };
    for size in [egui::vec2(760.0, 560.0), egui::vec2(900.0, 640.0)] {
        for scale in [1.0, 1.25, 1.5, 2.0] {
            for dialog in [
                Dialog::Settings,
                Dialog::Help,
                Dialog::Details(0),
                Dialog::Problem,
            ] {
                for failed in [false, true] {
                    let context = egui::Context::default();
                    Launcher::configure(&context);
                    let mut snapshot = Snapshot {
                        games: Game::ALL.map(|_| game_status(Phase::Downloading)),
                        busy: true,
                        queued: 4,
                        error: None,
                    };
                    if failed {
                        snapshot.games[0].error = app.problem.clone();
                    }
                    app.dialog = Some(dialog);
                    for frame in 0..3 {
                        let mut input = egui::RawInput {
                            screen_rect: Some(egui::Rect::from_min_size(egui::Pos2::ZERO, size)),
                            ..Default::default()
                        };
                        if let Some(viewport) = input.viewports.get_mut(&egui::ViewportId::ROOT) {
                            viewport.native_pixels_per_point = Some(scale);
                        }
                        if frame == 2 {
                            input.events.push(egui::Event::Key {
                                key: egui::Key::Escape,
                                physical_key: None,
                                pressed: true,
                                repeat: false,
                                modifiers: egui::Modifiers::NONE,
                            });
                        }
                        let mut output = context.run_ui(input, |ui| {
                            if let Some(rect) = app.show_dialog(ui.ctx(), &snapshot) {
                                assert!(
                                    rect.width() <= size.x && rect.height() <= size.y,
                                    "dialog overflow: {rect:?} at {size:?}"
                                );
                                if frame > 0 {
                                    assert!(
                                        rect.min.x >= 0.0
                                            && rect.min.y >= 0.0
                                            && rect.max.x <= size.x
                                            && rect.max.y <= size.y,
                                        "dialog outside screen: {rect:?}"
                                    );
                                }
                            }
                        });
                        output.textures_delta.clear();
                    }
                    assert!(app.dialog.is_none(), "Escape must close the dialog");
                }
            }
        }
    }
    Ok(())
}

#[test]
fn all_controls_fit_at_minimum_size_with_long_paths_and_errors() -> Result<()> {
    let data = tempfile::tempdir()?;
    let settings=Settings{version:1,library:data.path().join("a deliberately long game library folder name repeated to check truncation and wrapping"),queue:vec![]};
    let library = Library {
        data: data.path().into(),
        settings: settings.clone(),
        scheduler: Scheduler::start(Catalog::bundled()?, data.path().into(), settings)?,
        _lock: state::exclusive_lock(&data.path().join("launcher.lock"))?,
    };
    let mut app=Launcher{problem:None,dialog:None,advanced_help:false,library:Ok(library),message:Some("A very long network error that should be truncated instead of adding rows and hiding the footer. ".repeat(8)),closing:false,updater:Err(glitter_boys_core::Error::Invalid("test".into())),healthy:false};
    for size in [egui::vec2(760.0, 560.0), egui::vec2(900.0, 640.0)] {
        for scale in [1.0, 1.25, 1.5, 2.0] {
            for phase in [
                Phase::Ready,
                Phase::Downloading,
                Phase::Preparing,
                Phase::Extracting,
                Phase::Waiting,
                Phase::Launching,
                Phase::Paused,
                Phase::Failed,
            ] {
                let context = egui::Context::default();
                Launcher::configure(&context);
                let snapshot = Snapshot {
                    games: Game::ALL.map(|game| GameStatus {
                        game,
                        phase,
                        progress: Progress {
                            phase: "Unpacking (4 workers)",
                            completed: 75_000_000_000,
                            total: 134_000_000_000,
                        },
                        timing: glitter_boys_core::scheduler::Timing {
                            elapsed: Some(Duration::from_secs(359_999)),
                            bytes_per_second: Some(1_234_500_000.0),
                            remaining: Some(Duration::from_secs(359_999)),
                        },
                        queued: true,
                        pausing: false,
                        handoff: false,
                        error: (phase == Phase::Failed).then(|| {
                            Problem::new(
                                "Setup couldn't finish",
                                "Try again. If this continues, save a support report from Help.",
                                "A detailed error".repeat(40),
                            )
                        }),
                    }),
                    busy: phase == Phase::Downloading,
                    queued: 4,
                    error: None,
                };
                // Font atlas/layout settle over successive frames, matching the native app.
                for _ in 0..2 {
                    let mut input = egui::RawInput {
                        screen_rect: Some(egui::Rect::from_min_size(egui::Pos2::ZERO, size)),
                        ..Default::default()
                    };
                    input
                        .viewports
                        .get_mut(&egui::ViewportId::ROOT)
                        .ok_or_else(|| {
                            glitter_boys_core::Error::Invalid("Missing root viewport".into())
                        })?
                        .native_pixels_per_point = Some(scale);
                    let mut output = context.run_ui(input, |ui| {
                        let used = app.render(ui, &snapshot);
                        assert!(
                            used.right() <= size.x,
                            "width overflow: {used:?} at {size:?}/{scale}"
                        );
                        assert!(
                            used.bottom() <= size.y,
                            "height overflow: {used:?} at {size:?}/{scale}"
                        );
                    });
                    output.textures_delta.clear();
                }
            }
        }
    }
    Ok(())
}
