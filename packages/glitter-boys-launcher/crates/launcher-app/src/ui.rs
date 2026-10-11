//! A simple game library with supporting information in focused dialogs.
mod dialogs;
mod game_art;
pub(crate) mod icons;
mod presentation;
mod rows;
#[cfg(test)]
mod tests;
mod theme;
use eframe::egui::{self, Color32, RichText};
use glitter_boys_core::{
    Result,
    catalog::{Catalog, Game, Mode},
    install,
    problem::{Activity, Problem},
    scheduler::{Command, Phase, Scheduler, Snapshot},
    state::{self, Settings},
    storage,
};
use icons::{Icon, button};
use presentation::card_copy;
use std::{fs::File, path::PathBuf, time::Duration};
const INK: Color32 = Color32::from_rgb(18, 18, 25);
const SURFACE: Color32 = Color32::from_rgb(27, 26, 35);
const LINE: Color32 = Color32::from_rgb(46, 43, 58);
const MUTED: Color32 = Color32::from_rgb(155, 151, 169);
const LILAC: Color32 = Color32::from_rgb(185, 162, 239);
const PINK: Color32 = Color32::from_rgb(237, 153, 176);
struct Library {
    data: PathBuf,
    settings: Settings,
    scheduler: Scheduler,
    _lock: File,
}
impl Library {
    fn load(data: PathBuf, resume: bool) -> Result<Self> {
        std::fs::create_dir_all(&data)?;
        let lock = state::exclusive_lock(&data.join("launcher.lock"))?;
        let catalog = Catalog::bundled()?;
        let mut settings = Settings::load(&data)?;
        settings.reconcile_queue(&catalog)?;
        settings.save(&data)?;
        let scheduler = Scheduler::start(catalog, data.clone(), settings.clone())?;
        if resume {
            scheduler.send(Command::ResumeAll)?;
        }
        Ok(Self {
            data,
            settings,
            scheduler,
            _lock: lock,
        })
    }
}
#[derive(Clone, Copy, PartialEq, Eq)]
enum Dialog {
    Settings,
    Help,
    Details(usize),
    Problem,
    Cancel(usize),
    Uninstall(usize),
    Cleanup,
}
#[derive(Clone, Copy, PartialEq, Eq, Default)]
enum SettingsTab {
    #[default]
    General,
    Storage,
    Updates,
}
pub struct Launcher {
    game_icons: [egui::TextureHandle; 4],
    library: Result<Library>,
    message: Option<String>,
    problem: Option<Problem>,
    dialog: Option<Dialog>,
    advanced_help: bool,
    closing: bool,
    updater: Result<glitter_boys_core::updates::Updater>,
    healthy: bool,
    settings_tab: SettingsTab,
    keep_saves: bool,
}
impl Launcher {
    pub fn new(
        context: &eframe::CreationContext<'_>,
        message: Option<String>,
        startup: crate::startup::Startup,
    ) -> Result<Self> {
        Self::configure(&context.egui_ctx);
        Ok(Self {
            game_icons: game_art::load(&context.egui_ctx)?,
            library: Library::load(startup.data, startup.resume),
            message,
            problem: None,
            dialog: None,
            advanced_help: false,
            closing: false,
            updater: glitter_boys_core::updates::Updater::new(),
            healthy: false,
            settings_tab: SettingsTab::General,
            keep_saves: true,
        })
    }
    fn report(&mut self, error: &glitter_boys_core::Error) {
        self.problem = Some(Problem::from_error(error, Activity::Launcher));
        if self.dialog.is_some() {
            self.dialog = Some(Dialog::Problem);
        }
    }
    fn send(&mut self, command: Command) {
        let result = self
            .library
            .as_ref()
            .ok()
            .map(|l| l.scheduler.send(command));
        if let Some(Err(error)) = result {
            self.report(&error);
        }
    }
    fn snapshot(&self) -> Result<Snapshot> {
        match &self.library {
            Ok(library) => library.scheduler.snapshot(),
            Err(e) => Err(glitter_boys_core::Error::Invalid(e.to_string())),
        }
    }
    fn footer(&mut self, ui: &mut egui::Ui, snapshot: &Snapshot) {
        ui.horizontal(|ui| {
            let active = snapshot.games.iter().any(|g| {
                matches!(
                    g.phase,
                    Phase::Waiting | Phase::Downloading | Phase::Extracting | Phase::Preparing
                )
            });
            if snapshot.queued > 0 {
                ui.label(
                    RichText::new(format!(
                        "{} installation{}",
                        snapshot.queued,
                        if snapshot.queued == 1 { "" } else { "s" }
                    ))
                    .small(),
                );
                if ui
                    .add_enabled(
                        !self.closing && (active || !snapshot.busy),
                        egui::Button::new(if active { "Pause all" } else { "Resume all" }),
                    )
                    .clicked()
                {
                    self.send(if active {
                        Command::PauseAll
                    } else {
                        Command::ResumeAll
                    });
                }
            }
        });
    }
    fn render(&mut self, ui: &mut egui::Ui, snapshot: &Snapshot) -> egui::Rect {
        let rect = egui::CentralPanel::default()
            .frame(egui::Frame::new().fill(INK).inner_margin(20))
            .show(ui, |ui| {
                ui.horizontal(|ui| {
                    ui.label(
                        RichText::new("GLITTER BOYS")
                            .font(egui::FontId::new(
                                27.0,
                                egui::FontFamily::Name("Brand".into()),
                            ))
                            .color(LILAC),
                    );
                    ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                        if button(ui, Icon::Help, "Help", false).clicked() { self.dialog = Some(Dialog::Help); }
                        if button(ui, Icon::Gear, "Settings", false).clicked() { self.dialog = Some(Dialog::Settings); }
                    });
                });
                ui.add_space(16.0);
                ui.horizontal(|ui| {
                    ui.label(RichText::new("Your games").size(20.0).strong());
                    ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                        ui.label(RichText::new("4 games").size(12.0).color(MUTED));
                    });
                });
                ui.add_space(8.0);
                let height = ((ui.available_height() - 90.0) / 4.0 - 6.0).clamp(82.0, 112.0);
                for index in 0..4 {
                    self.card(ui, snapshot, index, height);
                    if index < 3 { ui.add_space(2.0); }
                }
                ui.add_space(6.0);
                ui.separator();
                let problem = self.problem.as_ref().or(snapshot.error.as_ref());
                if self.closing {
                    ui.label(
                        RichText::new(presentation::closing_text(snapshot))
                            .small()
                            .color(LILAC),
                    );
                } else if let Some(problem) = problem {
                    let title = problem.title;
                    ui.horizontal(|ui| {
                        ui.label(RichText::new(title).small().color(PINK));
                        if ui.small_button("Get help").clicked() {
                            self.dialog = Some(Dialog::Problem);
                        }
                    });
                } else {
                    let update_ready = self
                        .updater
                        .as_ref()
                        .ok()
                        .and_then(|u| u.snapshot().ok())
                        .is_some_and(|s| s.ready.is_some());
                    ui.horizontal(|ui| {
                        if self.message.is_some() {
                            ui.with_layout(
                                egui::Layout::right_to_left(egui::Align::Center),
                                |ui| {
                                    if ui.small_button("Dismiss").clicked() {
                                        self.message = None;
                                    }
                                    let text = self.message.as_deref().unwrap_or_default();
                                    ui.add(
                                        egui::Label::new(RichText::new(text).small().weak())
                                            .truncate(),
                                    )
                                    .on_hover_text(text);
                                },
                            );
                            return;
                        }
                        if let Some(message) = &snapshot.storage.message {
                            ui.add(egui::Label::new(RichText::new(message).small()).truncate()).on_hover_text(message);
                            if !snapshot.storage.busy && ui.small_button("Dismiss").clicked() { self.send(Command::DismissStorageMessage); }
                        } else if update_ready {
                            ui.label(RichText::new("An update is ready. It will install when you close Glitter Boys.").small());
                        } else {
                            ui.allocate_space(egui::Vec2::ZERO);
                        }
                    });
                }
                self.footer(ui, snapshot);
                ui.min_rect()
            })
            .inner;
        self.show_dialog(ui.ctx(), snapshot)
            .map_or(rect, |dialog| rect.union(dialog))
    }
}
fn play_buttons(ui: &mut egui::Ui, game: Game, enabled: bool) -> Option<Mode> {
    let choices: &[(&str, Mode)] = match game {
        Game::T5 | Game::T6 => &[
            ("Play Multiplayer", Mode::Multiplayer),
            ("Play Zombies", Mode::Zombies),
        ],
        Game::Iw4x => &[("Play", Mode::Multiplayer)],
        Game::T7 => &[("Play", Mode::Zombies)],
    };
    let mut selected = None;
    for index in 0..choices.len() {
        let (label, mode) = choices[if ui.layout().main_dir == egui::Direction::RightToLeft {
            choices.len() - 1 - index
        } else {
            index
        }];
        if ui
            .add_enabled_ui(enabled, |ui| button(ui, Icon::Play, label, true))
            .inner
            .clicked()
        {
            selected = Some(mode);
        }
    }
    selected
}
fn duration_text(duration: Duration) -> String {
    let seconds = duration.as_secs();
    if seconds >= 3600 {
        format!("{}h {:02}m", seconds / 3600, seconds % 3600 / 60)
    } else if seconds >= 60 {
        format!("{}m {:02}s", seconds / 60, seconds % 60)
    } else {
        format!("{seconds}s")
    }
}
impl eframe::App for Launcher {
    fn on_exit(&mut self, _: Option<&eframe::glow::Context>) {
        if self.snapshot().is_ok_and(|s| !s.busy)
            && let Ok(updater) = &self.updater
            && let Err(error) = updater.apply_on_exit()
        {
            glitter_boys_core::diagnostics::record(
                None,
                glitter_boys_core::diagnostics::Operation::UpdateApply,
                glitter_boys_core::diagnostics::Outcome::Failed,
                glitter_boys_core::diagnostics::failure(&error),
                0,
                0,
            );
        }
    }
    fn logic(&mut self, context: &egui::Context, _: &mut eframe::Frame) {
        if !self.healthy && self.library.is_ok() {
            match glitter_boys_core::updates::commit_startup() {
                Ok(()) => {
                    self.healthy = true;
                    if let Ok(updater) = &self.updater {
                        updater.check();
                    }
                }
                Err(e) => self.report(&e),
            }
        }
        let busy = self.snapshot().is_ok_and(|s| s.busy);
        if context.input(|i| i.viewport().close_requested()) && busy {
            context.send_viewport_cmd(egui::ViewportCommand::CancelClose);
            self.closing = true;
            self.send(Command::Shutdown);
        }
        if self.closing && !busy {
            context.send_viewport_cmd(egui::ViewportCommand::Close);
        }
        context.request_repaint_after(Duration::from_millis(100));
    }
    fn ui(&mut self, ui: &mut egui::Ui, _: &mut eframe::Frame) {
        match self.snapshot() {
            Ok(snapshot) => {
                self.render(ui, &snapshot);
            }
            Err(e) => {
                let problem = Problem::from_error(&e, Activity::Launcher);
                ui.heading("Glitter Boys couldn't open your library");
                ui.label(problem.next_step);
                ui.label("Your game files have not been removed.");
                self.problem_contents(ui, &problem);
            }
        }
    }
}
