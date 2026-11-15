//! The supervisor's side of desktop chat: runs the Explore client against a
//! [`ChatSession`] and publishes the window's view of it.
//!
//! The device credential stays in the supervisor process, which already holds
//! it for uploads; the window, which renders on the GPU and can be lost with
//! it, never sees the bearer. It sends [`ChatCommand`]s over IPC and renders
//! the [`ChatParts`] this relay publishes.

use scout_client_core::desktop_api::{ActiveRun, ConversationListResponse};
use scout_desktop_ipc::{ChatAvailability, ChatCommand, ChatParts};
use tokio::sync::{mpsc, watch};
use tokio::task::JoinHandle;
use uuid::Uuid;

use crate::client::ExploreClient;
use crate::error::ExploreClientError;
use crate::model::Transcript;
use crate::session::ChatSession;
use crate::stream::{StreamEnd, StreamOptions, StreamSignal};

/// The supervisor's handle on the chat relay.
#[derive(Debug, Clone)]
pub struct ChatRelay {
    commands: mpsc::UnboundedSender<ChatCommand>,
    parts: watch::Receiver<ChatParts>,
}

impl ChatRelay {
    /// Start the relay for `origin` on the current Tokio runtime. It asks
    /// Scout nothing until the first [`ChatCommand::Refresh`], which the
    /// supervisor sends when a window opens.
    #[must_use]
    pub fn spawn(origin: String) -> Self {
        let (relay, commands, parts) = Self::detached();
        tokio::spawn(run(origin, commands, parts));
        relay
    }

    /// A relay with nothing behind it: the caller reads the commands and
    /// publishes the parts. For tests of the supervisor's side of the link.
    #[must_use]
    pub fn detached() -> (
        Self,
        mpsc::UnboundedReceiver<ChatCommand>,
        watch::Sender<ChatParts>,
    ) {
        let (commands, receiver) = mpsc::unbounded_channel();
        let (parts, watcher) = watch::channel(ChatParts::default());
        (
            Self {
                commands,
                parts: watcher,
            },
            receiver,
            parts,
        )
    }

    /// Pass one window command on. A relay that has stopped drops it: the
    /// supervisor is shutting down.
    pub fn send(&self, command: ChatCommand) {
        // A send fails only once the relay's task has ended, which happens
        // when the supervisor drops its runtime on the way out.
        let _stopped = self.commands.send(command);
    }

    /// Follow what the window should render.
    #[must_use]
    pub fn subscribe(&self) -> watch::Receiver<ChatParts> {
        self.parts.clone()
    }

    /// Whether Scout refused this build as too old for chat.
    #[must_use]
    pub fn upgrade_required(&self) -> bool {
        self.parts.borrow().status.availability == ChatAvailability::UpgradeRequired
    }
}

/// An answer from a request the relay started.
enum Answer {
    Client(Result<ExploreClient, ExploreClientError>),
    Listed(Result<ConversationListResponse, ExploreClientError>),
    Opened(Result<Transcript, ExploreClientError>),
    Started(Result<ActiveRun, ExploreClientError>),
    Signal(StreamSignal),
    Ended(Result<StreamEnd, ExploreClientError>),
    Settled(Result<Transcript, ExploreClientError>),
    Failed(ExploreClientError),
}

struct Relay {
    origin: String,
    session: ChatSession,
    client: Option<ExploreClient>,
    answers: mpsc::UnboundedSender<Answer>,
    follow: Option<JoinHandle<()>>,
}

async fn run(
    origin: String,
    mut commands: mpsc::UnboundedReceiver<ChatCommand>,
    parts: watch::Sender<ChatParts>,
) {
    let (answers, mut answered) = mpsc::unbounded_channel();
    let mut relay = Relay {
        origin,
        session: ChatSession::new(),
        client: None,
        answers,
        follow: None,
    };
    loop {
        tokio::select! {
            command = commands.recv() => match command {
                Some(command) => relay.command(command),
                None => break,
            },
            Some(answer) = answered.recv() => relay.answer(answer),
        }
        let next = relay.session.parts();
        parts.send_if_modified(|current| {
            if *current == next {
                false
            } else {
                *current = next;
                true
            }
        });
    }
    if let Some(follow) = relay.follow.take() {
        follow.abort();
    }
}

impl Relay {
    fn command(&mut self, command: ChatCommand) {
        match command {
            ChatCommand::Refresh => self.refresh(),
            ChatCommand::Open { conversation_id } => {
                if self.session.open(conversation_id) {
                    self.fetch(conversation_id, Answer::Opened);
                }
            }
            ChatCommand::New => self.session.start_new(),
            ChatCommand::Send { question } => {
                let (Some(client), Some(request)) =
                    (self.client.clone(), self.session.submit(&question))
                else {
                    return;
                };
                let answers = self.answers.clone();
                tokio::spawn(async move {
                    let _ = answers.send(Answer::Started(client.start_run(&request).await));
                });
            }
            ChatCommand::Stop => {
                if let (Some(client), Some(run_id)) = (self.client.clone(), self.session.stop()) {
                    let answers = self.answers.clone();
                    tokio::spawn(async move {
                        if let Err(error) = client.stop_run(run_id).await {
                            let _ = answers.send(Answer::Failed(error));
                        }
                    });
                }
            }
        }
    }

    /// Read the credential again (pairing may have replaced it) and ask for
    /// the conversation list, which every gate refuses the same way.
    fn refresh(&self) {
        let origin = self.origin.clone();
        let answers = self.answers.clone();
        tokio::spawn(async move {
            // The credential store can block on the operating system.
            let client =
                tokio::task::spawn_blocking(move || ExploreClient::from_credential_store(&origin))
                    .await
                    .unwrap_or_else(|join| {
                        Err(ExploreClientError::Unexpected {
                            status: 0,
                            detail: format!("reading the device credential failed: {join}"),
                        })
                    });
            let _ = answers.send(Answer::Client(client));
        });
    }

    fn fetch(
        &self,
        conversation_id: Uuid,
        wrap: fn(Result<Transcript, ExploreClientError>) -> Answer,
    ) {
        let Some(client) = self.client.clone() else {
            return;
        };
        let answers = self.answers.clone();
        tokio::spawn(async move {
            let _ = answers.send(wrap(client.get_conversation(conversation_id).await));
        });
    }

    fn list(&self) {
        let Some(client) = self.client.clone() else {
            return;
        };
        let answers = self.answers.clone();
        tokio::spawn(async move {
            let _ = answers.send(Answer::Listed(client.list_conversations().await));
        });
    }

    fn answer(&mut self, answer: Answer) {
        match answer {
            Answer::Client(Ok(client)) => {
                self.client = Some(client);
                self.list();
                if let Some(open) = self.session.open_conversation() {
                    self.fetch(open, Answer::Opened);
                }
            }
            Answer::Client(Err(error)) => {
                self.client = None;
                self.session.refresh_failed(&error);
            }
            Answer::Listed(Ok(list)) => self.session.listed(list),
            Answer::Listed(Err(error)) => self.session.refresh_failed(&error),
            Answer::Opened(Ok(transcript)) => self.session.opened(transcript),
            Answer::Opened(Err(error)) | Answer::Failed(error) => {
                self.session.request_failed(&error);
            }
            Answer::Started(Ok(run)) => {
                let run_id = run.run_id;
                self.session.started(run);
                self.follow_run(run_id);
            }
            Answer::Started(Err(error)) => self.session.start_failed(&error),
            Answer::Signal(signal) => self.session.signal(&signal),
            Answer::Ended(end) => {
                self.follow = None;
                if let Some(conversation_id) = self.session.stream_ended(end) {
                    self.fetch(conversation_id, Answer::Settled);
                    // The title and order change once a turn lands.
                    self.list();
                }
            }
            Answer::Settled(Ok(transcript)) => self.session.settled(transcript),
            Answer::Settled(Err(error)) => self.session.settle_failed(&error),
        }
    }

    fn follow_run(&mut self, run_id: Uuid) {
        let Some(client) = self.client.clone() else {
            return;
        };
        let answers = self.answers.clone();
        self.follow = Some(tokio::spawn(async move {
            let signals = answers.clone();
            let end = client
                .follow_run(run_id, StreamOptions::default(), move |signal| {
                    let _ = signals.send(Answer::Signal(signal));
                })
                .await;
            let _ = answers.send(Answer::Ended(end));
        }));
    }
}
