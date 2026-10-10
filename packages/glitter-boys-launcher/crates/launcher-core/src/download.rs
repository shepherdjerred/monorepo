//! Bounded resumable HTTPS downloads, checked against the reviewed catalog.

use crate::{Cancellation, Error, Progress, Result, catalog::Artifact};
use reqwest::{
    Client, StatusCode,
    header::{ACCEPT_ENCODING, CONTENT_RANGE, RANGE},
};
use sha2::{Digest, Sha256};
use std::{
    fs::{File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    time::Duration,
};

pub struct DownloadClient {
    transport: Client,
    runtime: tokio::runtime::Runtime,
}

pub fn client() -> Result<DownloadClient> {
    let transport = Client::builder()
        .https_only(true)
        .connect_timeout(Duration::from_secs(30))
        .read_timeout(Duration::from_secs(60))
        .user_agent("GlitterBoys/0.1.0")
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()?;
    Ok(DownloadClient {
        transport,
        runtime: tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()?,
    })
}

pub fn digest(
    path: &Path,
    cancel: &Cancellation,
    progress: &mut dyn FnMut(Progress),
) -> Result<String> {
    let mut file = File::open(path)?;
    let total = file.metadata()?.len();
    let mut hasher = Sha256::new();
    let mut completed = 0_u64;
    let mut buffer = vec![0_u8; 1024 * 1024];
    loop {
        cancel.check()?;
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
        completed += read as u64;
        progress(Progress {
            phase: "Checking download",
            completed,
            total,
        });
    }
    Ok(hex::encode(hasher.finalize()))
}

fn verify(
    path: &Path,
    artifact: &Artifact,
    cancel: &Cancellation,
    progress: &mut dyn FnMut(Progress),
) -> Result<bool> {
    Ok(std::fs::metadata(path)?.len() == artifact.bytes
        && digest(path, cancel, progress)?.eq_ignore_ascii_case(&artifact.sha256))
}

fn range_matches(value: &str, offset: u64, total: u64) -> bool {
    value == format!("bytes {offset}-{}/{total}", total - 1)
}

pub fn fetch(
    client: &DownloadClient,
    artifact: &Artifact,
    cache: &Path,
    cancel: &Cancellation,
    progress: &mut dyn FnMut(Progress),
) -> Result<PathBuf> {
    artifact.validate()?;
    client.runtime.block_on(fetch_async(
        &client.transport,
        artifact,
        cache,
        cancel,
        progress,
    ))
}

async fn fetch_async(
    client: &Client,
    artifact: &Artifact,
    cache: &Path,
    cancel: &Cancellation,
    progress: &mut dyn FnMut(Progress),
) -> Result<PathBuf> {
    crate::install::ensure_plain_directory(cache)?;
    // Digest-specific directories prevent mixing data across catalog revisions.
    let cache = cache.join(&artifact.sha256);
    crate::install::ensure_plain_directory(&cache)?;
    let final_path = cache.join(&artifact.file);
    let partial_path = cache.join(format!("{}.partial", artifact.file));
    for path in [&final_path, &partial_path] {
        match std::fs::symlink_metadata(path) {
            Ok(metadata) if !metadata.is_file() || metadata.file_type().is_symlink() => {
                return Err(Error::Invalid(
                    "Download cache contains an unexpected file type".into(),
                ));
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.into()),
        }
    }
    if final_path.exists() {
        if verify(&final_path, artifact, cancel, progress)? {
            return Ok(final_path);
        }
        // Only a file in our content-addressed archive cache is removed.
        std::fs::remove_file(&final_path)?;
    }
    let mut offset = match std::fs::metadata(&partial_path) {
        Ok(metadata) => metadata.len(),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => 0,
        Err(error) => return Err(error.into()),
    };
    if offset > artifact.bytes {
        return Err(Error::Invalid(
            "Saved partial download is larger than expected".into(),
        ));
    }
    if offset < artifact.bytes {
        cancel.check()?;
        let mut request = client
            .get(&artifact.url)
            .header(ACCEPT_ENCODING, "identity");
        if offset > 0 {
            request = request.header(RANGE, format!("bytes={offset}-"));
        }
        let mut response = request.send().await?.error_for_status()?;
        let append = if response.status() == StatusCode::PARTIAL_CONTENT {
            let range = response
                .headers()
                .get(CONTENT_RANGE)
                .and_then(|v| v.to_str().ok());
            if !range.is_some_and(|range| range_matches(range, offset, artifact.bytes)) {
                return Err(Error::Invalid(
                    "Download server returned an invalid byte range; saved progress is unchanged"
                        .into(),
                ));
            }
            true
        } else if response.status() == StatusCode::OK {
            offset = 0; // A server ignoring Range must replace, never append.
            false
        } else {
            return Err(Error::Invalid("Unexpected download response".into()));
        };
        if response
            .content_length()
            .is_some_and(|length| length != artifact.bytes - offset)
        {
            return Err(Error::Invalid(
                "Download size has changed; the catalog needs an update".into(),
            ));
        }
        let mut output = OpenOptions::new()
            .create(true)
            .write(true)
            .append(append)
            .truncate(!append)
            .open(&partial_path)?;
        loop {
            cancel.check()?;
            let Some(buffer) = response.chunk().await? else {
                break;
            };
            let read = buffer.len();
            if offset + read as u64 > artifact.bytes {
                return Err(Error::Invalid("Download exceeds its catalog size".into()));
            }
            output.write_all(&buffer[..read])?;
            offset += read as u64;
            progress(Progress {
                phase: "Downloading",
                completed: offset,
                total: artifact.bytes,
            });
        }
        output.sync_all()?;
        if offset != artifact.bytes {
            return Err(Error::Invalid(
                "Download interrupted. Choose Resume to continue.".into(),
            ));
        }
    }
    if !verify(&partial_path, artifact, cancel, progress)? {
        std::fs::remove_file(&partial_path)?;
        return Err(Error::Invalid(
            "Download checksum did not match. The damaged download was discarded; choose Retry."
                .into(),
        ));
    }
    std::fs::rename(&partial_path, &final_path)?;
    Ok(final_path)
}

#[cfg(test)]
#[path = "download/tests.rs"]
mod transport_tests;

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_shifted_or_changed_ranges() {
        assert!(range_matches("bytes 100-199/200", 100, 200));
        for value in [
            "bytes 0-199/200",
            "bytes 100-199/201",
            "bytes 100-198/200",
            "bytes 100-199/*",
        ] {
            assert!(!range_matches(value, 100, 200));
        }
    }
    #[test]
    fn hashes_content_and_honors_pause() -> Result<()> {
        let temp = tempfile::NamedTempFile::new()?;
        std::fs::write(temp.path(), b"abc")?;
        let cancel = Cancellation::default();
        assert_eq!(
            digest(temp.path(), &cancel, &mut |_| {})?,
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        cancel.pause();
        assert!(matches!(
            digest(temp.path(), &cancel, &mut |_| {}),
            Err(Error::Paused)
        ));
        Ok(())
    }
}
