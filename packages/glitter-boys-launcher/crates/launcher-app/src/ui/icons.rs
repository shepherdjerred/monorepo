//! Small, resolution-independent icons. Labels remain visible on every action.
use super::*;
#[derive(Clone, Copy)]
pub(super) enum Icon {
    Play,
    Download,
    Pause,
    Cancel,
    Gear,
    Help,
    Folder,
    Trash,
    Refresh,
    Info,
}
pub(super) fn button(ui: &mut egui::Ui, icon: Icon, label: &str, primary: bool) -> egui::Response {
    let text = RichText::new(format!("    {label}")).size(13.0);
    let button = egui::Button::new(if primary { text.color(INK) } else { text })
        .min_size(egui::vec2(32.0, 34.0))
        .corner_radius(6);
    let response = ui.add(if primary { button.fill(LILAC) } else { button });
    response.widget_info(|| {
        egui::WidgetInfo::labeled(
            egui::WidgetType::Button,
            ui.is_enabled(),
            if label.is_empty() {
                "Game details"
            } else {
                label
            },
        )
    });
    let color = if primary {
        INK
    } else {
        ui.visuals().text_color()
    };
    draw(
        ui.painter(),
        icon,
        egui::Rect::from_center_size(
            egui::pos2(response.rect.left() + 15.0, response.rect.center().y),
            egui::vec2(14.0, 14.0),
        ),
        if ui.is_enabled() {
            color
        } else {
            color.gamma_multiply(0.4)
        },
    );
    response
}
pub(super) fn draw(p: &egui::Painter, icon: Icon, rect: egui::Rect, color: Color32) {
    let point = |x: f32, y: f32| rect.min + egui::vec2(x, y) * rect.width();
    let stroke = egui::Stroke::new(1.5, color);
    let line = |points: &[(f32, f32)]| {
        p.add(egui::Shape::line(
            points.iter().map(|&(x, y)| point(x, y)).collect(),
            stroke,
        ))
    };
    match icon {
        Icon::Play => {
            p.add(egui::Shape::convex_polygon(
                vec![point(0.2, 0.08), point(0.9, 0.5), point(0.2, 0.92)],
                color,
                egui::Stroke::NONE,
            ));
        }
        Icon::Pause => {
            line(&[(0.3, 0.1), (0.3, 0.9)]);
            line(&[(0.7, 0.1), (0.7, 0.9)]);
        }
        Icon::Cancel => {
            line(&[(0.15, 0.15), (0.85, 0.85)]);
            line(&[(0.85, 0.15), (0.15, 0.85)]);
        }
        Icon::Download => {
            line(&[(0.5, 0.05), (0.5, 0.7)]);
            line(&[(0.22, 0.43), (0.5, 0.7), (0.78, 0.43)]);
            line(&[(0.1, 0.7), (0.1, 0.95), (0.9, 0.95), (0.9, 0.7)]);
        }
        Icon::Folder => {
            line(&[
                (0.05, 0.9),
                (0.05, 0.17),
                (0.4, 0.17),
                (0.52, 0.33),
                (0.95, 0.33),
                (0.95, 0.9),
                (0.05, 0.9),
            ]);
        }
        Icon::Trash => {
            line(&[(0.1, 0.25), (0.9, 0.25)]);
            line(&[(0.35, 0.25), (0.35, 0.08), (0.65, 0.08), (0.65, 0.25)]);
            line(&[(0.2, 0.25), (0.25, 0.95), (0.75, 0.95), (0.8, 0.25)]);
        }
        Icon::Gear => {
            p.circle_stroke(rect.center(), rect.width() * 0.31, stroke);
            p.circle_stroke(rect.center(), rect.width() * 0.1, stroke);
            for i in 0..8 {
                let angle = i as f32 * std::f32::consts::TAU / 8.0;
                let v = egui::vec2(angle.cos(), angle.sin());
                p.line_segment(
                    [
                        rect.center() + v * rect.width() * 0.3,
                        rect.center() + v * rect.width() * 0.48,
                    ],
                    stroke,
                );
            }
        }
        Icon::Refresh => {
            line(&[
                (0.9, 0.35),
                (0.7, 0.1),
                (0.3, 0.1),
                (0.1, 0.35),
                (0.1, 0.7),
                (0.3, 0.9),
                (0.7, 0.9),
                (0.9, 0.7),
            ]);
            line(&[(0.9, 0.05), (0.9, 0.35), (0.6, 0.35)]);
        }
        Icon::Help | Icon::Info => {
            p.circle_stroke(rect.center(), rect.width() * 0.47, stroke);
            if matches!(icon, Icon::Help) {
                line(&[
                    (0.3, 0.35),
                    (0.4, 0.23),
                    (0.6, 0.23),
                    (0.7, 0.35),
                    (0.5, 0.55),
                    (0.5, 0.62),
                ]);
            } else {
                line(&[(0.5, 0.43), (0.5, 0.76)]);
                p.circle_filled(point(0.5, 0.25), 0.8, color);
            }
            if matches!(icon, Icon::Help) {
                p.circle_filled(point(0.5, 0.8), 0.8, color);
            }
        }
    }
}
pub(crate) fn app_icon() -> egui::IconData {
    let size = 64_u32;
    let mut rgba = vec![0_u8; (size * size * 4) as usize];
    for y in 0..size {
        for x in 0..size {
            let dx = (x as f32 - 31.5).abs();
            let dy = (y as f32 - 31.5).abs();
            let outside = dx > 22.0
                && dy > 22.0
                && (dx - 22.0).powi(2) + (dy - 22.0).powi(2) > 9.5_f32.powi(2);
            let star = dx / 20.0 + dy / 20.0 <= 1.0 && (dx.min(dy) < 5.0 || dx + dy < 14.0);
            let color = if outside {
                [0, 0, 0, 0]
            } else if star {
                [195, 155, 255, 255]
            } else {
                [22, 10, 44, 255]
            };
            let start = ((y * size + x) * 4) as usize;
            rgba[start..start + 4].copy_from_slice(&color);
        }
    }
    egui::IconData {
        rgba,
        width: size,
        height: size,
    }
}
