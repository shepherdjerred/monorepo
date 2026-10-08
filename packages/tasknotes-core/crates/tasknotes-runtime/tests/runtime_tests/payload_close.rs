//! Engine retirement waits for provider callbacks and concurrent close callers.

use super::{Arc, Engine, GatedMemory, ProfileKind, ReadPause, RuntimeError, profile};

fn await_shutdown(engine: Arc<Engine>) -> std::result::Result<(), Box<dyn std::error::Error>> {
    let (entered_tx, entered_rx) = std::sync::mpsc::sync_channel(1);
    let (cancel_tx, cancel_rx) = std::sync::mpsc::channel::<()>();
    let observer = std::thread::spawn(move || {
        loop {
            if engine.is_closed() {
                return entered_tx
                    .send(())
                    .map_err(|_| RuntimeError::Host("test shutdown observer failed".to_owned()));
            }
            match cancel_rx.recv_timeout(std::time::Duration::from_millis(1)) {
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {}
                _ => {
                    return Err(RuntimeError::Host(
                        "test shutdown observation canceled".to_owned(),
                    ));
                }
            }
        }
    });
    let observation = entered_rx.recv_timeout(std::time::Duration::from_secs(5));
    drop(cancel_tx);
    observer
        .join()
        .map_err(|_| RuntimeError::Host("test observer worker failed".to_owned()))??;
    observation?;
    Ok(())
}

#[test]
fn concurrent_close_waits_for_active_callback_and_blocks_new_work()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let files = Arc::new(GatedMemory::default());
    let engine = Arc::new(Engine::open(":memory:", files.clone())?);
    engine.register_profile(profile(ProfileKind::LocalFolder))?;
    let (entered_tx, entered_rx) = std::sync::mpsc::sync_channel(1);
    let (release_tx, release_rx) = std::sync::mpsc::sync_channel(1);
    *files
        .pause
        .lock()
        .map_err(|_| RuntimeError::Host("test gate failed".to_owned()))? = Some(ReadPause {
        path: ".obsidian/plugins/tasknotes/data.json".to_owned(),
        entered: entered_tx,
        release: release_rx,
    });
    let reading = engine.clone();
    let operation = std::thread::spawn(move || reading.refresh("a"));
    entered_rx.recv_timeout(std::time::Duration::from_secs(5))?;
    let (done_tx, done_rx) = std::sync::mpsc::sync_channel(2);
    let closing = engine.clone();
    let first_done = done_tx.clone();
    let first = std::thread::spawn(move || {
        closing.close()?;
        first_done
            .send(())
            .map_err(|_| RuntimeError::Host("test close channel failed".to_owned()))
    });
    await_shutdown(engine.clone())?;
    assert!(matches!(engine.profiles(), Err(RuntimeError::Closed)));
    assert!(matches!(engine.refresh("b"), Err(RuntimeError::Closed)));
    let closing = engine.clone();
    let second = std::thread::spawn(move || {
        closing.close()?;
        done_tx
            .send(())
            .map_err(|_| RuntimeError::Host("test close channel failed".to_owned()))
    });
    assert!(matches!(
        done_rx.recv_timeout(std::time::Duration::from_millis(20)),
        Err(std::sync::mpsc::RecvTimeoutError::Timeout)
    ));
    release_tx.send(())?;
    assert!(matches!(
        operation
            .join()
            .map_err(|_| RuntimeError::Host("test worker failed".to_owned()))?,
        Err(RuntimeError::Closed)
    ));
    first
        .join()
        .map_err(|_| RuntimeError::Host("test close worker failed".to_owned()))??;
    second
        .join()
        .map_err(|_| RuntimeError::Host("test close worker failed".to_owned()))??;
    done_rx.recv_timeout(std::time::Duration::from_secs(5))?;
    done_rx.recv_timeout(std::time::Duration::from_secs(5))?;
    let reads = files
        .inner
        .state
        .lock()
        .map_err(|_| RuntimeError::Host("test memory lock failed".to_owned()))?
        .reads;
    assert!(matches!(engine.refresh("a"), Err(RuntimeError::Closed)));
    assert_eq!(
        files
            .inner
            .state
            .lock()
            .map_err(|_| RuntimeError::Host("test memory lock failed".to_owned()))?
            .reads,
        reads
    );
    Ok(())
}
