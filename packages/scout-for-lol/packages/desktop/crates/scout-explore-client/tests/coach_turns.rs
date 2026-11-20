//! Turns Scout asks for itself, as pure session state: they open their own
//! conversation, show the coach panel once the answer lands, stay silent when
//! the coach is off, and never carry free text or live state.

#![cfg(feature = "golden")]

use chrono::Utc;
use scout_client_core::coach_context::{AllySlot, ChampSelectContext, EnemySlot, GameContext};
use scout_client_core::desktop_api::{
    ActiveRun, AppInitiation, DesktopApiErrorCode, DesktopApiErrorCode as Code,
};
use scout_desktop_ipc::{ChatAvailability, ChatCoachKind};
use scout_explore_client::app_turns::AppTurn;
use scout_explore_client::golden;
use scout_explore_client::session::ChatSession;
use scout_explore_client::{ExploreClientError, Refusal};
use uuid::Uuid;

type TestResult = Result<(), Box<dyn std::error::Error>>;

fn select_turn(key: &str) -> AppTurn {
    AppTurn {
        initiation: AppInitiation::AppChampSelect,
        game_key: key.to_owned(),
        context: GameContext {
            champ_select: Some(ChampSelectContext {
                phase: Some("BAN_PICK".to_owned()),
                local_cell_id: 0,
                my_team: vec![AllySlot {
                    cell_id: 0,
                    champion_id: 103,
                    assigned_role: None,
                }],
                their_team: vec![EnemySlot {
                    cell_id: 5,
                    champion_id: 64,
                }],
                my_bans: Vec::new(),
                their_bans: Vec::new(),
            }),
            ..GameContext::default()
        },
    }
}

fn run_in(conversation_id: Uuid) -> ActiveRun {
    ActiveRun {
        run_id: Uuid::from_u128(0xa0),
        conversation_id,
        question_message_id: Uuid::from_u128(0xa1),
        leaf_id_at_start: None,
        version_count_at_start: 0,
        started_at: Utc::now(),
    }
}

fn refused(code: Code) -> ExploreClientError {
    ExploreClientError::Refused(Refusal {
        code,
        message: "no".to_owned(),
        retry_after: None,
    })
}

#[test]
fn the_first_turn_opens_its_own_conversation_and_the_answer_becomes_the_panel() -> TestResult {
    let mut session = golden::coach_options()?;
    let transcript = golden::coach_transcript()?;
    let conversation = transcript.conversation.id;
    // The player had this conversation open; a select starts a fresh one.
    let request = session
        .begin_app_turn(&select_turn("cs-1"))
        .ok_or("request")?;
    assert_eq!(request.conversation_id, None);
    assert_eq!(request.initiation, AppInitiation::AppChampSelect);
    assert!(request.game_context.live.is_none());
    assert_eq!(session.parts().status.open_conversation, None);
    assert_eq!(session.parts().coach, None, "nothing until the answer");

    session.started(run_in(conversation));
    session.settled(transcript);
    let parts = session.parts();
    let coach = parts.coach.ok_or("panel")?;
    assert_eq!(coach.kind, ChatCoachKind::ChampSelect);
    let shown = parts.transcript.ok_or("transcript")?;
    let answer = shown
        .messages
        .iter()
        .find(|message| message.id == coach.message_id)
        .ok_or("the panel names a message of the transcript")?;
    assert!(
        (2..=4).contains(&answer.coach_options.len()),
        "the chips come from the answer"
    );

    // The same select continues the conversation while it is open.
    let next = session
        .begin_app_turn(&select_turn("cs-1"))
        .ok_or("request")?;
    assert_eq!(next.conversation_id, Some(conversation));
    Ok(())
}

#[test]
fn the_panel_goes_when_the_select_ends_or_another_conversation_opens() -> TestResult {
    let mut session = golden::coach_options()?;
    let transcript = golden::coach_transcript()?;
    let conversation = transcript.conversation.id;
    session
        .begin_app_turn(&select_turn("cs-1"))
        .ok_or("request")?;
    session.started(run_in(conversation));
    session.settled(transcript);
    assert!(session.parts().coach.is_some());

    session.start_new();
    assert_eq!(session.parts().coach, None, "another conversation is open");

    session.open(conversation);
    session.clear_coach();
    assert_eq!(session.parts().coach, None);
    Ok(())
}

#[test]
fn a_coach_that_is_off_or_a_spent_limit_says_nothing() -> TestResult {
    for code in [
        DesktopApiErrorCode::FeatureDisabled,
        DesktopApiErrorCode::RateLimited,
    ] {
        // The player has a conversation open when the coach is refused.
        let mut session = golden::coach_options()?;
        let conversation = golden::coach_transcript()?.conversation.id;
        session
            .begin_app_turn(&select_turn("cs-1"))
            .ok_or("request")?;
        session.app_turn_failed(&refused(code));
        let parts = session.parts();
        assert_eq!(
            parts.status.open_conversation,
            Some(conversation),
            "{code:?}: the player's conversation is still open"
        );
        assert!(parts.transcript.is_some(), "{code:?}: and still shown");
        assert_eq!(parts.turn, None, "{code:?}: the optimistic turn is gone");
        assert_eq!(parts.status.notice, None, "{code:?}: no notice");
        assert_eq!(parts.status.availability, ChatAvailability::Ready);
        assert_eq!(parts.coach, None);
    }
    Ok(())
}

#[test]
fn a_turn_waits_for_the_one_running() -> TestResult {
    let mut session: ChatSession = golden::streaming()?;
    assert!(session.begin_app_turn(&select_turn("cs-1")).is_none());
    Ok(())
}
