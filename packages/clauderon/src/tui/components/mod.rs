/// Session creation dialog.
pub mod create_dialog;
/// File system directory picker widget.
pub mod directory_picker;
/// Filter header bar for session list.
pub mod filter_header;
/// Startup health check modal.
pub mod health_modal;
/// Reconcile error detail dialog.
pub mod reconcile_error_dialog;
/// Dialog shown when recreation is blocked.
pub mod recreate_blocked_dialog;
/// Confirmation dialog for session recreation.
pub mod recreate_confirm_dialog;
/// Session list table widget.
pub mod session_list;
/// Bottom status bar.
pub mod status_bar;

/// Spinner animation frames for UI indicators
pub const SPINNER_FRAMES: &[&str] = &["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
