//! The post-game review: find it after a game and announce it when it is ready.
//!
//! The server starts a review on its own once the game's recording and its
//! resolved match both exist (`scoutCoachReviewWorkflow`); the desktop only
//! reads it through `coach/reviews/get`. After a game ends, the collector
//! names the League game it saw end ([`finished_target`]). When the newest
//! match-history page lists that game, its platform makes the Riot match id
//! and the review is asked for by match. A game the history never lists (an
//! end-of-game-only game such as League Classic) is asked for by its game id
//! (desktop contract 12); the server names the match from this owner's own
//! capture of the game. [`ReviewPoller`] asks with backoff and a bounded
//! number of attempts: a review is minutes behind the game, and one that
//! never comes (Scout Coach off, quota spent, the match never resolved) must
//! stop being asked about.
//!
//! When the review is ready, the supervisor opens its conversation in the main
//! window and gives the overlay a `review_ready` card for the next game.

use std::time::{Duration, Instant};

use scout_client_core::desktop_api::{CoachReviewRequest, CoachReviewResponse, CoachReviewStatus};
use scout_client_runtime::runtime::RuntimeState;
use scout_explore_client::{ExploreClientError, Recovery};
use tokio::sync::mpsc;
use uuid::Uuid;

/// How long after the game ends the first request goes, and the wait before
/// each later one; the last repeats. About 45 minutes in all.
const DELAYS: [Duration; 5] = [
    Duration::from_secs(30),
    Duration::from_secs(60),
    Duration::from_secs(120),
    Duration::from_secs(240),
    Duration::from_secs(300),
];
/// Requests for one game before giving up on its review.
pub(super) const MAX_ATTEMPTS: u32 = 12;

/// The game whose review to ask for: its League game id, and its Riot match
/// id once the match history names it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReviewTarget {
    /// The League game id the collector saw end.
    pub game_id: String,
    /// The Riot match id, when the newest match-history page lists the game.
    pub match_id: Option<String>,
}

impl ReviewTarget {
    /// The request for this game: by match id when it is known, otherwise
    /// by game id.
    ///
    /// # Errors
    /// When the id is not one the contract accepts.
    pub fn request(&self) -> Result<CoachReviewRequest, String> {
        match &self.match_id {
            Some(match_id) => CoachReviewRequest::for_match(match_id),
            None => CoachReviewRequest::for_game(&self.game_id),
        }
    }

    /// How diagnostics name the game.
    #[must_use]
    pub fn label(&self) -> String {
        self.match_id
            .clone()
            .unwrap_or_else(|| format!("game {}", self.game_id))
    }
}

/// The game the collector last saw end, with its match id when the newest
/// match-history page lists it.
#[must_use]
pub(super) fn finished_target(state: &RuntimeState) -> Option<ReviewTarget> {
    let game_id = state.ended_game_id.clone()?;
    let match_id = state
        .recent_match_ids
        .iter()
        .find(|match_id| {
            match_id
                .split_once('_')
                .is_some_and(|(_, game)| game == game_id)
        })
        .cloned();
    Some(ReviewTarget { game_id, match_id })
}

/// What one `coach/reviews/get` said, reduced to what the poller does next.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ReviewAnswer {
    /// The review of this match is in this conversation.
    Ready {
        /// The match the server reviewed, as it names it.
        match_id: String,
        /// Where the review is.
        conversation_id: Uuid,
    },
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
                (CoachReviewStatus::Ready, Some(conversation_id)) => Self::Ready {
                    match_id: review.match_id,
                    conversation_id,
                },
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

/// A game id and what asking about its review said.
pub type ReviewFetch = (String, ReviewAnswer);

/// Where the supervisor asks for reviews. [`ScoutReviews`] in production.
pub trait ReviewSource: Send + Sync {
    /// Ask for `target`'s review and send the answer, under its game id, to
    /// `done`.
    fn fetch(&self, target: ReviewTarget, done: mpsc::UnboundedSender<ReviewFetch>);
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
    fn fetch(&self, target: ReviewTarget, done: mpsc::UnboundedSender<ReviewFetch>) {
        let origin = self.origin.clone();
        tokio::spawn(async move {
            // The credential store can block on the operating system.
            let client = tokio::task::spawn_blocking(move || {
                scout_explore_client::ExploreClient::from_credential_store(&origin)
            })
            .await;
            let answer = match (client, target.request()) {
                (_, Err(problem)) => ReviewAnswer::Final(problem),
                (Ok(Ok(client)), Ok(request)) => {
                    ReviewAnswer::from_result(client.get_coach_review(&request).await)
                }
                (Ok(Err(error)), Ok(_)) => ReviewAnswer::from_result(Err(error)),
                (Err(join), Ok(_)) => ReviewAnswer::Retry(join.to_string()),
            };
            // The supervisor is gone only while Scout quits.
            let _ = done.send((target.game_id, answer));
        });
    }
}

/// What the supervisor should do about a settled game.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ReviewEvent {
    /// The review is ready in this conversation.
    Ready {
        /// The match reviewed.
        match_id: String,
        /// Where the review is.
        conversation_id: Uuid,
    },
    /// No review will be shown for this game; the reason is safe to record.
    Stopped {
        /// The game, by match id when known.
        game: String,
        /// Why.
        reason: String,
    },
}

#[derive(Debug, Clone)]
struct Watch {
    target: ReviewTarget,
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

    /// Follow `target`, the newest finished game. A newer game replaces the
    /// one being asked about. The same game keeps its attempts and schedule,
    /// and once the history names its match, it is asked for by match.
    pub(super) fn follow(&mut self, target: Option<ReviewTarget>, now: Instant) {
        let Some(target) = target else {
            return;
        };
        if let Some(watch) = self
            .watch
            .as_mut()
            .filter(|watch| watch.target.game_id == target.game_id)
        {
            if target.match_id.is_some() {
                watch.target.match_id = target.match_id;
            }
            return;
        }
        self.watch = Some(Watch {
            target,
            attempts: 0,
            next_at: now + self.delays[0],
            in_flight: false,
            settled: false,
        });
    }

    /// The game to ask about now, if a request is due.
    pub(super) fn due(&mut self, now: Instant) -> Option<ReviewTarget> {
        let watch = self.watch.as_mut()?;
        if watch.settled || watch.in_flight || now < watch.next_at {
            return None;
        }
        watch.in_flight = true;
        watch.attempts += 1;
        Some(watch.target.clone())
    }

    /// Take an answer for game `game_id`. Returns what to do when the game
    /// is settled.
    pub(super) fn settle(
        &mut self,
        game_id: &str,
        answer: ReviewAnswer,
        now: Instant,
    ) -> Option<ReviewEvent> {
        let watch = self
            .watch
            .as_mut()
            .filter(|watch| watch.target.game_id == game_id && !watch.settled)?;
        watch.in_flight = false;
        let stop = |watch: &mut Watch, reason: String| {
            watch.settled = true;
            Some(ReviewEvent::Stopped {
                game: watch.target.label(),
                reason,
            })
        };
        match answer {
            ReviewAnswer::Ready {
                match_id,
                conversation_id,
            } => {
                watch.settled = true;
                Some(ReviewEvent::Ready {
                    match_id,
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

    const GAME: &str = "5654104474";
    const MATCH: &str = "NA1_5654104474";

    fn state(ended: Option<&str>, recent: &[&str]) -> RuntimeState {
        let mut state = RuntimeState::default();
        state.ended_game_id = ended.map(str::to_owned);
        state.recent_match_ids = recent.iter().map(|id| (*id).to_owned()).collect();
        state
    }

    fn by_match() -> ReviewTarget {
        ReviewTarget {
            game_id: GAME.to_owned(),
            match_id: Some(MATCH.to_owned()),
        }
    }

    fn by_game() -> ReviewTarget {
        ReviewTarget {
            game_id: GAME.to_owned(),
            match_id: None,
        }
    }

    fn ready(conversation: u128) -> ReviewAnswer {
        ReviewAnswer::Ready {
            match_id: MATCH.to_owned(),
            conversation_id: Uuid::from_u128(conversation),
        }
    }

    #[test]
    fn the_finished_game_is_asked_for_by_match_once_the_history_lists_it() {
        assert_eq!(finished_target(&state(None, &[MATCH])), None);
        let absent = finished_target(&state(Some(GAME), &["NA1_1"]));
        assert_eq!(absent, Some(by_game()));
        assert_eq!(
            absent.map(|target| target.request()),
            Some(Ok(CoachReviewRequest::Game(GAME.to_owned())))
        );
        let listed = finished_target(&state(Some(GAME), &["NA1_1", MATCH]));
        assert_eq!(listed, Some(by_match()));
        assert_eq!(
            listed.map(|target| target.request()),
            Some(Ok(CoachReviewRequest::Match(MATCH.to_owned())))
        );
    }

    #[test]
    fn the_first_request_waits_and_later_ones_back_off() {
        let start = Instant::now();
        let mut poller = ReviewPoller::default();
        poller.follow(Some(by_match()), start);
        assert_eq!(poller.due(start), None, "the server needs a moment");
        let first = start + Duration::from_secs(30);
        assert_eq!(poller.due(first), Some(by_match()));
        assert_eq!(poller.due(first), None, "one request at a time");
        assert_eq!(poller.settle(GAME, ReviewAnswer::NotYet, first), None);
        assert_eq!(poller.due(first + Duration::from_secs(59)), None);
        let second = first + Duration::from_secs(60);
        assert_eq!(poller.due(second), Some(by_match()));
        assert_eq!(poller.settle(GAME, ReviewAnswer::Pending, second), None);
        assert_eq!(poller.due(second + Duration::from_secs(119)), None);
        assert!(poller.due(second + Duration::from_secs(120)).is_some());
    }

    #[test]
    fn a_game_the_history_names_later_switches_to_its_match_and_keeps_its_count() {
        let start = Instant::now();
        let mut poller = ReviewPoller::default();
        poller.follow(Some(by_game()), start);
        let first = start + Duration::from_secs(30);
        assert_eq!(poller.due(first), Some(by_game()));
        assert_eq!(poller.settle(GAME, ReviewAnswer::NotYet, first), None);
        poller.follow(Some(by_match()), first);
        // Still the second attempt's wait, not a fresh start.
        assert_eq!(poller.due(first + Duration::from_secs(59)), None);
        assert_eq!(
            poller.due(first + Duration::from_secs(60)),
            Some(by_match())
        );
        // The history page rolling the game off does not undo its match.
        poller.follow(Some(by_game()), first);
        assert_eq!(
            poller.settle(GAME, ready(4), first),
            Some(ReviewEvent::Ready {
                match_id: MATCH.to_owned(),
                conversation_id: Uuid::from_u128(4),
            })
        );
    }

    #[test]
    fn a_ready_review_settles_the_game_once() {
        let start = Instant::now();
        let mut poller = ReviewPoller::default();
        poller.follow(Some(by_game()), start);
        let now = start + Duration::from_secs(30);
        assert!(poller.due(now).is_some());
        assert_eq!(
            poller.settle(GAME, ready(7), now),
            Some(ReviewEvent::Ready {
                match_id: MATCH.to_owned(),
                conversation_id: Uuid::from_u128(7),
            })
        );
        assert_eq!(poller.due(now + Duration::from_secs(3_600)), None);
        poller.follow(Some(by_match()), now);
        assert_eq!(poller.due(now + Duration::from_secs(3_600)), None);
    }

    #[test]
    fn asking_stops_after_a_bounded_number_of_attempts() {
        let mut now = Instant::now();
        let mut poller = ReviewPoller::default();
        poller.follow(Some(by_game()), now);
        let mut stopped = None;
        for attempt in 1..=MAX_ATTEMPTS {
            now += Duration::from_secs(300);
            assert!(poller.due(now).is_some(), "attempt {attempt}");
            stopped = poller.settle(GAME, ReviewAnswer::Retry("offline".to_owned()), now);
        }
        assert_eq!(
            stopped,
            Some(ReviewEvent::Stopped {
                game: format!("game {GAME}"),
                reason: format!("no review after {MAX_ATTEMPTS} requests; stopped asking"),
            })
        );
        assert_eq!(poller.due(now + Duration::from_secs(3_600)), None);
    }

    #[test]
    fn a_final_answer_stops_at_once_and_a_newer_game_starts_over() {
        let start = Instant::now();
        let mut poller = ReviewPoller::default();
        poller.follow(Some(by_match()), start);
        let now = start + Duration::from_secs(30);
        assert!(poller.due(now).is_some());
        assert!(matches!(
            poller.settle(
                GAME,
                ReviewAnswer::Final("Scout Coach is off".to_owned()),
                now
            ),
            Some(ReviewEvent::Stopped { .. })
        ));
        let newer = ReviewTarget {
            game_id: "5654104475".to_owned(),
            match_id: None,
        };
        poller.follow(Some(newer.clone()), now);
        assert_eq!(poller.due(now + Duration::from_secs(30)), Some(newer));
        // An answer for a game no longer followed is ignored.
        assert_eq!(poller.settle(GAME, ready(1), now), None);
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
        assert_eq!(
            ReviewAnswer::from_result(response(CoachReviewStatus::Ready, Some(Uuid::from_u128(3)))),
            ready(3)
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
