//! Write a support bundle for a launcher data folder without opening the app.
//!
//! `cargo run --example support_bundle -- <data-dir> <output.zip>`
//!
//! The library comes from the folder's `settings.json`. Game states and the update
//! state are only known to a running launcher, so they are absent here.
fn main() -> glitter_boys_core::Result<()> {
    let mut args = std::env::args_os().skip(1);
    let (Some(data), Some(output)) = (args.next(), args.next()) else {
        return Err(glitter_boys_core::Error::Invalid(
            "Usage: support_bundle <data-dir> <output.zip>".into(),
        ));
    };
    let data = std::path::PathBuf::from(data);
    let settings = glitter_boys_core::state::Settings::load(&data)?;
    let summary = glitter_boys_core::support::write_bundle(
        std::path::Path::new(&output),
        &glitter_boys_core::support::BundleInput {
            data: &data,
            library: Some(&settings.library),
            snapshot: None,
            update: None,
            launcher_problem: None,
        },
    )?;
    println!(
        "{} entries written; shortened: {:?}",
        summary.entries, summary.truncated
    );
    Ok(())
}
