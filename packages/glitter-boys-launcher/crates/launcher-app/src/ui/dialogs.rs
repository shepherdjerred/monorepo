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
                    ui.heading(g.game.title());
                    if let Some(problem) = &g.error {
                        self.problem_contents(ui, problem);
                    } else if g.phase == Phase::Ready {
                        ui.label("Ready to play");
                    } else {
                        ui.label(card_copy(g, snapshot.busy).status);
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
                            ui.label(format!("Speed: {:.1} MB/s", rate / 1e6));
                        }
                        if let Some(remaining) = g.timing.remaining {
                            ui.label(format!(
                                "Time left in this step: {}",
                                duration_text(remaining)
                            ));
                        }
                        ui.label("Pausing saves downloads. Unpacking starts over when resumed.");
                    }
                }
                Dialog::Problem => {
                    if let Some(problem) = self.problem.clone().or_else(|| snapshot.error.clone()) {
                        self.problem_contents(ui, &problem);
                    } else {
                        ui.label("There's nothing to resolve right now.");
                    }
                }
            }
            ui.separator();
            close = ui.button("Close").clicked();
        });
        if close || response.should_close() {
            self.dialog = None;
        }
        Some(response.response.rect)
    }
    pub(super) fn problem_contents(&mut self, ui: &mut egui::Ui, problem: &Problem) {
        ui.label(RichText::new(problem.title).strong().color(PINK));
        ui.label(problem.next_step);
        ui.label(RichText::new("Error details").small().weak());
        // Keep arbitrary OS paths and upstream output from pushing actions outside the dialog.
        bounded_text(ui, &problem.details, 3);
        ui.horizontal(|ui| {
            if ui.button("Copy error details").clicked() {
                ui.ctx().copy_text(problem.details.clone());
                self.message = Some("Error details copied.".into());
            }
            if ui.button("Save support report").clicked() {
                self.export_report();
            }
        });
    }
    fn settings_dialog(&mut self, ui: &mut egui::Ui, snapshot: &Snapshot) {
        ui.heading("Settings");
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
        let mut enabled = glitter_boys_core::diagnostics::enabled();
        if ui
            .checkbox(&mut enabled, "Share error and performance reports")
            .changed()
            && let Err(e) = glitter_boys_core::diagnostics::set_enabled(enabled)
        {
            self.report(&e);
        }
        ui.label(
            RichText::new("Reports exclude passwords, account details, file paths, and chat.")
                .small(),
        );
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
        ui.label("Still stuck? Save a support report and send it to Jerred with a description of what happened.");
        if ui.button("Save support report").clicked() {
            self.export_report();
        }
        ui.label(RichText::new("Saving a report doesn't send it anywhere. It contains launcher events, not your Plutonium account details.").small());
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
    fn export_report(&mut self) {
        if let Some(path) = rfd::FileDialog::new()
            .set_file_name("glitter-boys-support.txt")
            .save_file()
        {
            match glitter_boys_core::diagnostics::export(&path) {
                Ok(()) => {
                    self.message = Some(format!("Support report saved to {}", path.display()));
                    self.dialog = None;
                }
                Err(e) => self.report(&e),
            }
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
