//! Bundled game icons, decoded once when the UI starts.
use super::*;

pub(super) fn load(context: &egui::Context) -> Result<[egui::TextureHandle; 4]> {
    let load = |name: &str, bytes: &[u8]| -> Result<egui::TextureHandle> {
        let icon = eframe::icon_data::from_png_bytes(bytes).map_err(|error| {
            glitter_boys_core::Error::Invalid(format!("Invalid bundled {name} icon: {error}"))
        })?;
        let image = egui::ColorImage::from_rgba_unmultiplied(
            [icon.width as usize, icon.height as usize],
            &icon.rgba,
        );
        Ok(context.load_texture(name, image, egui::TextureOptions::LINEAR))
    };
    Ok([
        load("MW2", include_bytes!("../../../../assets/games/mw2.png"))?,
        load(
            "Black Ops",
            include_bytes!("../../../../assets/games/bo1.png"),
        )?,
        load(
            "Black Ops II",
            include_bytes!("../../../../assets/games/bo2.png"),
        )?,
        load(
            "Black Ops III",
            include_bytes!("../../../../assets/games/bo3.png"),
        )?,
    ])
}
