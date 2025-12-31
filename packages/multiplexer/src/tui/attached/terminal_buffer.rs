//! Terminal buffer with vt100 emulation and scroll-back support.
//!
//! This module provides:
//! - vt100 terminal emulation parsing
//! - Scroll-back buffer with configurable limit
//! - UTF-8 buffering for incomplete sequences
//! - Scroll position tracking

use std::collections::VecDeque;

/// Default scroll-back buffer limit (number of lines).
pub const DEFAULT_SCROLLBACK_LIMIT: usize = 10_000;

/// A single line in the scroll-back buffer.
#[derive(Clone, Debug)]
pub struct Line {
    /// The text content of the line.
    pub text: String,
    /// Style information for each cell (to be expanded).
    pub styles: Vec<CellStyle>,
}

/// Style information for a single cell.
#[derive(Clone, Debug, Default)]
pub struct CellStyle {
    pub foreground: Option<Color>,
    pub background: Option<Color>,
    pub bold: bool,
    pub italic: bool,
    pub underline: bool,
    pub inverse: bool,
}

/// Terminal color representation.
#[derive(Clone, Copy, Debug)]
pub enum Color {
    /// Standard 16 colors (0-15).
    Indexed(u8),
    /// 24-bit RGB color.
    Rgb(u8, u8, u8),
}

/// Terminal buffer with vt100 emulation and scroll-back.
pub struct TerminalBuffer {
    /// vt100 parser for terminal emulation.
    parser: vt100::Parser,

    /// Lines that have scrolled off the top of the screen.
    scroll_back: VecDeque<Line>,

    /// Maximum number of scroll-back lines to keep.
    #[allow(dead_code)]
    scroll_back_limit: usize,

    /// Current scroll offset (0 = at bottom, showing live output).
    scroll_offset: usize,

    /// Buffer for incomplete UTF-8 sequences.
    utf8_buffer: Vec<u8>,
}

impl TerminalBuffer {
    /// Create a new terminal buffer with the given dimensions.
    #[must_use]
    pub fn new(rows: u16, cols: u16) -> Self {
        Self {
            parser: vt100::Parser::new(rows, cols, 0),
            scroll_back: VecDeque::new(),
            scroll_back_limit: DEFAULT_SCROLLBACK_LIMIT,
            scroll_offset: 0,
            utf8_buffer: Vec::new(),
        }
    }

    /// Create a new terminal buffer with custom scroll-back limit.
    #[must_use]
    pub fn with_scrollback_limit(rows: u16, cols: u16, limit: usize) -> Self {
        Self {
            parser: vt100::Parser::new(rows, cols, 0),
            scroll_back: VecDeque::new(),
            scroll_back_limit: limit,
            scroll_offset: 0,
            utf8_buffer: Vec::new(),
        }
    }

    /// Process incoming bytes from the PTY.
    ///
    /// This handles UTF-8 buffering for incomplete sequences and updates
    /// both the vt100 parser and scroll-back buffer.
    pub fn process(&mut self, data: &[u8]) {
        // Append to UTF-8 buffer
        self.utf8_buffer.extend_from_slice(data);

        // Find the last valid UTF-8 boundary
        let valid_len = self.find_utf8_boundary();

        if valid_len > 0 {
            // Process valid UTF-8 portion
            let to_process: Vec<u8> = self.utf8_buffer.drain(..valid_len).collect();

            // Capture lines that will scroll off before processing
            self.capture_scrolled_lines();

            // Process through vt100 parser
            self.parser.process(&to_process);

            // Reset scroll to bottom on new output (auto-scroll behavior)
            self.scroll_offset = 0;
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

    /// Capture lines that scroll off the visible screen.
    fn capture_scrolled_lines(&mut self) {
        // This will be called before processing to capture any lines
        // that might scroll off. Implementation depends on vt100 scroll events.
        // For now, we rely on periodic screen capture.
    }

    /// Resize the terminal buffer.
    pub fn resize(&mut self, rows: u16, cols: u16) {
        self.parser.set_size(rows, cols);
    }

    /// Get the current vt100 screen.
    #[must_use]
    pub fn screen(&self) -> &vt100::Screen {
        self.parser.screen()
    }

    /// Get the scroll-back buffer.
    #[must_use]
    pub fn scroll_back(&self) -> &VecDeque<Line> {
        &self.scroll_back
    }

    /// Get the current scroll offset.
    #[must_use]
    pub fn scroll_offset(&self) -> usize {
        self.scroll_offset
    }

    /// Set the scroll offset.
    pub fn set_scroll_offset(&mut self, offset: usize) {
        self.scroll_offset = offset.min(self.scroll_back.len());
    }

    /// Scroll up by the given number of lines.
    pub fn scroll_up(&mut self, lines: usize) {
        self.scroll_offset = (self.scroll_offset + lines).min(self.scroll_back.len());
    }

    /// Scroll down by the given number of lines.
    pub fn scroll_down(&mut self, lines: usize) {
        self.scroll_offset = self.scroll_offset.saturating_sub(lines);
    }

    /// Scroll to the bottom (live output).
    pub fn scroll_to_bottom(&mut self) {
        self.scroll_offset = 0;
    }

    /// Check if we're at the bottom (viewing live output).
    #[must_use]
    pub fn is_at_bottom(&self) -> bool {
        self.scroll_offset == 0
    }

    /// Get the terminal dimensions.
    #[must_use]
    pub fn size(&self) -> (u16, u16) {
        let screen = self.parser.screen();
        (screen.size().0, screen.size().1)
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

        // Scroll up with no history has no effect
        buf.scroll_up(10);
        assert!(buf.is_at_bottom()); // Still at bottom because no scroll-back history

        // Manually add some scroll-back history for testing
        buf.scroll_back.push_back(Line {
            text: "test line".to_string(),
            styles: Vec::new(),
        });

        // Now scroll up should work
        buf.scroll_up(1);
        assert!(!buf.is_at_bottom());
        assert_eq!(buf.scroll_offset(), 1);

        // Scroll back to bottom
        buf.scroll_to_bottom();
        assert!(buf.is_at_bottom());
    }

    #[test]
    fn test_resize() {
        let mut buf = TerminalBuffer::new(24, 80);
        assert_eq!(buf.size(), (24, 80));

        buf.resize(40, 120);
        assert_eq!(buf.size(), (40, 120));
    }
}
