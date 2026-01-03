use std::path::PathBuf;
use std::process::Command;

fn main() {
    // Check if we're in CI - fail hard on missing dependencies
    let is_ci = std::env::var("CI").is_ok();

    // Output directory for generated TypeScript types
    let output_dir = PathBuf::from("web/shared/src/generated");

    // Ensure output directory exists
    std::fs::create_dir_all(&output_dir).expect("Failed to create output directory");

    // Run TypeShare CLI to generate TypeScript types
    // This requires 'typeshare' to be installed: cargo install typeshare-cli
    let status = Command::new("typeshare")
        .arg(".")
        .arg("--lang=typescript")
        .arg(format!("--output-file={}/index.ts", output_dir.display()))
        .status();

    match status {
        Ok(exit_status) if exit_status.success() => {
            println!("cargo:warning=TypeShare generation completed successfully");
        }
        Ok(exit_status) => {
            let msg = format!(
                "TypeShare CLI failed with status: {}. Install typeshare-cli: cargo install typeshare-cli",
                exit_status
            );
            if is_ci {
                panic!("{}", msg);
            } else {
                println!("cargo:warning={}", msg);
            }
        }
        Err(e) => {
            let msg = format!(
                "Failed to run TypeShare CLI: {}. Install typeshare-cli: cargo install typeshare-cli",
                e
            );
            if is_ci {
                panic!("{}", msg);
            } else {
                println!("cargo:warning={}", msg);
            }
        }
    }

    // Check that frontend dist directory exists
    // Frontend must be built before Rust compilation for static file embedding
    let frontend_dist = PathBuf::from("web/frontend/dist");
    if !frontend_dist.exists() {
        let msg = "Frontend dist directory not found. Build the frontend first: cd web/frontend && bun run build";
        if is_ci {
            panic!("{}", msg);
        } else {
            println!("cargo:warning={}", msg);
        }
    }

    // Trigger rebuild if any Rust source files change
    println!("cargo:rerun-if-changed=src/");
    // Also rebuild if frontend dist changes
    println!("cargo:rerun-if-changed=web/frontend/dist/");
}
