//! Terminal buffer with vt100 emulation and scroll-back support.
//!
//! This module provides:
//! - vt100 terminal emulation parsing
//! - Scroll-back buffer (handled internally by vt100 parser)
//! - UTF-8 buffering for incomplete sequences
//! - Scroll position tracking

/// Default scroll-back buffer limit (number of lines).
pub const DEFAULT_SCROLLBACK_LIMIT: usize = 10_000;

/// Terminal buffer with vt100 emulation and scroll-back.
pub struct TerminalBuffer {
    /// vt100 parser for terminal emulation.
    parser: vt100::Parser,

    /// Maximum number of scroll-back lines to keep.
    /// Note: This is stored for potential future use; the vt100 parser handles scrollback internally.
    _scroll_back_limit: usize,

    /// Buffer for incomplete UTF-8 sequences.
    utf8_buffer: Vec<u8>,

    /// Whether user has manually scrolled up (scroll lock).
    /// When true, new output won't auto-scroll to bottom.
    user_scrolled: bool,
}

impl std::fmt::Debug for TerminalBuffer {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("TerminalBuffer").finish()
    }
}

impl TerminalBuffer {
    /// Create a new terminal buffer with the given dimensions.
    #[must_use]
    pub fn new(rows: u16, cols: u16) -> Self {
        Self {
            parser: vt100::Parser::new(rows, cols, DEFAULT_SCROLLBACK_LIMIT),
            _scroll_back_limit: DEFAULT_SCROLLBACK_LIMIT,
            utf8_buffer: Vec::new(),
            user_scrolled: false,
        }
    }

    /// Create a new terminal buffer with custom scroll-back limit.
    #[must_use]
    pub fn with_scrollback_limit(rows: u16, cols: u16, limit: usize) -> Self {
        Self {
            parser: vt100::Parser::new(rows, cols, limit),
            _scroll_back_limit: limit,
            utf8_buffer: Vec::new(),
            user_scrolled: false,
        }
    }

    /// Process incoming bytes from the PTY.
    ///
    /// This handles UTF-8 buffering for incomplete sequences and updates
    /// the vt100 parser (which handles scroll-back internally).
    pub fn process(&mut self, data: &[u8]) {
        // Append to UTF-8 buffer
        self.utf8_buffer.extend_from_slice(data);

        // Find the last valid UTF-8 boundary
        let valid_len = self.find_utf8_boundary();

        if valid_len > 0 {
            // Process valid UTF-8 portion
            let to_process: Vec<u8> = self.utf8_buffer.drain(..valid_len).collect();

            // Process through vt100 parser (which handles scrollback internally)
            self.parser.process(&to_process);

            // Auto-scroll to bottom on new output, but only if user hasn't manually scrolled up
            if !self.user_scrolled {
                self.parser.screen_mut().set_scrollback(0);
            }
        }
    }

    /// Find the boundary of valid UTF-8 in the buffer.
    fn find_utf8_boundary(&self) -> usize {
        let buf = &self.utf8_buffer;
        let len = buf.len();

        if len == 0 {
            return 0;
        }

        // Check if the last 1-3 bytes could be the start of an incomplete sequence
        for i in 1..=3.min(len) {
            let pos = len - i;
            let byte = buf[pos];

            // Check if this could be the start of a multi-byte sequence
            if byte & 0b1100_0000 == 0b1100_0000 {
                // This is a leading byte, check if sequence is complete
                let expected_len = if byte & 0b1111_0000 == 0b1111_0000 {
                    4
                } else if byte & 0b1110_0000 == 0b1110_0000 {
                    3
                } else if byte & 0b1100_0000 == 0b1100_0000 {
                    2
                } else {
                    1
                };

                if len - pos < expected_len {
                    // Incomplete sequence, return up to this point
                    return pos;
                }
            }
        }

        // All bytes are valid
        len
    }

    /// Resize the terminal buffer.
    pub fn resize(&mut self, rows: u16, cols: u16) {
        self.parser.screen_mut().set_size(rows, cols);
    }

    /// Get the current vt100 screen.
    #[must_use]
    pub fn screen(&self) -> &vt100::Screen {
        self.parser.screen()
    }

    /// Get the current scroll offset (0 = at bottom, viewing live output).
    #[must_use]
    pub fn get_scroll_offset(&self) -> usize {
        self.parser.screen().scrollback()
    }

    /// Scroll up by the given number of lines.
    /// The vt100 parser clamps the scrollback to available content internally.
    pub fn scroll_up(&mut self, lines: usize) {
        let current = self.parser.screen().scrollback();
        let new_offset = current + lines;
        // Let vt100 parser clamp to actual scrollback content
        self.parser.screen_mut().set_scrollback(new_offset);
        // Mark that user has manually scrolled
        self.user_scrolled = true;
    }

    /// Scroll down by the given number of lines.
    pub fn scroll_down(&mut self, lines: usize) {
        let current = self.parser.screen().scrollback();
        let new_offset = current.saturating_sub(lines);
        self.parser.screen_mut().set_scrollback(new_offset);
        // Still mark as user scrolled - they're manually controlling position
        self.user_scrolled = true;
    }

    /// Scroll to the bottom (live output).
    pub fn scroll_to_bottom(&mut self) {
        self.parser.screen_mut().set_scrollback(0);
        // Resume auto-scroll behavior when user returns to bottom
        self.user_scrolled = false;
    }

    /// Check if we're at the bottom (viewing live output).
    #[must_use]
    pub fn is_at_bottom(&self) -> bool {
        self.parser.screen().scrollback() == 0
    }

    /// Reset scroll lock (e.g., when user sends input to PTY).
    /// This allows auto-scroll to resume on new output.
    pub fn reset_scroll_lock(&mut self) {
        self.user_scrolled = false;
    }

    /// Get the terminal dimensions.
    #[must_use]
    pub fn size(&self) -> (u16, u16) {
        let screen = self.parser.screen();
        (screen.size().0, screen.size().1)
    }

    /// Generate a snapshot of the current screen state as escape sequences.
    ///
    /// This produces a byte sequence that, when written to a terminal, will
    /// recreate the current screen state including:
    /// - Screen contents with proper colors and attributes
    /// - Cursor position
    ///
    /// The snapshot uses SGR (Select Graphic Rendition) escape codes for
    /// colors and attributes (bold, underline, etc.).
    #[must_use]
    pub fn snapshot(&self) -> Vec<u8> {
        let screen = self.parser.screen();
        let (rows, cols) = screen.size();
        let mut output = Vec::with_capacity((rows as usize) * (cols as usize) * 4);

        // Reset all attributes and clear screen, move cursor home
        output.extend_from_slice(b"\x1b[0m\x1b[2J\x1b[H");

        let mut last_attrs: Option<vt100::Cell> = None;

        for row in 0..rows {
            // Move cursor to beginning of row
            output.extend_from_slice(format!("\x1b[{};1H", row + 1).as_bytes());

            for col in 0..cols {
                let cell = screen.cell(row, col);
                if let Some(cell) = cell {
                    // Check if we need to update SGR attributes
                    let need_sgr = match &last_attrs {
                        None => true,
                        Some(last) => {
                            cell.fgcolor() != last.fgcolor()
                                || cell.bgcolor() != last.bgcolor()
                                || cell.bold() != last.bold()
                                || cell.italic() != last.italic()
                                || cell.underline() != last.underline()
                                || cell.inverse() != last.inverse()
                        }
                    };

                    if need_sgr {
                        output.extend_from_slice(b"\x1b[0"); // Reset, then set attributes

                        // Bold
                        if cell.bold() {
                            output.extend_from_slice(b";1");
                        }

                        // Italic
                        if cell.italic() {
                            output.extend_from_slice(b";3");
                        }

                        // Underline
                        if cell.underline() {
                            output.extend_from_slice(b";4");
                        }

                        // Inverse
                        if cell.inverse() {
                            output.extend_from_slice(b";7");
                        }

                        // Foreground color
                        match cell.fgcolor() {
                            vt100::Color::Default => {}
                            vt100::Color::Idx(idx) => {
                                if idx < 8 {
                                    output.extend_from_slice(format!(";{}", 30 + idx).as_bytes());
                                } else if idx < 16 {
                                    output
                                        .extend_from_slice(format!(";{}", 90 + idx - 8).as_bytes());
                                } else {
                                    output.extend_from_slice(format!(";38;5;{idx}").as_bytes());
                                }
                            }
                            vt100::Color::Rgb(r, g, b) => {
                                output.extend_from_slice(format!(";38;2;{r};{g};{b}").as_bytes());
                            }
                        }

                        // Background color
                        match cell.bgcolor() {
                            vt100::Color::Default => {}
                            vt100::Color::Idx(idx) => {
                                if idx < 8 {
                                    output.extend_from_slice(format!(";{}", 40 + idx).as_bytes());
                                } else if idx < 16 {
                                    output.extend_from_slice(
                                        format!(";{}", 100 + idx - 8).as_bytes(),
                                    );
                                } else {
                                    output.extend_from_slice(format!(";48;5;{idx}").as_bytes());
                                }
                            }
                            vt100::Color::Rgb(r, g, b) => {
                                output.extend_from_slice(format!(";48;2;{r};{g};{b}").as_bytes());
                            }
                        }

                        output.extend_from_slice(b"m");
                        last_attrs = Some(cell.clone());
                    }

                    // Output the character
                    let contents = cell.contents();
                    if contents.is_empty() {
                        output.push(b' ');
                    } else {
                        output.extend_from_slice(contents.as_bytes());
                    }
                } else {
                    // Cell doesn't exist, output space
                    output.push(b' ');
                }
            }
        }

        // Reset attributes and position cursor
        let (cursor_row, cursor_col) = screen.cursor_position();
        output.extend_from_slice(b"\x1b[0m");
        output.extend_from_slice(format!("\x1b[{};{}H", cursor_row + 1, cursor_col + 1).as_bytes());

        output
    }
}

impl Default for TerminalBuffer {
    fn default() -> Self {
        Self::new(24, 80)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_new_buffer() {
        let buf = TerminalBuffer::new(24, 80);
        assert_eq!(buf.size(), (24, 80));
        assert!(buf.is_at_bottom());
    }

    #[test]
    fn test_process_simple_text() {
        let mut buf = TerminalBuffer::new(24, 80);
        buf.process(b"Hello, World!");

        let screen = buf.screen();
        let contents = screen.contents();
        assert!(contents.contains("Hello, World!"));
    }

    #[test]
    fn test_utf8_buffering() {
        let mut buf = TerminalBuffer::new(24, 80);

        // Send incomplete UTF-8 sequence (first byte of 2-byte char)
        buf.process(&[0xC3]); // First byte of 'é' (0xC3 0xA9)

        // Buffer should hold incomplete sequence
        assert_eq!(buf.utf8_buffer.len(), 1);

        // Send completing byte
        buf.process(&[0xA9]); // Second byte of 'é'

        // Buffer should be empty now
        assert_eq!(buf.utf8_buffer.len(), 0);
    }

    #[test]
    fn test_scroll_operations() {
        let mut buf = TerminalBuffer::new(24, 80);

        // Initially at bottom
        assert!(buf.is_at_bottom());
        assert_eq!(buf.get_scroll_offset(), 0);

        // Add some content to create scrollback history
        // Print more lines than the screen height to create scrollback
        for i in 0..100 {
            buf.process(format!("Line {i}\n").as_bytes());
        }

        // Scroll up should work now
        buf.scroll_up(10);
        assert!(!buf.is_at_bottom());
        assert_eq!(buf.get_scroll_offset(), 10);

        // Scroll down a bit
        buf.scroll_down(5);
        assert_eq!(buf.get_scroll_offset(), 5);

        // Scroll back to bottom
        buf.scroll_to_bottom();
        assert!(buf.is_at_bottom());
        assert_eq!(buf.get_scroll_offset(), 0);
    }

    #[test]
    fn test_resize() {
        let mut buf = TerminalBuffer::new(24, 80);
        assert_eq!(buf.size(), (24, 80));

        buf.resize(40, 120);
        assert_eq!(buf.size(), (40, 120));
    }
}
