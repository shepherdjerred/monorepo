use super::*;
impl Launcher {
    pub(super) fn configure(context: &egui::Context) {
        let mut fonts = egui::FontDefinitions::default();
        fonts.font_data.insert(
            "Atkinson".into(),
            egui::FontData::from_static(include_bytes!(
                "../../../../assets/AtkinsonHyperlegible-Regular.ttf"
            ))
            .into(),
        );
        fonts.font_data.insert(
            "Luckiest Guy".into(),
            egui::FontData::from_static(include_bytes!(
                "../../../../assets/LuckiestGuy-Regular.ttf"
            ))
            .into(),
        );
        fonts
            .families
            .entry(egui::FontFamily::Proportional)
            .or_default()
            .insert(0, "Atkinson".into());
        fonts.families.insert(
            egui::FontFamily::Name("Brand".into()),
            vec!["Luckiest Guy".into()],
        );
        context.set_fonts(fonts);
        context.set_theme(egui::Theme::Dark);
        let mut visuals = egui::Visuals::dark();
        visuals.panel_fill = INK;
        visuals.window_fill = Color32::from_rgb(35, 21, 56);
        visuals.widgets.noninteractive.bg_fill = Color32::from_rgb(35, 21, 56);
        visuals.widgets.inactive.bg_fill = Color32::from_rgb(61, 41, 83);
        visuals.widgets.hovered.bg_fill = Color32::from_rgb(87, 57, 115);
        visuals.selection.bg_fill = Color32::from_rgb(102, 62, 139);
        visuals.hyperlink_color = LILAC;
        visuals.override_text_color = Some(Color32::from_rgb(238, 231, 247));
        context.set_visuals(visuals);
        context.style_mut_of(egui::Theme::Dark, |style| {
            style
                .text_styles
                .insert(egui::TextStyle::Body, egui::FontId::proportional(14.0));
            style
                .text_styles
                .insert(egui::TextStyle::Button, egui::FontId::proportional(14.0));
            style
                .text_styles
                .insert(egui::TextStyle::Small, egui::FontId::proportional(13.0));
            style.spacing.button_padding = egui::vec2(10.0, 5.0);
        });
    }
}
