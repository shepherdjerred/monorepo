//! Spoken coach turns over `coach/voice/turns`.
//!
//! The microphone never streams: `scout-voice` records one finished
//! utterance locally, and [`ExploreClient::start_voice_turn`] uploads it
//! whole. The server transcribes it itself, so the request carries no text,
//! and answers with one event stream: the transcript, the Explore run it
//! started, the answer, and the answer's speech as PCM chunks, ending with
//! `done`. A turn is one request; a lost stream is not resumed here, because
//! the run it started can be followed over `runs/stream` like any other.
//!
//! No UI and no hotkeys live here: the window and the global shortcut are the
//! next stage's.

use std::collections::VecDeque;
use std::fmt;
use std::pin::Pin;

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD;
use futures_util::{Stream, StreamExt, stream};
use scout_client_core::coach_context::GameContext;
use serde::{Deserialize, Deserializer, Serialize};
use thiserror::Error;
use uuid::Uuid;

use crate::client::ExploreClient;
use crate::contract::{VOICE_MAX_DURATION_MS, VOICE_MIN_DURATION_MS, VOICE_SAMPLE_RATE_HZ};
use crate::error::ExploreClientError;
use crate::stream::{FrameError, SseDecoder, SseFrame};

/// The canonical PCM WAV header the route accepts: RIFF, `fmt `, `data`.
pub const WAV_HEADER_BYTES: usize = 44;
const BYTES_PER_SAMPLE: u32 = 2;

/// What started the recording. Holding the push-to-talk key is the act
/// itself; a wake-word turn must also open with "hey scout" in the server's
/// own transcript.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum VoiceTrigger {
    /// The local wake-word detector fired.
    WakeWord,
    /// The player held the push-to-talk key.
    PushToTalk,
}

/// Why bytes are not an utterance the route accepts.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Error)]
pub enum UtteranceError {
    /// Not a canonical 44-byte-header PCM WAV.
    #[error("the recording is not a plain PCM WAV file")]
    NotPlainWav,
    /// A WAV, but not 16 kHz mono 16-bit PCM.
    #[error("the recording must be 16 kHz mono 16-bit PCM")]
    Format,
    /// Shorter than the shortest utterance the server reads as speech.
    #[error("the recording is {duration_ms} ms, too short to hold a question")]
    TooShort {
        /// The recording's length.
        duration_ms: u32,
    },
    /// Longer than the longest utterance the desktop records.
    #[error("the recording is {duration_ms} ms, longer than a voice turn may be")]
    TooLong {
        /// The recording's length.
        duration_ms: u32,
    },
}

/// One finished utterance, checked against the contract before it leaves
/// the device, so a bad recording fails here rather than as a server 400.
#[derive(Clone, PartialEq, Eq)]
pub struct Utterance {
    wav: Vec<u8>,
    duration_ms: u32,
}

impl fmt::Debug for Utterance {
    // A recording of the player's voice never reaches a log line.
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("Utterance")
            .field("bytes", &self.wav.len())
            .field("duration_ms", &self.duration_ms)
            .finish()
    }
}

fn le_u16(bytes: &[u8], offset: usize) -> Option<u16> {
    Some(u16::from_le_bytes(
        bytes.get(offset..offset + 2)?.try_into().ok()?,
    ))
}

fn le_u32(bytes: &[u8], offset: usize) -> Option<u32> {
    Some(u32::from_le_bytes(
        bytes.get(offset..offset + 4)?.try_into().ok()?,
    ))
}

impl Utterance {
    /// Check a WAV the voice cascade wrote: a canonical header, 16 kHz mono
    /// 16-bit PCM, and a length between the contract's bounds.
    ///
    /// # Errors
    ///
    /// Returns the first way the bytes break the contract.
    pub fn from_wav(wav: Vec<u8>) -> Result<Self, UtteranceError> {
        let total = u32::try_from(wav.len()).map_err(|_| UtteranceError::NotPlainWav)?;
        let data_bytes = total
            .checked_sub(u32::try_from(WAV_HEADER_BYTES).map_err(|_| UtteranceError::NotPlainWav)?)
            .ok_or(UtteranceError::NotPlainWav)?;
        let canonical = wav.get(0..4) == Some(b"RIFF")
            && le_u32(&wav, 4) == Some(total - 8)
            && wav.get(8..12) == Some(b"WAVE")
            && wav.get(12..16) == Some(b"fmt ")
            && le_u32(&wav, 16) == Some(16)
            && wav.get(36..40) == Some(b"data")
            && le_u32(&wav, 40) == Some(data_bytes);
        if !canonical {
            return Err(UtteranceError::NotPlainWav);
        }
        let plain_pcm = le_u16(&wav, 20) == Some(1)
            && le_u16(&wav, 22) == Some(1)
            && le_u32(&wav, 24) == Some(VOICE_SAMPLE_RATE_HZ)
            && le_u32(&wav, 28) == Some(VOICE_SAMPLE_RATE_HZ * BYTES_PER_SAMPLE)
            && le_u16(&wav, 32) == Some(2)
            && le_u16(&wav, 34) == Some(16)
            && data_bytes % BYTES_PER_SAMPLE == 0;
        if !plain_pcm {
            return Err(UtteranceError::Format);
        }
        let samples = u64::from(data_bytes / BYTES_PER_SAMPLE);
        let duration_ms =
            u32::try_from(samples * 1000 / u64::from(VOICE_SAMPLE_RATE_HZ)).map_err(|_| {
                UtteranceError::TooLong {
                    duration_ms: u32::MAX,
                }
            })?;
        if duration_ms < VOICE_MIN_DURATION_MS {
            return Err(UtteranceError::TooShort { duration_ms });
        }
        if duration_ms > VOICE_MAX_DURATION_MS {
            return Err(UtteranceError::TooLong { duration_ms });
        }
        Ok(Self { wav, duration_ms })
    }

    /// The recording's length.
    #[must_use]
    pub const fn duration_ms(&self) -> u32 {
        self.duration_ms
    }

    /// The WAV bytes, as uploaded.
    #[must_use]
    pub fn as_wav(&self) -> &[u8] {
        &self.wav
    }
}

/// The upload's media type.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum VoiceMediaType {
    /// A PCM WAV file.
    #[serde(rename = "audio/wav")]
    Wav,
}

/// The utterance inside a request.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VoiceAudio {
    /// Always a WAV.
    pub media_type: VoiceMediaType,
    /// The WAV, base64, no longer than the longest utterance encodes to.
    #[serde(deserialize_with = "upload_base64")]
    pub base64: String,
}

/// The longest base64 an upload may be: the longest utterance, encoded.
pub const MAX_UPLOAD_BASE64_LEN: usize = {
    let samples = VOICE_MAX_DURATION_MS as usize * VOICE_SAMPLE_RATE_HZ as usize / 1000;
    let bytes = WAV_HEADER_BYTES + samples * BYTES_PER_SAMPLE as usize;
    bytes.div_ceil(3) * 4
};

/// Standard base64 with padding, as the server's schema reads it.
fn is_base64(text: &str, max_len: usize) -> bool {
    let body = text.trim_end_matches('=');
    text.len() >= 4
        && text.len() <= max_len
        && text.len() - body.len() <= 2
        && body
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'+' || byte == b'/')
}

fn upload_base64<'de, D>(deserializer: D) -> Result<String, D::Error>
where
    D: Deserializer<'de>,
{
    let text = String::deserialize(deserializer)?;
    if is_base64(&text, MAX_UPLOAD_BASE64_LEN) {
        Ok(text)
    } else {
        Err(serde::de::Error::custom(
            "audio must be base64 within the longest utterance",
        ))
    }
}

/// A key that may be `null` but may not be left out.
fn nullable<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(deserializer)
}

/// A key that may be left out but, when sent, is never `null`.
fn present<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    T::deserialize(deserializer).map(Some)
}

/// `coach/voice/turns`' body. There is no text field: the question is
/// whatever the server hears.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VoiceTurnRequest {
    /// What started the recording.
    pub trigger: VoiceTrigger,
    /// The conversation to continue; `null` starts a new one.
    #[serde(deserialize_with = "nullable")]
    pub conversation_id: Option<Uuid>,
    /// The utterance.
    pub audio: VoiceAudio,
    /// The game the player is in, when they chose to send it.
    #[serde(
        default,
        deserialize_with = "present",
        skip_serializing_if = "Option::is_none"
    )]
    pub game_context: Option<GameContext>,
}

impl VoiceTurnRequest {
    /// The body for `utterance`.
    #[must_use]
    pub fn new(
        utterance: &Utterance,
        trigger: VoiceTrigger,
        conversation_id: Option<Uuid>,
        game_context: Option<GameContext>,
    ) -> Self {
        Self {
            trigger,
            conversation_id,
            audio: VoiceAudio {
                media_type: VoiceMediaType::Wav,
                base64: STANDARD.encode(utterance.as_wav()),
            },
            game_context,
        }
    }
}

/// How the server judged the wake phrase in its own transcript.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WakeVerification {
    /// A wake-word turn opened with the phrase.
    Verified,
    /// Push-to-talk needs no phrase.
    NotRequired,
}

/// Why a voice turn stopped short, inside its stream.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum VoiceTurnErrorCode {
    /// The transcript did not open with the wake phrase; nothing ran.
    WakeNotVerified,
    /// Nothing followed the wake phrase.
    EmptyQuestion,
    /// The server could not transcribe the recording.
    TranscriptionFailed,
    /// Scout's spending allowance, or a provider's budget, is used up.
    BudgetExhausted,
    /// An Explore or in-game question allowance is spent; see the retry hint.
    QuotaExceeded,
    /// The conversation already has an answer running.
    ConversationBusy,
    /// The turn cannot start as asked.
    InvalidTurn,
    /// The conversation, or the run, is not the owner's.
    NotFound,
    /// Try again later.
    Unavailable,
    /// The Explore turn did not finish.
    AnswerFailed,
    /// The answer stands, but could not be spoken.
    SynthesisFailed,
}

/// The spoken answer's sample encoding.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SpeechEncoding {
    /// Signed 16-bit little-endian PCM, mono.
    #[serde(rename = "pcm_s16le")]
    PcmS16le,
}

/// How a voice turn ended.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum VoiceTurnOutcome {
    /// The run answered.
    Succeeded,
    /// The run failed.
    Failed,
    /// The run was stopped.
    Stopped,
    /// The run was interrupted.
    Interrupted,
    /// No Explore run started.
    Refused,
}

/// One frame of a `coach/voice/turns` response.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "snake_case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum VoiceTurnEvent {
    /// The question as the server heard it, the wake phrase stripped.
    Transcript {
        /// The question.
        text: String,
        /// What started the recording.
        trigger: VoiceTrigger,
        /// How the wake phrase was judged.
        wake: WakeVerification,
    },
    /// The Explore run the question started.
    Run {
        /// Run id; `runs/stream` can follow it too.
        run_id: Uuid,
        /// The conversation it answers in.
        conversation_id: Uuid,
        /// The saved question.
        question_message_id: Uuid,
    },
    /// The saved answer, and the shorter text Scout speaks.
    Answer {
        /// The saved answer message.
        message_id: Uuid,
        /// The answer as the transcript shows it.
        text: String,
        /// What the `audio` frames say.
        spoken_text: String,
    },
    /// One chunk of the spoken answer, in order.
    Audio {
        /// Position from zero.
        sequence: u32,
        /// Sample encoding.
        encoding: SpeechEncoding,
        /// Samples per second.
        sample_rate_hz: u32,
        /// The PCM bytes, base64.
        base64: String,
    },
    /// Why the turn stopped short. After `answer`, the answer still stands.
    Error {
        /// The refusal.
        code: VoiceTurnErrorCode,
        /// Safe to show.
        message: String,
        /// When to try again, if the server said.
        retry_after_seconds: Option<u32>,
    },
    /// Always the last frame.
    Done {
        /// How the turn ended.
        outcome: VoiceTurnOutcome,
    },
}

impl VoiceTurnEvent {
    /// The contract's name for this event.
    #[must_use]
    pub const fn kind(&self) -> &'static str {
        match self {
            Self::Transcript { .. } => "transcript",
            Self::Run { .. } => "run",
            Self::Answer { .. } => "answer",
            Self::Audio { .. } => "audio",
            Self::Error { .. } => "error",
            Self::Done { .. } => "done",
        }
    }
}

/// Why a voice turn's stream could not be read to its end.
#[derive(Debug, Error)]
pub enum VoiceStreamError {
    /// The connection failed or went idle past the stream timeout.
    #[error("voice turn stream failed: {0}")]
    Transport(#[source] reqwest::Error),
    /// A line was not UTF-8.
    #[error(transparent)]
    Frame(#[from] FrameError),
    /// A frame's data is not one voice event.
    #[error("voice turn frame does not match the contract: {0}")]
    Invalid(#[source] serde_json::Error),
    /// The SSE `event:` name disagrees with the data's `type`.
    #[error("voice turn frame named {event:?} carries a {kind:?} event")]
    Mismatched {
        /// The `event:` line.
        event: String,
        /// The data's `type`.
        kind: &'static str,
    },
    /// The server closed the stream before `done`.
    #[error("the voice turn stream ended before it was done")]
    Ended,
}

/// Parse one frame's data as a voice event.
///
/// # Errors
///
/// Returns [`VoiceStreamError::Invalid`] for data outside the contract, or
/// [`VoiceStreamError::Mismatched`] when the `event:` name disagrees with it.
pub fn parse_voice_frame(frame: &SseFrame) -> Result<VoiceTurnEvent, VoiceStreamError> {
    let event: VoiceTurnEvent =
        serde_json::from_str(&frame.data).map_err(VoiceStreamError::Invalid)?;
    match frame.event.as_deref() {
        Some(name) if name != event.kind() => Err(VoiceStreamError::Mismatched {
            event: name.to_owned(),
            kind: event.kind(),
        }),
        _ => Ok(event),
    }
}

/// A voice turn's events, in order, ending after `done` or the first error.
pub type VoiceTurnEvents =
    Pin<Box<dyn Stream<Item = Result<VoiceTurnEvent, VoiceStreamError>> + Send>>;

struct Reading<S> {
    bytes: Pin<Box<S>>,
    decoder: SseDecoder,
    pending: VecDeque<SseFrame>,
    finished: bool,
}

/// Decode `bytes` into voice events until `done`, a failure, or the end.
pub fn voice_events<S, B>(bytes: S) -> VoiceTurnEvents
where
    S: Stream<Item = Result<B, reqwest::Error>> + Send + 'static,
    B: AsRef<[u8]>,
{
    let reading = Reading {
        bytes: Box::pin(bytes),
        decoder: SseDecoder::default(),
        pending: VecDeque::new(),
        finished: false,
    };
    Box::pin(stream::unfold(reading, |mut reading| async move {
        if reading.finished {
            return None;
        }
        loop {
            if let Some(frame) = reading.pending.pop_front() {
                let event = parse_voice_frame(&frame);
                reading.finished = !matches!(event, Ok(ref parsed) if parsed.kind() != "done");
                return Some((event, reading));
            }
            match reading.bytes.next().await {
                Some(Ok(chunk)) => match reading.decoder.push(chunk.as_ref()) {
                    Ok(frames) => reading.pending.extend(frames),
                    Err(error) => {
                        reading.finished = true;
                        return Some((Err(error.into()), reading));
                    }
                },
                Some(Err(error)) => {
                    reading.finished = true;
                    return Some((Err(VoiceStreamError::Transport(error)), reading));
                }
                None => {
                    reading.finished = true;
                    return Some((Err(VoiceStreamError::Ended), reading));
                }
            }
        }
    }))
}

impl ExploreClient {
    /// `coach/voice/turns`: upload one finished utterance and follow its
    /// answer. The microphone never streams; only `utterance` leaves the
    /// device, with the game context when the player chose to send it.
    ///
    /// # Errors
    ///
    /// Returns a transport failure, a typed refusal before the stream opens
    /// (`feature_disabled` with voice off, `rate_limited` past the device's
    /// voice limit, `invalid_game_context`), or a contract mismatch. Failures
    /// after the stream opens arrive as its events.
    pub async fn start_voice_turn(
        &self,
        utterance: &Utterance,
        trigger: VoiceTrigger,
        conversation_id: Option<Uuid>,
        game_context: Option<GameContext>,
    ) -> Result<VoiceTurnEvents, ExploreClientError> {
        let request = VoiceTurnRequest::new(utterance, trigger, conversation_id, game_context);
        let response = self.open_voice_turn(&request).await?;
        Ok(voice_events(response.bytes_stream()))
    }
}
