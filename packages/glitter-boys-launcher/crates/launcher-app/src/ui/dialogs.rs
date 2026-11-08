use super::*;
impl Launcher {
    pub(super) fn show_dialog(
        &mut self,
        context: &egui::Context,
        snapshot: &Snapshot,
    ) -> Option<egui::Rect> {
        let dialog = self.dialog?;
        let mut close = false;
        let response = egui::Modal::new(egui::Id::new("launcher-dialog")).show(context, |ui| {
            ui.set_width(480.0_f32.min(context.content_rect().width() - 64.0));
            ui.spacing_mut().item_spacing.y = 8.0;
            match dialog {
                Dialog::Settings => self.settings_dialog(ui, snapshot),
                Dialog::Help => self.help_dialog(ui),
                Dialog::Details(index) => {
                    let g = &snapshot.games[index];
                    ui.heading(format!("{} details", g.game.title()));
                    ui.label(RichText::new(format!("Released {}", g.game.release_year())).small().color(MUTED));
                    if let Some(problem) = &g.error {
                        let retry = (g.phase == Phase::Failed).then_some((g.game, g.resumable));
                        self.problem_contents(ui, problem, retry);
                    } else if g.phase == Phase::Ready {
                        ui.label("Ready to play");
                        if ui.add_enabled_ui(can_uninstall(snapshot, index), |ui| button(ui, Icon::Trash, "Uninstall", false)).inner.on_disabled_hover_text("Wait for the storage check or current removal to finish.").clicked() {
                            self.keep_saves = true;
                            self.dialog = Some(Dialog::Uninstall(index));
                        }
                    } else {
                        ui.label(card_copy(g).status);
                        if g.progress.total > 0 {
                            ui.label(format!(
                                "{:.2} of {:.2} GB in this step",
                                g.progress.completed as f64 / 1e9,
                                g.progress.total as f64 / 1e9
                            ));
                        }
                        if let Some(elapsed) = g.timing.elapsed {
                            ui.label(format!("Elapsed this session: {}", duration_text(elapsed)))
                                .on_hover_text("Excludes pauses.");
                        }
                        if let Some(rate) = g.timing.bytes_per_second {
                            ui.label(format!("{}: {}", if g.progress.phase == "Checking download" { "Checking speed" } else if g.phase == Phase::Extracting { "Unpacking speed" } else { "Download speed" }, presentation::speed_text(rate)));
                        }
                        if let Some(cap) = presentation::cap_text(g, snapshot.download_limit_mbps) {
                            let mbps = snapshot.download_limit_mbps.unwrap_or_default();
                            ui.label(format!(
                                "Download limit: {cap} (about {})",
                                presentation::speed_text(f64::from(mbps) * 125_000.0)
                            ));
                        }
                        if let Some(remaining) = g.timing.remaining {
                            ui.label(format!(
                                "Time left in this step: {}",
                                duration_text(remaining)
                            ));
                        }
                    }
                    ui.separator();
                    if let Some(report) = &snapshot.storage.report {
                        let usage = &report.games[index];
                        ui.label(RichText::new(format!("{} on disk", storage_size(usage.total()))).strong());
                        egui::Grid::new("game-storage").num_columns(2).spacing([32.0, 4.0]).show(ui, |ui| {
                            storage_row(ui, "Game files", usage.files);
                            storage_row(ui, "Downloads", usage.downloads);
                            storage_row(ui, "Temporary files", usage.temporary);
                            storage_row(ui, "Saves, settings & mods", usage.saves);
                        });
                        if matches!(g.game, Game::T5 | Game::T6) {
                            ui.label(RichText::new("Shared launcher files are listed in Settings → Storage.").small().color(MUTED));
                        }
                    } else {
                        ui.label(if snapshot.storage.busy { "Checking storage…" } else { "Storage hasn't been checked yet." });
                    }
                    if snapshot.storage.busy && snapshot.storage.report.is_some() {
                        ui.label(RichText::new("Updating storage sizes…").small().color(MUTED));
                    }
                }
                Dialog::Cancel(index) => {
                    ui.heading("Cancel installation?");
                    ui.label(format!("{} will be removed from the installation list. Its unneeded downloads will be deleted.", snapshot.games[index].game.title()));
                    ui.label("Downloads shared with another game are kept.");
                    if ui.add_enabled_ui(!snapshot.storage.busy && !snapshot.games[index].pausing, |ui| button(ui, Icon::Cancel, "Cancel installation", false)).inner.clicked() {
                        self.send(Command::Storage(storage::Action::Cancel(snapshot.games[index].game)));
                        self.dialog = None;
                    }
                }
                Dialog::Uninstall(index) => {
                    let game = snapshot.games[index].game;
                    ui.heading(format!("Uninstall {}?", game.title()));
                    if let Some(report) = &snapshot.storage.report { ui.label(format!("Game files and local data: {}", storage_size(report.games[index].files + report.games[index].saves))); }
                    ui.checkbox(&mut self.keep_saves, "Keep local saves and settings");
                    ui.label("Kept files return when you reinstall here. Shared account data is kept.");
                    if ui.add_enabled_ui(can_uninstall(snapshot, index), |ui| button(ui, Icon::Trash, "Uninstall game", false)).inner.clicked() {
                        self.send(Command::Storage(storage::Action::Uninstall(game, self.keep_saves)));
                        self.dialog = None;
                        self.settings_tab = SettingsTab::Storage;
                        self.dialog = Some(Dialog::Settings);
                    }
                }
                Dialog::Cleanup => {
                    ui.heading("Free up space?");
                    if let Some(report) = &snapshot.storage.report { ui.label(format!("Remove {:.2} GB of unused downloads and temporary files.", report.reclaimable as f64 / 1e9)); }
                    ui.label("Installed games, saves, and paused downloads are kept.");
                    if ui.add_enabled_ui(!snapshot.busy, |ui| button(ui, Icon::Trash, "Free up space", false)).inner.clicked() {
                        self.send(Command::Storage(storage::Action::Cleanup));
                        self.dialog = Some(Dialog::Settings);
                    }
                }
                Dialog::Problem => {
                    if let Some(problem) = self.problem.clone().or_else(|| snapshot.error.clone()) {
                        self.problem_contents(ui, &problem, None);
                    } else {
                        ui.label("There's nothing to resolve right now.");
                    }
                }
            }
            ui.separator();
            close = ui.button(if matches!(dialog, Dialog::Cancel(_) | Dialog::Uninstall(_) | Dialog::Cleanup) { "Go back" } else { "Close" }).clicked();
        });
        if close || response.should_close() {
            self.dialog = None;
        }
        Some(response.response.rect)
    }
    /// A problem, its next step, and its technical details. `retry` offers Try again for a
    /// failed game setup, noting when the unpacked files will be reused.
    pub(super) fn problem_contents(
        &mut self,
        ui: &mut egui::Ui,
        problem: &Problem,
        retry: Option<(Game, bool)>,
    ) {
        ui.label(RichText::new(problem.title).strong().color(PINK));
        ui.label(problem.next_step);
        ui.label(RichText::new("Error details").small().weak());
        // Keep arbitrary OS paths and upstream output from pushing actions outside the dialog.
        bounded_text(ui, &problem.details, 3);
        ui.horizontal_wrapped(|ui| {
            if let Some((game, resumable)) = retry {
                let response = button(ui, Icon::Refresh, "Try again", true);
                let response = if resumable {
                    response.on_hover_text("Continues from the files already unpacked.")
                } else {
                    response
                };
                if response.clicked() {
                    self.send(Command::Install(game));
                    self.dialog = None;
                }
            }
            if ui.button("Copy error details").clicked() {
                ui.ctx().copy_text(problem.details.clone());
                self.message = Some("Error details copied.".into());
            }
            if ui.button("Save support bundle").clicked() {
                self.export_bundle();
            }
        });
    }
    fn settings_dialog(&mut self, ui: &mut egui::Ui, snapshot: &Snapshot) {
        ui.heading("Settings");
        ui.horizontal(|ui| {
            ui.selectable_value(&mut self.settings_tab, SettingsTab::General, "General");
            if ui
                .selectable_value(&mut self.settings_tab, SettingsTab::Storage, "Storage")
                .clicked()
                && !snapshot.storage.busy
            {
                self.send(Command::Storage(storage::Action::Analyze));
            }
            ui.selectable_value(&mut self.settings_tab, SettingsTab::Updates, "Updates");
        });
        ui.separator();
        if self.settings_tab == SettingsTab::Storage {
            if let Some(report) = &snapshot.storage.report {
                ui.label(
                    RichText::new(format!("{} used", storage_size(report.total())))
                        .strong()
                        .size(20.0),
                );
                egui::Grid::new("storage-breakdown")
                    .num_columns(2)
                    .spacing([32.0, 4.0])
                    .show(ui, |ui| {
                        for (i, game) in Game::ALL.iter().enumerate() {
                            storage_row(ui, game.title(), report.games[i].total());
                        }
                        storage_row(ui, "Shared game launchers", report.shared);
                        storage_row(ui, "Glitter Boys & logs", report.launcher);
                        if report.other > 0 {
                            storage_row(ui, "Other files", report.other);
                        }
                    });
                ui.label(
                    RichText::new(
                        "Game totals include downloads, temporary files, and saved data.",
                    )
                    .small()
                    .color(MUTED),
                );
                ui.separator();
                ui.label(format!(
                    "{} of unused files can be removed",
                    storage_size(report.reclaimable)
                ));
            } else if !snapshot.storage.busy {
                ui.label("Check storage to see how much space your games use.");
            }
            if let Some(message) = &snapshot.storage.message {
                bounded_text(ui, message, 2);
            }
            ui.horizontal(|ui| {
                if ui
                    .add_enabled_ui(!snapshot.storage.busy, |ui| {
                        button(ui, Icon::Refresh, "Refresh", false)
                    })
                    .inner
                    .clicked()
                {
                    self.send(Command::Storage(storage::Action::Analyze));
                }
                if ui
                    .add_enabled_ui(
                        !snapshot.busy
                            && snapshot
                                .storage
                                .report
                                .as_ref()
                                .is_some_and(|r| r.reclaimable > 0),
                        |ui| button(ui, Icon::Trash, "Free up space", false),
                    )
                    .inner
                    .clicked()
                {
                    self.dialog = Some(Dialog::Cleanup);
                }
            });
            ui.label(
                RichText::new(
                    "Paused downloads are kept. Cancel an installation to remove its downloads.",
                )
                .small(),
            );
            if snapshot.busy && !snapshot.storage.busy {
                ui.label(
                    RichText::new("Pause installations to free up space.")
                        .small()
                        .color(MUTED),
                );
            }
            return;
        }
        if self.settings_tab == SettingsTab::General {
            ui.label(RichText::new("Game folder").strong());
            if let Ok(library) = &self.library {
                let path = library.settings.library.display().to_string();
                ui.add(egui::Label::new(&path).truncate())
                    .on_hover_text(&path);
                let space = install::available_bytes(&library.settings.library)
                    .map(|bytes| format!("{:.0} GB available", bytes as f64 / 1e9))
                    .unwrap_or_else(|_| {
                        "Couldn't check free space. Make sure this drive is connected.".into()
                    });
                ui.label(space);
            }
            if button(ui, Icon::Folder, "Open game folder", false).clicked()
                && let Ok(library) = &self.library
            {
                let result = install::library_folder(&library.settings.library)
                    .and_then(|path| open::that(path).map_err(Into::into));
                if let Err(e) = result {
                    self.report(&e);
                }
            }
            if ui
                .add_enabled(
                    !snapshot.busy && snapshot.queued == 0,
                    egui::Button::new("Change game folder"),
                )
                .clicked()
            {
                self.change_folder();
            }
            if snapshot.busy || snapshot.queued > 0 {
                ui.label(RichText::new("Pause installations and remove them from the list below before changing folders. Existing games won't be moved.").small());
            } else {
                ui.label(RichText::new("A GlitterBoys folder is created inside your selection. Existing games won't be moved.").small());
            }
            if snapshot.queued > 0 {
                if ui
                    .add_enabled(
                        !snapshot.busy,
                        egui::Button::new("Remove paused installations from the list"),
                    )
                    .clicked()
                {
                    self.send(Command::Clear);
                }
                ui.label(RichText::new("Saved downloads stay in their original folder. Install again there to reuse them.").small());
            }
            ui.separator();
            let mut draft = *self
                .download_limit_draft
                .get_or_insert(snapshot.download_limit_mbps.unwrap_or(50));
            let mut limited = snapshot.download_limit_mbps.is_some();
            ui.horizontal(|ui| {
                if ui.checkbox(&mut limited, "Limit download speed to").changed() {
                    self.send(Command::DownloadLimit(limited.then_some(draft)));
                }
                let response = ui.add_enabled(
                    limited,
                    egui::DragValue::new(&mut draft)
                        .range(1..=glitter_boys_core::download::MAX_LIMIT_MBPS)
                        .speed(1.0)
                        .suffix(" Mbps"),
                );
                ui.label(
                    RichText::new(format!(
                        "≈ {}",
                        presentation::speed_text(f64::from(draft) * 125_000.0)
                    ))
                    .small()
                    .color(MUTED),
                );
                self.download_limit_draft = Some(draft);
                // Apply when the value settles, not on every drag step.
                if let Some(current) = snapshot.download_limit_mbps
                    && (response.drag_stopped() || response.lost_focus())
                    && draft != current
                {
                    self.send(Command::DownloadLimit(Some(draft)));
                }
            })
            .response
            .on_hover_text("Applies to game downloads right away. Updates run by MW2 or Plutonium themselves aren't limited.");
            ui.separator();
            let mut enabled = glitter_boys_core::diagnostics::enabled();
            if ui
                .checkbox(&mut enabled, "Share error and performance reports")
                .changed()
                && let Err(e) = glitter_boys_core::diagnostics::set_enabled(enabled)
            {
                self.report(&e);
            }
            ui.label(
                RichText::new("Reports are numbers and categories only: no passwords, account details, file paths, or chat.")
                    .small(),
            );
            return;
        }
        ui.separator();
        ui.label(format!("Glitter Boys · {}", env!("CARGO_PKG_VERSION")));
        let update = self
            .updater
            .as_ref()
            .map_err(|e| e.to_string())
            .and_then(|u| u.snapshot().map_err(|e| e.to_string()));
        match update {
            Ok(update) => {
                bounded_text(ui, &update.message, 2);
                if let Some(error) = update.error
                    && ui.small_button("Copy update error").clicked()
                {
                    ui.ctx().copy_text(error);
                }
                if ui
                    .add_enabled(
                        update.supported && !update.checking && update.ready.is_none(),
                        egui::Button::new("Check for updates"),
                    )
                    .clicked()
                    && let Ok(updater) = &self.updater
                {
                    updater.check();
                }
            }
            Err(error) => {
                ui.label("Updates couldn't be checked. Games are still available.");
                if ui.button("Copy update error").clicked() {
                    ui.ctx().copy_text(error);
                }
            }
        }
    }
    fn help_dialog(&mut self, ui: &mut egui::Ui) {
        ui.heading("Help");
        ui.label("Choose Install on a game, wait for setup, then choose Play. You can install more than one game at a time.");
        if ui.button("Open the getting-started guide").clicked() {
            self.open_link("https://glitter-boys.com/docs/launcher/");
        }
        ui.label("Black Ops and Black Ops II may ask you to sign in to Plutonium. Sign in only in its own window; Glitter Boys never asks for your password.");
        ui.separator();
        ui.label("Still stuck? Save a support bundle and send it to Jerred with a description of what happened.");
        if ui.button("Save support bundle").clicked() {
            self.export_bundle();
        }
        ui.label(RichText::new("Saving a bundle doesn't send it anywhere. It has launcher logs, settings, and file names from your game folders, with your Windows user name removed. It never includes Plutonium account details, saves, or passwords.").small());
        ui.checkbox(&mut self.advanced_help, "Show advanced tools");
        if self.advanced_help {
            ui.horizontal(|ui| {
                if ui.button("Open logs").clicked() {
                    self.open_logs();
                }
                if ui.button("Advanced guides").clicked() {
                    self.open_link("https://glitter-boys.com/docs/");
                }
            });
        }
    }
    fn export_bundle(&mut self) {
        let Some(path) = rfd::FileDialog::new()
            .set_file_name(glitter_boys_core::support::file_name(
                std::time::SystemTime::now(),
            ))
            .add_filter("Zip archive", &["zip"])
            .save_file()
        else {
            return;
        };
        let snapshot = self.snapshot().ok();
        let update = self.updater.as_ref().ok().and_then(|u| u.snapshot().ok());
        let (data, library) = match &self.library {
            Ok(library) => (library.data.clone(), Some(library.settings.library.clone())),
            Err(_) => match glitter_boys_core::state::data_directory() {
                Ok(data) => (data, None),
                Err(e) => return self.report(&e),
            },
        };
        let result = glitter_boys_core::support::write_bundle(
            &path,
            &glitter_boys_core::support::BundleInput {
                data: &data,
                library: library.as_deref(),
                snapshot: snapshot.as_ref(),
                update: update.as_ref(),
                launcher_problem: self.problem.as_ref(),
            },
        );
        match result {
            Ok(summary) => {
                tracing::info!(path = %path.display(), entries = summary.entries, truncated = ?summary.truncated, "support bundle saved");
                self.message = Some(format!("Support bundle saved to {}", path.display()));
                self.dialog = None;
                if let Some(folder) = path.parent()
                    && let Err(e) = open::that(folder)
                {
                    tracing::warn!(%e, "could not open the bundle folder");
                }
            }
            Err(e) => self.report(&e),
        }
    }
    fn open_logs(&mut self) {
        match glitter_boys_core::diagnostics::logs_directory() {
            Some(path) => {
                if let Err(e) = open::that(path) {
                    self.report(&e.into());
                }
            }
            None => {
                self.problem = Some(Problem::new(
                    "Logs aren't available",
                    "Restart Glitter Boys and try again.",
                    "Local diagnostics did not initialize.",
                ))
            }
        }
    }
    fn open_link(&mut self, url: &str) {
        if let Err(e) = open::that(url) {
            self.report(&e.into());
        }
    }
    fn change_folder(&mut self) {
        if let Some(root) = rfd::FileDialog::new()
            .set_title("Choose where to create your GlitterBoys game folder")
            .pick_folder()
            && let Ok(library) = &mut self.library
        {
            let mut settings = library.settings.clone();
            settings.library = root.join("GlitterBoys");
            settings.queue.clear();
            let result = (|| -> Result<()> {
                let scheduler =
                    Scheduler::start(Catalog::bundled()?, library.data.clone(), settings.clone())?;
                settings.save(&library.data)?;
                library.scheduler = scheduler;
                library.settings = settings;
                Ok(())
            })();
            if let Err(e) = result {
                self.report(&e);
            }
        }
    }
}

fn bounded_text(ui: &mut egui::Ui, text: &str, rows: usize) {
    let mut job = egui::text::LayoutJob::simple(
        text.into(),
        egui::TextStyle::Body.resolve(ui.style()),
        ui.visuals().text_color(),
        ui.available_width(),
    );
    job.wrap.max_rows = rows;
    ui.add(egui::Label::new(job).wrap());
}

pub(super) fn can_uninstall(snapshot: &Snapshot, index: usize) -> bool {
    let game = &snapshot.games[index];
    game.phase == Phase::Ready && !game.pausing && !snapshot.storage.busy
}

fn storage_size(bytes: u64) -> String {
    if bytes >= 1_000_000_000 {
        format!("{:.2} GB", bytes as f64 / 1e9)
    } else if bytes >= 1_000_000 {
        format!("{:.1} MB", bytes as f64 / 1e6)
    } else if bytes >= 1_000 {
        format!("{:.1} KB", bytes as f64 / 1e3)
    } else {
        format!("{bytes} B")
    }
}

fn storage_row(ui: &mut egui::Ui, label: &str, bytes: u64) {
    ui.label(label);
    ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
        ui.label(storage_size(bytes));
    });
    ui.end_row();
}
