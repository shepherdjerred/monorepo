/// Types of terminal query sequences that can be detected.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TerminalQuery {
    /// Device Status Report (DSR) - ESC[5n
    DeviceStatus,
    /// Cursor Position Report (CPR) - ESC[6n
    CursorPosition,
    /// Primary Device Attributes (DA1) - ESC[c
    PrimaryDeviceAttributes,
    /// Secondary Device Attributes (DA2) - ESC[>c
    SecondaryDeviceAttributes,
}

/// Parsed terminal output event, either raw output or a query sequence.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TerminalEvent {
    /// Raw terminal output bytes (with queries stripped).
    Output(Vec<u8>),
    /// A detected terminal query sequence.
    Query(TerminalQuery),
}

/// Parse terminal output for query sequences (DSR/DA) and strip them from output.
#[derive(Default, Debug)]
pub struct TerminalQueryParser {
    pending: Vec<u8>,
}

impl TerminalQueryParser {
    /// Create a new parser with empty state.
    #[must_use]
    pub fn new() -> Self {
        Self {
            pending: Vec::new(),
        }
    }

    /// Parse a chunk of output into output/query events.
    ///
    /// This strips recognized query sequences from the output stream while
    /// preserving all other bytes verbatim.
    pub fn parse(&mut self, input: &[u8]) -> Vec<TerminalEvent> {
        const ESC: u8 = 0x1b;

        let mut buf = Vec::with_capacity(self.pending.len() + input.len());
        buf.extend_from_slice(&self.pending);
        buf.extend_from_slice(input);
        self.pending.clear();

        let mut events = Vec::new();
        let mut out = Vec::new();
        let mut i = 0;

        while i < buf.len() {
            if buf[i] != ESC {
                out.push(buf[i]);
                i += 1;
                continue;
            }

            if i + 1 >= buf.len() {
                break;
            }

            if buf[i + 1] != b'[' {
                out.push(buf[i]);
                i += 1;
                continue;
            }

            if i + 2 >= buf.len() {
                break;
            }

            match buf[i + 2] {
                b'6' => {
                    if i + 3 >= buf.len() {
                        break;
                    }
                    if buf[i + 3] == b'n' {
                        if !out.is_empty() {
                            events.push(TerminalEvent::Output(std::mem::take(&mut out)));
                        }
                        events.push(TerminalEvent::Query(TerminalQuery::CursorPosition));
                        i += 4;
                        continue;
                    }
                }
                b'5' => {
                    if i + 3 >= buf.len() {
                        break;
                    }
                    if buf[i + 3] == b'n' {
                        if !out.is_empty() {
                            events.push(TerminalEvent::Output(std::mem::take(&mut out)));
                        }
                        events.push(TerminalEvent::Query(TerminalQuery::DeviceStatus));
                        i += 4;
                        continue;
                    }
                }
                b'c' => {
                    if !out.is_empty() {
                        events.push(TerminalEvent::Output(std::mem::take(&mut out)));
                    }
                    events.push(TerminalEvent::Query(TerminalQuery::PrimaryDeviceAttributes));
                    i += 3;
                    continue;
                }
                b'>' => {
                    if i + 3 >= buf.len() {
                        break;
                    }
                    if buf[i + 3] == b'c' {
                        if !out.is_empty() {
                            events.push(TerminalEvent::Output(std::mem::take(&mut out)));
                        }
                        events.push(TerminalEvent::Query(
                            TerminalQuery::SecondaryDeviceAttributes,
                        ));
                        i += 4;
                        continue;
                    }
                }
                _ => {}
            }

            out.push(buf[i]);
            i += 1;
        }

        if !out.is_empty() {
            events.push(TerminalEvent::Output(out));
        }

        if i < buf.len() {
            self.pending.extend_from_slice(&buf[i..]);
        }

        events
    }
}

/// Build a response byte sequence for a terminal query, using the given cursor position.
#[must_use]
pub fn build_query_response(query: TerminalQuery, cursor: Option<(u16, u16)>) -> Vec<u8> {
    match query {
        TerminalQuery::DeviceStatus => b"\x1b[0n".to_vec(),
        TerminalQuery::CursorPosition => {
            let (row, col) = cursor.unwrap_or((0, 0));
            format!("\x1b[{};{}R", row + 1, col + 1).into_bytes()
        }
        TerminalQuery::PrimaryDeviceAttributes => b"\x1b[?1;2c".to_vec(),
        TerminalQuery::SecondaryDeviceAttributes => b"\x1b[>0;0;0c".to_vec(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_dsr_cursor_query() {
        let mut parser = TerminalQueryParser::new();
        let input = b"hi\x1b[6nthere";
        let events = parser.parse(input);

        assert_eq!(
            events,
            vec![
                TerminalEvent::Output(b"hi".to_vec()),
                TerminalEvent::Query(TerminalQuery::CursorPosition),
                TerminalEvent::Output(b"there".to_vec()),
            ]
        );
    }

    #[test]
    fn handles_partial_sequence_across_chunks() {
        let mut parser = TerminalQueryParser::new();
        let events_first = parser.parse(b"hi\x1b[");
        assert_eq!(events_first, vec![TerminalEvent::Output(b"hi".to_vec())]);

        let events_second = parser.parse(b"6nthere");
        assert_eq!(
            events_second,
            vec![
                TerminalEvent::Query(TerminalQuery::CursorPosition),
                TerminalEvent::Output(b"there".to_vec()),
            ]
        );
    }
}
