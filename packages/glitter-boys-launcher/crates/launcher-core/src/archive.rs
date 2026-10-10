//! ZIP validation and extraction, including byte-split BO3 downloads.

use crate::{Cancellation, Error, Progress, Result};
use std::{
    collections::HashSet,
    fs::File,
    io::{Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
};

/// Reject Windows path aliases even when checks run on a Linux CI worker.
pub fn safe_relative_path(name: &str) -> Result<PathBuf> {
    let normalized = name.replace('\\', "/");
    let trimmed = normalized.trim_end_matches('/');
    if trimmed.is_empty() || normalized.starts_with('/') {
        return Err(Error::Invalid(
            "Archive contains an absolute or empty path".into(),
        ));
    }
    let mut path = PathBuf::new();
    for component in trimmed.split('/') {
        let stem = component
            .split('.')
            .next()
            .unwrap_or_default()
            .to_ascii_uppercase();
        let reserved = matches!(
            stem.as_str(),
            "CON" | "PRN" | "AUX" | "NUL" | "CONIN$" | "CONOUT$"
        ) || (stem.len() == 4
            && (stem.starts_with("COM") || stem.starts_with("LPT"))
            && stem.as_bytes()[3].is_ascii_digit());
        if component.is_empty()
            || component == "."
            || component == ".."
            || reserved
            || component.ends_with(['.', ' '])
            || component
                .chars()
                .any(|c| c.is_control() || "<>:\"|?*".contains(c))
        {
            return Err(Error::Invalid(
                "Archive contains an unsafe Windows path".into(),
            ));
        }
        path.push(component);
    }
    Ok(path)
}

/// Treat numbered download parts as one seekable stream, without a second giant copy.
pub struct PartsReader {
    parts: Vec<(File, u64, u64)>,
    length: u64,
    position: u64,
}

impl PartsReader {
    pub fn open(paths: &[PathBuf]) -> Result<Self> {
        let mut parts = Vec::new();
        let mut length = 0_u64;
        for path in paths {
            let file = File::open(path)?;
            let size = file.metadata()?.len();
            parts.push((file, length, size));
            length = length
                .checked_add(size)
                .ok_or_else(|| Error::Invalid("Archive is too large".into()))?;
        }
        if parts.is_empty() {
            return Err(Error::Invalid("Archive parts are missing".into()));
        }
        Ok(Self {
            parts,
            length,
            position: 0,
        })
    }
}

impl Read for PartsReader {
    fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
        if buffer.is_empty() || self.position >= self.length {
            return Ok(0);
        }
        for (file, start, size) in &mut self.parts {
            if self.position >= *start && self.position < *start + *size {
                let offset = self.position - *start;
                file.seek(SeekFrom::Start(offset))?;
                let count = usize::try_from((*size - offset).min(buffer.len() as u64))
                    .map_err(std::io::Error::other)?;
                let read = file.read(&mut buffer[..count])?;
                if read == 0 {
                    return Err(std::io::Error::new(
                        std::io::ErrorKind::UnexpectedEof,
                        "Archive part was truncated",
                    ));
                }
                self.position += read as u64;
                return Ok(read);
            }
        }
        Err(std::io::Error::other("Invalid archive position"))
    }
}

impl Seek for PartsReader {
    fn seek(&mut self, position: SeekFrom) -> std::io::Result<u64> {
        let next = match position {
            SeekFrom::Start(offset) => i128::from(offset),
            SeekFrom::Current(offset) => i128::from(self.position) + i128::from(offset),
            SeekFrom::End(offset) => i128::from(self.length) + i128::from(offset),
        };
        self.position = u64::try_from(next)
            .map_err(|_| std::io::Error::new(std::io::ErrorKind::InvalidInput, "Invalid seek"))?;
        Ok(self.position)
    }
}

fn validated_archive(
    parts: &[PathBuf],
    expected_bytes: u64,
    root: Option<&str>,
    cancel: &Cancellation,
) -> Result<zip::ZipArchive<PartsReader>> {
    let mut archive = zip::ZipArchive::new(PartsReader::open(parts)?)?;
    let mut names = HashSet::new();
    let mut total = 0_u64;
    // Validate the entire directory before creating any files.
    for index in 0..archive.len() {
        cancel.check()?;
        let entry = archive.by_index(index)?;
        let path = safe_relative_path(&entry.name()?)?;
        if root.is_some_and(|root| !path.starts_with(root)) {
            return Err(Error::Invalid(
                "Archive has an unexpected root folder".into(),
            ));
        }
        let kind = entry.unix_mode().unwrap_or_default() & 0o170000;
        if !matches!(kind, 0 | 0o040000 | 0o100000) {
            return Err(Error::Invalid(
                "Archive contains a link or special file".into(),
            ));
        }
        if !names.insert(path.to_string_lossy().to_lowercase()) {
            return Err(Error::Invalid("Archive has duplicate Windows paths".into()));
        }
        total = total
            .checked_add(entry.size())
            .ok_or_else(|| Error::Invalid("Archive size overflow".into()))?;
        if total > expected_bytes {
            return Err(Error::Invalid(
                "Archive exceeds the expected expanded size".into(),
            ));
        }
    }
    if total != expected_bytes {
        return Err(Error::Invalid(
            "Archive size does not match the catalog".into(),
        ));
    }
    Ok(archive)
}

/// Inspect the same archive metadata used by installation, without extracting files.
pub fn inspect(parts: &[PathBuf], expected_bytes: u64, root: Option<&str>) -> Result<usize> {
    Ok(validated_archive(parts, expected_bytes, root, &Cancellation::default())?.len())
}

pub fn extract(
    parts: &[PathBuf],
    destination: &Path,
    expected_bytes: u64,
    root: Option<&str>,
    cancel: &Cancellation,
    progress: &mut dyn FnMut(Progress),
) -> Result<()> {
    let workers = std::thread::available_parallelism()?.get().min(4);
    extract_with_workers(
        parts,
        destination,
        expected_bytes,
        root,
        cancel,
        progress,
        workers,
    )
}

struct ExtractionJob {
    index: usize,
    path: PathBuf,
    size: u64,
}

/// Bounded extraction with an explicit worker count for reproducible local benchmarks.
pub fn extract_with_workers(
    parts: &[PathBuf],
    destination: &Path,
    expected_bytes: u64,
    root: Option<&str>,
    cancel: &Cancellation,
    progress: &mut dyn FnMut(Progress),
    workers: usize,
) -> Result<()> {
    use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};

    if !(1..=4).contains(&workers) {
        return Err(Error::Invalid(
            "Extraction requires between one and four workers".into(),
        ));
    }
    let mut archive = validated_archive(parts, expected_bytes, root, cancel)?;
    if destination.read_dir()?.next().is_some() {
        return Err(Error::Invalid(
            "Extraction needs an empty staging folder".into(),
        ));
    }
    let mut jobs = Vec::new();
    for index in 0..archive.len() {
        cancel.check()?;
        let entry = archive.by_index(index)?;
        let path = safe_relative_path(&entry.name()?)?;
        let output = destination.join(&path);
        if entry.is_dir() {
            std::fs::create_dir_all(&output)?;
            continue;
        }
        if let Some(parent) = output.parent() {
            std::fs::create_dir_all(parent)?;
        }
        jobs.push(ExtractionJob {
            index,
            path,
            size: entry.size(),
        });
    }
    drop(archive);
    // Start the biggest entries first, so one large file does not leave the other
    // workers idle at the end. Each worker has independent archive file handles.
    jobs.sort_unstable_by_key(|job| std::cmp::Reverse(job.size));
    let worker_count = workers.min(jobs.len());
    let phase = match worker_count {
        2 => "Unpacking (2 workers)",
        3 => "Unpacking (3 workers)",
        4 => "Unpacking (4 workers)",
        _ => "Unpacking",
    };
    let next = AtomicUsize::new(0);
    let completed = AtomicU64::new(0);
    let stopped = AtomicBool::new(false);
    std::thread::scope(|scope| -> Result<()> {
        let mut handles = Vec::new();
        for _ in 0..worker_count {
            let jobs = &jobs;
            let next = &next;
            let completed = &completed;
            let stopped = &stopped;
            handles.push(scope.spawn(move || {
                let result = (|| -> Result<()> {
                    let mut archive = zip::ZipArchive::new(PartsReader::open(parts)?)?;
                    let mut buffer = vec![0_u8; 1024 * 1024];
                    loop {
                        cancel.check()?;
                        if stopped.load(Ordering::Relaxed) {
                            return Ok(());
                        }
                        let Some(job) = jobs.get(next.fetch_add(1, Ordering::Relaxed)) else {
                            return Ok(());
                        };
                        let mut entry = archive.by_index(job.index)?;
                        if safe_relative_path(&entry.name()?)? != job.path
                            || entry.size() != job.size
                        {
                            return Err(Error::Invalid("Archive changed during extraction".into()));
                        }
                        let mut file = File::create_new(destination.join(&job.path))?;
                        let mut written = 0_u64;
                        loop {
                            cancel.check()?;
                            if stopped.load(Ordering::Relaxed) {
                                return Ok(());
                            }
                            let count = entry.read(&mut buffer)?; // CRC is checked at EOF on every worker.
                            if count == 0 {
                                break;
                            }
                            written += count as u64;
                            if written > job.size {
                                return Err(Error::Invalid(
                                    "Archive entry exceeds its declared size".into(),
                                ));
                            }
                            file.write_all(&buffer[..count])?;
                            completed.fetch_add(count as u64, Ordering::Relaxed);
                        }
                        if written != job.size {
                            return Err(Error::Invalid("Archive entry is truncated".into()));
                        }
                        file.sync_all()?;
                    }
                })();
                if result.is_err() {
                    stopped.store(true, Ordering::Relaxed);
                }
                result
            }));
        }
        while handles.iter().any(|handle| !handle.is_finished()) {
            progress(Progress {
                phase,
                completed: completed.load(Ordering::Relaxed),
                total: expected_bytes,
            });
            std::thread::sleep(std::time::Duration::from_millis(100));
        }
        let mut failure = None;
        for handle in handles {
            let result = handle.join().unwrap_or_else(|_| {
                Err(Error::Invalid(
                    "An extraction worker stopped unexpectedly".into(),
                ))
            });
            if let Err(error) = result {
                failure.get_or_insert(error);
            }
        }
        if let Some(error) = failure {
            return Err(error);
        }
        cancel.check()?;
        if completed.load(Ordering::Relaxed) != expected_bytes {
            return Err(Error::Invalid(
                "Extraction did not write the expected number of bytes".into(),
            ));
        }
        progress(Progress {
            phase,
            completed: expected_bytes,
            total: expected_bytes,
        });
        Ok(())
    })?;
    Ok(())
}

#[cfg(test)]
#[path = "archive/tests.rs"]
mod extraction_tests;

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_windows_aliases_and_traversal() {
        for path in [
            "../save",
            "a/../../save",
            "C:\\game",
            "//server/share",
            "a:stream",
            "NUL.txt",
            "dir/COM1",
            "file.",
            "dir /save",
            "a//b",
        ] {
            assert!(safe_relative_path(path).is_err(), "{path}");
        }
        assert_eq!(
            safe_relative_path("t6\\zone\\english/").ok(),
            Some(PathBuf::from("t6/zone/english"))
        );
    }
    #[test]
    fn reads_and_seeks_across_part_boundaries() -> Result<()> {
        let temp = tempfile::tempdir()?;
        let paths = [temp.path().join("a"), temp.path().join("b")];
        std::fs::write(&paths[0], b"abc")?;
        std::fs::write(&paths[1], b"defg")?;
        let mut reader = PartsReader::open(&paths)?;
        reader.seek(SeekFrom::Start(2))?;
        let mut bytes = [0_u8; 4];
        reader.read_exact(&mut bytes)?;
        assert_eq!(&bytes, b"cdef");
        reader.seek(SeekFrom::End(-2))?;
        let mut tail = String::new();
        reader.read_to_string(&mut tail)?;
        assert_eq!(tail, "fg");
        assert!(reader.seek(SeekFrom::Start(0))?.eq(&0));
        assert!(reader.seek(SeekFrom::Current(-1)).is_err());
        Ok(())
    }
}
