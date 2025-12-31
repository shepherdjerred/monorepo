//! Terminal rendering from vt100 screen to ratatui.
//!
//! This module converts vt100 screen state to ratatui widgets.

use ratatui::{
    buffer::Buffer,
    layout::Rect,
    style::{Color, Modifier, Style},
    widgets::Widget,
};

use super::terminal_buffer::TerminalBuffer;

/// Render a terminal buffer to a ratatui frame area.
pub fn render_terminal(buffer: &TerminalBuffer, area: Rect, buf: &mut Buffer) {
    let screen = buffer.screen();
    let (rows, cols) = (screen.size().0 as u16, screen.size().1 as u16);

    // Calculate visible area
    let visible_rows = area.height.min(rows);
    let visible_cols = area.width.min(cols);

    // Get scroll offset
    let scroll_offset = buffer.scroll_offset();

    // Render each cell
    for row in 0..visible_rows {
        for col in 0..visible_cols {
            let screen_row = if scroll_offset > 0 {
                // TODO: Implement scroll-back rendering
                row
            } else {
                row
            };

            if let Some(cell) = screen.cell(screen_row, col) {
                let x = area.x + col;
                let y = area.y + row;

                if x < area.right() && y < area.bottom() {
                    let style = convert_style(cell);
                    let ch = cell.contents();

                    // Get the buffer cell
                    if let Some(buf_cell) = buf.cell_mut((x, y)) {
                        buf_cell.set_style(style);
                        if !ch.is_empty() {
                            buf_cell.set_symbol(&ch);
                        } else {
                            buf_cell.set_symbol(" ");
                        }
                    }
                }
            }
        }
    }

    // Render cursor if at bottom (viewing live output)
    if scroll_offset == 0 {
        let cursor_pos = screen.cursor_position();
        let cursor_x = area.x + cursor_pos.1;
        let cursor_y = area.y + cursor_pos.0;

        if cursor_x < area.right() && cursor_y < area.bottom() {
            if let Some(buf_cell) = buf.cell_mut((cursor_x, cursor_y)) {
                // Invert the cursor cell for visibility
                let current_style = buf_cell.style();
                let cursor_style = current_style.add_modifier(Modifier::REVERSED);
                buf_cell.set_style(cursor_style);
            }
        }
    }
}

/// Convert vt100 cell style to ratatui style.
fn convert_style(cell: &vt100::Cell) -> Style {
    let mut style = Style::default();

    // Foreground color
    if let Some(fg) = convert_color(cell.fgcolor()) {
        style = style.fg(fg);
    }

    // Background color
    if let Some(bg) = convert_color(cell.bgcolor()) {
        style = style.bg(bg);
    }

    // Attributes
    if cell.bold() {
        style = style.add_modifier(Modifier::BOLD);
    }
    if cell.italic() {
        style = style.add_modifier(Modifier::ITALIC);
    }
    if cell.underline() {
        style = style.add_modifier(Modifier::UNDERLINED);
    }
    if cell.inverse() {
        style = style.add_modifier(Modifier::REVERSED);
    }

    style
}

/// Convert vt100 color to ratatui color.
fn convert_color(color: vt100::Color) -> Option<Color> {
    match color {
        vt100::Color::Default => None,
        vt100::Color::Idx(idx) => Some(convert_indexed_color(idx)),
        vt100::Color::Rgb(r, g, b) => Some(Color::Rgb(r, g, b)),
    }
}

/// Convert indexed color (0-255) to ratatui color.
fn convert_indexed_color(idx: u8) -> Color {
    match idx {
        // Standard colors (0-7)
        0 => Color::Black,
        1 => Color::Red,
        2 => Color::Green,
        3 => Color::Yellow,
        4 => Color::Blue,
        5 => Color::Magenta,
        6 => Color::Cyan,
        7 => Color::Gray,
        // Bright colors (8-15)
        8 => Color::DarkGray,
        9 => Color::LightRed,
        10 => Color::LightGreen,
        11 => Color::LightYellow,
        12 => Color::LightBlue,
        13 => Color::LightMagenta,
        14 => Color::LightCyan,
        15 => Color::White,
        // 216-color cube and grayscale (16-255)
        _ => Color::Indexed(idx),
    }
}

/// Widget wrapper for rendering a terminal buffer.
pub struct TerminalWidget<'a> {
    buffer: &'a TerminalBuffer,
}

impl<'a> TerminalWidget<'a> {
    /// Create a new terminal widget.
    #[must_use]
    pub fn new(buffer: &'a TerminalBuffer) -> Self {
        Self { buffer }
    }
}

impl Widget for TerminalWidget<'_> {
    fn render(self, area: Rect, buf: &mut Buffer) {
        render_terminal(self.buffer, area, buf);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_convert_indexed_colors() {
        assert_eq!(convert_indexed_color(0), Color::Black);
        assert_eq!(convert_indexed_color(1), Color::Red);
        assert_eq!(convert_indexed_color(7), Color::Gray);
        assert_eq!(convert_indexed_color(8), Color::DarkGray);
        assert_eq!(convert_indexed_color(15), Color::White);
        assert_eq!(convert_indexed_color(200), Color::Indexed(200));
    }

    #[test]
    fn test_convert_color() {
        assert_eq!(convert_color(vt100::Color::Default), None);
        assert_eq!(convert_color(vt100::Color::Idx(1)), Some(Color::Red));
        assert_eq!(
            convert_color(vt100::Color::Rgb(255, 128, 64)),
            Some(Color::Rgb(255, 128, 64))
        );
    }
}
