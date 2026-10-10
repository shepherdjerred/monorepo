//! Validate downloaded archive layouts with the production Rust ZIP reader.
use glitter_boys_core::{archive, catalog::Catalog};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let root = std::env::args_os()
        .nth(1)
        .map(std::path::PathBuf::from)
        .ok_or("Usage: cargo run --example audit_archives -- <archive-directory>")?;
    let catalog = Catalog::bundled()?;
    for package in catalog.games {
        let paths = package
            .archives
            .iter()
            .map(|artifact| root.join(&artifact.file))
            .collect::<Vec<_>>();
        let count = archive::inspect(&paths, package.expanded_bytes, Some(package.game.id()))?;
        println!(
            "{}: {count} entries, {} expanded bytes; metadata validated",
            package.game.id(),
            package.expanded_bytes
        );
    }
    Ok(())
}
