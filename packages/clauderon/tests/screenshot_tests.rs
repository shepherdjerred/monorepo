//! TUI screenshot tests - generates PNG images from TestBackend for documentation
//!
//! These tests are marked with `#[ignore]` so they don't run in regular CI.
//! Run manually with: `cargo test --test screenshot_tests -- --ignored`

use ab_glyph::{FontRef, PxScale};
use image::{ImageBuffer, Rgb, RgbImage};
use imageproc::drawing::draw_text_mut;
use ratatui::{Terminal, backend::TestBackend};
use std::path::PathBuf;

use clauderon::api::MockApiClient;
use clauderon::core::{BackendType, SessionStatus};
use clauderon::tui::app::{App, AppMode, CreateDialogFocus};
use clauderon::tui::ui;

// Constants for rendering
const CHAR_WIDTH: u32 = 9; // Width of a monospace character in pixels
const CHAR_HEIGHT: u32 = 18; // Height of a monospace character in pixels
const FONT_SIZE: f32 = 14.0;

// Colors (VS Code Dark+ theme)
const BG_COLOR: Rgb<u8> = Rgb([30, 30, 30]); // #1E1E1E
const FG_COLOR: Rgb<u8> = Rgb([212, 212, 212]); // #D4D4D4

/// Convert a ratatui TestBackend buffer to a PNG image
#[allow(clippy::cast_possible_truncation, clippy::cast_possible_wrap)]
fn buffer_to_png(
    buffer: &ratatui::buffer::Buffer,
    output_path: &PathBuf,
) -> Result<(), Box<dyn std::error::Error>> {
    let width = buffer.area.width as u32;
    let height = buffer.area.height as u32;

    // Create image with calculated dimensions
    let img_width = width * CHAR_WIDTH;
    let img_height = height * CHAR_HEIGHT;
    let mut img: RgbImage = ImageBuffer::from_pixel(img_width, img_height, BG_COLOR);

    // Try to load font, fall back to simple rendering if not available
    let font_result = get_or_download_font();

    if let Ok(font_data) = font_result {
        let font = FontRef::try_from_slice(&font_data)?;
        let scale = PxScale::from(FONT_SIZE);

        // Render each character from the buffer using the font
        for y in 0..height {
            for x in 0..width {
                if let Some(cell) = buffer.cell((x as u16, y as u16)) {
                    let symbol = cell.symbol();
                    if !symbol.is_empty() && symbol != " " {
                        let px_x = x * CHAR_WIDTH;
                        let px_y = y * CHAR_HEIGHT;

                        // Draw text (character by character)
                        draw_text_mut(
                            &mut img,
                            FG_COLOR,
                            px_x as i32,
                            px_y as i32,
                            scale,
                            &font,
                            symbol,
                        );
                    }
                }
            }
        }
    } else {
        // Fallback: simple block rendering (no actual font rendering)
        println!("Warning: Font not available, using simple block rendering");
        for y in 0..height {
            for x in 0..width {
                if let Some(cell) = buffer.cell((x as u16, y as u16)) {
                    let symbol = cell.symbol();
                    if !symbol.is_empty() && symbol != " " {
                        // Draw a simple rectangle for each character
                        let px_x = x * CHAR_WIDTH;
                        let px_y = y * CHAR_HEIGHT;

                        for dy in 0..CHAR_HEIGHT {
                            for dx in 0..CHAR_WIDTH / 2 {
                                img.put_pixel(px_x + dx, px_y + dy, FG_COLOR);
                            }
                        }
                    }
                }
            }
        }
    }

    // Save PNG
    img.save(output_path)?;
    println!("✓ Created {}", output_path.display());

    Ok(())
}

/// Get font data, downloading if necessary
fn get_or_download_font() -> Result<Vec<u8>, Box<dyn std::error::Error>> {
    use std::fs;
    use std::path::PathBuf;

    // Check for embedded font first
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let font_path = manifest_dir.join("assets").join("DejaVuSansMono.ttf");

    if font_path.exists() {
        return Ok(fs::read(&font_path)?);
    }

    // Try to find system font
    let system_fonts = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
        "/System/Library/Fonts/Monaco.ttf",
        "/System/Library/Fonts/Menlo.ttc",
    ];

    for path in &system_fonts {
        if std::path::Path::new(path).exists() {
            return Ok(fs::read(path)?);
        }
    }

    Err("No suitable monospace font found".into())
}

/// Helper to get screenshots directory
fn screenshots_dir() -> PathBuf {
    let mut path = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    path.push("screenshots");
    path.push("tui");
    std::fs::create_dir_all(&path).unwrap();
    path
}

// ============================================================================
// Screenshot Generation Tests
// ============================================================================

/// Generate screenshot of session list with sample data
#[tokio::test]
#[ignore] // Run manually with --ignored flag
async fn generate_session_list_screenshot() {
    let backend = TestBackend::new(100, 30);
    let mut terminal = Terminal::new(backend).unwrap();

    let mut app = App::new();
    let mock = MockApiClient::new();

    // Add sample sessions
    let s1 = MockApiClient::create_mock_session("dev-environment", SessionStatus::Running);
    let s2 = MockApiClient::create_mock_session("test-suite", SessionStatus::Idle);
    let s3 = MockApiClient::create_mock_session("prod-debug", SessionStatus::Running);
    mock.add_session(s1).await;
    mock.add_session(s2).await;
    mock.add_session(s3).await;

    app.set_client(Box::new(mock));
    app.refresh_sessions().await.unwrap();

    // Render
    terminal.draw(|frame| ui::render(frame, &app)).unwrap();

    // Convert to PNG
    let buffer = terminal.backend().buffer();
    let output_path = screenshots_dir().join("session-list.png");
    buffer_to_png(buffer, &output_path).unwrap();
}

/// Generate screenshot of create session dialog
#[tokio::test]
#[ignore]
async fn generate_create_dialog_screenshot() {
    let backend = TestBackend::new(100, 35);
    let mut terminal = Terminal::new(backend).unwrap();

    let mut app = App::new();
    app.open_create_dialog();

    // Fill in some sample data to show what the dialog looks like
    app.create_dialog.prompt = "Implement user authentication".to_string();
    app.create_dialog.repo_path = "/Users/dev/myproject".to_string();
    app.create_dialog.base_branch = "main".to_string();
    app.create_dialog.backend = BackendType::Docker;
    app.create_dialog.focus = CreateDialogFocus::Prompt;

    // Render
    terminal.draw(|frame| ui::render(frame, &app)).unwrap();

    // Convert to PNG
    let buffer = terminal.backend().buffer();
    let output_path = screenshots_dir().join("create-dialog.png");
    buffer_to_png(buffer, &output_path).unwrap();
}

/// Generate screenshot of help screen
#[test]
#[ignore]
fn generate_help_screen_screenshot() {
    let backend = TestBackend::new(100, 30);
    let mut terminal = Terminal::new(backend).unwrap();

    let mut app = App::new();
    app.mode = AppMode::Help;

    // Render
    terminal.draw(|frame| ui::render(frame, &app)).unwrap();

    // Convert to PNG
    let buffer = terminal.backend().buffer();
    let output_path = screenshots_dir().join("help-screen.png");
    buffer_to_png(buffer, &output_path).unwrap();
}

/// Generate screenshot of empty session list
#[test]
#[ignore]
fn generate_empty_session_list_screenshot() {
    let backend = TestBackend::new(100, 25);
    let mut terminal = Terminal::new(backend).unwrap();

    let app = App::new();

    // Render
    terminal.draw(|frame| ui::render(frame, &app)).unwrap();

    // Convert to PNG
    let buffer = terminal.backend().buffer();
    let output_path = screenshots_dir().join("empty-session-list.png");
    buffer_to_png(buffer, &output_path).unwrap();
}

/// Generate screenshot of delete confirmation dialog
#[tokio::test]
#[ignore]
async fn generate_delete_confirmation_screenshot() {
    let backend = TestBackend::new(100, 30);
    let mut terminal = Terminal::new(backend).unwrap();

    let mut app = App::new();
    let mock = MockApiClient::new();

    let session = MockApiClient::create_mock_session("old-session", SessionStatus::Idle);
    mock.add_session(session).await;

    app.set_client(Box::new(mock));
    app.refresh_sessions().await.unwrap();
    app.open_delete_confirm();

    // Render
    terminal.draw(|frame| ui::render(frame, &app)).unwrap();

    // Convert to PNG
    let buffer = terminal.backend().buffer();
    let output_path = screenshots_dir().join("delete-confirmation.png");
    buffer_to_png(buffer, &output_path).unwrap();
}
