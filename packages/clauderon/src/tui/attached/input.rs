//! Keyboard input encoding for PTY.
//!
//! Converts crossterm key events to byte sequences that can be sent to a PTY.

use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};

/// Encode a key event into bytes for sending to a PTY.
///
/// Returns the byte sequence that should be written to the PTY.
#[must_use]
pub fn encode_key(key: &KeyEvent) -> Vec<u8> {
    let modifiers = key.modifiers;
    let has_ctrl = modifiers.contains(KeyModifiers::CONTROL);
    let has_alt = modifiers.contains(KeyModifiers::ALT);
    let has_shift = modifiers.contains(KeyModifiers::SHIFT);

    match key.code {
        // Regular characters
        KeyCode::Char(c) => encode_char(c, has_ctrl, has_alt),

        // Enter
        KeyCode::Enter => {
            if has_shift {
                // Shift+Enter sends CSI escape sequence
                vec![0x1b, b'[', b'1', b'3', b'~']
            } else {
                vec![b'\r']
            }
        }

        // Backspace
        KeyCode::Backspace => {
            if has_ctrl {
                vec![0x08] // Ctrl+Backspace
            } else {
                vec![0x7f] // DEL
            }
        }

        // Tab
        KeyCode::Tab => {
            if has_shift {
                vec![0x1b, b'[', b'Z'] // Shift+Tab (reverse tab)
            } else {
                vec![b'\t']
            }
        }

        // Escape
        KeyCode::Esc => vec![0x1b],

        // Arrow keys
        KeyCode::Up => encode_arrow(b'A', has_ctrl, has_alt, has_shift),
        KeyCode::Down => encode_arrow(b'B', has_ctrl, has_alt, has_shift),
        KeyCode::Right => encode_arrow(b'C', has_ctrl, has_alt, has_shift),
        KeyCode::Left => encode_arrow(b'D', has_ctrl, has_alt, has_shift),

        // Navigation keys
        KeyCode::Home => encode_special(b'H', has_ctrl, has_alt, has_shift),
        KeyCode::End => encode_special(b'F', has_ctrl, has_alt, has_shift),
        KeyCode::PageUp => vec![0x1b, b'[', b'5', b'~'],
        KeyCode::PageDown => vec![0x1b, b'[', b'6', b'~'],
        KeyCode::Insert => vec![0x1b, b'[', b'2', b'~'],
        KeyCode::Delete => vec![0x1b, b'[', b'3', b'~'],

        // Function keys
        KeyCode::F(n) => encode_function_key(n),

        // Other keys (return empty for unsupported)
        _ => Vec::new(),
    }
}

/// Encode a character with modifiers.
fn encode_char(c: char, has_ctrl: bool, has_alt: bool) -> Vec<u8> {
    let mut result = Vec::new();

    // Alt modifier sends ESC prefix
    if has_alt {
        result.push(0x1b);
    }

    if has_ctrl {
        // Control characters: Ctrl+A = 0x01, Ctrl+B = 0x02, etc.
        match c.to_ascii_lowercase() {
            'a'..='z' => {
                let ctrl_char = (c.to_ascii_lowercase() as u8) - b'a' + 1;
                result.push(ctrl_char);
            }
            '[' => result.push(0x1b),  // Ctrl+[ = ESC
            '\\' => result.push(0x1c), // Ctrl+\ = FS
            ']' => result.push(0x1d),  // Ctrl+] = GS (alternate detach key)
            '^' => result.push(0x1e),  // Ctrl+^ = RS
            '_' => result.push(0x1f),  // Ctrl+_ = US
            ' ' => result.push(0x00),  // Ctrl+Space = NUL
            _ => {
                // For other characters, just encode normally
                result.extend(c.to_string().as_bytes());
            }
        }
    } else {
        // Normal character
        result.extend(c.to_string().as_bytes());
    }

    result
}

/// Encode arrow key with modifiers.
fn encode_arrow(direction: u8, has_ctrl: bool, has_alt: bool, has_shift: bool) -> Vec<u8> {
    let modifier = compute_modifier(has_ctrl, has_alt, has_shift);

    if modifier > 1 {
        // CSI 1 ; modifier direction
        vec![0x1b, b'[', b'1', b';', b'0' + modifier, direction]
    } else {
        // Simple: CSI direction
        vec![0x1b, b'[', direction]
    }
}

/// Encode special key (Home, End) with modifiers.
fn encode_special(key: u8, has_ctrl: bool, has_alt: bool, has_shift: bool) -> Vec<u8> {
    let modifier = compute_modifier(has_ctrl, has_alt, has_shift);

    if modifier > 1 {
        vec![0x1b, b'[', b'1', b';', b'0' + modifier, key]
    } else {
        vec![0x1b, b'[', key]
    }
}

/// Compute the modifier value for CSI sequences.
/// 1 = none, 2 = shift, 3 = alt, 4 = alt+shift, 5 = ctrl, 6 = ctrl+shift, 7 = ctrl+alt, 8 = ctrl+alt+shift
fn compute_modifier(has_ctrl: bool, has_alt: bool, has_shift: bool) -> u8 {
    let mut modifier: u8 = 1;
    if has_shift {
        modifier += 1;
    }
    if has_alt {
        modifier += 2;
    }
    if has_ctrl {
        modifier += 4;
    }
    modifier
}

/// Encode function key (F1-F12).
fn encode_function_key(n: u8) -> Vec<u8> {
    match n {
        1 => vec![0x1b, b'O', b'P'],
        2 => vec![0x1b, b'O', b'Q'],
        3 => vec![0x1b, b'O', b'R'],
        4 => vec![0x1b, b'O', b'S'],
        5 => vec![0x1b, b'[', b'1', b'5', b'~'],
        6 => vec![0x1b, b'[', b'1', b'7', b'~'],
        7 => vec![0x1b, b'[', b'1', b'8', b'~'],
        8 => vec![0x1b, b'[', b'1', b'9', b'~'],
        9 => vec![0x1b, b'[', b'2', b'0', b'~'],
        10 => vec![0x1b, b'[', b'2', b'1', b'~'],
        11 => vec![0x1b, b'[', b'2', b'3', b'~'],
        12 => vec![0x1b, b'[', b'2', b'4', b'~'],
        _ => Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crossterm::event::KeyEventKind;

    fn key_event(code: KeyCode, modifiers: KeyModifiers) -> KeyEvent {
        KeyEvent::new_with_kind(code, modifiers, KeyEventKind::Press)
    }

    #[test]
    fn test_encode_simple_char() {
        let event = key_event(KeyCode::Char('a'), KeyModifiers::NONE);
        assert_eq!(encode_key(&event), vec![b'a']);
    }

    #[test]
    fn test_encode_ctrl_c() {
        let event = key_event(KeyCode::Char('c'), KeyModifiers::CONTROL);
        assert_eq!(encode_key(&event), vec![0x03]); // ETX
    }

    #[test]
    fn test_encode_ctrl_bracket() {
        // This is an alternate detach key
        let event = key_event(KeyCode::Char(']'), KeyModifiers::CONTROL);
        assert_eq!(encode_key(&event), vec![0x1d]); // GS
    }

    #[test]
    fn test_encode_enter() {
        let event = key_event(KeyCode::Enter, KeyModifiers::NONE);
        assert_eq!(encode_key(&event), vec![b'\r']);
    }

    #[test]
    fn test_encode_backspace() {
        let event = key_event(KeyCode::Backspace, KeyModifiers::NONE);
        assert_eq!(encode_key(&event), vec![0x7f]);
    }

    #[test]
    fn test_encode_escape() {
        let event = key_event(KeyCode::Esc, KeyModifiers::NONE);
        assert_eq!(encode_key(&event), vec![0x1b]);
    }

    #[test]
    fn test_encode_arrow_up() {
        let event = key_event(KeyCode::Up, KeyModifiers::NONE);
        assert_eq!(encode_key(&event), vec![0x1b, b'[', b'A']);
    }

    #[test]
    fn test_encode_ctrl_arrow() {
        let event = key_event(KeyCode::Right, KeyModifiers::CONTROL);
        assert_eq!(encode_key(&event), vec![0x1b, b'[', b'1', b';', b'5', b'C']);
    }

    #[test]
    fn test_encode_alt_char() {
        let event = key_event(KeyCode::Char('x'), KeyModifiers::ALT);
        assert_eq!(encode_key(&event), vec![0x1b, b'x']);
    }

    #[test]
    fn test_encode_function_keys() {
        let f1 = key_event(KeyCode::F(1), KeyModifiers::NONE);
        assert_eq!(encode_key(&f1), vec![0x1b, b'O', b'P']);

        let f5 = key_event(KeyCode::F(5), KeyModifiers::NONE);
        assert_eq!(encode_key(&f5), vec![0x1b, b'[', b'1', b'5', b'~']);
    }

    #[test]
    fn test_encode_shift_tab() {
        let event = key_event(KeyCode::Tab, KeyModifiers::SHIFT);
        assert_eq!(encode_key(&event), vec![0x1b, b'[', b'Z']);
    }
}
