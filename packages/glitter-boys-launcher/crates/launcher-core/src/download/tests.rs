//! Loopback tests cover HTTP resume semantics. Production validates HTTPS first.

use super::*;
use std::{
    net::TcpListener,
    thread::{self, JoinHandle},
    time::Instant,
};

type TestResult = std::result::Result<(), Box<dyn std::error::Error>>;

fn serve(
    response: &'static [u8],
) -> std::io::Result<(String, JoinHandle<std::io::Result<String>>)> {
    let listener = TcpListener::bind("127.0.0.1:0")?;
    listener.set_nonblocking(true)?;
    let url = format!("http://{}/archive.zip", listener.local_addr()?);
    let thread = thread::spawn(move || {
        let deadline = Instant::now() + Duration::from_secs(5);
        let mut stream = loop {
            match listener.accept() {
                Ok((stream, _)) => break stream,
                Err(error)
                    if error.kind() == std::io::ErrorKind::WouldBlock
                        && Instant::now() < deadline =>
                {
                    thread::sleep(Duration::from_millis(5))
                }
                Err(error) => return Err(error),
            }
        };
        stream.set_nonblocking(false)?;
        stream.set_read_timeout(Some(Duration::from_secs(3)))?;
        let mut request = Vec::new();
        let mut byte = [0_u8; 1];
        while !request.ends_with(b"\r\n\r\n") && request.len() < 8192 {
            stream.read_exact(&mut byte)?;
            request.push(byte[0]);
        }
        stream.write_all(response)?;
        Ok(String::from_utf8_lossy(&request).to_lowercase())
    });
    Ok((url, thread))
}

fn fixture(url: String) -> Artifact {
    Artifact {
        file: "archive.zip".into(),
        url,
        bytes: 6,
        sha256: hex::encode(Sha256::digest(b"abcdef")),
    }
}

fn seed(cache: &Path, artifact: &Artifact, bytes: &[u8]) -> Result<PathBuf> {
    let directory = cache.join(&artifact.sha256);
    std::fs::create_dir_all(&directory)?;
    let path = directory.join("archive.zip.partial");
    std::fs::write(&path, bytes)?;
    Ok(path)
}

fn request(
    artifact: &Artifact,
    cache: &Path,
    cancel: &Cancellation,
    progress: &mut dyn FnMut(Progress),
) -> Result<PathBuf> {
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()?;
    let transport = Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(3))
        .build()?;
    runtime.block_on(fetch_async(&transport, artifact, cache, cancel, progress))
}

fn join(thread: JoinHandle<std::io::Result<String>>) -> std::io::Result<String> {
    thread
        .join()
        .map_err(|_| std::io::Error::other("HTTP test thread failed"))?
}

#[test]
fn resumes_a_truncated_response_without_repeating_saved_bytes() -> TestResult {
    let cache = tempfile::tempdir()?;
    let (url, first) =
        serve(b"HTTP/1.1 200 OK\r\nContent-Length: 6\r\nConnection: close\r\n\r\nabc")?;
    let mut artifact = fixture(url);
    assert!(
        request(
            &artifact,
            cache.path(),
            &Cancellation::default(),
            &mut |_| {}
        )
        .is_err()
    );
    join(first)?;
    let partial = cache
        .path()
        .join(&artifact.sha256)
        .join("archive.zip.partial");
    assert_eq!(std::fs::read(&partial)?, b"abc");
    let (url, second) = serve(b"HTTP/1.1 206 Partial Content\r\nContent-Length: 3\r\nContent-Range: bytes 3-5/6\r\nConnection: close\r\n\r\ndef")?;
    artifact.url = url;
    let ready = request(
        &artifact,
        cache.path(),
        &Cancellation::default(),
        &mut |_| {},
    )?;
    assert_eq!(std::fs::read(ready)?, b"abcdef");
    assert!(join(second)?.contains("range: bytes=3-"));
    assert!(!partial.exists());
    Ok(())
}

#[test]
fn ignored_range_replaces_instead_of_appending() -> TestResult {
    let cache = tempfile::tempdir()?;
    let (url, server) =
        serve(b"HTTP/1.1 200 OK\r\nContent-Length: 6\r\nConnection: close\r\n\r\nabcdef")?;
    let artifact = fixture(url);
    seed(cache.path(), &artifact, b"bad")?;
    let ready = request(
        &artifact,
        cache.path(),
        &Cancellation::default(),
        &mut |_| {},
    )?;
    assert_eq!(std::fs::read(ready)?, b"abcdef");
    join(server)?;
    Ok(())
}

#[test]
fn incorrect_range_keeps_saved_progress_intact() -> TestResult {
    let cache = tempfile::tempdir()?;
    let (url, server) = serve(b"HTTP/1.1 206 Partial Content\r\nContent-Length: 3\r\nContent-Range: bytes 2-4/6\r\nConnection: close\r\n\r\ncde")?;
    let artifact = fixture(url);
    let partial = seed(cache.path(), &artifact, b"abc")?;
    assert!(
        request(
            &artifact,
            cache.path(),
            &Cancellation::default(),
            &mut |_| {}
        )
        .is_err()
    );
    assert_eq!(std::fs::read(partial)?, b"abc");
    join(server)?;
    Ok(())
}

#[test]
fn changed_content_never_becomes_a_ready_archive() -> TestResult {
    let cache = tempfile::tempdir()?;
    let (url, server) =
        serve(b"HTTP/1.1 200 OK\r\nContent-Length: 6\r\nConnection: close\r\n\r\nxxxxxx")?;
    let artifact = fixture(url);
    assert!(
        request(
            &artifact,
            cache.path(),
            &Cancellation::default(),
            &mut |_| {}
        )
        .is_err()
    );
    assert!(
        !cache
            .path()
            .join(&artifact.sha256)
            .join("archive.zip")
            .exists()
    );
    assert!(
        !cache
            .path()
            .join(&artifact.sha256)
            .join("archive.zip.partial")
            .exists()
    );
    join(server)?;
    Ok(())
}

#[test]
fn paused_download_can_finish_after_a_restart() -> TestResult {
    let cache = tempfile::tempdir()?;
    let (url, server) =
        serve(b"HTTP/1.1 200 OK\r\nContent-Length: 6\r\nConnection: close\r\n\r\nabcdef")?;
    let artifact = fixture(url);
    let cancel = Cancellation::default();
    let result = request(&artifact, cache.path(), &cancel, &mut |progress| {
        if progress.phase == "Downloading" {
            cancel.pause();
        }
    });
    assert!(matches!(result, Err(Error::Paused)));
    join(server)?;
    let ready = request(
        &artifact,
        cache.path(),
        &Cancellation::default(),
        &mut |_| {},
    )?;
    assert_eq!(std::fs::read(ready)?, b"abcdef");
    Ok(())
}

#[test]
fn production_entry_point_rejects_plain_http() -> TestResult {
    let cache = tempfile::tempdir()?;
    let artifact = fixture("http://127.0.0.1:9/not-used".into());
    assert!(
        fetch(
            &client()?,
            &artifact,
            cache.path(),
            &Cancellation::default(),
            &mut |_| {}
        )
        .is_err()
    );
    Ok(())
}
