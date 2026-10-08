//! Isolated full-size protocol allocation evidence, excluding the synthetic
//! peer's source wire buffer. Native queues/provider allocators remain separate.

use std::{alloc::System, error::Error};

use obsidian_sync::{
    crypto::{EncryptionVersion, VaultCipher, VaultKey},
    session::{
        Checkpoint, DEFAULT_FILE_LIMIT, Effect, Input, PIECE_BYTES, Session, SessionConfig, Upload,
    },
};
use serde_json::json;
use stats_alloc::{INSTRUMENTED_SYSTEM, Region, StatsAlloc};
use tasknotes_vault::document::ContentRevision;

#[global_allocator]
static GLOBAL: &StatsAlloc<System> = &INSTRUMENTED_SYSTEM;
type TestResult<T = ()> = Result<T, Box<dyn Error>>;

fn live_bytes() -> usize {
    let stats = GLOBAL.stats();
    stats
        .bytes_allocated
        .saturating_sub(stats.bytes_deallocated)
}

fn persist(session: &mut Session, effects: &[Effect], now: u64) -> TestResult {
    for effect in effects {
        if let Effect::PersistCheckpointDelta { revision, delta } = effect {
            delta.validate()?;
            session.handle(Input::CheckpointPersisted(*revision), now)?;
        }
    }
    Ok(())
}

fn ready(cipher: VaultCipher) -> TestResult<Session> {
    let mut session = Session::new(
        SessionConfig::new(
            "sync-test.obsidian.md",
            "synthetic-memory-token",
            "synthetic-memory-vault",
            "Memory acceptance",
        )?,
        cipher,
        Checkpoint::default(),
    )?;
    session.begin(0)?;
    session.handle(Input::Opened, 1)?;
    session.handle(Input::Text(r#"{"res":"ok"}"#.into()), 2)?;
    let effects = session.handle(Input::Text(r#"{"op":"ready","version":0}"#.into()), 3)?;
    persist(&mut session, &effects, 4)?;
    Ok(session)
}

fn upload_all(session: &mut Session, size: usize) -> TestResult {
    let plaintext = vec![0xa5; size];
    let region = Region::new(GLOBAL);
    let effects = session.queue_upload(
        Upload {
            operation_id: "immutable-memory-receipt".to_owned(),
            path: "Attachments/199MiB.bin".to_owned(),
            related_path: None,
            folder: false,
            ctime: 1000,
            mtime: 2000,
            bytes: Some(plaintext),
        },
        [4; 12],
        10,
    )?;
    let queue_allocations = region.change().bytes_allocated;
    assert!(queue_allocations < size + 128 * 1024);
    assert!(
        effects
            .iter()
            .any(|effect| matches!(effect, Effect::SendText(_)))
    );
    drop(effects);
    let queued = live_bytes();
    let mut effects = session.handle(Input::Text(r#"{"res":"upload"}"#.into()), 11)?;
    let mut sent = 0;
    let mut sampled_extra = 0;
    loop {
        sampled_extra = sampled_extra.max(live_bytes().saturating_sub(queued));
        for effect in &effects {
            if let Effect::SendBinary(frame) = effect {
                assert!(frame.bytes().len() <= PIECE_BYTES);
                sent += frame.bytes().len();
            }
        }
        if effects
            .iter()
            .any(|effect| matches!(effect, Effect::Uploaded { .. }))
        {
            break;
        }
        drop(effects);
        effects = session.handle(Input::Text(r#"{"res":"ok"}"#.into()), 12)?;
    }
    assert_eq!(sent, size + 28);
    assert!(sampled_extra <= PIECE_BYTES + 128 * 1024);
    eprintln!(
        "199 MiB upload queue allocations={queue_allocations}; sampled piece overhead={sampled_extra}"
    );
    Ok(())
}

fn download_all(session: &mut Session, cipher: &VaultCipher, size: usize) -> TestResult {
    let plaintext = vec![0xa5; size];
    let hash = ContentRevision::of(&plaintext).as_str().to_owned();
    let wire = cipher.encrypt_content(&plaintext, [5; 12])?;
    drop(plaintext);
    let notice = json!({
        "op":"push","uid":1,"path":cipher.encode_string("Attachments/199MiB.bin")?,
        "hash":cipher.encode_string(&hash)?,"size":size,"ctime":1000,"mtime":2000,
        "folder":false,"deleted":false
    });
    let effects = session.handle(Input::Text(notice.to_string()), 20)?;
    persist(session, &effects, 21)?;
    session.queue_download(1, 22)?;
    let baseline = live_bytes();
    let region = Region::new(GLOBAL);
    let effects = session.handle(
        Input::Text(
            json!({"size":wire.len(),"pieces":wire.len().div_ceil(PIECE_BYTES)}).to_string(),
        ),
        23,
    )?;
    assert!(effects.is_empty());
    let header_allocations = region.change().bytes_allocated;
    assert!(header_allocations >= wire.len());
    assert!(header_allocations < wire.len() + 128 * 1024);
    let mut peak = live_bytes().saturating_sub(baseline);
    let mut received = 0;
    for piece in wire.chunks(PIECE_BYTES) {
        let input = piece.to_vec();
        peak = peak.max(live_bytes().saturating_sub(baseline));
        let region = Region::new(GLOBAL);
        let effects = session.handle(Input::Binary(input), 24)?;
        assert!(region.change().bytes_allocated < 128 * 1024);
        peak = peak.max(live_bytes().saturating_sub(baseline));
        for effect in effects {
            if let Effect::Downloaded(download) = effect {
                assert_eq!(download.content_hash.as_deref(), Some(hash.as_str()));
                let bytes = download.bytes.ok_or("Missing authenticated plaintext")?;
                assert_eq!(bytes.len(), size);
                assert_eq!(bytes.capacity(), wire.len());
                assert!(bytes.iter().all(|byte| *byte == 0xa5));
                received += 1;
            }
        }
    }
    assert_eq!(received, 1);
    assert!(peak <= wire.len() + PIECE_BYTES + 128 * 1024);
    eprintln!(
        "199 MiB download accumulator allocation={header_allocations}; sampled Rust payload peak={peak}"
    );
    Ok(())
}

#[test]
fn maximum_file_upload_and_authenticated_download_keep_exact_frames_and_one_piece() -> TestResult {
    let key = VaultKey::from_bytes(&[1; 32])?;
    let cipher = VaultCipher::new(EncryptionVersion::V3, &key, "synthetic-memory-vault")?;
    let mut session = ready(VaultCipher::new(
        EncryptionVersion::V3,
        &key,
        "synthetic-memory-vault",
    )?)?;
    let size = usize::try_from(DEFAULT_FILE_LIMIT)?;
    upload_all(&mut session, size)?;
    download_all(&mut session, &cipher, size)?;
    Ok(())
}
