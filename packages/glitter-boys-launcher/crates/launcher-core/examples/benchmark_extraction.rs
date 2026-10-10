//! Compare one and four workers on unchanged compressed entries from the real BO3 ZIP.
//! Temporary sample archives and output stay under the explicitly supplied scratch folder.
use glitter_boys_core::{
    Cancellation, archive,
    catalog::{Catalog, Game},
};
use std::{fs::File, path::PathBuf, time::Instant};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args = std::env::args_os().skip(1).collect::<Vec<_>>();
    if args.len() != 2 {
        return Err(
            "Usage: benchmark_extraction <download-directory> <existing-scratch-directory>".into(),
        );
    }
    let downloads = PathBuf::from(&args[0]);
    let scratch = tempfile::Builder::new()
        .prefix("gb-extraction-benchmark-")
        .tempdir_in(&args[1])?;
    let catalog = Catalog::bundled()?;
    let parts = catalog
        .package(Game::T7)?
        .archives
        .iter()
        .map(|file| downloads.join(&file.file))
        .collect::<Vec<_>>();
    let mut source = zip::ZipArchive::new(archive::PartsReader::open(&parts)?)?;
    let sample_path = scratch.path().join("sample.zip");
    let mut sample = zip::ZipWriter::new(File::create(&sample_path)?);
    let mut count = 0;
    let mut expanded = 0;
    for index in 0..source.len() {
        let entry = source.by_index(index)?;
        // Multiple medium-sized compressed entries provide real CPU work without
        // writing another complete 134 GB game solely for a benchmark.
        if entry.is_dir()
            || !(64 * 1024 * 1024..=512 * 1024 * 1024).contains(&entry.size())
            || entry.compression() == zip::CompressionMethod::Stored
        {
            continue;
        }
        println!("Sample: {} bytes, {:?}", entry.size(), entry.compression());
        expanded += entry.size();
        sample.raw_copy_file(entry)?;
        count += 1;
        if count == 8 {
            break;
        }
    }
    sample.finish()?.sync_all()?;
    if count < 4 {
        return Err(
            "Archive does not contain enough matching entries for a parallel benchmark".into(),
        );
    }
    println!("Benchmark: {count} real entries, {expanded} expanded bytes");
    let mut serial = 0.0;
    for workers in [1, 4] {
        let output = tempfile::tempdir_in(scratch.path())?;
        let started = Instant::now();
        archive::extract_with_workers(
            std::slice::from_ref(&sample_path),
            output.path(),
            expanded,
            Some("t7"),
            &Cancellation::default(),
            &mut |_| {},
            workers,
        )?;
        let seconds = started.elapsed().as_secs_f64();
        println!(
            "{workers} workers: {seconds:.2}s, {:.1} MB/s (all entry CRCs passed)",
            expanded as f64 / 1e6 / seconds
        );
        if workers == 1 {
            serial = seconds;
        } else {
            println!("Speedup: {:.2}x", serial / seconds);
        }
    }
    Ok(())
}
