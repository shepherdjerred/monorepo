//! Text input utilities for cursor-based text editing with UTF-8 safety.

/// Insert a character at the cursor position in a single-line text field.
///
/// Returns the new cursor position (in bytes).
pub fn insert_char_at_cursor(text: &mut String, cursor_pos: usize, ch: char) -> usize {
    // Ensure cursor is at a valid UTF-8 boundary
    let cursor_pos = clamp_to_char_boundary(text, cursor_pos);

    text.insert(cursor_pos, ch);

    // Move cursor forward by the byte length of the inserted character
    cursor_pos + ch.len_utf8()
}

/// Delete the character before the cursor (backspace) in a single-line text field.
///
/// Returns the new cursor position (in bytes).
pub fn delete_char_before_cursor(text: &mut String, cursor_pos: usize) -> usize {
    if cursor_pos == 0 || text.is_empty() {
        return 0;
    }

    // Find the start of the character before the cursor
    let mut new_pos = cursor_pos.saturating_sub(1);
    while new_pos > 0 && !text.is_char_boundary(new_pos) {
        new_pos -= 1;
    }

    // Remove the character
    text.remove(new_pos);
    new_pos
}

/// Delete the character at the cursor (delete key) in a single-line text field.
///
/// Returns the cursor position (unchanged).
pub fn delete_char_at_cursor(text: &mut String, cursor_pos: usize) -> usize {
    let cursor_pos = clamp_to_char_boundary(text, cursor_pos);

    if cursor_pos >= text.len() {
        return cursor_pos;
    }

    text.remove(cursor_pos);
    cursor_pos
}

/// Move the cursor left by one character.
///
/// Returns the new cursor position (in bytes).
#[must_use]
pub fn move_cursor_left(text: &str, cursor_pos: usize) -> usize {
    if cursor_pos == 0 {
        return 0;
    }

    // Find the start of the previous character
    let mut new_pos = cursor_pos.saturating_sub(1);
    while new_pos > 0 && !text.is_char_boundary(new_pos) {
        new_pos -= 1;
    }
    new_pos
}

/// Move the cursor right by one character.
///
/// Returns the new cursor position (in bytes).
#[must_use]
pub fn move_cursor_right(text: &str, cursor_pos: usize) -> usize {
    if cursor_pos >= text.len() {
        return text.len();
    }

    // Find the start of the next character
    let mut new_pos = cursor_pos + 1;
    while new_pos < text.len() && !text.is_char_boundary(new_pos) {
        new_pos += 1;
    }
    new_pos.min(text.len())
}

/// Move the cursor to the start of the text.
#[must_use]
pub fn move_cursor_to_start() -> usize {
    0
}

/// Move the cursor to the end of the text.
#[must_use]
pub fn move_cursor_to_end(text: &str) -> usize {
    text.len()
}

/// Clamp a byte position to the nearest valid UTF-8 character boundary.
fn clamp_to_char_boundary(text: &str, pos: usize) -> usize {
    let pos = pos.min(text.len());

    // Move backwards to find a valid character boundary
    let mut adjusted = pos;
    while adjusted > 0 && !text.is_char_boundary(adjusted) {
        adjusted -= 1;
    }
    adjusted
}

/// Split a string at a character boundary, returning (before_cursor, after_cursor).
///
/// Used for rendering the cursor in the correct position.
#[must_use]
pub fn split_at_char_boundary(text: &str, pos: usize) -> (&str, &str) {
    let pos = clamp_to_char_boundary(text, pos);
    text.split_at(pos)
}

// ============================================================================
// Multiline text editing functions
// ============================================================================

/// Calculate byte positions where each line starts in the text.
/// Returns a Vec where the index is the line number and the value is the byte offset.
fn calculate_line_starts(text: &str) -> Vec<usize> {
    let mut line_starts = vec![0]; // First line starts at 0

    for (idx, ch) in text.char_indices() {
        if ch == '\n' {
            line_starts.push(idx + 1); // Next line starts after newline
        }
    }

    line_starts
}

/// Insert a character at the cursor position in multiline text.
///
/// Returns the new cursor position (line, column).
pub fn insert_char_at_cursor_multiline(
    text: &mut String,
    line: usize,
    col: usize,
    ch: char,
) -> (usize, usize) {
    // Calculate line starts first (no borrows of text content)
    let line_starts = calculate_line_starts(text);
    let total_lines = line_starts.len();

    if line >= total_lines {
        // Cursor is beyond last line, append character to end
        if !text.is_empty() && !text.ends_with('\n') {
            text.push('\n');
        }
        text.push(ch);
        return (line, 1);
    }

    // Get byte position of the start of target line
    let line_start = line_starts[line];

    // Calculate line end
    let line_end = if line + 1 < line_starts.len() {
        line_starts[line + 1] - 1 // -1 to exclude the newline
    } else {
        text.len()
    };

    // Extract the target line to calculate column offset
    let target_line = &text[line_start..line_end];
    let byte_offset = char_col_to_byte_offset(target_line, col);

    // Calculate absolute position
    let abs_pos = line_start + byte_offset;

    // Insert the character (all borrows are now dropped)
    text.insert(abs_pos, ch);

    // Return new cursor position (same line, column advanced)
    (line, col + 1)
}

/// Insert a newline at the cursor position, splitting the current line.
///
/// Returns the new cursor position (line, column).
pub fn insert_newline_at_cursor(text: &mut String, line: usize, col: usize) -> (usize, usize) {
    let line_starts = calculate_line_starts(text);
    let total_lines = line_starts.len();

    if line >= total_lines {
        // Cursor is beyond last line, just append newline
        text.push('\n');
        return (line + 1, 0);
    }

    let line_start = line_starts[line];
    let line_end = if line + 1 < line_starts.len() {
        line_starts[line + 1] - 1
    } else {
        text.len()
    };

    let target_line = &text[line_start..line_end];
    let byte_offset = char_col_to_byte_offset(target_line, col);
    let abs_pos = line_start + byte_offset;

    text.insert(abs_pos, '\n');

    // Move to beginning of next line
    (line + 1, 0)
}

/// Delete the character before the cursor in multiline text (backspace).
///
/// Returns the new cursor position (line, column).
pub fn delete_char_before_cursor_multiline(
    text: &mut String,
    line: usize,
    col: usize,
) -> (usize, usize) {
    if col == 0 {
        // At start of line - merge with previous line
        if line == 0 {
            return (0, 0); // At very start, nothing to delete
        }

        let line_starts = calculate_line_starts(text);

        // Calculate length of previous line in characters
        let prev_line_start = line_starts[line - 1];
        let prev_line_end = line_starts[line] - 1; // -1 to exclude newline
        let prev_line = &text[prev_line_start..prev_line_end];
        let prev_line_len = prev_line.chars().count();

        // Delete the newline at line_starts[line] - 1
        let newline_pos = line_starts[line] - 1;
        text.remove(newline_pos);

        return (line - 1, prev_line_len);
    }

    // Delete character before cursor on current line
    let line_starts = calculate_line_starts(text);
    let total_lines = line_starts.len();

    if line >= total_lines {
        return (line, col);
    }

    let line_start = line_starts[line];
    let line_end = if line + 1 < line_starts.len() {
        line_starts[line + 1] - 1
    } else {
        text.len()
    };

    let target_line = &text[line_start..line_end];
    let byte_offset = char_col_to_byte_offset(target_line, col);

    // Find start of previous character
    let mut prev_byte = byte_offset.saturating_sub(1);
    while prev_byte > 0 && !target_line.is_char_boundary(prev_byte) {
        prev_byte -= 1;
    }

    let abs_pos = line_start + prev_byte;
    text.remove(abs_pos);
    (line, col - 1)
}

/// Delete the character at the cursor in multiline text (delete key).
///
/// Returns the cursor position (unchanged).
pub fn delete_char_at_cursor_multiline(
    text: &mut String,
    line: usize,
    col: usize,
) -> (usize, usize) {
    let line_starts = calculate_line_starts(text);
    let total_lines = line_starts.len();

    if line >= total_lines {
        return (line, col);
    }

    let line_start = line_starts[line];
    let line_end = if line + 1 < line_starts.len() {
        line_starts[line + 1] - 1
    } else {
        text.len()
    };

    let target_line = &text[line_start..line_end];

    // Check if at end of line
    if col >= target_line.chars().count() {
        // At end of line - delete newline if not last line
        if line < total_lines - 1 {
            // The newline is at line_end
            text.remove(line_end);
        }
        return (line, col);
    }

    // Delete character at cursor
    let byte_offset = char_col_to_byte_offset(target_line, col);
    let abs_pos = line_start + byte_offset;

    text.remove(abs_pos);
    (line, col)
}

/// Move cursor left in multiline text, wrapping to previous line if needed.
///
/// Returns the new cursor position (line, column).
#[must_use]
pub fn move_cursor_left_multiline(text: &str, line: usize, col: usize) -> (usize, usize) {
    if col > 0 {
        // Move left on current line
        return (line, col - 1);
    }

    // At start of line - wrap to end of previous line
    if line == 0 {
        return (0, 0); // Already at start
    }

    let lines: Vec<&str> = text.lines().collect();
    let prev_line_len = lines.get(line - 1).map_or(0, |l| l.chars().count());

    (line - 1, prev_line_len)
}

/// Move cursor right in multiline text, wrapping to next line if needed.
///
/// Returns the new cursor position (line, column).
#[must_use]
pub fn move_cursor_right_multiline(text: &str, line: usize, col: usize) -> (usize, usize) {
    let lines: Vec<&str> = text.lines().collect();

    if line >= lines.len() {
        return (line, col);
    }

    let line_len = lines[line].chars().count();

    if col < line_len {
        // Move right on current line
        return (line, col + 1);
    }

    // At end of line - wrap to start of next line
    if line + 1 < lines.len() {
        return (line + 1, 0);
    }

    // At end of last line
    (line, col)
}

/// Move cursor up one line in multiline text.
///
/// Returns the new cursor position (line, column).
#[must_use]
pub fn move_cursor_up_multiline(text: &str, line: usize, col: usize) -> (usize, usize) {
    if line == 0 {
        return (0, col); // Already at top
    }

    let lines: Vec<&str> = text.lines().collect();
    let prev_line_len = lines.get(line - 1).map_or(0, |l| l.chars().count());

    // Clamp column to previous line length
    (line - 1, col.min(prev_line_len))
}

/// Move cursor down one line in multiline text.
///
/// Returns the new cursor position (line, column).
#[must_use]
pub fn move_cursor_down_multiline(text: &str, line: usize, col: usize) -> (usize, usize) {
    let lines: Vec<&str> = text.lines().collect();

    if line + 1 >= lines.len() {
        return (line, col); // Already at bottom
    }

    let next_line_len = lines[line + 1].chars().count();

    // Clamp column to next line length
    (line + 1, col.min(next_line_len))
}

/// Move cursor to start of current line.
#[must_use]
pub fn move_cursor_to_line_start(line: usize) -> (usize, usize) {
    (line, 0)
}

/// Move cursor to end of current line.
#[must_use]
pub fn move_cursor_to_line_end(text: &str, line: usize) -> (usize, usize) {
    let lines: Vec<&str> = text.lines().collect();
    let line_len = lines.get(line).map_or(0, |l| l.chars().count());
    (line, line_len)
}

/// Convert a character column position to a byte offset within a line.
fn char_col_to_byte_offset(line: &str, col: usize) -> usize {
    line.char_indices()
        .nth(col)
        .map_or(line.len(), |(byte_idx, _)| byte_idx)
}

/// Split a line at a character column, returning (before_cursor, after_cursor).
///
/// Used for rendering the cursor in multiline fields.
#[must_use]
pub fn split_at_char_col(line: &str, col: usize) -> (&str, &str) {
    let byte_offset = char_col_to_byte_offset(line, col);
    line.split_at(byte_offset)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_insert_char_ascii() {
        let mut text = String::from("hello");
        let cursor = insert_char_at_cursor(&mut text, 5, '!');
        assert_eq!(text, "hello!");
        assert_eq!(cursor, 6);
    }

    #[test]
    fn test_insert_char_middle() {
        let mut text = String::from("helo");
        let cursor = insert_char_at_cursor(&mut text, 2, 'l');
        assert_eq!(text, "hello");
        assert_eq!(cursor, 3);
    }

    #[test]
    fn test_insert_char_emoji() {
        let mut text = String::from("hello");
        let cursor = insert_char_at_cursor(&mut text, 5, '😀');
        assert_eq!(text, "hello😀");
        assert_eq!(cursor, 5 + '😀'.len_utf8());
    }

    #[test]
    fn test_delete_char_before_cursor() {
        let mut text = String::from("hello");
        let cursor = delete_char_before_cursor(&mut text, 5);
        assert_eq!(text, "hell");
        assert_eq!(cursor, 4);
    }

    #[test]
    fn test_delete_char_before_cursor_emoji() {
        let mut text = String::from("hello😀");
        let len = text.len();
        let cursor = delete_char_before_cursor(&mut text, len);
        assert_eq!(text, "hello");
        assert_eq!(cursor, 5);
    }

    #[test]
    fn test_delete_char_before_cursor_empty() {
        let mut text = String::new();
        let cursor = delete_char_before_cursor(&mut text, 0);
        assert_eq!(text, "");
        assert_eq!(cursor, 0);
    }

    #[test]
    fn test_delete_char_at_cursor() {
        let mut text = String::from("hello");
        let cursor = delete_char_at_cursor(&mut text, 1);
        assert_eq!(text, "hllo");
        assert_eq!(cursor, 1);
    }

    #[test]
    fn test_delete_char_at_cursor_emoji() {
        let mut text = String::from("😀hello");
        let cursor = delete_char_at_cursor(&mut text, 0);
        assert_eq!(text, "hello");
        assert_eq!(cursor, 0);
    }

    #[test]
    fn test_move_cursor_left() {
        let text = "hello";
        let cursor = move_cursor_left(text, 5);
        assert_eq!(cursor, 4);
    }

    #[test]
    fn test_move_cursor_left_emoji() {
        let text = "hello😀";
        let cursor = move_cursor_left(text, text.len());
        assert_eq!(cursor, 5);
    }

    #[test]
    fn test_move_cursor_left_at_start() {
        let text = "hello";
        let cursor = move_cursor_left(text, 0);
        assert_eq!(cursor, 0);
    }

    #[test]
    fn test_move_cursor_right() {
        let text = "hello";
        let cursor = move_cursor_right(text, 0);
        assert_eq!(cursor, 1);
    }

    #[test]
    fn test_move_cursor_right_emoji() {
        let text = "😀hello";
        let cursor = move_cursor_right(text, 0);
        assert_eq!(cursor, '😀'.len_utf8());
    }

    #[test]
    fn test_move_cursor_right_at_end() {
        let text = "hello";
        let cursor = move_cursor_right(text, text.len());
        assert_eq!(cursor, text.len());
    }

    #[test]
    fn test_move_cursor_to_start() {
        assert_eq!(move_cursor_to_start(), 0);
    }

    #[test]
    fn test_move_cursor_to_end() {
        let text = "hello";
        assert_eq!(move_cursor_to_end(text), 5);

        let text_emoji = "hello😀";
        assert_eq!(move_cursor_to_end(text_emoji), text_emoji.len());
    }

    #[test]
    fn test_split_at_char_boundary() {
        let text = "hello";
        let (before, after) = split_at_char_boundary(text, 2);
        assert_eq!(before, "he");
        assert_eq!(after, "llo");
    }

    #[test]
    fn test_split_at_char_boundary_emoji() {
        let text = "he😀llo";
        let emoji_start = 2;
        let emoji_end = emoji_start + '😀'.len_utf8();

        let (before, after) = split_at_char_boundary(text, emoji_end);
        assert_eq!(before, "he😀");
        assert_eq!(after, "llo");
    }

    #[test]
    fn test_multibyte_chars() {
        // Test various UTF-8 characters
        let text = "héllo";
        let mut text_mut = text.to_owned();

        // Insert at position after 'h' (1 byte)
        let cursor = insert_char_at_cursor(&mut text_mut, 1, 'i');
        assert_eq!(text_mut, "hiéllo");
        assert_eq!(cursor, 2);
    }

    #[test]
    fn test_clamp_to_char_boundary() {
        let text = "😀hello";
        let emoji_len = '😀'.len_utf8();

        // Test clamping within emoji bytes
        assert_eq!(clamp_to_char_boundary(text, 0), 0);
        assert_eq!(clamp_to_char_boundary(text, 1), 0); // Inside emoji, clamp to start
        assert_eq!(clamp_to_char_boundary(text, emoji_len), emoji_len);
    }
}
