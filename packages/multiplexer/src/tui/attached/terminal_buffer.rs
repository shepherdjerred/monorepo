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
    scroll_back_limit: usize,

    /// Buffer for incomplete UTF-8 sequences.
    utf8_buffer: Vec<u8>,
}

impl TerminalBuffer {
    /// Create a new terminal buffer with the given dimensions.
    #[must_use]
    pub fn new(rows: u16, cols: u16) -> Self {
        Self {
            parser: vt100::Parser::new(rows, cols, DEFAULT_SCROLLBACK_LIMIT),
            scroll_back_limit: DEFAULT_SCROLLBACK_LIMIT,
            utf8_buffer: Vec::new(),
        }
    }

    /// Create a new terminal buffer with custom scroll-back limit.
    #[must_use]
    pub fn with_scrollback_limit(rows: u16, cols: u16, limit: usize) -> Self {
        Self {
            parser: vt100::Parser::new(rows, cols, limit),
            scroll_back_limit: limit,
            utf8_buffer: Vec::new(),
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

            // Reset scroll to bottom on new output (auto-scroll behavior)
            self.parser.set_scrollback(0);
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
        self.parser.set_size(rows, cols);
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
    pub fn scroll_up(&mut self, lines: usize) {
        let current = self.parser.screen().scrollback();
        let new_offset = (current + lines).min(self.scroll_back_limit);
        self.parser.set_scrollback(new_offset);
    }

    /// Scroll down by the given number of lines.
    pub fn scroll_down(&mut self, lines: usize) {
        let current = self.parser.screen().scrollback();
        let new_offset = current.saturating_sub(lines);
        self.parser.set_scrollback(new_offset);
    }

    /// Scroll to the bottom (live output).
    pub fn scroll_to_bottom(&mut self) {
        self.parser.set_scrollback(0);
    }

    /// Check if we're at the bottom (viewing live output).
    #[must_use]
    pub fn is_at_bottom(&self) -> bool {
        self.parser.screen().scrollback() == 0
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
        assert_eq!(buf.get_scroll_offset(), 0);

        // Add some content to create scrollback history
        // Print more lines than the screen height to create scrollback
        for i in 0..100 {
            buf.process(format!("Line {}\n", i).as_bytes());
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
