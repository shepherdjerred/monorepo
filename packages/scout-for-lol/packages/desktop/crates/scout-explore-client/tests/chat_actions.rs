//! The chat actions as pure session state: images in the composer, edit and
//! regenerate as the web starts them, version switching, share links and the
//! model picker. No I/O: the relay performs what these transitions ask for.

#![cfg(feature = "golden")]

use scout_client_core::desktop_api::{
    AttachPoint, ConversationListResponse, DesktopApiErrorCode, ExploreModel, ModelsResponse,
};
use scout_desktop_ipc::{ChatAvailability, ChatDraftState};
use scout_explore_client::ExploreClientError;
use scout_explore_client::Refusal;
use scout_explore_client::golden;
use scout_explore_client::model::{Attachment, AttachmentMediaType};
use scout_explore_client::session::{
    ChatSession, MAX_IMAGE_BYTES, MAX_IMAGES, UploadFailure, load_image,
};
use uuid::Uuid;

type TestResult = Result<(), Box<dyn std::error::Error>>;

fn uploaded(id: u128) -> Attachment {
    Attachment {
        id: Uuid::from_u128(id),
        media_type: AttachmentMediaType::Png,
    }
}

#[test]
fn a_question_waits_for_its_images_and_then_carries_them() -> TestResult {
    let mut session = golden::ready()?;
    session.start_new();
    let job = session.begin_attach("/tmp/build.png").ok_or("job")?;
    let composer = session.parts().composer;
    assert_eq!(composer.drafts.len(), 1);
    assert_eq!(composer.drafts[0].name, "build.png");
    assert_eq!(composer.drafts[0].state, ChatDraftState::Uploading);

    assert!(session.submit("What is wrong with this build?").is_none());
    assert_eq!(
        session.parts().status.notice.as_deref(),
        Some("Wait for your images to finish uploading.")
    );

    session.upload_finished(job.key, Ok(uploaded(0xa1)));
    assert_eq!(
        session.parts().composer.drafts[0].state,
        ChatDraftState::Ready
    );
    let request = session
        .submit("What is wrong with this build?")
        .ok_or("request")?;
    assert_eq!(request.attachment_ids, Some(vec![Uuid::from_u128(0xa1)]));
    assert_eq!(request.attach, AttachPoint::Leaf);
    assert_eq!(session.parts().composer.drafts, []);
    let turn = session.parts().turn.ok_or("turn")?;
    assert_eq!(turn.attachments.len(), 1);
    assert_eq!(turn.attachments[0].media_type, "image/png");
    assert_eq!(
        turn.attachments[0].thumbnail.as_deref(),
        Some("/tmp/build.png")
    );
    Ok(())
}

#[test]
fn a_refused_question_gives_its_images_back() -> TestResult {
    let mut session = golden::composing("/tmp/a.png", "/tmp/b.png")?;
    session.submit("Look at these").ok_or("request")?;
    assert_eq!(session.parts().composer.drafts.len(), 0);

    session.start_failed(&ExploreClientError::Refused(Refusal {
        code: DesktopApiErrorCode::ConversationBusy,
        message: "Busy.".to_owned(),
        retry_after: None,
    }));

    let drafts = session.parts().composer.drafts;
    assert_eq!(drafts.len(), 2);
    assert!(
        drafts
            .iter()
            .all(|draft| draft.state == ChatDraftState::Ready)
    );
    assert!(
        session.submit("Look at these").is_some(),
        "and they can go again"
    );
    Ok(())
}

#[test]
fn images_are_held_to_the_webs_count_and_types() -> TestResult {
    let mut session = golden::ready()?;
    for index in 0..MAX_IMAGES {
        assert!(
            session
                .begin_attach(&format!("/tmp/{index}.webp"))
                .is_some()
        );
    }
    assert!(session.begin_attach("/tmp/extra.png").is_none());
    assert_eq!(
        session.parts().status.notice.as_deref(),
        Some("A question can carry at most 4 images.")
    );

    let mut session = golden::ready()?;
    assert!(session.begin_attach("/tmp/clip.gif").is_none());
    assert_eq!(
        session.parts().status.notice.as_deref(),
        Some("Choose a PNG, JPEG, or WebP image.")
    );
    assert_eq!(session.parts().composer.max_images, 4);
    Ok(())
}

#[test]
fn a_failed_image_is_named_and_left_behind() -> TestResult {
    let mut session = golden::ready()?;
    let big = session.begin_attach("/tmp/huge.png").ok_or("job")?;
    let fine = session.begin_attach("/tmp/fine.png").ok_or("job")?;
    session.upload_finished(
        big.key,
        Err(UploadFailure::Local(
            "Images can be at most 10 MiB.".to_owned(),
        )),
    );
    session.upload_finished(fine.key, Ok(uploaded(0xb1)));
    let drafts = session.parts().composer.drafts;
    assert_eq!(
        drafts[0].state,
        ChatDraftState::Failed {
            message: "Images can be at most 10 MiB.".to_owned()
        }
    );

    let request = session.submit("Only the good one").ok_or("request")?;
    assert_eq!(request.attachment_ids, Some(vec![Uuid::from_u128(0xb1)]));
    Ok(())
}

#[test]
fn removing_an_uploaded_image_says_which_to_discard() -> TestResult {
    let mut session = golden::composing("/tmp/a.png", "/tmp/b.png")?;
    let keys: Vec<_> = session
        .parts()
        .composer
        .drafts
        .iter()
        .map(|draft| draft.key)
        .collect();
    assert_eq!(
        session.remove_attachment(keys[0]),
        Some(Uuid::from_u128(0xa1))
    );
    assert_eq!(session.parts().composer.drafts.len(), 1);
    assert_eq!(session.remove_attachment(keys[0]), None, "already gone");

    let uploading = session.begin_attach("/tmp/c.png").ok_or("job")?;
    assert_eq!(
        session.remove_attachment(uploading.key),
        None,
        "nothing stored yet"
    );
    Ok(())
}

#[test]
fn an_image_file_is_checked_by_size_and_first_bytes() -> TestResult {
    let directory = std::env::temp_dir().join(format!("scout-chat-actions-{}", Uuid::new_v4()));
    std::fs::create_dir_all(&directory)?;
    let png = directory.join("ok.png");
    std::fs::write(
        &png,
        [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0],
    )?;
    let (media_type, bytes) = load_image(&png)?;
    assert_eq!(media_type, AttachmentMediaType::Png);
    assert_eq!(bytes.len(), 12);

    let renamed = directory.join("not-an-image.png");
    std::fs::write(&renamed, b"GIF89a....")?;
    assert_eq!(
        load_image(&renamed),
        Err("Choose a PNG, JPEG, or WebP image.".to_owned())
    );
    assert!(load_image(&directory.join("missing.png")).is_err());

    let huge = directory.join("huge.png");
    let file = std::fs::File::create(&huge)?;
    file.set_len(MAX_IMAGE_BYTES + 1)?;
    assert_eq!(
        load_image(&huge),
        Err("Images can be at most 10 MiB.".to_owned())
    );
    std::fs::remove_dir_all(&directory)?;
    Ok(())
}

#[test]
fn editing_forks_under_the_questions_parent_or_at_the_root() -> TestResult {
    let mut session = golden::branched()?;

    // The opening question has no parent: the fork the parent id cannot name.
    let request = session
        .edit(golden::BRANCHED_QUESTION, "  Who wins ARAM in October?  ")
        .ok_or("request")?;
    assert_eq!(request.attach, AttachPoint::Root);
    assert_eq!(
        request.question.as_deref(),
        Some("Who wins ARAM in October?")
    );
    assert_eq!(request.conversation_id, Some(golden::BRANCHED_CONVERSATION));
    // While it runs the old branch is replaced, not shown above the new one.
    let parts = session.parts();
    assert_eq!(parts.transcript.ok_or("transcript")?.messages.len(), 0);
    assert_eq!(
        parts.turn.ok_or("turn")?.question.as_deref(),
        Some("Who wins ARAM in October?")
    );

    let mut session = golden::branched()?;
    let request = session
        .edit(golden::BRANCHED_FOLLOW_UP, "And on the Rift?")
        .ok_or("request")?;
    assert_eq!(
        request.attach,
        AttachPoint::Message {
            message_id: golden::BRANCHED_ANSWER
        }
    );
    assert_eq!(
        session
            .parts()
            .transcript
            .ok_or("transcript")?
            .messages
            .len(),
        2
    );
    Ok(())
}

#[test]
fn regenerating_answers_the_same_question_again() -> TestResult {
    let mut session = golden::branched()?;
    let request = session
        .regenerate(golden::BRANCHED_FOLLOW_UP_ANSWER)
        .ok_or("request")?;
    assert_eq!(request.question, None);
    assert_eq!(
        request.attach,
        AttachPoint::Message {
            message_id: golden::BRANCHED_FOLLOW_UP
        }
    );
    assert_eq!(request.attachment_ids, None);
    // The question stays; only its answer is being replaced.
    let parts = session.parts();
    let kept: Vec<_> = parts
        .transcript
        .ok_or("transcript")?
        .messages
        .iter()
        .map(|message| message.id)
        .collect();
    assert_eq!(
        kept,
        [
            golden::BRANCHED_QUESTION,
            golden::BRANCHED_ANSWER,
            golden::BRANCHED_FOLLOW_UP
        ]
    );
    Ok(())
}

#[test]
fn edit_and_regenerate_refuse_what_they_cannot_act_on() -> TestResult {
    let mut session = golden::branched()?;
    assert!(
        session
            .edit(golden::BRANCHED_ANSWER, "An answer is not a question")
            .is_none()
    );
    assert!(session.regenerate(golden::BRANCHED_QUESTION).is_none());
    assert!(session.edit(Uuid::from_u128(1), "Unknown").is_none());
    assert!(session.edit(golden::BRANCHED_QUESTION, "   ").is_none());

    session
        .regenerate(golden::BRANCHED_ANSWER)
        .ok_or("the first regenerate starts")?;
    assert!(
        session
            .edit(golden::BRANCHED_QUESTION, "While one runs")
            .is_none(),
        "one turn at a time"
    );
    assert!(
        session
            .switch_version(golden::BRANCHED_QUESTION_FIRST)
            .is_none()
    );

    let mut gated = golden::branched()?;
    gated.refresh_failed(&ExploreClientError::NotPaired);
    assert_eq!(
        gated.parts().status.availability,
        ChatAvailability::NeedsApproval
    );
    assert!(gated.regenerate(golden::BRANCHED_ANSWER).is_none());
    Ok(())
}

#[test]
fn the_switcher_names_the_neighbouring_versions() -> TestResult {
    let session = golden::branched()?;
    let messages = session.parts().transcript.ok_or("transcript")?.messages;
    let version = messages[0]
        .version
        .clone()
        .ok_or("the edited question has versions")?;
    assert_eq!((version.position, version.count), (2, 3));
    assert_eq!(version.previous, Some(golden::BRANCHED_QUESTION_FIRST));
    assert_eq!(version.next, Some(golden::BRANCHED_QUESTION_LAST));
    let answer = messages[1]
        .version
        .clone()
        .ok_or("the answer has versions")?;
    assert_eq!((answer.position, answer.count), (1, 2));
    assert_eq!(answer.previous, None);
    assert_eq!(answer.next, Some(golden::BRANCHED_ANSWER_NEXT));
    assert_eq!(messages[2].version, None, "one version shows no switcher");
    Ok(())
}

#[test]
fn switching_moves_to_the_chosen_version_of_the_open_conversation() -> TestResult {
    let mut session = golden::branched()?;
    assert_eq!(
        session.switch_version(golden::BRANCHED_QUESTION_LAST),
        Some((
            golden::BRANCHED_CONVERSATION,
            golden::BRANCHED_QUESTION_LAST
        ))
    );
    assert_eq!(
        session.switch_version(Uuid::from_u128(7)),
        None,
        "not a version here"
    );
    let mut blank = golden::ready()?;
    assert_eq!(blank.switch_version(golden::BRANCHED_QUESTION_LAST), None);
    Ok(())
}

#[test]
fn a_conversation_links_to_the_web_and_a_shared_one_to_its_share_page() -> TestResult {
    let parts = golden::branched()?.parts();
    let transcript = parts.transcript.ok_or("transcript")?;
    assert_eq!(
        transcript.web_url,
        format!(
            "https://scout-for-lol.com/app/explore/{}",
            golden::BRANCHED_CONVERSATION
        )
    );
    assert_eq!(transcript.share_url, None);

    let shared = golden::shared()?.parts().transcript.ok_or("transcript")?;
    assert_eq!(
        shared.share_url.as_deref(),
        Some("https://scout-for-lol.com/app/explore/s/aaaaaaaabbbbbbbbccccccccdddddddd")
    );

    // The links follow the backend the client talks to, whatever path it names.
    let mut beta = ChatSession::with_web_origin("https://beta.scout-for-lol.com/app");
    beta.listed(ConversationListResponse {
        conversations: Vec::new(),
    });
    beta.open(golden::BRANCHED_CONVERSATION);
    beta.opened(golden::branched_transcript(Some(golden::SHARE_TOKEN))?);
    let transcript = beta.parts().transcript.ok_or("transcript")?;
    assert!(
        transcript
            .web_url
            .starts_with("https://beta.scout-for-lol.com/app/explore/")
    );
    assert!(
        transcript
            .share_url
            .is_some_and(|url| url.starts_with("https://beta.scout-for-lol.com/app/explore/s/"))
    );
    assert_eq!(beta.shareable(), Some(golden::BRANCHED_CONVERSATION));
    assert_eq!(
        golden::ready()?.shareable(),
        None,
        "a blank chat has nothing to share"
    );
    Ok(())
}

#[test]
fn the_model_picker_offers_the_servers_models_and_sends_only_a_choice() -> TestResult {
    let mut session = golden::branched()?;
    let composer = session.parts().composer;
    assert_eq!(
        composer
            .models
            .iter()
            .map(|model| model.id.as_str())
            .collect::<Vec<_>>(),
        ["gpt-6-luna", "gpt-6.1-sol"]
    );
    assert_eq!(
        composer.model.as_deref(),
        Some("gpt-6-luna"),
        "the default shows"
    );
    let unchosen = session.submit("First").ok_or("request")?;
    assert_eq!(unchosen.model, None, "the server's default needs no model");

    let mut session = golden::branched()?;
    session.choose_model(Some("gpt-6.1-sol"));
    assert_eq!(
        session.parts().composer.model.as_deref(),
        Some("gpt-6.1-sol")
    );
    let chosen = session.submit("Second").ok_or("request")?;
    assert_eq!(chosen.model, Some(ExploreModel::Sol));

    let mut session = golden::branched()?;
    session.choose_model(Some("gpt-5"));
    assert_eq!(
        session.parts().composer.model.as_deref(),
        Some("gpt-6-luna"),
        "unknown ids are ignored"
    );
    session.choose_model(Some("gpt-6.1-sol"));
    session.choose_model(None);
    assert_eq!(
        session.parts().composer.model.as_deref(),
        Some("gpt-6-luna")
    );
    Ok(())
}

#[test]
fn with_the_picker_off_there_is_nothing_to_choose() -> TestResult {
    let mut session = golden::ready()?;
    assert_eq!(session.parts().composer.models, [], "before the list loads");
    let fixture: serde_json::Value = serde_json::from_str(golden::MODELS)?;
    let mut models: ModelsResponse = serde_json::from_value(fixture["response"].clone())?;
    models.picker_enabled = false;
    models.models.clear();
    session.models_loaded(models);
    session.choose_model(Some("gpt-6.1-sol"));
    let composer = session.parts().composer;
    assert_eq!((composer.models.len(), composer.model), (0, None));
    assert_eq!(session.submit("Hi").ok_or("request")?.model, None);
    Ok(())
}
