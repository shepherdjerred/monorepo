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

/// A proactive turn over the recorded live game. Beta profile only.
#[cfg(scout_proactive_coach)]
fn proactive_turn(
    key: &str,
) -> Result<scout_explore_client::proactive::ProactiveTurn, Box<dyn std::error::Error>> {
    use scout_client_core::desktop_api::CoachTrigger;
    use scout_client_core::live::model::AllGameData;
    use scout_client_core::live::snapshot::project;

    let data: AllGameData = serde_json::from_str(include_str!(
        "../../scout-client-core/testdata/live/allgamedata.json"
    ))?;
    Ok(scout_explore_client::proactive::ProactiveTurn {
        game_key: key.to_owned(),
        trigger: CoachTrigger::DeathStreak {
            deaths: 4,
            deaths_without_takedown: 3,
        },
        snapshot: project(&data)?,
    })
}

#[cfg(scout_proactive_coach)]
#[test]
fn a_proactive_answer_is_its_own_scout_noticed_panel_and_never_the_players_answer() -> TestResult {
    let mut session = golden::coach_options()?;
    let transcript = golden::coach_transcript()?;
    let conversation = transcript.conversation.id;
    let turn = proactive_turn("g-1")?;
    let request = session.begin_proactive_turn(&turn).ok_or("request")?;
    // No text of any kind: the trigger, its game and the frame.
    assert_eq!(request.conversation_id, None);
    assert_eq!(request.game_key, "g-1");
    assert_eq!(request.trigger, turn.trigger);
    assert_eq!(session.parts().coach, None, "nothing until the answer");
    assert!(
        session.begin_proactive_turn(&turn).is_none(),
        "one turn at a time"
    );

    // The golden question stands in for the server-worded one.
    let question = transcript.messages[0].id;
    session.started(ActiveRun {
        question_message_id: question,
        ..run_in(conversation)
    });
    session.settled(transcript.clone());
    let coach = session.parts().coach.ok_or("panel")?;
    assert_eq!(coach.kind, ChatCoachKind::Proactive);
    assert_eq!(coach.message_id, golden::COACH_ANSWER);

    // The player asks a follow-up in the same conversation: the card still
    // shows Scout's note, not the answer to the player.
    let mut followed = transcript;
    let mut asked = followed.messages[0].clone();
    asked.id = Uuid::from_u128(0xf1);
    asked.parent_id = Some(golden::COACH_ANSWER);
    asked.content = "What should I build?".to_owned();
    let mut answered = followed.messages[1].clone();
    answered.id = Uuid::from_u128(0xf2);
    answered.parent_id = Some(asked.id);
    followed.messages.push(asked);
    followed.messages.push(answered);
    session.settled(followed);
    let coach = session.parts().coach.ok_or("panel")?;
    assert_eq!(coach.kind, ChatCoachKind::Proactive);
    assert_eq!(coach.message_id, golden::COACH_ANSWER);
    Ok(())
}

#[cfg(scout_proactive_coach)]
#[test]
fn a_proactive_turn_scout_did_not_start_puts_the_players_conversation_back_quietly() -> TestResult {
    let mut session = golden::coach_options()?;
    let open = session.parts().status.open_conversation;
    assert!(open.is_some());
    session
        .begin_proactive_turn(&proactive_turn("g-1")?)
        .ok_or("request")?;
    assert_eq!(session.parts().status.open_conversation, None);
    // A duplicate: no error, nothing shown.
    session.proactive_turn_not_started(None);
    let parts = session.parts();
    assert_eq!(parts.status.open_conversation, open);
    assert_eq!(parts.turn, None);
    assert_eq!(parts.status.notice, None);
    assert_eq!(parts.coach, None);

    // No answer at all (here a broken contract) says nothing either.
    session
        .begin_proactive_turn(&proactive_turn("g-1")?)
        .ok_or("request")?;
    session.proactive_turn_not_started(Some(&ExploreClientError::Unexpected {
        status: 502,
        detail: "bad gateway".to_owned(),
    }));
    assert_eq!(session.parts().status.notice, None);
    // Nor does proactive coaching being off: chat itself stays on.
    session
        .begin_proactive_turn(&proactive_turn("g-1")?)
        .ok_or("request")?;
    session.proactive_turn_not_started(Some(&refused(Code::FeatureDisabled)));
    assert_eq!(session.parts().status.availability, ChatAvailability::Ready);

    // Spacing: a refusal the player did not cause says nothing either.
    session
        .begin_proactive_turn(&proactive_turn("g-1")?)
        .ok_or("request")?;
    session.proactive_turn_not_started(Some(&refused(Code::RateLimited)));
    let parts = session.parts();
    assert_eq!(parts.status.open_conversation, open);
    assert_eq!(parts.status.notice, None);
    assert_eq!(parts.status.availability, ChatAvailability::Ready);
    Ok(())
}

#[cfg(scout_proactive_coach)]
#[test]
fn a_conversation_the_player_opens_meanwhile_stays_open_when_the_turn_does_not_start() -> TestResult
{
    let mut session = golden::coach_options()?;
    session
        .begin_proactive_turn(&proactive_turn("g-1")?)
        .ok_or("request")?;
    let chosen = Uuid::from_u128(0xc0);
    session.open(chosen);
    session.proactive_turn_not_started(None);
    assert_eq!(session.parts().status.open_conversation, Some(chosen));

    let mut blank = golden::coach_options()?;
    blank
        .begin_proactive_turn(&proactive_turn("g-1")?)
        .ok_or("request")?;
    blank.new_chat();
    blank.proactive_turn_not_started(None);
    assert_eq!(blank.parts().status.open_conversation, None);
    Ok(())
}
