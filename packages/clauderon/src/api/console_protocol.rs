use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ConsoleMessage {
    Attach {
        session_id: String,
        rows: u16,
        cols: u16,
    },
    Attached,
    Error {
        message: String,
    },
    Output {
        data: String,
    },
    Input {
        data: String,
    },
    Resize {
        rows: u16,
        cols: u16,
    },
}
