//! Independently captured official-client request transcripts, plus host/peer
//! fault boundaries that must not lose durable receipts or remote changes.

use std::{collections::BTreeSet, error::Error};

use obsidian_sync::{
    SyncError,
    auth::{AuthRequest, AuthResponse, VaultList},
    crypto::{ContentFrame, EncryptionVersion, VaultCipher, VaultKey},
    filter::{AttachmentCategory, SyncFilter},
    session::{
        Checkpoint, Effect, Input, Session, SessionConfig, Upload, UploadMetadata, server_url,
    },
};
use serde::Deserialize;
use serde_json::{Value, json};

type TestResult = Result<(), Box<dyn Error>>;

#[derive(Deserialize)]
struct Fixture {
    transcript: Transcript,
}
#[derive(Deserialize)]
struct Transcript {
    accounts: Vec<Value>,
    cases: Vec<Case>,
    filters: Vec<FilterCase>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Case {
    version: u8,
    key_bytes: Vec<u8>,
    salt: String,
    frames: Vec<Value>,
    pulled_bytes: Vec<u8>,
    notices: Vec<Value>,
    ready: u64,
}
#[derive(Deserialize)]
struct FilterCase {
    path: String,
    folder: bool,
    allowed: bool,
}

fn fixture() -> Result<Fixture, serde_json::Error> {
    serde_json::from_str(include_str!("reference/protocol.json"))
}

fn cipher(case: &Case) -> obsidian_sync::Result<VaultCipher> {
    VaultCipher::new(
        EncryptionVersion::try_from(case.version)?,
        &VaultKey::from_bytes(&case.key_bytes)?,
        &case.salt,
    )
}

fn session(case: &Case, checkpoint: Checkpoint) -> obsidian_sync::Result<Session> {
    Session::new(
        SessionConfig::new(
            "sync-test.obsidian.md",
            "public-synthetic-token",
            "synthetic-vault",
            "Synthetic Device",
        )?,
        cipher(case)?,
        checkpoint,
    )
}

fn frames(effects: &[Effect]) -> Result<Vec<Value>, serde_json::Error> {
    effects
        .iter()
        .filter_map(|effect| match effect {
            Effect::SendText(frame) => {
                Some(serde_json::from_str(frame.as_str()).map(|value: Value| json!({"text":value})))
            }
            Effect::SendBinary(frame) => Some(Ok(json!({"binary":frame.bytes()}))),
            _ => None,
        })
        .collect()
}

fn persist(
    session: &mut Session,
    effects: &[Effect],
    now: u64,
) -> obsidian_sync::Result<Vec<Effect>> {
    let mut output = Vec::new();
    for effect in effects {
        if let Effect::PersistCheckpointDelta { revision, delta } = effect {
            delta.validate()?;
            let json = serde_json::to_string(delta).map_err(|_| SyncError::Protocol)?;
            let restored = serde_json::from_str(&json).map_err(|_| SyncError::Protocol)?;
            assert_eq!(*delta, restored);
            output.extend(session.handle(Input::CheckpointPersisted(*revision), now)?);
        }
        if let Effect::PersistCheckpoint {
            revision,
            checkpoint,
        } = effect
        {
            checkpoint.validate()?;
            let serialized = serde_json::to_string(checkpoint).map_err(|_| SyncError::Protocol)?;
            let restored: Checkpoint =
                serde_json::from_str(&serialized).map_err(|_| SyncError::Protocol)?;
            assert_eq!(restored, *checkpoint);
            output.extend(session.handle(Input::CheckpointPersisted(*revision), now)?);
        }
    }
    Ok(output)
}

fn connected(session: &mut Session) -> obsidian_sync::Result<Vec<Effect>> {
    session.begin(0)?;
    let effects = session.handle(Input::Opened, 1)?;
    session.handle(
        Input::Text(json!({"res":"ok","perFileMax":208_666_624,"userId":42}).to_string()),
        2,
    )?;
    let ready = session.handle(
        Input::Text(json!({"op":"ready","version":5}).to_string()),
        3,
    )?;
    let durable = persist(session, &ready, 4)?;
    assert!(
        durable
            .iter()
            .any(|effect| matches!(effect, Effect::Ready { cursor: 5 }))
    );
    Ok(effects)
}

fn upload(path: &str, related: Option<&str>, folder: bool, bytes: Option<Vec<u8>>) -> Upload {
    Upload {
        operation_id: path.into(),
        path: path.into(),
        related_path: related.map(str::to_owned),
        folder,
        ctime: 1000,
        mtime: 2000,
        bytes,
    }
}

#[test]
fn exact_official_wire_transcripts_for_all_encryption_versions() -> TestResult {
    assert_official_wire_transcripts(false)
}

#[test]
fn owned_final_frames_preserve_all_official_transcripts() -> TestResult {
    assert_official_wire_transcripts(true)
}

fn metadata_for(upload: &Upload) -> Result<UploadMetadata, SyncError> {
    use sha2::{Digest, Sha256};
    Ok(UploadMetadata {
        operation_id: upload.operation_id.clone(),
        path: upload.path.clone(),
        related_path: upload.related_path.clone(),
        folder: upload.folder,
        ctime: upload.ctime,
        mtime: upload.mtime,
        deleted: upload.bytes.is_none(),
        size: u64::try_from(upload.bytes.as_ref().map_or(0, Vec::len))
            .map_err(|_| SyncError::FileTooLarge)?,
        content_hash: upload
            .bytes
            .as_deref()
            .filter(|_| !upload.folder)
            .map(|bytes| hex::encode(Sha256::digest(bytes))),
    })
}

fn queue_owned(
    session: &mut Session,
    upload: Upload,
    nonce: [u8; 12],
    now: u64,
) -> obsidian_sync::Result<Vec<Effect>> {
    let metadata = metadata_for(&upload)?;
    session.admit_upload(&metadata)?;
    let frame = upload
        .bytes
        .filter(|bytes| !bytes.is_empty())
        .map(|bytes| {
            let mut frame = ContentFrame::new(bytes.len(), nonce)?;
            frame.content_mut()?.copy_from_slice(&bytes);
            Ok::<_, SyncError>(frame)
        })
        .transpose()?;
    session.queue_content_frame(metadata, frame, now)
}

fn assert_official_wire_transcripts(owned: bool) -> TestResult {
    let fixture = fixture()?;
    for case in fixture.transcript.cases {
        let mut session = session(
            &case,
            Checkpoint {
                cursor: 5,
                initial: false,
                ..Checkpoint::default()
            },
        )?;
        let mut actual = frames(&connected(&mut session)?)?;
        let nonce = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
        let tasks = [
            upload(
                "Tasks/日本語 📝.md",
                Some("Tasks/Before.md"),
                false,
                Some(case.pulled_bytes.clone()),
            ),
            upload("Tasks/Empty.md", None, false, Some(Vec::new())),
            upload("Tasks/Folder", None, true, Some(Vec::new())),
            upload("Tasks/Removed.md", None, false, None),
            upload(
                "Tasks/Renamed.md",
                Some("Tasks/Original.md"),
                false,
                Some(case.pulled_bytes.clone()),
            ),
        ];
        for (index, task) in tasks.into_iter().enumerate() {
            let populated = task.bytes.as_ref().is_some_and(|bytes| !bytes.is_empty());
            let expected_id = task.operation_id.clone();
            let effects = if owned {
                queue_owned(&mut session, task, nonce, 10)?
            } else {
                session.queue_upload(task, nonce, 10)?
            };
            actual.extend(frames(&effects)?);
            let response = session.handle(
                Input::Text(json!({"res":if populated {"upload"} else {"ok"}}).to_string()),
                11,
            )?;
            actual.extend(frames(&response)?);
            let completion = if populated {
                session.handle(Input::Text(json!({"res":"ok"}).to_string()), 12)?
            } else {
                response
            };
            assert!(completion.iter().any(|effect| matches!(effect,Effect::Uploaded { operation_id,.. } if operation_id==&expected_id)));
            if index == 0 {
                actual.extend(frames(&session.queue_download(6, 13)?)?);
                let wire: Vec<u8> = serde_json::from_value(
                    case.frames
                        .iter()
                        .find_map(|frame| frame.get("binary"))
                        .ok_or("Missing reference content")?
                        .clone(),
                )?;
                assert!(
                    session
                        .handle(
                            Input::Text(
                                json!({"deleted":false,"size":wire.len(),"pieces":1}).to_string()
                            ),
                            14
                        )?
                        .is_empty()
                );
                let result = session.handle(Input::Binary(wire), 15)?;
                match result.first() {
                    Some(Effect::Downloaded(download)) => {
                        assert_eq!(download.bytes.as_ref(), Some(&case.pulled_bytes));
                    }
                    _ => return Err("Missing authenticated download".into()),
                }
                drop(result);
                session.release_download(6)?;
            }
        }
        assert_eq!(actual, case.frames, "official version {}", case.version);
        assert_eq!(case.ready, 5);
        assert_eq!(
            case.notices
                .first()
                .and_then(|notice| notice.get("path"))
                .and_then(Value::as_str),
            Some("Tasks/日本語 📝.md")
        );
    }
    Ok(())
}

#[test]
fn account_request_builders_match_official_capture_and_redact_secrets() -> TestResult {
    let fixture = fixture()?;
    let requests = [
        AuthRequest::sign_in(
            "synthetic@example.test",
            "public-synthetic-password",
            "123456",
        ),
        AuthRequest::sign_out("public-synthetic-token"),
        AuthRequest::user_info("public-synthetic-token"),
        AuthRequest::list_vaults("public-synthetic-token"),
    ];
    let posts = fixture
        .transcript
        .accounts
        .iter()
        .filter(|request| request.get("method") == Some(&json!("POST")));
    for (request, expected) in requests.iter().zip(posts) {
        assert_eq!(json!(request.url()), expected["url"]);
        assert_eq!(json!(request.headers()), expected["headers"]);
        assert_eq!(
            serde_json::from_str::<Value>(request.body())?,
            expected["body"]
        );
        assert!(!format!("{request:?}").contains("public-synthetic"));
    }
    assert!(requests.first().ok_or("No sign-in")?.requires_preflight());
    Ok(())
}

#[test]
fn authentication_challenges_and_managed_shared_vaults_are_typed() -> TestResult {
    let sign_in = AuthRequest::sign_in("synthetic@example.test", "public-password", "");
    assert!(matches!(
        sign_in.decode_response(200, r#"{"error":"Please enter your 2FA code"}"#)?,
        AuthResponse::MfaRequired
    ));
    assert!(matches!(
        sign_in.decode_response(200, r#"{"error":"2FA code is incorrect"}"#)?,
        AuthResponse::MfaRejected
    ));
    assert_eq!(
        sign_in.decode_response(401, "private peer text").err(),
        Some(SyncError::Http(401))
    );
    assert_eq!(
        sign_in
            .decode_response(200, r#"{"error":"Private credential details"}"#)
            .err(),
        Some(SyncError::AccountRejected)
    );
    let signed = sign_in.decode_response(
        200,
        r#"{"token":"public-session-token","name":"Synthetic","email":"synthetic@example.test"}"#,
    )?;
    assert!(!format!("{signed:?}").contains("public-session-token"));
    match signed {
        AuthResponse::SignedIn(account) => assert_eq!(account.token(), "public-session-token"),
        _ => return Err("Wrong response".into()),
    }
    let list=AuthRequest::list_vaults("public-token").decode_response(200,&json!({"vaults":[],"shared":[{"id":"shared-id","name":"Shared","host":"sync-test.obsidian.md","region":"synthetic-region","salt":"synthetic-salt","encryption_version":3,"password":"public-managed-password","future_permissions":{"write":false}}]}).to_string())?;
    match list {
        AuthResponse::Vaults(list) => {
            let vault = list.shared.first().ok_or("Missing shared vault")?;
            assert!(vault.is_managed());
            assert_eq!(vault.cipher(None)?.version(), 3);
            assert_eq!(
                vault.metadata.get("future_permissions"),
                Some(&json!({"write":false}))
            );
            assert!(!format!("{list:?}").contains("public-managed-password"));
        }
        _ => return Err("Wrong vault response".into()),
    }
    Ok(())
}

#[test]
fn selection_matches_official_filter_and_folder_boundaries() -> TestResult {
    let fixture = fixture()?;
    let filter = SyncFilter {
        excluded_folders: BTreeSet::from(["Private".into()]),
        ..SyncFilter::default()
    };
    for case in fixture.transcript.filters {
        assert_eq!(
            filter.allows(&case.path, case.folder),
            case.allowed,
            "{}",
            case.path
        );
    }
    let audio = SyncFilter {
        attachment_categories: BTreeSet::from([AttachmentCategory::Audio]),
        ..SyncFilter::default()
    };
    assert!(audio.allows("Clip.webm", false));
    assert!(!audio.allows("Photo.jpg", false));
    assert!(audio.allows("Notes/A.MD", false));
    Ok(())
}

#[test]
fn service_destination_and_paths_reject_traversal_and_lookalikes() -> TestResult {
    assert_eq!(
        server_url("sync-test.obsidian.md")?,
        "wss://sync-test.obsidian.md"
    );
    for host in [
        "obsidian.md",
        "evilobsidian.md",
        "sync.obsidian.md.evil.test",
        "sync.obsidian.md:443",
        "user@sync.obsidian.md",
        "sync.obsidian.md/path",
        "sync..obsidian.md",
        "127.0.0.1",
    ] {
        assert_eq!(server_url(host).err(), Some(SyncError::Host));
    }
    for path in [
        "/escape.md",
        "A/../escape.md",
        "A//B.md",
        "C:/escape.md",
        "A\\B.md",
        "A/./B.md",
        "A/\0B.md",
    ] {
        assert!(!SyncFilter::default().allows(path, false));
    }
    Ok(())
}

fn push_notice(case: &Case, uid: u64, path: &str, deleted: bool) -> Result<String, Box<dyn Error>> {
    Ok(json!({"op":"push","uid":uid,"path":cipher(case)?.encode_string(path)?,"hash":"","size":0,"ctime":1000,"mtime":2000,"folder":false,"deleted":deleted}).to_string())
}

#[test]
fn notices_are_durable_before_delivery_and_replay_after_crash() -> TestResult {
    let fixture = fixture()?;
    let case = fixture
        .transcript
        .cases
        .first()
        .ok_or("No reference case")?;
    let mut session = session(case, Checkpoint::default())?;
    connected(&mut session)?;
    let changes = session.handle(Input::Text(push_notice(case, 6, "Tasks/A.md", false)?), 10)?;
    assert!(
        !changes
            .iter()
            .any(|effect| matches!(effect, Effect::RemoteChange(_)))
    );
    assert!(
        changes
            .iter()
            .any(|effect| matches!(effect, Effect::PersistCheckpointDelta { .. }))
    );
    let durable = session.checkpoint().clone();
    let delivered = persist(&mut session, &changes, 11)?;
    assert!(delivered.iter().any(|effect| matches!(effect,Effect::RemoteChange(file) if file.uid==6 && file.path=="Tasks/A.md")));
    let mut restored = super_session(case, durable)?;
    assert!(
        restored
            .begin(12)?
            .iter()
            .any(|effect| matches!(effect,Effect::RemoteChange(file) if file.uid==6))
    );
    let completed = restored.complete_remote(6)?;
    assert!(completed.iter().any(|effect| matches!(effect,Effect::PersistCheckpointDelta {delta,..} if delta.pending_remove==Some(6) && delta.cursor==6)));
    assert_eq!(
        restored.complete_remote(6).err(),
        Some(SyncError::SessionState)
    );
    Ok(())
}

fn super_session(case: &Case, checkpoint: Checkpoint) -> obsidian_sync::Result<Session> {
    session(case, checkpoint)
}

#[test]
fn initial_tombstone_advances_checkpoint_without_deleting_replica() -> TestResult {
    let fixture = fixture()?;
    let case = fixture
        .transcript
        .cases
        .first()
        .ok_or("No reference case")?;
    let mut session = session(case, Checkpoint::default())?;
    session.begin(0)?;
    session.handle(Input::Opened, 1)?;
    session.handle(Input::Text(r#"{"res":"ok"}"#.into()), 2)?;
    let effects = session.handle(Input::Text(push_notice(case, 1, "Tasks/Old.md", true)?), 3)?;
    let delivered = persist(&mut session, &effects, 4)?;
    assert!(
        !delivered
            .iter()
            .any(|effect| matches!(effect, Effect::RemoteChange(_)))
    );
    assert_eq!(session.checkpoint().cursor, 1);
    assert!(session.checkpoint().pending.is_empty());
    assert!(session.checkpoint().initial);
    Ok(())
}

#[test]
fn remote_rename_decrypts_both_paths_and_preserves_tombstone() -> TestResult {
    let fixture = fixture()?;
    let case = fixture.transcript.cases.first().ok_or("No case")?;
    let mut session = session(case, Checkpoint::default())?;
    connected(&mut session)?;
    let cipher = cipher(case)?;
    let notice = json!({"op":"push","uid":6,"path":cipher.encode_string("Tasks/New.md")?,"relatedpath":cipher.encode_string("Tasks/Old.md")?,"folder":false,"deleted":false,"hash":""});
    let barrier = session.handle(Input::Text(notice.to_string()), 10)?;
    let effects = persist(&mut session, &barrier, 11)?;
    assert!(effects.iter().any(|effect| matches!(effect,Effect::RemoteChange(file) if file.related_path.as_deref()==Some("Tasks/Old.md"))));
    Ok(())
}

#[test]
fn disconnect_retries_exact_immutable_upload_and_cancel_returns_receipt() -> TestResult {
    let fixture = fixture()?;
    let case = fixture.transcript.cases.first().ok_or("No case")?;
    let mut session = session(case, Checkpoint::default())?;
    connected(&mut session)?;
    let first = session.queue_upload(
        upload("Tasks/A.md", None, false, Some(vec![1, 2, 3])),
        [0; 12],
        10,
    )?;
    let failure = session.handle(Input::Disconnected, 11)?;
    assert!(failure.iter().any(|effect| matches!(effect,Effect::Failed {retryable:true,operation_id:Some(id),..} if id=="Tasks/A.md")));
    assert!(session.handle(Input::Tick, 5010)?.is_empty());
    assert!(
        session
            .handle(Input::Tick, 5011)?
            .iter()
            .any(|effect| matches!(effect, Effect::Connect { .. }))
    );
    session.handle(Input::Opened, 5012)?;
    session.handle(Input::Text(r#"{"res":"ok"}"#.into()), 5013)?;
    let barrier = session.handle(Input::Text(r#"{"op":"ready","version":5}"#.into()), 5014)?;
    let retry = persist(&mut session, &barrier, 5015)?;
    assert_eq!(frames(&first)?, frames(&retry)?);
    let cancelled = session.handle(Input::Cancel, 5016)?;
    assert!(cancelled.iter().any(
        |effect| matches!(effect,Effect::Cancelled {operation_id} if operation_id=="Tasks/A.md")
    ));
    assert!(session.handle(Input::Tick, 999_999)?.is_empty());
    Ok(())
}

#[test]
fn oversized_malformed_or_unauthenticated_downloads_never_expose_plaintext() -> TestResult {
    let fixture = fixture()?;
    let case = fixture.transcript.cases.first().ok_or("No case")?;
    for reply in [
        json!({"size":999_999_999,"pieces":1}),
        json!({"size":20,"pieces":0}),
        json!({"size":1,"pieces":2}),
    ] {
        let mut session = session(case, Checkpoint::default())?;
        connected(&mut session)?;
        session.queue_download(6, 10)?;
        let effects = session.handle(Input::Text(reply.to_string()), 11)?;
        assert!(effects.iter().any(|effect| matches!(
            effect,
            Effect::Failed {
                retryable: false,
                ..
            }
        )));
        assert!(
            !effects
                .iter()
                .any(|effect| matches!(effect, Effect::Downloaded(_)))
        );
    }
    let mut session = session(case, Checkpoint::default())?;
    connected(&mut session)?;
    session.queue_download(6, 10)?;
    session.handle(Input::Text(json!({"size":28,"pieces":1}).to_string()), 11)?;
    let failure = session.handle(Input::Binary(vec![0; 28]), 12)?;
    assert!(failure.iter().any(|effect| matches!(
        effect,
        Effect::Failed {
            error: SyncError::Authentication,
            ..
        }
    )));
    Ok(())
}

#[test]
fn large_upload_is_split_and_each_piece_requires_acknowledgement() -> TestResult {
    let fixture = fixture()?;
    let case = fixture.transcript.cases.first().ok_or("No case")?;
    let mut session = session(case, Checkpoint::default())?;
    connected(&mut session)?;
    let header = session.queue_upload(
        upload(
            "Attachments/Large.bin",
            None,
            false,
            Some(vec![7; obsidian_sync::session::PIECE_BYTES + 100]),
        ),
        [0; 12],
        10,
    )?;
    let json = frames(&header)?;
    assert_eq!(
        json.first()
            .and_then(|frame| frame.get("text"))
            .and_then(|text| text.get("pieces")),
        Some(&json!(2))
    );
    let first = session.handle(Input::Text(r#"{"res":"upload"}"#.into()), 11)?;
    assert!(
        matches!(first.first(),Some(Effect::SendBinary(frame)) if frame.bytes().len()==obsidian_sync::session::PIECE_BYTES)
    );
    assert!(
        !first
            .iter()
            .any(|effect| matches!(effect, Effect::Uploaded { .. }))
    );
    let second = session.handle(Input::Text(r#"{"res":"ok"}"#.into()), 12)?;
    assert!(matches!(second.first(),Some(Effect::SendBinary(frame)) if frame.bytes().len()==128));
    let complete = session.handle(Input::Text(r#"{"res":"ok"}"#.into()), 13)?;
    assert!(complete.iter().any(|effect| matches!(effect,Effect::Uploaded {operation_id,..} if operation_id=="Attachments/Large.bin")));
    Ok(())
}

#[test]
fn text_frame_bound_accepts_exact_limit_and_rejects_larger_before_parse() -> TestResult {
    let fixture = fixture()?;
    let case = fixture.transcript.cases.first().ok_or("No case")?;
    let mut session = session(case, Checkpoint::default())?;
    connected(&mut session)?;
    let mut exact = r#"{"op":"pong"}"#.to_owned();
    exact.extend(std::iter::repeat_n(
        ' ',
        obsidian_sync::session::TEXT_MESSAGE_BYTES - exact.len(),
    ));
    let accepted = session.handle(Input::Text(exact), 10)?;
    assert!(
        !accepted
            .iter()
            .any(|effect| matches!(effect, Effect::Failed { .. }))
    );
    let oversized = " ".repeat(obsidian_sync::session::TEXT_MESSAGE_BYTES + 1);
    let rejected = session.handle(Input::Text(oversized), 11)?;
    assert!(rejected.iter().any(|effect| matches!(
        effect,
        Effect::Failed {
            error: SyncError::Protocol,
            retryable: false,
            ..
        }
    )));
    assert!(
        rejected
            .iter()
            .any(|effect| matches!(effect, Effect::Close))
    );
    assert!(
        !rejected
            .iter()
            .any(|effect| matches!(effect, Effect::Downloaded(_)))
    );
    Ok(())
}

#[test]
fn expired_session_bad_checkpoint_and_stale_persistence_fail_loudly() -> TestResult {
    let fixture = fixture()?;
    let case = fixture.transcript.cases.first().ok_or("No case")?;
    assert!(
        session(
            case,
            Checkpoint {
                schema_version: 2,
                ..Checkpoint::default()
            }
        )
        .is_err()
    );
    let mut session = session(case, Checkpoint::default())?;
    session.begin(0)?;
    session.handle(Input::Opened, 1)?;
    let failure = session.handle(
        Input::Text(r#"{"res":"err","msg":"Vault not found"}"#.into()),
        2,
    )?;
    assert!(failure.iter().any(|effect| matches!(
        effect,
        Effect::Failed {
            error: SyncError::AccountRejected,
            retryable: false,
            ..
        }
    )));
    assert_eq!(
        session.handle(Input::CheckpointPersisted(10), 3).err(),
        Some(SyncError::SessionState)
    );
    let list: VaultList = serde_json::from_str(r#"{"vaults":[],"shared":[]}"#)?;
    assert!(list.vaults.is_empty());
    Ok(())
}

#[test]
fn aggregate_upload_budget_rejects_before_encryption_and_releases_after_ack() -> TestResult {
    let fixture = fixture()?;
    let case = fixture.transcript.cases.first().ok_or("No case")?;
    let mut config = SessionConfig::new(
        "sync-test.obsidian.md",
        "public-synthetic-token",
        "synthetic-vault",
        "Synthetic Device",
    )?;
    config.queued_byte_limit = 5000;
    let mut session = Session::new(config, cipher(case)?, Checkpoint::default())?;
    connected(&mut session)?;
    session.queue_upload(
        upload("A.md", None, false, Some(vec![0; 2000])),
        [0; 12],
        10,
    )?;
    assert_eq!(
        session
            .queue_upload(
                upload("B.md", None, false, Some(vec![0; 2000])),
                [1; 12],
                11
            )
            .err(),
        Some(SyncError::QueueFull)
    );
    session.handle(Input::Text(r#"{"res":"upload"}"#.into()), 12)?;
    session.handle(Input::Text(r#"{"res":"ok"}"#.into()), 13)?;
    assert!(
        session
            .queue_upload(
                upload("B.md", None, false, Some(vec![0; 2000])),
                [1; 12],
                14
            )
            .is_ok()
    );
    session.handle(Input::Cancel, 15)?;
    assert!(
        session
            .queue_upload(
                upload("C.md", None, false, Some(vec![0; 2000])),
                [2; 12],
                16
            )
            .is_ok()
    );
    Ok(())
}

#[test]
fn owned_admission_checks_size_capacity_hash_and_releases_exact_queue_reservation() -> TestResult {
    let fixture = fixture()?;
    let case = fixture.transcript.cases.first().ok_or("No case")?;
    let mut config = SessionConfig::new(
        "sync-test.obsidian.md",
        "public-synthetic-token",
        "synthetic-vault",
        "Synthetic Device",
    )?;
    config.queued_byte_limit = 5000;
    let mut session = Session::new(config, cipher(case)?, Checkpoint::default())?;
    connected(&mut session)?;
    let a = upload("A.md", None, false, Some(vec![9; 2000]));
    let mut invalid = metadata_for(&a)?;
    invalid.size = obsidian_sync::session::DEFAULT_FILE_LIMIT + 1;
    assert_eq!(
        session.admit_upload(&invalid).err(),
        Some(SyncError::FileTooLarge)
    );
    let mut frame = ContentFrame::new(2000, [0; 12])?;
    frame.content_mut()?.fill(8);
    assert_eq!(
        session
            .queue_content_frame(metadata_for(&a)?, Some(frame), 4)
            .err(),
        Some(SyncError::Authentication)
    );
    // Authentication failure never consumes an operation ID or queue budget.
    queue_owned(&mut session, a, [0; 12], 5)?;
    let b = upload("B.md", None, false, Some(vec![7; 2000]));
    assert_eq!(
        session.admit_upload(&metadata_for(&b)?).err(),
        Some(SyncError::QueueFull)
    );
    session.handle(Input::Text(r#"{"res":"upload"}"#.into()), 6)?;
    session.handle(Input::Text(r#"{"res":"ok"}"#.into()), 7)?;
    session.admit_upload(&metadata_for(&b)?)?;
    queue_owned(&mut session, b, [1; 12], 8)?;
    session.handle(Input::Cancel, 9)?;
    queue_owned(
        &mut session,
        upload("C.md", None, false, Some(vec![6; 2000])),
        [2; 12],
        10,
    )?;
    Ok(())
}

#[test]
fn negotiated_plaintext_limit_allows_exact_boundary_and_empty_wire_special_case() -> TestResult {
    let fixture = fixture()?;
    let case = fixture.transcript.cases.first().ok_or("No case")?;
    let mut session = session(case, Checkpoint::default())?;
    session.begin(0)?;
    session.handle(Input::Opened, 1)?;
    session.handle(Input::Text(r#"{"res":"ok","perFileMax":3}"#.into()), 2)?;
    let barrier = session.handle(Input::Text(r#"{"op":"ready","version":0}"#.into()), 3)?;
    persist(&mut session, &barrier, 4)?;
    let header =
        session.queue_upload(upload("A.md", None, false, Some(vec![1, 2, 3])), [0; 12], 5)?;
    assert_eq!(
        frames(&header)?
            .first()
            .and_then(|frame| frame.get("text"))
            .and_then(|text| text.get("size")),
        Some(&json!(31))
    );
    assert_eq!(
        session
            .queue_upload(
                upload("B.md", None, false, Some(vec![1, 2, 3, 4])),
                [0; 12],
                6
            )
            .err(),
        Some(SyncError::FileTooLarge)
    );
    Ok(())
}

#[test]
fn initial_stream_persists_linear_bytes_and_crash_replays_atomic_delta_rows() -> TestResult {
    const COUNT: u64 = 10_000;
    let fixture = fixture()?;
    let case = fixture.transcript.cases.first().ok_or("No case")?;
    let mut session = session(case, Checkpoint::default())?;
    connected(&mut session)?;
    let mut durable = session.checkpoint().clone();
    let cipher = cipher(case)?;
    let mut persisted_bytes = 0;
    let mut delivered_count = 0;
    for offset in 0..COUNT {
        let uid = 6 + offset;
        let notice = json!({"op":"push","uid":uid,"path":cipher.encode_string(&format!("Tasks/{offset}.md"))?,"hash":"","size":0,"folder":false,"deleted":false});
        let effects = session.handle(Input::Text(notice.to_string()), 10 + offset)?;
        for effect in effects {
            let Effect::PersistCheckpointDelta { revision, delta } = effect else {
                return Err("Full snapshot appeared in hot path".into());
            };
            persisted_bytes += serde_json::to_vec(&delta)?.len();
            durable.apply_delta(&delta)?;
            delivered_count += session
                .handle(Input::CheckpointPersisted(revision), 10 + offset)?
                .iter()
                .filter(|effect| matches!(effect, Effect::RemoteChange(_)))
                .count();
        }
    }
    assert_eq!(durable, *session.checkpoint());
    assert_eq!(delivered_count, usize::try_from(COUNT)?);
    assert!(
        persisted_bytes < usize::try_from(COUNT)? * 1024,
        "Delta bytes: {persisted_bytes}"
    );
    let mut restored = super_session(case, durable.clone())?;
    assert_eq!(
        restored
            .begin(20_000)?
            .iter()
            .filter(|effect| matches!(effect, Effect::RemoteChange(_)))
            .count(),
        usize::try_from(COUNT)?
    );
    for effect in restored.complete_remote(6)? {
        let Effect::PersistCheckpointDelta { delta, .. } = effect else {
            return Err("Missing removal delta".into());
        };
        durable.apply_delta(&delta)?;
    }
    // Commit happened before the host could acknowledge it; a second crash
    // still reconstructs exactly the remaining unapplied rows.
    let mut second = super_session(case, durable)?;
    let replay = second.begin(20_001)?;
    assert_eq!(
        replay
            .iter()
            .filter(|effect| matches!(effect, Effect::RemoteChange(_)))
            .count(),
        usize::try_from(COUNT - 1)?
    );
    assert!(
        !replay
            .iter()
            .any(|effect| matches!(effect,Effect::RemoteChange(file) if file.uid==6))
    );
    Ok(())
}

#[test]
fn remote_pending_work_blocks_upload_until_application_and_same_path_invalidates_snapshot()
-> TestResult {
    let fixture = fixture()?;
    let case = fixture.transcript.cases.first().ok_or("No case")?;
    let mut session = session(case, Checkpoint::default())?;
    connected(&mut session)?;
    let barrier = session.handle(Input::Text(push_notice(case, 6, "Remote/A.md", false)?), 10)?;
    persist(&mut session, &barrier, 11)?;
    assert!(
        session
            .queue_upload(
                upload("Local/B.md", None, false, Some(vec![1])),
                [0; 12],
                12
            )?
            .is_empty()
    );
    // A pending download bypasses the blocked upload at the queue head.
    let pull = session.queue_download(6, 13)?;
    assert!(
        pull.iter()
            .any(|effect| matches!(effect, Effect::Cancelled { .. }))
    );
    assert_eq!(
        frames(&pull)?
            .first()
            .and_then(|frame| frame.get("text"))
            .and_then(|text| text.get("op")),
        Some(&json!("pull"))
    );
    assert!(session.queue_download(6, 13)?.is_empty());
    session.handle(
        Input::Text(r#"{"deleted":false,"size":0,"pieces":0}"#.into()),
        14,
    )?;
    session.release_download(6)?;
    let applied = session.complete_remote(6)?;
    assert_eq!(
        frames(&persist(&mut session, &applied, 15)?)?,
        Vec::<Value>::new()
    );
    let sent = session.queue_upload(
        upload("Local/B.md", None, false, Some(vec![1])),
        [0; 12],
        15,
    )?;
    assert_eq!(
        frames(&sent)?
            .first()
            .and_then(|frame| frame.get("text"))
            .and_then(|text| text.get("op")),
        Some(&json!("push"))
    );
    let changed = session.handle(Input::Text(push_notice(case, 7, "Local/B.md", false)?), 16)?;
    assert!(changed.iter().any(|effect| matches!(effect, Effect::Close)));
    assert!(changed.iter().any(
        |effect| matches!(effect,Effect::Cancelled {operation_id} if operation_id=="Local/B.md")
    ));
    assert!(
        !changed
            .iter()
            .any(|effect| matches!(effect, Effect::Uploaded { .. }))
    );
    Ok(())
}
