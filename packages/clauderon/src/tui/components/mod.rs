pub mod create_dialog;
pub mod directory_picker;
pub mod filter_header;
pub mod health_modal;
pub mod issue_picker;
pub mod reconcile_error_dialog;
pub mod recreate_blocked_dialog;
pub mod recreate_confirm_dialog;
pub mod session_list;
pub mod status_bar;

/// Spinner animation frames for UI indicators
pub const SPINNER_FRAMES: &[&str] = &["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
