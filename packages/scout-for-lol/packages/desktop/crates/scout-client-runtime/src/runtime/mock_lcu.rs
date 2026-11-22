//! A mock League client for collector tests: a loopback HTTP server that
//! answers each path from a table the test can change between passes, and
//! counts every request it receives.
//!
//! It reads each request body to its `content-length` before answering, so it
//! also stands in for the Scout backend's replay routes, whose uploads carry
//! the file.

use std::collections::HashMap;
use std::sync::{Arc, Mutex, PoisonError};

use scout_client_core::lcu::{LcuClient, LeagueLockfile};
use tokio::io::{AsyncReadExt as _, AsyncWriteExt as _};
use tokio::net::TcpListener;

type Table = Arc<Mutex<HashMap<String, (u16, String)>>>;

/// The running mock. Paths it has no answer for are `404 Not Found`, which
/// the League client means as "nothing there".
pub(super) struct MockLcu {
    origin: String,
    answers: Table,
    requests: Arc<Mutex<HashMap<String, usize>>>,
}

impl MockLcu {
    pub(super) async fn start() -> Result<Self, Box<dyn std::error::Error>> {
        let listener = TcpListener::bind("127.0.0.1:0").await?;
        let origin = format!("http://{}", listener.local_addr()?);
        let answers: Table = Arc::default();
        let requests: Arc<Mutex<HashMap<String, usize>>> = Arc::default();
        let (table, counts) = (Arc::clone(&answers), Arc::clone(&requests));
        tokio::spawn(async move {
            while let Ok((mut stream, _)) = listener.accept().await {
                let (table, counts) = (Arc::clone(&table), Arc::clone(&counts));
                tokio::spawn(async move {
                    let mut received = Vec::new();
                    let mut buffer = [0_u8; 4096];
                    let head_end = loop {
                        if let Some(end) =
                            received.windows(4).position(|window| window == b"\r\n\r\n")
                        {
                            break end + 4;
                        }
                        match stream.read(&mut buffer).await {
                            Ok(0) | Err(_) => return,
                            Ok(read) => received.extend_from_slice(&buffer[..read]),
                        }
                    };
                    let request = String::from_utf8_lossy(&received[..head_end]).into_owned();
                    let body_length = request
                        .lines()
                        .find_map(|line| {
                            let (name, value) = line.split_once(':')?;
                            name.eq_ignore_ascii_case("content-length")
                                .then(|| value.trim().parse::<usize>().ok())?
                        })
                        .unwrap_or_default();
                    while received.len() < head_end + body_length {
                        match stream.read(&mut buffer).await {
                            Ok(0) | Err(_) => return,
                            Ok(read) => received.extend_from_slice(&buffer[..read]),
                        }
                    }
                    let path = request.split_whitespace().nth(1).unwrap_or_default();
                    *counts
                        .lock()
                        .unwrap_or_else(PoisonError::into_inner)
                        .entry(path.to_owned())
                        .or_default() += 1;
                    let (status, body) = table
                        .lock()
                        .unwrap_or_else(PoisonError::into_inner)
                        .get(path)
                        .cloned()
                        .unwrap_or((404, String::new()));
                    let head = format!(
                        "HTTP/1.1 {status} X\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n",
                        body.len()
                    );
                    let _ = stream.write_all(head.as_bytes()).await;
                    let _ = stream.write_all(body.as_bytes()).await;
                });
            }
        });
        Ok(Self {
            origin,
            answers,
            requests,
        })
    }

    /// The mock's `http://127.0.0.1:<port>` origin.
    pub(super) fn origin(&self) -> String {
        self.origin.clone()
    }

    /// A client for this mock, sent a lockfile credential like the real one.
    pub(super) fn client(&self) -> Result<LcuClient, Box<dyn std::error::Error>> {
        let lockfile = LeagueLockfile::parse("LeagueClient:1:1:mock-secret:https")?;
        Ok(LcuClient::with_base_url(&self.origin, &lockfile)?)
    }

    /// Answer `path` with `status` and `body` from now on.
    pub(super) fn answer(&self, path: &str, status: u16, body: &serde_json::Value) {
        self.answers
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .insert(path.to_owned(), (status, body.to_string()));
    }

    /// How many times `path` was requested.
    pub(super) fn requests(&self, path: &str) -> usize {
        self.requests
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .get(path)
            .copied()
            .unwrap_or_default()
    }

    /// Forget every request counted so far.
    pub(super) fn reset_requests(&self) {
        self.requests
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clear();
    }
}
