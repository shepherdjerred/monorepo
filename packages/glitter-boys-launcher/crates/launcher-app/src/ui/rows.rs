use super::*;

impl Launcher {
    pub(super) fn card(
        &mut self,
        ui: &mut egui::Ui,
        snapshot: &Snapshot,
        index: usize,
        height: f32,
    ) {
        let game = &snapshot.games[index];
        let copy = card_copy(game);
        let (rect, _) = ui.allocate_exact_size(
            egui::vec2(ui.available_width(), height),
            egui::Sense::hover(),
        );
        ui.painter().rect(
            rect,
            10,
            SURFACE,
            egui::Stroke::new(1.0, LINE),
            egui::StrokeKind::Inside,
        );

        let badge = egui::Rect::from_center_size(
            egui::pos2(rect.left() + 44.0, rect.center().y),
            egui::vec2(56.0, 56.0),
        );
        let icon = &self.game_icons[match game.game {
            Game::Iw4x => 0,
            Game::T5 => 1,
            Game::T6 => 2,
            Game::T7 => 3,
        }];
        egui::Image::new(icon).corner_radius(8).paint_at(ui, badge);
        let details = egui::Rect::from_center_size(
            egui::pos2(rect.right() - 30.0, rect.center().y),
            egui::vec2(28.0, 34.0),
        );
        let mut details_ui = ui.new_child(
            egui::UiBuilder::new()
                .id_salt((index, "details"))
                .max_rect(details),
        );
        // The quiet information action keeps destructive operations away from Play.
        let response = details_ui.add(egui::Button::new("").frame(false).min_size(details.size()));
        response.widget_info(|| {
            egui::WidgetInfo::labeled(egui::WidgetType::Button, true, "Game details")
        });
        icons::draw(
            ui.painter(),
            Icon::Info,
            egui::Rect::from_center_size(details.center(), egui::vec2(16.0, 16.0)),
            if response.hovered() { LILAC } else { MUTED },
        );
        if response.on_hover_text("Game details").clicked() {
            self.dialog = Some(Dialog::Details(index));
            self.send(Command::Storage(storage::Action::Analyze));
        }

        let actions = egui::Rect::from_min_max(
            egui::pos2(details.left() - 280.0, rect.top()),
            egui::pos2(details.left() - 12.0, rect.bottom()),
        );
        let mut action_ui = ui.new_child(
            egui::UiBuilder::new()
                .id_salt((index, "actions"))
                .max_rect(actions)
                .layout(egui::Layout::right_to_left(egui::Align::Center)),
        );
        let enabled = !self.closing
            && !game.pausing
            && game.phase != Phase::Launching
            && (!snapshot.storage.busy
                || matches!(
                    game.phase,
                    Phase::Waiting | Phase::Downloading | Phase::Extracting | Phase::Preparing
                ))
            && !(game.phase == Phase::Ready
                && snapshot
                    .games
                    .iter()
                    .any(|other| other.phase == Phase::Launching));
        if game.phase == Phase::Ready {
            if let Some(mode) = play_buttons(&mut action_ui, game.game, enabled) {
                self.send(Command::Play(game.game, mode));
            }
        } else if action_ui
            .add_enabled_ui(enabled, |ui| {
                button(
                    ui,
                    match game.phase {
                        Phase::Paused if game.queued => Icon::Play,
                        Phase::Launching => Icon::Play,
                        Phase::Waiting
                        | Phase::Downloading
                        | Phase::Extracting
                        | Phase::Preparing => Icon::Pause,
                        Phase::Failed => Icon::Refresh,
                        _ => Icon::Download,
                    },
                    copy.action,
                    true,
                )
            })
            .inner
            .clicked()
        {
            self.send(match game.phase {
                Phase::Waiting | Phase::Downloading | Phase::Extracting | Phase::Preparing => {
                    Command::Pause(game.game)
                }
                _ => Command::Install(game.game),
            });
        }
        if game.phase == Phase::Paused
            && game.queued
            && !game.pausing
            && action_ui
                .add_enabled_ui(!snapshot.storage.busy && !self.closing, |ui| {
                    button(ui, Icon::Cancel, "Cancel", false)
                })
                .inner
                .clicked()
        {
            self.dialog = Some(Dialog::Cancel(index));
        }
        if game.error.is_some() && button(&mut action_ui, Icon::Help, "Get help", false).clicked() {
            self.dialog = Some(Dialog::Details(index));
        }

        let info = egui::Rect::from_min_max(
            egui::pos2(badge.right() + 16.0, rect.top() + 10.0),
            egui::pos2(actions.left() - 16.0, rect.bottom() - 8.0),
        );
        let mut content = ui.new_child(
            egui::UiBuilder::new()
                .id_salt((index, "info"))
                .max_rect(info)
                .layout(egui::Layout::top_down(egui::Align::Min)),
        );
        content.set_clip_rect(info);
        content.spacing_mut().item_spacing.y = 2.0;
        content
            .add(egui::Label::new(RichText::new(game.game.title()).size(19.0).strong()).truncate())
            .on_hover_text(game.game.title());
        let active = matches!(
            game.phase,
            Phase::Downloading | Phase::Extracting | Phase::Preparing | Phase::Launching
        );
        let status_color = if game.error.is_some() {
            PINK
        } else if game.phase == Phase::Ready || active {
            LILAC
        } else {
            MUTED
        };
        let status = if game.pausing {
            format!(
                "{} · {} elapsed",
                copy.status,
                game.timing
                    .stage_elapsed
                    .map(duration_text)
                    .unwrap_or_else(|| "0s".into())
            )
        } else {
            copy.status.to_string()
        };
        let modes = if game.game == Game::Iw4x {
            "Multiplayer"
        } else {
            "Multiplayer + Zombies"
        };
        if !active && !game.pausing {
            let metadata = format!("{modes} · {}", game.game.release_year());
            content
                .add(egui::Label::new(RichText::new(&metadata).size(12.0).color(MUTED)).truncate())
                .on_hover_text(metadata);
        }
        content.horizontal(|ui| {
            let (dot, _) = ui.allocate_exact_size(egui::vec2(6.0, 14.0), egui::Sense::hover());
            ui.painter().circle_filled(dot.center(), 2.5, status_color);
            ui.add(
                egui::Label::new(RichText::new(&status).size(12.0).color(status_color)).truncate(),
            )
            .on_hover_text(&status);
        });
        if game.pausing {
            content.add(
                egui::Label::new(
                    RichText::new(presentation::step_label(game))
                        .size(12.0)
                        .color(MUTED),
                )
                .truncate(),
            );
        }
        if active && !game.pausing {
            let fraction = if game.progress.total > 0 {
                (game.progress.completed as f64 / game.progress.total as f64).clamp(0.0, 1.0) as f32
            } else {
                0.0
            };
            content.add(
                egui::ProgressBar::new(fraction)
                    .desired_height(16.0)
                    .corner_radius(4)
                    .fill(Color32::from_rgb(78, 61, 109))
                    .text(RichText::new(presentation::row_progress_text(game)).size(11.0))
                    .animate(game.progress.total == 0),
            );
        }
    }
}
