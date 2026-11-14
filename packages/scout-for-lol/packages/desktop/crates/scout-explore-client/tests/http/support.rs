//! A scripted loopback HTTP server for the Explore client's tests.
//!
//! Each path answers from its own queue of replies, in order, so a test can
//! script "the first stream drops, the second finishes". A stream reply can
//! close after its frames or hold the connection open without sending
//! anything, which is how a stalled stream looks to the client.

use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;

use scout_client_core::credentials::DeviceCredential;
use scout_explore_client::ExploreClient;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use uuid::Uuid;

pub type TestResult = Result<(), Box<dyn std::error::Error>>;

pub const TOKEN: &str = "sct_test_token";

/// What one request is answered with.
#[derive(Debug, Clone)]
pub enum Reply {
    /// A complete response.
    Json {
        status: u16,
        body: String,
        headers: Vec<(&'static str, String)>,
    },
    /// A `text/event-stream` that writes `frames`, then closes or stalls.
    Stream { frames: Vec<String>, stall: bool },
}

impl Reply {
    pub fn json(status: u16, body: impl Into<String>) -> Self {
        Self::Json {
            status,
            body: body.into(),
            headers: Vec::new(),
        }
    }

    pub fn with_header(self, name: &'static str, value: &str) -> Self {
        match self {
            Self::Json {
                status,
                body,
                mut headers,
            } => {
                headers.push((name, value.to_owned()));
                Self::Json {
                    status,
                    body,
                    headers,
                }
            }
            stream @ Self::Stream { .. } => stream,
        }
    }

    /// A stream that sends each event as one SSE frame, then closes.
    pub fn stream(events: &[serde_json::Value]) -> Self {
        Self::Stream {
            frames: events.iter().map(frame).collect(),
            stall: false,
        }
    }

    /// A stream that sends each event, then holds the connection silently.
    pub fn stalled(events: &[serde_json::Value]) -> Self {
        Self::Stream {
            frames: events.iter().map(frame).collect(),
            stall: true,
        }
    }
}

/// One event as the server writes it.
pub fn frame(event: &serde_json::Value) -> String {
    format!(
        "event: {}\ndata: {event}\n\n",
        event["type"].as_str().unwrap_or("unknown")
    )
}

/// A request the server received.
#[derive(Debug, Clone)]
pub struct Recorded {
    pub path: String,
    pub headers: HashMap<String, String>,
    pub body: String,
}

type Script = Arc<Mutex<HashMap<String, VecDeque<Reply>>>>;

pub struct MockServer {
    pub origin: String,
    requests: Arc<Mutex<Vec<Recorded>>>,
}

impl MockServer {
    pub async fn start(script: Vec<(&str, Vec<Reply>)>) -> Result<Self, std::io::Error> {
        let listener = TcpListener::bind("127.0.0.1:0").await?;
        let origin = format!("http://{}", listener.local_addr()?);
        let script: Script = Arc::new(Mutex::new(
            script
                .into_iter()
                .map(|(path, replies)| (path.to_owned(), replies.into()))
                .collect(),
        ));
        let requests = Arc::new(Mutex::new(Vec::new()));
        let recorded = Arc::clone(&requests);
        tokio::spawn(async move {
            while let Ok((stream, _)) = listener.accept().await {
                let script = Arc::clone(&script);
                let recorded = Arc::clone(&recorded);
                tokio::spawn(async move {
                    let _ = serve(stream, script, recorded).await;
                });
            }
        });
        Ok(Self { origin, requests })
    }

    pub fn requests(&self) -> Vec<Recorded> {
        self.requests
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clone()
    }

    pub fn requests_to(&self, path: &str) -> Vec<Recorded> {
        self.requests()
            .into_iter()
            .filter(|request| request.path == path)
            .collect()
    }

    pub fn client(&self) -> Result<ExploreClient, scout_explore_client::ExploreClientError> {
        ExploreClient::new(
            &self.origin,
            DeviceCredential {
                device_id: Uuid::new_v4(),
                token: TOKEN.to_owned(),
            },
        )
    }
}

async fn read_request(stream: &mut TcpStream) -> Result<Recorded, std::io::Error> {
    let mut buffer = Vec::new();
    let mut chunk = [0_u8; 4096];
    let head_end = loop {
        let read = stream.read(&mut chunk).await?;
        if read == 0 {
            return Err(std::io::ErrorKind::UnexpectedEof.into());
        }
        buffer.extend_from_slice(&chunk[..read]);
        if let Some(index) = buffer.windows(4).position(|window| window == b"\r\n\r\n") {
            break index;
        }
    };
    let head = String::from_utf8_lossy(&buffer[..head_end]).into_owned();
    let mut lines = head.split("\r\n");
    let path = lines
        .next()
        .and_then(|line| line.split(' ').nth(1))
        .unwrap_or_default()
        .to_owned();
    let headers: HashMap<String, String> = lines
        .filter_map(|line| line.split_once(':'))
        .map(|(name, value)| (name.trim().to_ascii_lowercase(), value.trim().to_owned()))
        .collect();
    let length: usize = headers
        .get("content-length")
        .and_then(|value| value.parse().ok())
        .unwrap_or(0);
    let mut body = buffer[head_end + 4..].to_vec();
    while body.len() < length {
        let read = stream.read(&mut chunk).await?;
        if read == 0 {
            break;
        }
        body.extend_from_slice(&chunk[..read]);
    }
    Ok(Recorded {
        path,
        headers,
        body: String::from_utf8_lossy(&body).into_owned(),
    })
}

fn reason(status: u16) -> &'static str {
    match status {
        200 => "OK",
        401 => "Unauthorized",
        403 => "Forbidden",
        404 => "Not Found",
        426 => "Upgrade Required",
        429 => "Too Many Requests",
        502 => "Bad Gateway",
        503 => "Service Unavailable",
        _ => "Status",
    }
}

async fn serve(
    mut stream: TcpStream,
    script: Script,
    recorded: Arc<Mutex<Vec<Recorded>>>,
) -> Result<(), std::io::Error> {
    let request = read_request(&mut stream).await?;
    let reply = script
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .get_mut(&request.path)
        .and_then(VecDeque::pop_front);
    recorded
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .push(request);
    match reply {
        None => {
            let body = "no scripted reply";
            stream
                .write_all(
                    format!(
                        "HTTP/1.1 500 Internal Server Error\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
                        body.len()
                    )
                    .as_bytes(),
                )
                .await?;
        }
        Some(Reply::Json {
            status,
            body,
            headers,
        }) => {
            let extra = headers
                .iter()
                .fold(String::new(), |mut extra, (name, value)| {
                    extra.push_str(name);
                    extra.push_str(": ");
                    extra.push_str(value);
                    extra.push_str("\r\n");
                    extra
                });
            stream
                .write_all(
                    format!(
                        "HTTP/1.1 {status} {}\r\ncontent-type: application/json\r\ncontent-length: {}\r\n{extra}connection: close\r\n\r\n{body}",
                        reason(status),
                        body.len()
                    )
                    .as_bytes(),
                )
                .await?;
        }
        Some(Reply::Stream { frames, stall }) => {
            stream
                .write_all(
                    b"HTTP/1.1 200 OK\r\ncontent-type: text/event-stream\r\ncache-control: no-store\r\nconnection: close\r\n\r\n",
                )
                .await?;
            for frame in frames {
                stream.write_all(frame.as_bytes()).await?;
                stream.flush().await?;
            }
            if stall {
                tokio::time::sleep(Duration::from_secs(3600)).await;
            }
        }
    }
    stream.shutdown().await
}
