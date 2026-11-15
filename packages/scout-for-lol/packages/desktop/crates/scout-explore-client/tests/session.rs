//! The golden run played through a chat session: what the window is sent
//! while the answer streams, once it lands, and when the run reported an
//! error.

#![cfg(feature = "golden")]

use scout_desktop_ipc::{
    ChatAvailability, ChatImage, ChatRole, ChatToolStatus, ChatVisual, ChatVisuals,
};
use scout_explore_client::golden;
use scout_explore_client::session::chat_transcript;

type TestResult = Result<(), Box<dyn std::error::Error>>;

#[test]
fn the_sidebar_lists_the_golden_conversations() -> TestResult {
    let parts = golden::ready()?.parts();
    assert_eq!(parts.status.availability, ChatAvailability::Ready);
    let titles: Vec<_> = parts
        .conversations
        .iter()
        .map(|conversation| conversation.title.as_str())
        .collect();
    assert_eq!(
        titles,
        ["Best ADC pair this week", "Who carries our ARAMs?"]
    );
    assert_eq!(parts.transcript, None);
    assert_eq!(parts.turn, None);
    Ok(())
}

#[test]
fn mid_turn_the_window_sees_the_streamed_answer_and_its_steps() -> TestResult {
    let session = golden::streaming()?;
    let open = session.open_conversation();
    let parts = session.parts();
    let turn = parts.turn.ok_or("no turn mid-stream")?;
    assert_eq!(turn.question.as_deref(), Some(golden::QUESTION));
    assert_eq!(
        turn.answer.as_deref(),
        Some("Jinx and Lulu lead with a 61% win rate.")
    );
    assert_eq!(turn.activity.as_deref(), Some("Running the query"));
    assert!(turn.stoppable);
    assert!(!turn.stopping);
    let steps: Vec<_> = turn
        .tools
        .iter()
        .map(|step| (step.summary.as_str(), step.status, step.duration_ms))
        .collect();
    assert_eq!(
        steps,
        [
            ("Checked the query.", ChatToolStatus::Succeeded, Some(41)),
            (
                "The query returned 1 row.",
                ChatToolStatus::Succeeded,
                Some(230)
            ),
        ]
    );
    assert_eq!(turn.error, None);
    // The new conversation is the open one, highlighted in the sidebar.
    assert_eq!(
        parts
            .conversations
            .iter()
            .find(|conversation| Some(conversation.id) == open)
            .map(|conversation| conversation.title.as_str()),
        Some("Best ADC pair this week")
    );
    Ok(())
}

#[test]
fn once_landed_the_transcript_holds_the_answer_and_the_turn_is_gone() -> TestResult {
    let session = golden::settled()?;
    assert!(!session.turn_active());
    let parts = session.parts();
    assert_eq!(parts.turn, None);
    assert_eq!(parts.status.notice, None);
    let transcript = parts.transcript.ok_or("no transcript")?;
    assert_eq!(transcript.title, "Best ADC pair this week");
    let rows: Vec<_> = transcript
        .messages
        .iter()
        .map(|message| (message.role, message.content.as_str(), message.tools.len()))
        .collect();
    assert_eq!(
        rows,
        [
            (ChatRole::User, golden::QUESTION, 0),
            (
                ChatRole::Assistant,
                "Jinx and Lulu lead with a 61% win rate.",
                2
            ),
        ]
    );
    Ok(())
}

#[test]
fn an_error_the_run_reported_outlives_the_turn_as_a_notice() -> TestResult {
    let parts = golden::interrupted()?.parts();
    assert_eq!(parts.turn, None);
    assert_eq!(
        parts.status.notice.as_deref(),
        Some("Explore could not finish this answer.")
    );
    Ok(())
}

#[test]
fn a_transcript_keeps_roles_caveats_and_no_raw_payloads() -> TestResult {
    let transcript = chat_transcript(&golden::transcript()?, None);
    assert_eq!(transcript.title, "Who carries our ARAMs?");
    let answer = transcript
        .messages
        .iter()
        .find(|message| message.role == ChatRole::Assistant)
        .ok_or("no answer")?;
    assert_eq!(answer.caveats, ["Only games Scout recorded are counted."]);
    // The IPC type has no field for query text or raw tool payloads, and
    // cards cross only as their rendered projection.
    let wire = serde_json::to_value(&transcript)?;
    for absent in [
        "queryText",
        "rawInput",
        "rawOutput",
        "matchCards",
        "preview",
    ] {
        assert!(!wire.to_string().contains(absent), "{absent} crossed IPC");
    }
    Ok(())
}

#[test]
fn an_answer_with_visuals_asks_for_its_chart_and_art_and_shows_them_as_they_land() -> TestResult {
    let mut session = golden::visuals()?;
    let wanted = session.wanted_images();
    let parts = session.parts();
    let transcript = parts.transcript.as_ref().ok_or("transcript")?;
    let chart = match &transcript.messages[1].visuals.visual {
        Some(ChatVisual::Chart { image, .. }) => image.clone(),
        other => return Err(format!("expected a chart, got {other:?}").into()),
    };
    assert!(matches!(
        transcript.messages[3].visuals.visual,
        Some(ChatVisual::Table(_))
    ));
    assert_eq!(wanted.first().map(|(key, _)| key), Some(&chart));
    assert_eq!(parts.images.len(), wanted.len());
    assert!(
        parts
            .images
            .values()
            .all(|image| *image == ChatImage::Loading)
    );
    // Ten champions on the match card, and the loadout's art without the
    // empty slot or repeats (Jinx and Kraken Slayer are named twice).
    assert_eq!(wanted.len(), 1 + 10 + 6 + 2 + 5 + 3);
    // A question carries no visuals.
    assert_eq!(transcript.messages[0].visuals, ChatVisuals::default());

    session.image_loaded(
        chart.clone(),
        ChatImage::Ready {
            path: "/cache/chart.asset".to_owned(),
        },
    );
    let failed = wanted[1].0.clone();
    session.image_loaded(
        failed.clone(),
        ChatImage::Failed {
            message: "offline".to_owned(),
        },
    );
    let parts = session.parts();
    assert_eq!(
        parts.images.get(&chart),
        Some(&ChatImage::Ready {
            path: "/cache/chart.asset".to_owned()
        })
    );
    assert_eq!(
        session.forget_failed_images(),
        std::slice::from_ref(&failed)
    );
    assert_eq!(
        session.parts().images.get(&failed),
        Some(&ChatImage::Loading)
    );
    Ok(())
}
