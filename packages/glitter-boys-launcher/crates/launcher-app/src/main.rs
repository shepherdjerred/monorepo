#![cfg_attr(
    all(target_os = "windows", not(debug_assertions)),
    windows_subsystem = "windows"
)]
//! Native Windows launcher using the same egui/eframe stack as Scout Desktop.

mod startup;
mod ui;

fn main() -> eframe::Result {
    let startup = match startup::Startup::parse(std::env::args_os().skip(1)) {
        Ok(startup) => startup,
        Err(error) => {
            rfd::MessageDialog::new()
                .set_title("Glitter Boys needs attention")
                .set_description(error.to_string())
                .set_level(rfd::MessageLevel::Error)
                .show();
            return Ok(());
        }
    };
    match glitter_boys_core::updates::bootstrap() {
        Ok(true) => return Ok(()),
        Ok(false) => {}
        Err(error) => {
            rfd::MessageDialog::new()
                .set_title("Glitter Boys needs attention")
                .set_description(error.to_string())
                .set_level(rfd::MessageLevel::Error)
                .show();
            return Ok(());
        }
    }
    let diagnostics_error = glitter_boys_core::diagnostics::initialize(&startup.data)
        .err()
        .map(|error| format!("Local diagnostics could not start: {error}"));
    let options = eframe::NativeOptions {
        viewport: eframe::egui::ViewportBuilder::default()
            .with_app_id("com.glitter-boys.launcher")
            .with_title("Glitter Boys")
            .with_inner_size([900.0, 640.0])
            .with_min_inner_size([760.0, 560.0]),
        ..Default::default()
    };
    eframe::run_native(
        "Glitter Boys",
        options,
        Box::new(move |context| {
            Ok(Box::new(ui::Launcher::new(
                context,
                diagnostics_error,
                startup,
            )))
        }),
    )
}
