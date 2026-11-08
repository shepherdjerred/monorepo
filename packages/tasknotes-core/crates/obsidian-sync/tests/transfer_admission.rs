//! Aggregate upload/pull/owned-completion admission with captured ciphertext.

use obsidian_sync::{
    SyncError,
    crypto::{ContentFrame, EncryptionVersion, VaultCipher, VaultKey},
    session::{Checkpoint, Effect, Input, Session, SessionConfig, Upload, UploadMetadata},
};
use serde_json::json;
use sha2::{Digest, Sha256};

type Result<T> = std::result::Result<T, Box<dyn std::error::Error>>;

fn session() -> Result<(Session, VaultCipher)> {
    let key = VaultKey::from_bytes(&[0x14; 32])?;
    let cipher = VaultCipher::new(EncryptionVersion::V3, &key, "public-synthetic-salt")?;
    let mut session = Session::new(
        SessionConfig::new(
            "sync-test.obsidian.md",
            "public-token",
            "public-vault",
            "Public Device",
        )?,
        VaultCipher::new(EncryptionVersion::V3, &key, "public-synthetic-salt")?,
        Checkpoint::default(),
    )?;
    session.begin(0)?;
    session.handle(Input::Opened, 1)?;
    session.handle(
        Input::Text(r#"{"res":"ok","perFileMax":208666624}"#.to_owned()),
        2,
    )?;
    let ready = session.handle(Input::Text(r#"{"op":"ready","version":0}"#.to_owned()), 3)?;
    for effect in ready {
        if let Effect::PersistCheckpointDelta { revision, .. } = effect {
            session.handle(Input::CheckpointPersisted(revision), 4)?;
        }
    }
    Ok((session, cipher))
}

fn upload(id: &str) -> Upload {
    Upload {
        operation_id: id.to_owned(),
        path: format!("Attachments/{id}.bin"),
        related_path: None,
        folder: false,
        ctime: 12,
        mtime: 13,
        bytes: Some(vec![0x51; 64]),
    }
}

#[test]
fn owned_completion_blocks_all_next_frames_until_exact_release() -> Result<()> {
    let (mut session, cipher) = session()?;
    session.queue_download(1, 10)?;
    let wire = cipher.encrypt_content(b"authenticated owned image", [0x55; 12])?;
    session.handle(
        Input::Text(json!({"deleted":false,"size":wire.len(),"pieces":1}).to_string()),
        11,
    )?;
    session.queue_download(2, 12)?;
    let completion = session.handle(Input::Binary(wire), 13)?;
    assert_eq!(completion.len(), 1);
    assert!(matches!(completion.first(), Some(Effect::Downloaded(_))));
    assert!(
        session.transfer_memory_bytes() >= u64::try_from(b"authenticated owned image".len() + 28)?
    );
    assert_eq!(
        session.queue_upload(upload("blocked"), [0; 12], 14).err(),
        Some(SyncError::QueueFull)
    );
    assert!(session.handle(Input::Tick, 15)?.is_empty());
    assert_eq!(
        session.release_download(2).err(),
        Some(SyncError::SessionState)
    );
    drop(completion);
    session.release_download(1)?;
    assert_eq!(session.transfer_memory_bytes(), 0);
    let next = session.handle(Input::Tick, 16)?;
    assert!(next.iter().any(
        |effect| matches!(effect,Effect::SendText(frame) if frame.as_str().contains("\"uid\":2"))
    ));
    Ok(())
}

#[test]
fn pulling_returns_unsent_receipt_but_finishes_active_upload_before_allocating() -> Result<()> {
    let (mut session, _) = session()?;
    let first = session.queue_upload(upload("active"), [0; 12], 10)?;
    assert!(
        first
            .iter()
            .any(|effect| matches!(effect, Effect::SendText(_)))
    );
    session.queue_upload(upload("unsent"), [1; 12], 11)?;
    let pull = session.queue_download(1, 12)?;
    assert_eq!(pull.len(), 1);
    assert!(matches!(pull.first(),Some(Effect::Cancelled{operation_id}) if operation_id=="unsent"));
    assert!(session.transfer_memory_bytes() > 0);
    assert_eq!(
        session.queue_upload(upload("more"), [2; 12], 13).err(),
        Some(SyncError::QueueFull)
    );
    session.handle(Input::Text(r#"{"res":"upload"}"#.into()), 14)?;
    let completed = session.handle(Input::Text(r#"{"res":"ok"}"#.into()), 15)?;
    assert!(completed.iter().any(
        |effect| matches!(effect,Effect::Uploaded{operation_id,..} if operation_id=="active")
    ));
    assert!(completed.iter().any(|effect|matches!(effect,Effect::SendText(frame) if frame.as_str().contains("\"op\":\"pull\""))));
    assert_eq!(session.transfer_memory_bytes(), 0);
    Ok(())
}

#[test]
fn near_limit_download_admission_frees_queued_upload_before_frame_reservation() -> Result<()> {
    const SIZE: usize = 208_666_624;
    let (mut session, cipher) = session()?;
    // A durable pending notice prevents upload transmission while admission can
    // still queue its immutable frame. The host retains the original receipt.
    let notice=session.handle(Input::Text(json!({"op":"push","uid":1,"path":cipher.encode_string("Attachments/remote.bin")?,"size":SIZE,"hash":"","ctime":1,"mtime":1,"folder":false,"deleted":false}).to_string()),10)?;
    for effect in notice {
        if let Effect::PersistCheckpointDelta { revision, .. } = effect {
            session.handle(Input::CheckpointPersisted(revision), 11)?;
        }
    }
    let mut frame = ContentFrame::new(SIZE, [0; 12])?;
    frame.content_mut()?.fill(0x21);
    let hash = hex::encode(Sha256::digest(frame.content()?));
    let metadata = UploadMetadata {
        operation_id: "held-immutable-receipt".into(),
        path: "Attachments/local.bin".into(),
        related_path: None,
        ctime: 12,
        mtime: 13,
        folder: false,
        deleted: false,
        size: u64::try_from(SIZE)?,
        content_hash: Some(hash),
    };
    session.queue_content_frame(metadata, Some(frame), 12)?;
    assert!(session.transfer_memory_bytes() >= u64::try_from(SIZE)?);
    let effects = session.queue_download(1, 13)?;
    assert!(effects.iter().any(|effect|matches!(effect,Effect::Cancelled{operation_id} if operation_id=="held-immutable-receipt")));
    assert_eq!(session.transfer_memory_bytes(), 0);
    session.handle(
        Input::Text(json!({"deleted":false,"size":SIZE+28,"pieces":100}).to_string()),
        14,
    )?;
    assert_eq!(session.transfer_memory_bytes(), u64::try_from(SIZE + 28)?);
    assert_eq!(
        session.queue_upload(upload("blocked"), [1; 12], 15).err(),
        Some(SyncError::QueueFull)
    );
    session.handle(Input::Cancel, 16)?;
    assert_eq!(session.transfer_memory_bytes(), 0);
    Ok(())
}
