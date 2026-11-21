//! The post-game review: find it after a game and announce it when it is ready.
//!
//! The server starts a review on its own once the game's recording and its
//! resolved match both exist (`scoutCoachReviewWorkflow`); the desktop only
//! reads it through `coach/reviews/get`. After a game ends, the collector
//! names the game it saw end, and its match history names the platform; the
//! two make the Riot match id ([`finished_match_id`]). [`ReviewPoller`] then
//! asks for that match with backoff and a bounded number of attempts: a
//! review is minutes behind the game, and one that never comes (Scout Coach
//! off, quota spent, the match never resolved) must stop being asked about.
//!
//! When the review is ready, the supervisor opens its conversation in the main
//! window and gives the overlay a `review_ready` card for the next game.

use std::time::{Duration, Instant};

use scout_client_core::desktop_api::{CoachReviewRequest, CoachReviewResponse, CoachReviewStatus};
use scout_client_runtime::runtime::RuntimeState;
use scout_explore_client::{ExploreClientError, Recovery};
use tokio::sync::mpsc;
use uuid::Uuid;

/// How long after the match is known the first request goes, and the wait
/// before each later one; the last repeats. About 45 minutes in all.
const DELAYS: [Duration; 5] = [
    Duration::from_secs(30),
    Duration::from_secs(60),
    Duration::from_secs(120),
    Duration::from_secs(240),
    Duration::from_secs(300),
];
/// Requests for one game before giving up on its review.
pub(super) const MAX_ATTEMPTS: u32 = 12;

/// The Riot match id of the game the collector last saw end, once the match
/// history names it.
#[must_use]
pub(super) fn finished_match_id(state: &RuntimeState) -> Option<String> {
    let game_id = state.ended_game_id.as_deref()?;
    state
        .recent_match_ids
        .iter()
        .find(|match_id| {
            match_id
                .split_once('_')
                .is_some_and(|(_, game)| game == game_id)
        })
        .cloned()
}

/// What one `coach/reviews/get` said, reduced to what the poller does next.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ReviewAnswer {
    /// The review is in this conversation.
    Ready(Uuid),
    /// The review is being written; ask again later.
    Pending,
    /// No review exists yet: the server starts it once the recording and the
    /// match both arrive. Ask again later.
    NotYet,
    /// Asking again cannot help: declined, failed, Scout Coach off, not
    /// paired. Safe to record.
    Final(String),
    /// The request failed on the way; ask again later. Safe to record.
    Retry(String),
}

impl ReviewAnswer {
    /// The answer for a `coach/reviews/get` result.
    #[must_use]
    pub fn from_result(result: Result<CoachReviewResponse, ExploreClientError>) -> Self {
        match result {
            Ok(review) => match (review.status, review.conversation_id) {
                (CoachReviewStatus::Ready, Some(conversation)) => Self::Ready(conversation),
                (CoachReviewStatus::Ready, None) => {
                    Self::Final("the review is ready without a conversation".to_owned())
                }
                (CoachReviewStatus::Pending, _) => Self::Pending,
                (CoachReviewStatus::Declined, _) => {
                    Self::Final("Scout declined to review this game".to_owned())
                }
                (CoachReviewStatus::Failed, _) => {
                    Self::Final("the review ended without an answer".to_owned())
                }
            },
            Err(ExploreClientError::Refused(refusal)) => match refusal.recovery() {
                Recovery::NotFound => Self::NotYet,
                Recovery::RetryLater { .. } => Self::Retry(refusal.message),
                _ => Self::Final(refusal.message),
            },
            Err(error @ (ExploreClientError::Transport(_) | ExploreClientError::Decode(_))) => {
                Self::Retry(error.to_string())
            }
            Err(error) => Self::Final(error.to_string()),
        }
    }
}

/// A match id and what asking about it said.
pub type ReviewFetch = (String, ReviewAnswer);

/// Where the supervisor asks for reviews. [`ScoutReviews`] in production.
pub trait ReviewSource: Send + Sync {
    /// Ask for `match_id`'s review and send the answer to `done`.
    fn fetch(&self, match_id: String, done: mpsc::UnboundedSender<ReviewFetch>);
}

/// `coach/reviews/get` on Scout, with the device credential.
pub struct ScoutReviews {
    origin: String,
}

impl ScoutReviews {
    /// Reviews from `origin`.
    #[must_use]
    pub const fn new(origin: String) -> Self {
        Self { origin }
    }
}

impl ReviewSource for ScoutReviews {
    fn fetch(&self, match_id: String, done: mpsc::UnboundedSender<ReviewFetch>) {
        let origin = self.origin.clone();
        tokio::spawn(async move {
            // The credential store can block on the operating system.
            let client = tokio::task::spawn_blocking(move || {
                scout_explore_client::ExploreClient::from_credential_store(&origin)
            })
            .await;
            let answer = match client {
                Ok(Ok(client)) => match serde_json::from_value::<CoachReviewRequest>(
                    serde_json::json!({ "matchId": match_id }),
                ) {
                    Ok(request) => {
                        ReviewAnswer::from_result(client.get_coach_review(&request).await)
                    }
                    Err(error) => ReviewAnswer::Final(format!("not a match id: {error}")),
                },
                Ok(Err(error)) => ReviewAnswer::from_result(Err(error)),
                Err(join) => ReviewAnswer::Retry(join.to_string()),
            };
            // The supervisor is gone only while Scout quits.
            let _ = done.send((match_id, answer));
        });
    }
}

/// What the supervisor should do about a settled game.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ReviewEvent {
    /// The review is ready in this conversation.
    Ready {
        /// The game reviewed.
        match_id: String,
        /// Where the review is.
        conversation_id: Uuid,
    },
    /// No review will be shown for this game; the reason is safe to record.
    Stopped {
        /// The game.
        match_id: String,
        /// Why.
        reason: String,
    },
}

#[derive(Debug, Clone)]
struct Watch {
    match_id: String,
    attempts: u32,
    next_at: Instant,
    in_flight: bool,
    settled: bool,
}

/// Asks about one game's review at a time, with backoff.
#[derive(Debug)]
pub(super) struct ReviewPoller {
    watch: Option<Watch>,
    delays: &'static [Duration],
}

impl Default for ReviewPoller {
    fn default() -> Self {
        Self {
            watch: None,
            delays: &DELAYS,
        }
    }
}

impl ReviewPoller {
    /// A poller that asks on every tick, so a supervisor test does not wait.
    #[cfg(test)]
    pub(super) fn immediate() -> Self {
        Self {
            watch: None,
            delays: &[Duration::ZERO],
        }
    }

    /// Follow `match_id`, the newest finished game. A newer game replaces the
    /// one being asked about; the same game changes nothing.
    pub(super) fn follow(&mut self, match_id: Option<String>, now: Instant) {
        let Some(match_id) = match_id else {
            return;
        };
        if self
            .watch
            .as_ref()
            .is_some_and(|watch| watch.match_id == match_id)
        {
            return;
        }
        self.watch = Some(Watch {
            match_id,
            attempts: 0,
            next_at: now + self.delays[0],
            in_flight: false,
            settled: false,
        });
    }

    /// The match to ask about now, if a request is due.
    pub(super) fn due(&mut self, now: Instant) -> Option<String> {
        let watch = self.watch.as_mut()?;
        if watch.settled || watch.in_flight || now < watch.next_at {
            return None;
        }
        watch.in_flight = true;
        watch.attempts += 1;
        Some(watch.match_id.clone())
    }

    /// Take an answer. Returns what to do when the game is settled.
    pub(super) fn settle(
        &mut self,
        match_id: &str,
        answer: ReviewAnswer,
        now: Instant,
    ) -> Option<ReviewEvent> {
        let watch = self
            .watch
            .as_mut()
            .filter(|watch| watch.match_id == match_id && !watch.settled)?;
        watch.in_flight = false;
        let stop = |watch: &mut Watch, reason: String| {
            watch.settled = true;
            Some(ReviewEvent::Stopped {
                match_id: watch.match_id.clone(),
                reason,
            })
        };
        match answer {
            ReviewAnswer::Ready(conversation_id) => {
                watch.settled = true;
                Some(ReviewEvent::Ready {
                    match_id: watch.match_id.clone(),
                    conversation_id,
                })
            }
            ReviewAnswer::Final(reason) => stop(watch, reason),
            ReviewAnswer::Pending | ReviewAnswer::NotYet | ReviewAnswer::Retry(_)
                if watch.attempts >= MAX_ATTEMPTS =>
            {
                stop(
                    watch,
                    format!("no review after {MAX_ATTEMPTS} requests; stopped asking"),
                )
            }
            ReviewAnswer::Pending | ReviewAnswer::NotYet | ReviewAnswer::Retry(_) => {
                let wait = usize::try_from(watch.attempts).unwrap_or(usize::MAX);
                watch.next_at = now + self.delays[wait.min(self.delays.len() - 1)];
                None
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const MATCH: &str = "NA1_5654104474";

    fn state(ended: Option<&str>, recent: &[&str]) -> RuntimeState {
        let mut state = RuntimeState::default();
        state.ended_game_id = ended.map(str::to_owned);
        state.recent_match_ids = recent.iter().map(|id| (*id).to_owned()).collect();
        state
    }

    #[test]
    fn the_finished_game_is_named_once_the_history_lists_it() {
        assert_eq!(finished_match_id(&state(None, &[MATCH])), None);
        assert_eq!(
            finished_match_id(&state(Some("5654104474"), &["NA1_1"])),
            None
        );
        assert_eq!(
            finished_match_id(&state(Some("5654104474"), &["NA1_1", MATCH])).as_deref(),
            Some(MATCH)
        );
    }

    #[test]
    fn the_first_request_waits_and_later_ones_back_off() {
        let start = Instant::now();
        let mut poller = ReviewPoller::default();
        poller.follow(Some(MATCH.to_owned()), start);
        assert_eq!(poller.due(start), None, "the server needs a moment");
        let first = start + Duration::from_secs(30);
        assert_eq!(poller.due(first).as_deref(), Some(MATCH));
        assert_eq!(poller.due(first), None, "one request at a time");
        assert_eq!(poller.settle(MATCH, ReviewAnswer::NotYet, first), None);
        assert_eq!(poller.due(first + Duration::from_secs(59)), None);
        let second = first + Duration::from_secs(60);
        assert_eq!(poller.due(second).as_deref(), Some(MATCH));
        assert_eq!(poller.settle(MATCH, ReviewAnswer::Pending, second), None);
        assert_eq!(poller.due(second + Duration::from_secs(119)), None);
        assert!(poller.due(second + Duration::from_secs(120)).is_some());
    }

    #[test]
    fn a_ready_review_settles_the_game_once() {
        let start = Instant::now();
        let mut poller = ReviewPoller::default();
        poller.follow(Some(MATCH.to_owned()), start);
        let now = start + Duration::from_secs(30);
        assert!(poller.due(now).is_some());
        let conversation = Uuid::from_u128(7);
        assert_eq!(
            poller.settle(MATCH, ReviewAnswer::Ready(conversation), now),
            Some(ReviewEvent::Ready {
                match_id: MATCH.to_owned(),
                conversation_id: conversation,
            })
        );
        assert_eq!(poller.due(now + Duration::from_secs(3_600)), None);
        poller.follow(Some(MATCH.to_owned()), now);
        assert_eq!(poller.due(now + Duration::from_secs(3_600)), None);
    }

    #[test]
    fn asking_stops_after_a_bounded_number_of_attempts() {
        let mut now = Instant::now();
        let mut poller = ReviewPoller::default();
        poller.follow(Some(MATCH.to_owned()), now);
        let mut stopped = None;
        for attempt in 1..=MAX_ATTEMPTS {
            now += Duration::from_secs(300);
            assert!(poller.due(now).is_some(), "attempt {attempt}");
            stopped = poller.settle(MATCH, ReviewAnswer::Retry("offline".to_owned()), now);
        }
        assert!(matches!(stopped, Some(ReviewEvent::Stopped { .. })));
        assert_eq!(poller.due(now + Duration::from_secs(3_600)), None);
    }

    #[test]
    fn a_final_answer_stops_at_once_and_a_newer_game_starts_over() {
        let start = Instant::now();
        let mut poller = ReviewPoller::default();
        poller.follow(Some(MATCH.to_owned()), start);
        let now = start + Duration::from_secs(30);
        assert!(poller.due(now).is_some());
        assert!(matches!(
            poller.settle(
                MATCH,
                ReviewAnswer::Final("Scout Coach is off".to_owned()),
                now
            ),
            Some(ReviewEvent::Stopped { .. })
        ));
        poller.follow(Some("NA1_5654104475".to_owned()), now);
        assert_eq!(
            poller.due(now + Duration::from_secs(30)).as_deref(),
            Some("NA1_5654104475")
        );
        // An answer for a game no longer followed is ignored.
        assert_eq!(
            poller.settle(MATCH, ReviewAnswer::Ready(Uuid::from_u128(1)), now),
            None
        );
    }

    #[test]
    fn the_server_statuses_map_to_what_the_poller_does() {
        let response = |status, conversation_id| {
            Ok(CoachReviewResponse {
                match_id: MATCH.to_owned(),
                status,
                conversation_id,
                created_at: chrono::Utc::now(),
            })
        };
        let conversation = Uuid::from_u128(3);
        assert_eq!(
            ReviewAnswer::from_result(response(CoachReviewStatus::Ready, Some(conversation))),
            ReviewAnswer::Ready(conversation)
        );
        assert_eq!(
            ReviewAnswer::from_result(response(CoachReviewStatus::Pending, None)),
            ReviewAnswer::Pending
        );
        for status in [CoachReviewStatus::Declined, CoachReviewStatus::Failed] {
            assert!(matches!(
                ReviewAnswer::from_result(response(status, None)),
                ReviewAnswer::Final(_)
            ));
        }
        assert!(matches!(
            ReviewAnswer::from_result(response(CoachReviewStatus::Ready, None)),
            ReviewAnswer::Final(_)
        ));
    }

    #[test]
    fn no_review_yet_is_asked_again_and_coach_off_is_final() {
        use scout_client_core::desktop_api::DesktopApiErrorCode;
        let refused = |code| {
            Err(ExploreClientError::Refused(scout_explore_client::Refusal {
                code,
                message: "refused".to_owned(),
                retry_after: None,
            }))
        };
        assert_eq!(
            ReviewAnswer::from_result(refused(DesktopApiErrorCode::NotFound)),
            ReviewAnswer::NotYet
        );
        assert_eq!(
            ReviewAnswer::from_result(refused(DesktopApiErrorCode::Unavailable)),
            ReviewAnswer::Retry("refused".to_owned())
        );
        assert_eq!(
            ReviewAnswer::from_result(refused(DesktopApiErrorCode::FeatureDisabled)),
            ReviewAnswer::Final("refused".to_owned())
        );
    }
}
