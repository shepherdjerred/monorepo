use std::path::PathBuf;
use std::process::Command;

fn main() {
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
            println!("cargo:warning=TypeShare CLI failed with status: {}", exit_status);
            println!("cargo:warning=Install typeshare-cli: cargo install typeshare-cli");
        }
        Err(e) => {
            println!("cargo:warning=Failed to run TypeShare CLI: {}", e);
            println!("cargo:warning=Install typeshare-cli: cargo install typeshare-cli");
        }
    }

    // Trigger rebuild if any Rust source files change
    println!("cargo:rerun-if-changed=src/");
}
