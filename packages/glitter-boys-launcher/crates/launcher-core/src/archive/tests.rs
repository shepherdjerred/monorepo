use super::*;
use std::io::Cursor;
use zip::write::SimpleFileOptions;

fn fixture(files: &[(&str, &[u8])]) -> Result<Vec<u8>> {
    let mut archive = zip::ZipWriter::new(Cursor::new(Vec::new()));
    for (name, bytes) in files {
        archive.start_file(
            name,
            SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored),
        )?;
        archive.write_all(bytes)?;
    }
    Ok(archive.finish()?.into_inner())
}

#[test]
fn extracts_a_zip_split_in_the_middle_of_file_data() -> Result<()> {
    let archive = fixture(&[("t6/file.txt", b"content")])?;
    let temp = tempfile::tempdir()?;
    let parts = [temp.path().join("a.001"), temp.path().join("a.002")];
    let split = archive
        .windows(7)
        .position(|bytes| bytes == b"content")
        .ok_or_else(|| Error::Invalid("Fixture data missing".into()))?
        + 3;
    std::fs::write(&parts[0], &archive[..split])?;
    std::fs::write(&parts[1], &archive[split..])?;
    let destination = tempfile::tempdir()?;
    extract(
        &parts,
        destination.path(),
        7,
        Some("t6"),
        &Cancellation::default(),
        &mut |_| {},
    )?;
    assert_eq!(
        std::fs::read(destination.path().join("t6/file.txt"))?,
        b"content"
    );
    Ok(())
}

#[test]
fn refuses_duplicate_windows_names_before_writing_files() -> Result<()> {
    let archive = fixture(&[("t6/FILE.txt", b"a"), ("t6/file.txt", b"b")])?;
    let temp = tempfile::tempdir()?;
    let path = temp.path().join("archive.zip");
    std::fs::write(&path, archive)?;
    let destination = tempfile::tempdir()?;
    assert!(
        extract(
            &[path],
            destination.path(),
            2,
            Some("t6"),
            &Cancellation::default(),
            &mut |_| {}
        )
        .is_err()
    );
    assert_eq!(destination.path().read_dir()?.count(), 0);
    Ok(())
}

#[test]
fn refuses_symlinks_and_wrong_expanded_size() -> Result<()> {
    let mut zip = zip::ZipWriter::new(Cursor::new(Vec::new()));
    zip.add_symlink("t6/link", "outside", SimpleFileOptions::default())?;
    let temp = tempfile::tempdir()?;
    let path = temp.path().join("archive.zip");
    std::fs::write(&path, zip.finish()?.into_inner())?;
    assert!(inspect(std::slice::from_ref(&path), 7, Some("t6")).is_err());
    std::fs::write(&path, fixture(&[("t6/valid.txt", b"abc")])?)?;
    assert!(inspect(&[path], 2, Some("t6")).is_err());
    Ok(())
}

#[test]
fn crc_failure_does_not_produce_a_successful_extraction() -> Result<()> {
    let mut archive = fixture(&[("t6/file.txt", b"content")])?;
    let offset = archive
        .windows(7)
        .position(|bytes| bytes == b"content")
        .ok_or_else(|| Error::Invalid("Fixture data missing".into()))?;
    archive[offset] = b'x';
    let temp = tempfile::tempdir()?;
    let path = temp.path().join("archive.zip");
    std::fs::write(&path, archive)?;
    let destination = tempfile::tempdir()?;
    assert!(
        extract(
            &[path],
            destination.path(),
            7,
            Some("t6"),
            &Cancellation::default(),
            &mut |_| {}
        )
        .is_err()
    );
    Ok(())
}

#[test]
fn preserves_existing_destination_contents() -> Result<()> {
    let archive = fixture(&[("t6/file.txt", b"content")])?;
    let temp = tempfile::tempdir()?;
    let path = temp.path().join("archive.zip");
    std::fs::write(&path, archive)?;
    let destination = tempfile::tempdir()?;
    std::fs::write(destination.path().join("save.dat"), b"preserve")?;
    assert!(
        extract(
            &[path],
            destination.path(),
            7,
            Some("t6"),
            &Cancellation::default(),
            &mut |_| {}
        )
        .is_err()
    );
    assert_eq!(
        std::fs::read(destination.path().join("save.dat"))?,
        b"preserve"
    );
    Ok(())
}

#[test]
fn parallel_extraction_matches_serial_bytes_and_reports_monotonic_progress() -> Result<()> {
    let temp = tempfile::tempdir()?;
    let path = temp.path().join("archive.zip");
    let mut zip = zip::ZipWriter::new(Cursor::new(Vec::new()));
    let payload = (0..1024 * 1024)
        .map(|i| (i % 251) as u8)
        .collect::<Vec<_>>();
    for index in 0..12 {
        zip.start_file(
            format!("t7/zone/{index}.bin"),
            SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated),
        )?;
        zip.write_all(&payload)?;
    }
    std::fs::write(&path, zip.finish()?.into_inner())?;
    let total = payload.len() as u64 * 12;
    for workers in [1, 4] {
        let output = tempfile::tempdir()?;
        let mut observations = Vec::new();
        extract_with_workers(
            std::slice::from_ref(&path),
            output.path(),
            total,
            Some("t7"),
            &Cancellation::default(),
            &mut |p| observations.push(p.completed),
            workers,
        )?;
        assert_eq!(observations.last(), Some(&total));
        assert!(observations.windows(2).all(|p| p[0] <= p[1]));
        assert!(observations.iter().all(|value| *value <= total));
        for index in 0..12 {
            assert_eq!(
                std::fs::read(output.path().join(format!("t7/zone/{index}.bin")))?,
                payload
            );
        }
    }
    Ok(())
}

#[test]
fn pausing_parallel_extraction_waits_for_all_workers() -> Result<()> {
    let temp = tempfile::tempdir()?;
    let path = temp.path().join("archive.zip");
    let payload = vec![b'x'; 4 * 1024 * 1024];
    let files = (0..8)
        .map(|i| (format!("t7/{i}.bin"), payload.as_slice()))
        .collect::<Vec<_>>();
    let borrowed = files
        .iter()
        .map(|(name, bytes)| (name.as_str(), *bytes))
        .collect::<Vec<_>>();
    std::fs::write(&path, fixture(&borrowed)?)?;
    let output = tempfile::tempdir()?;
    let cancel = Cancellation::default();
    let result = extract_with_workers(
        &[path],
        output.path(),
        payload.len() as u64 * 8,
        Some("t7"),
        &cancel,
        &mut |_| cancel.pause(),
        4,
    );
    assert!(matches!(result, Err(Error::Paused)));
    // Windows must be able to remove staging immediately after the workers join.
    output.close()?;
    Ok(())
}

#[test]
fn one_corrupt_entry_fails_the_parallel_job_and_releases_all_files() -> Result<()> {
    let payload = vec![b'x'; 1024 * 1024];
    let mut archive = fixture(&[
        ("t7/a.bin", &payload),
        ("t7/b.bin", &payload),
        ("t7/c.bin", &payload),
        ("t7/d.bin", &payload),
    ])?;
    let offset = archive
        .windows(32)
        .position(|bytes| bytes == &payload[..32])
        .ok_or_else(|| Error::Invalid("Fixture data missing".into()))?;
    archive[offset] = b'y';
    let temp = tempfile::tempdir()?;
    let path = temp.path().join("archive.zip");
    std::fs::write(&path, archive)?;
    let output = tempfile::tempdir()?;
    assert!(
        extract_with_workers(
            &[path],
            output.path(),
            payload.len() as u64 * 4,
            Some("t7"),
            &Cancellation::default(),
            &mut |_| {},
            4
        )
        .is_err()
    );
    output.close()?;
    Ok(())
}
