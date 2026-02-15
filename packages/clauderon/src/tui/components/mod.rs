/// Session creation dialog.
pub mod create_dialog;
/// Directory picker for file selection.
pub mod directory_picker;
/// Filter header for session list.
pub mod filter_header;
/// Health status modal dialog.
pub mod health_modal;
/// Reconcile error display dialog.
pub mod reconcile_error_dialog;
/// Recreate blocked state dialog.
pub mod recreate_blocked_dialog;
/// Recreate confirmation dialog.
pub mod recreate_confirm_dialog;
/// Session list rendering.
pub mod session_list;
/// Status bar rendering.
pub mod status_bar;

/// Spinner animation frames for UI indicators
pub const SPINNER_FRAMES: &[&str] = &["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
