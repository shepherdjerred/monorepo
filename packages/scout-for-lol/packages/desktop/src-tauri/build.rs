//! Build script for Tauri desktop application

use std::env;
use std::fs;
use std::path::PathBuf;

fn main() {
    tauri_build::build();

    // Copy WebView2Loader.dll to resources directory for embedding (Windows targets only)
    let target = env::var("TARGET").unwrap_or_default();
    if target.contains("windows") {
        let resources_dir = PathBuf::from("resources");
        fs::create_dir_all(&resources_dir).ok();

        // Try to find the DLL in the target release directory
        // This works for both GNU and MSVC toolchains
        let target_dir = PathBuf::from("target").join(&target).join("release");
        let dll_path = target_dir.join("WebView2Loader.dll");

        // Try to find DLL from webview2-com-sys build output if not in release directory
        let dll_source = if dll_path.exists() {
            Some(dll_path.clone())
        } else {
            // Look for DLL in webview2-com-sys build output
            let build_dir = PathBuf::from("target")
                .join(&target)
                .join("release")
                .join("build");
            if build_dir.exists() {
                // Search for webview2-com-sys output directories
                if let Ok(entries) = fs::read_dir(&build_dir) {
                    for entry in entries.flatten() {
                        let path = entry.path();
                        if path.is_dir()
                            && path
                                .file_name()
                                .and_then(|n| n.to_str())
                                .is_some_and(|n| n.contains("webview2-com-sys"))
                        {
                            // Check x64 directory (most common)
                            let x64_dll = path.join("out").join("x64").join("WebView2Loader.dll");
                            if x64_dll.exists() {
                                // Copy to release directory
                                if let Err(e) = fs::copy(&x64_dll, &dll_path) {
                                    eprintln!("cargo:warning=Failed to copy WebView2Loader.dll from build output: {e}");
                                }
                                break;
                            }
                        }
                    }
                }
            }
            if dll_path.exists() {
                Some(dll_path.clone())
            } else {
                None
            }
        };

        if let Some(source) = dll_source {
            // Copy to resources for embedding
            let dest = resources_dir.join("WebView2Loader.dll");
            if let Err(e) = fs::copy(&source, &dest) {
                eprintln!("cargo:warning=Failed to copy WebView2Loader.dll to resources: {e}");
            } else {
                println!("cargo:rerun-if-changed={}", source.display());
            }
        } else {
            // Warn if DLL is missing from release directory
            // This ensures Windows can find it when loading the executable
            eprintln!(
                "cargo:warning=WebView2Loader.dll should be in: {}",
                dll_path.display()
            );
        }
    }
}
