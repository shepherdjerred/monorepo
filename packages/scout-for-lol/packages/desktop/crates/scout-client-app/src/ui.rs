//! Minimal egui status and diagnostics surface.

use std::sync::mpsc::{self, Receiver};

use eframe::egui;
use tray_icon::menu::{Menu, MenuEvent, MenuItem};
use tray_icon::{Icon, TrayIcon, TrayIconBuilder};

use crate::runtime::{ClientRuntime, RuntimeState};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Page {
    Overview,
    Activity,
    Settings,
    Diagnostics,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TrayCommand {
    Open,
    Quit,
}

/// Native Scout Client egui application.
pub struct ScoutApp {
    runtime: ClientRuntime,
    page: Page,
    quitting: bool,
    tray_commands: Receiver<TrayCommand>,
    tray: Option<TrayIcon>,
}

impl ScoutApp {
    /// Create the egui app and native tray on the UI thread.
    pub fn new(context: &eframe::CreationContext<'_>, runtime: ClientRuntime) -> Self {
        context.egui_ctx.set_theme(egui::Theme::Dark);
        let (tray, tray_commands) = create_tray(&context.egui_ctx);
        if should_reveal_after_tray_creation(tray.is_some()) {
            tracing::warn!("tray initialization failed; revealing the Scout Client window");
            context
                .egui_ctx
                .send_viewport_cmd(egui::ViewportCommand::Visible(true));
        }
        Self {
            runtime,
            page: Page::Overview,
            quitting: false,
            tray_commands,
            tray,
        }
    }

    fn snapshot(&self) -> RuntimeState {
        self.runtime
            .state
            .read()
            .map_or_else(|_| RuntimeState::default(), |state| state.clone())
    }

    fn handle_tray(&mut self, context: &egui::Context) {
        while let Ok(command) = self.tray_commands.try_recv() {
            match command {
                TrayCommand::Open => {
                    context.send_viewport_cmd(egui::ViewportCommand::Visible(true));
                    context.send_viewport_cmd(egui::ViewportCommand::Focus);
                }
                TrayCommand::Quit => {
                    self.quitting = true;
                    self.runtime.shutdown();
                    context.send_viewport_cmd(egui::ViewportCommand::Close);
                }
            }
        }
    }
}

impl eframe::App for ScoutApp {
    fn logic(&mut self, context: &egui::Context, _frame: &mut eframe::Frame) {
        self.handle_tray(context);
    }

    fn ui(&mut self, ui: &mut egui::Ui, _frame: &mut eframe::Frame) {
        let context = ui.ctx().clone();
        self.handle_tray(&context);
        if should_hide_on_close(
            self.quitting,
            self.tray.is_some(),
            context.input(|input| input.viewport().close_requested()),
        ) {
            context.send_viewport_cmd(egui::ViewportCommand::CancelClose);
            context.send_viewport_cmd(egui::ViewportCommand::Visible(false));
        }

        egui::Panel::left("navigation")
            .resizable(false)
            .default_size(150.0)
            .show(ui, |ui| {
                ui.heading("Scout");
                ui.add_space(12.0);
                ui.selectable_value(&mut self.page, Page::Overview, "Overview");
                ui.selectable_value(&mut self.page, Page::Activity, "Activity");
                ui.selectable_value(&mut self.page, Page::Settings, "Settings");
                ui.selectable_value(&mut self.page, Page::Diagnostics, "Diagnostics");
            });
        let snapshot = self.snapshot();
        egui::CentralPanel::default().show(ui, |ui| match self.page {
            Page::Overview => overview(ui, &snapshot),
            Page::Activity => activity(ui, &snapshot),
            Page::Settings => settings(ui, &self.runtime, &snapshot),
            Page::Diagnostics => diagnostics(ui, &self.runtime, &snapshot),
        });
        context.request_repaint_after(std::time::Duration::from_secs(1));
    }

    fn on_exit(&mut self, _gl: Option<&eframe::glow::Context>) {
        self.runtime.shutdown();
    }
}

fn should_hide_on_close(quitting: bool, tray_available: bool, close_requested: bool) -> bool {
    !quitting && tray_available && close_requested
}

fn should_reveal_after_tray_creation(tray_available: bool) -> bool {
    !tray_available
}

fn overview(ui: &mut egui::Ui, state: &RuntimeState) {
    ui.heading("League observer");
    ui.add_space(12.0);
    status_row(
        ui,
        "League",
        if state.league_connected {
            "Connected"
        } else {
            "Waiting"
        },
    );
    status_row(
        ui,
        "Account",
        state.account_label.as_deref().unwrap_or("Not detected"),
    );
    status_row(
        ui,
        "Game phase",
        state.gameflow_phase.as_deref().unwrap_or("None"),
    );
    status_row(
        ui,
        "Pending uploads",
        &state.pending_observations.to_string(),
    );
    status_row(
        ui,
        "Scout API",
        if state.paired { "Paired" } else { "Not paired" },
    );
    status_row(
        ui,
        "Last upload",
        state.last_upload_at.as_deref().unwrap_or("Not yet"),
    );
    if let Some(error) = &state.last_error {
        ui.add_space(16.0);
        ui.colored_label(egui::Color32::LIGHT_RED, error);
    }
}

fn activity(ui: &mut egui::Ui, state: &RuntimeState) {
    ui.heading("Activity");
    ui.add_space(12.0);
    ui.label(format!(
        "{} observation(s) waiting for durable upload.",
        state.pending_observations
    ));
}

fn settings(ui: &mut egui::Ui, runtime: &ClientRuntime, state: &RuntimeState) {
    ui.heading("Settings");
    ui.add_space(12.0);
    ui.label(state.pairing_status.as_deref().unwrap_or(if state.paired {
        "Paired"
    } else {
        "Not paired"
    }));
    ui.horizontal(|ui| {
        if !state.paired && ui.button("Pair with Scout").clicked() {
            runtime.start_pairing();
        }
        if let Some(url) = &state.approval_url
            && ui.button("Open approval page").clicked()
            && let Err(error) = open::that(url)
        {
            tracing::warn!(%error, "could not open Scout Client approval page");
        }
        if state.paired && ui.button("Disconnect").clicked() {
            runtime.disconnect();
        }
    });
    ui.add_space(16.0);
    let mut start_at_login = state.start_at_login;
    if ui
        .checkbox(&mut start_at_login, "Start Scout Client at login")
        .changed()
    {
        runtime.set_start_at_login(start_at_login);
    }
    ui.label("Scout observes gameplay state only while League is running.");
}

fn diagnostics(ui: &mut egui::Ui, runtime: &ClientRuntime, state: &RuntimeState) {
    ui.heading("Diagnostics");
    ui.add_space(12.0);
    ui.monospace(format!("Client version: {}", env!("CARGO_PKG_VERSION")));
    ui.monospace(format!(
        "Protocol version: {}",
        scout_client_core::protocol::PROTOCOL_VERSION
    ));
    ui.monospace(format!("League connected: {}", state.league_connected));
    ui.monospace(format!("Outbox depth: {}", state.pending_observations));

    ui.add_space(12.0);
    ui.horizontal(|ui| {
        if let Some(directory) = runtime.log_directory()
            && ui.button("Open log folder").clicked()
            && let Err(error) = open::that_detached(directory)
        {
            tracing::warn!(%error, "could not open the Scout Client log folder");
        }
        if ui.button("Copy diagnostics").clicked() {
            ui.ctx().copy_text(runtime.diagnostics().bundle());
        }
    });

    ui.add_space(12.0);
    ui.strong("Counters");
    egui::Grid::new("diagnostic-counters")
        .num_columns(2)
        .striped(true)
        .show(ui, |ui| {
            for (name, value) in runtime.diagnostics().counters().readings() {
                ui.monospace(name);
                ui.monospace(value.to_string());
                ui.end_row();
            }
        });

    ui.add_space(12.0);
    ui.strong("Recent activity");
    let events = runtime.diagnostics().recent(RECENT_EVENT_ROWS);
    if events.is_empty() {
        ui.label("Nothing recorded yet.");
    } else {
        egui::ScrollArea::vertical()
            .max_height(220.0)
            .show(ui, |ui| {
                for record in &events {
                    ui.monospace(record.summary());
                }
            });
    }

    ui.add_space(12.0);
    ui.label("Credentials, PUUIDs, and local filesystem paths are excluded from diagnostics.");
}

/// Recent events shown on the Diagnostics page.
const RECENT_EVENT_ROWS: usize = 100;

fn status_row(ui: &mut egui::Ui, label: &str, value: &str) {
    ui.horizontal(|ui| {
        ui.strong(label);
        ui.label(value);
    });
}

fn create_tray(context: &egui::Context) -> (Option<TrayIcon>, Receiver<TrayCommand>) {
    let menu = Menu::new();
    let open = MenuItem::new("Open Scout", true, None);
    let quit = MenuItem::new("Quit Scout", true, None);
    let open_id = open.id().clone();
    let quit_id = quit.id().clone();
    if menu.append(&open).is_err() || menu.append(&quit).is_err() {
        let (_sender, receiver) = mpsc::channel();
        return (None, receiver);
    }
    let (sender, receiver) = mpsc::channel();
    let repaint = context.clone();
    MenuEvent::set_event_handler(Some(move |event: MenuEvent| {
        let command = if event.id == open_id {
            Some(TrayCommand::Open)
        } else if event.id == quit_id {
            Some(TrayCommand::Quit)
        } else {
            None
        };
        if let Some(command) = command {
            let _send_result = sender.send(command);
            repaint.request_repaint();
        }
    }));
    let icon_pixels = [59, 130, 246, 255].repeat(32 * 32);
    let icon = Icon::from_rgba(icon_pixels, 32, 32).ok();
    let tray = icon.and_then(|icon| {
        TrayIconBuilder::new()
            .with_menu(Box::new(menu))
            .with_tooltip("Scout Client")
            .with_icon(icon)
            .build()
            .ok()
    });
    (tray, receiver)
}

#[cfg(test)]
mod tests {
    use super::{should_hide_on_close, should_reveal_after_tray_creation};

    #[test]
    fn hides_only_when_a_working_tray_can_reopen_the_window() {
        assert!(should_hide_on_close(false, true, true));
        assert!(!should_hide_on_close(false, false, true));
        assert!(!should_hide_on_close(true, true, true));
        assert!(!should_hide_on_close(false, true, false));
    }

    #[test]
    fn reveals_the_window_when_tray_creation_fails() {
        assert!(should_reveal_after_tray_creation(false));
        assert!(!should_reveal_after_tray_creation(true));
    }
}
