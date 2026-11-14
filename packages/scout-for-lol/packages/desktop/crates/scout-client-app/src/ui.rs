//! Minimal egui status and diagnostics surface, rendered from the supervisor's
//! snapshots.

use eframe::egui;
use scout_desktop_ipc::{GameflowPhase, StateSnapshot, WindowMessage};

use crate::window::SupervisorLink;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Page {
    Overview,
    Activity,
    Settings,
    Diagnostics,
}

/// Native Scout Client egui application.
pub struct ScoutApp {
    link: SupervisorLink,
    page: Page,
    closing: bool,
    tray_available: bool,
    state: StateSnapshot,
    phase: GameflowPhase,
}

impl ScoutApp {
    /// Create the egui app and start listening to the supervisor.
    pub fn new(context: &eframe::CreationContext<'_>, link: SupervisorLink) -> Self {
        context.egui_ctx.set_theme(egui::Theme::Dark);
        link.listen(context.egui_ctx.clone());
        Self {
            link,
            page: Page::Overview,
            closing: false,
            tray_available: false,
            state: StateSnapshot::default(),
            phase: GameflowPhase::default(),
        }
    }

    fn receive(&mut self, context: &egui::Context) {
        let updates = self.link.updates();
        self.tray_available = updates.tray_available;
        self.state = updates.state;
        self.phase = updates.phase;
        if let Some(bundle) = updates.bundle {
            context.copy_text(bundle);
        }
        if updates.show {
            context.send_viewport_cmd(egui::ViewportCommand::Visible(true));
            context.send_viewport_cmd(egui::ViewportCommand::Focus);
        }
        if updates.close && !self.closing {
            self.closing = true;
            context.send_viewport_cmd(egui::ViewportCommand::Close);
        }
    }

    fn send(&self, message: &WindowMessage) {
        // A failed send marks the link closed; the next frame closes the window.
        let _delivered = self.link.send(message);
    }
}

impl eframe::App for ScoutApp {
    fn logic(&mut self, context: &egui::Context, _frame: &mut eframe::Frame) {
        self.receive(context);
    }

    fn ui(&mut self, ui: &mut egui::Ui, _frame: &mut eframe::Frame) {
        let context = ui.ctx().clone();
        if should_quit_on_close(
            self.closing,
            self.tray_available,
            context.input(|input| input.viewport().close_requested()),
        ) {
            // Nothing else could reopen the window, so closing it quits Scout.
            self.send(&WindowMessage::Quit);
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
        let mut outgoing = Vec::new();
        egui::CentralPanel::default().show(ui, |ui| match self.page {
            Page::Overview => overview(ui, &self.state),
            Page::Activity => activity(ui, &self.state),
            Page::Settings => settings(ui, &self.state, &mut outgoing),
            Page::Diagnostics => diagnostics(ui, &self.state, &self.phase, &mut outgoing),
        });
        for message in &outgoing {
            self.send(message);
        }
        context.request_repaint_after(std::time::Duration::from_secs(1));
    }
}

/// With a tray, closing the window only ends this process; the supervisor
/// keeps collecting and the tray can open a new window. Without one, it quits.
fn should_quit_on_close(closing: bool, tray_available: bool, close_requested: bool) -> bool {
    !closing && !tray_available && close_requested
}

fn overview(ui: &mut egui::Ui, state: &StateSnapshot) {
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

fn activity(ui: &mut egui::Ui, state: &StateSnapshot) {
    ui.heading("Activity");
    ui.add_space(12.0);
    ui.label(format!(
        "{} observation(s) waiting for durable upload.",
        state.pending_observations
    ));
}

fn settings(ui: &mut egui::Ui, state: &StateSnapshot, outgoing: &mut Vec<WindowMessage>) {
    ui.heading("Settings");
    ui.add_space(12.0);
    ui.label(state.pairing_status.as_deref().unwrap_or(if state.paired {
        "Paired"
    } else {
        "Not paired"
    }));
    ui.horizontal(|ui| {
        if !state.paired && ui.button("Pair with Scout").clicked() {
            outgoing.push(WindowMessage::Pair);
        }
        if let Some(url) = &state.approval_url
            && ui.button("Open approval page").clicked()
        {
            outgoing.push(WindowMessage::OpenUrl { url: url.clone() });
        }
        if state.paired && ui.button("Disconnect").clicked() {
            outgoing.push(WindowMessage::Disconnect);
        }
    });
    ui.add_space(16.0);
    let mut start_at_login = state.start_at_login;
    if ui
        .checkbox(&mut start_at_login, "Start Scout Client at login")
        .changed()
    {
        outgoing.push(WindowMessage::SetStartAtLogin {
            enabled: start_at_login,
        });
    }
    ui.label("Scout observes gameplay state only while League is running.");
    ui.add_space(16.0);
    if ui.button("Quit Scout").clicked() {
        outgoing.push(WindowMessage::Quit);
    }
}

fn diagnostics(
    ui: &mut egui::Ui,
    state: &StateSnapshot,
    phase: &GameflowPhase,
    outgoing: &mut Vec<WindowMessage>,
) {
    ui.heading("Diagnostics");
    ui.add_space(12.0);
    ui.monospace(format!("Client version: {}", env!("CARGO_PKG_VERSION")));
    ui.monospace(format!(
        "Protocol version: {}",
        scout_client_core::protocol::PROTOCOL_VERSION
    ));
    ui.monospace(format!("League connected: {}", state.league_connected));
    ui.monospace(format!("Gameflow phase: {phase:?}"));
    ui.monospace(format!("Outbox depth: {}", state.pending_observations));

    ui.add_space(12.0);
    ui.horizontal(|ui| {
        if state.diagnostics.log_folder_available && ui.button("Open log folder").clicked() {
            outgoing.push(WindowMessage::OpenLogFolder);
        }
        if ui.button("Copy diagnostics").clicked() {
            outgoing.push(WindowMessage::RequestDiagnostics);
        }
    });

    ui.add_space(12.0);
    ui.strong("Counters");
    egui::Grid::new("diagnostic-counters")
        .num_columns(2)
        .striped(true)
        .show(ui, |ui| {
            for counter in &state.diagnostics.counters {
                ui.monospace(&counter.name);
                ui.monospace(counter.value.to_string());
                ui.end_row();
            }
        });

    ui.add_space(12.0);
    ui.strong("Recent activity");
    if state.diagnostics.recent_events.is_empty() {
        ui.label("Nothing recorded yet.");
    } else {
        egui::ScrollArea::vertical()
            .max_height(220.0)
            .show(ui, |ui| {
                for summary in &state.diagnostics.recent_events {
                    ui.monospace(summary);
                }
            });
    }

    ui.add_space(12.0);
    ui.label("Credentials, PUUIDs, and local filesystem paths are excluded from diagnostics.");
}

fn status_row(ui: &mut egui::Ui, label: &str, value: &str) {
    ui.horizontal(|ui| {
        ui.strong(label);
        ui.label(value);
    });
}

#[cfg(test)]
mod tests {
    use super::should_quit_on_close;

    #[test]
    fn closing_quits_only_when_no_tray_can_reopen_the_window() {
        assert!(should_quit_on_close(false, false, true));
        assert!(!should_quit_on_close(false, true, true));
        assert!(!should_quit_on_close(true, false, true));
        assert!(!should_quit_on_close(false, false, false));
    }
}
