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
        visuals.window_fill = SURFACE;
        visuals.window_shadow = egui::epaint::Shadow::NONE;
        visuals.window_stroke = egui::Stroke::new(1.0, LINE);
        visuals.window_corner_radius = 12.into();
        visuals.widgets.noninteractive.bg_fill = SURFACE;
        visuals.widgets.noninteractive.bg_stroke = egui::Stroke::new(1.0, LINE);
        visuals.widgets.noninteractive.fg_stroke = egui::Stroke::new(1.0, MUTED);
        visuals.widgets.inactive.bg_fill = Color32::from_rgb(35, 33, 44);
        visuals.widgets.inactive.weak_bg_fill = Color32::from_rgb(35, 33, 44);
        visuals.widgets.inactive.bg_stroke = egui::Stroke::new(1.0, LINE);
        visuals.widgets.hovered.bg_fill = Color32::from_rgb(49, 44, 64);
        visuals.widgets.hovered.weak_bg_fill = Color32::from_rgb(49, 44, 64);
        visuals.widgets.hovered.bg_stroke = egui::Stroke::new(1.0, LILAC.gamma_multiply(0.65));
        visuals.widgets.active.bg_fill = Color32::from_rgb(59, 51, 79);
        visuals.widgets.active.weak_bg_fill = Color32::from_rgb(59, 51, 79);
        visuals.widgets.active.bg_stroke = egui::Stroke::new(1.0, LILAC);
        visuals.selection.bg_fill = Color32::from_rgb(77, 64, 104);
        visuals.hyperlink_color = LILAC;
        visuals.override_text_color = Some(Color32::from_rgb(237, 234, 244));
        for widget in [
            &mut visuals.widgets.inactive,
            &mut visuals.widgets.hovered,
            &mut visuals.widgets.active,
            &mut visuals.widgets.open,
        ] {
            widget.corner_radius = 6.into();
        }
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
                .insert(egui::TextStyle::Small, egui::FontId::proportional(12.0));
            style.spacing.button_padding = egui::vec2(12.0, 8.0);
            style.spacing.item_spacing = egui::vec2(8.0, 6.0);
        });
    }
}
