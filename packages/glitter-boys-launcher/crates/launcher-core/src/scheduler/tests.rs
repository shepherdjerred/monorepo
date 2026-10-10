use super::*;
use std::io::Write;

#[test]
fn restart_and_clear_distinguish_saved_installations_from_new_games() -> Result<()> {
    let (_temp, mut engine) = fixture()?;
    let scheduler = Scheduler::start(
        engine.catalog.clone(),
        engine.data.clone(),
        engine.settings.clone(),
    )?;
    let snapshot = scheduler.snapshot()?;
    assert!(snapshot.games[index(Game::T5)].queued);
    assert!(!snapshot.games[index(Game::T7)].queued);
    assert_eq!(snapshot.games[index(Game::T5)].phase, Phase::Paused);
    drop(scheduler);
    engine.status(
        Game::T5,
        Phase::Failed,
        Some(Problem::new("Fixture", "Try again", "fixture")),
    );
    engine.command(Command::Clear)?;
    engine.refresh_progress(Instant::now())?;
    let s = engine
        .shared
        .lock()
        .map_err(|_| Error::Invalid("Test snapshot poisoned".into()))?;
    assert!(!s.games[index(Game::T5)].queued);
    assert!(s.games[index(Game::T5)].error.is_none());
    assert_eq!(s.games[index(Game::T5)].phase, Phase::Paused);
    Ok(())
}

#[test]
fn client_handoff_is_visible_and_launch_failure_has_recovery_guidance() -> Result<()> {
    let (_temp, mut engine) = fixture()?;
    for (id, result) in [
        (0, Ok(Output::Finished)),
        (
            1,
            Err(Error::ActionRequired {
                title: "Windows needs a restart",
                next_step: "Restart Windows, then play again.",
            }),
        ),
    ] {
        engine.status(Game::T5, Phase::Launching, None);
        engine.running.insert(
            id,
            Running {
                key: Key::Play(Game::T5),
                cancel: Cancellation::default(),
                started: Instant::now(),
                bytes: 0,
                meter: Arc::new(Mutex::new(Meter::default())),
            },
        );
        engine
            .tx
            .send(Completion { id, result })
            .map_err(|e| Error::Invalid(e.to_string()))?;
        engine.receive();
        let s = engine
            .shared
            .lock()
            .map_err(|_| Error::Invalid("Test snapshot poisoned".into()))?;
        let g = &s.games[index(Game::T5)];
        assert_eq!(g.phase, Phase::Ready);
        assert_eq!(g.handoff, id == 0);
        if id == 1 {
            assert_eq!(
                g.error.as_ref().map(|e| e.title),
                Some("Windows needs a restart")
            );
        }
    }
    Ok(())
}

#[test]
fn parallel_parts_combine_bytes_and_speed_without_counting_hashing_as_download() -> Result<()> {
    let (_temp, mut engine) = fixture()?;
    engine.enabled[3] = true;
    engine.status(Game::T7, Phase::Downloading, None);
    let now = Instant::now();
    let artifacts = engine.artifacts(Game::T7)?;
    for (id, a) in artifacts.iter().take(2).enumerate() {
        let mut meter = Meter::default();
        let completed = 1_000 + id as u64 * 100;
        meter.update(
            Progress {
                phase: "Downloading",
                completed,
                total: a.bytes,
            },
            now - Duration::from_secs(2),
        );
        meter.update(
            Progress {
                phase: "Downloading",
                completed: completed + (id as u64 + 1) * 200,
                total: a.bytes,
            },
            now,
        );
        engine.running.insert(
            id as u64,
            Running {
                key: Key::Download(a.sha256.clone()),
                cancel: Cancellation::default(),
                started: now,
                bytes: a.bytes,
                meter: Arc::new(Mutex::new(meter)),
            },
        );
    }
    engine.refresh_progress(now)?;
    {
        let s = engine
            .shared
            .lock()
            .map_err(|_| Error::Invalid("Test snapshot poisoned".into()))?;
        let g = &s.games[3];
        assert_eq!(g.progress.phase, "Downloading (2 files)");
        assert_eq!(g.progress.completed, 2_700);
        assert_eq!(
            g.progress.total,
            artifacts.iter().map(|a| a.bytes).sum::<u64>()
        );
        assert_eq!(g.timing.bytes_per_second, Some(300.0));
        assert_eq!(
            g.timing.remaining,
            timing::eta(g.progress.total - 2_700, Some(300.0))
        );
        assert!(s.games[0].timing.bytes_per_second.is_none());
    }
    engine.running[&0]
        .meter
        .lock()
        .map_err(|_| Error::Invalid("Test meter poisoned".into()))?
        .update(
            Progress {
                phase: "Checking download",
                completed: 600,
                total: artifacts[0].bytes,
            },
            now,
        );
    engine.refresh_progress(now)?;
    {
        let s = engine
            .shared
            .lock()
            .map_err(|_| Error::Invalid("Test snapshot poisoned".into()))?;
        let g = &s.games[3];
        assert_eq!(g.timing.bytes_per_second, Some(200.0));
        assert_eq!(g.progress.completed, artifacts[0].bytes + 1_500);
    }
    engine.command(Command::Pause(Game::T7))?;
    engine.refresh_progress(now + Duration::from_secs(10))?;
    let s = engine
        .shared
        .lock()
        .map_err(|_| Error::Invalid("Test snapshot poisoned".into()))?;
    assert!(s.games[3].timing.remaining.is_none());
    assert!(s.games[3].timing.bytes_per_second.is_none());
    assert_eq!(s.games[3].phase, Phase::Paused);
    Ok(())
}

#[test]
fn stage_transition_clears_progress_and_waiting_does_not_keep_an_eta() -> Result<()> {
    let (_temp, mut engine) = fixture()?;
    engine.status(Game::T5, Phase::Extracting, None);
    let now = Instant::now();
    let mut meter = Meter::default();
    meter.update(
        Progress {
            phase: "Unpacking (4 workers)",
            completed: 0,
            total: 1_000,
        },
        now - Duration::from_secs(2),
    );
    meter.update(
        Progress {
            phase: "Unpacking (4 workers)",
            completed: 200,
            total: 1_000,
        },
        now,
    );
    engine.running.insert(
        0,
        Running {
            key: Key::Extract(Game::T5),
            cancel: Cancellation::default(),
            started: now,
            bytes: 1_000,
            meter: Arc::new(Mutex::new(meter)),
        },
    );
    engine.refresh_progress(now)?;
    assert_eq!(
        engine
            .shared
            .lock()
            .map_err(|_| Error::Invalid("Test snapshot poisoned".into()))?
            .games[1]
            .timing
            .remaining,
        Some(Duration::from_secs(8))
    );
    engine.running.clear();
    engine.status(Game::T5, Phase::Waiting, None);
    engine.refresh_progress(now)?;
    assert!(
        engine
            .shared
            .lock()
            .map_err(|_| Error::Invalid("Test snapshot poisoned".into()))?
            .games[1]
            .timing
            .remaining
            .is_none()
    );
    engine.status(Game::T5, Phase::Preparing, None);
    engine.refresh_progress(now)?;
    let s = engine
        .shared
        .lock()
        .map_err(|_| Error::Invalid("Test snapshot poisoned".into()))?;
    assert_eq!(s.games[1].progress.phase, "Preparing client");
    assert_eq!(s.games[1].progress.total, 0);
    assert!(s.games[1].timing.bytes_per_second.is_none());
    Ok(())
}
fn fixture() -> Result<(tempfile::TempDir, Engine)> {
    let temp = tempfile::tempdir()?;
    let data = temp.path().join("data");
    let library = temp.path().join("games");
    std::fs::create_dir_all(&data)?;
    std::fs::create_dir_all(&library)?;
    let settings = Settings {
        version: 1,
        library,
        queue: vec![Game::T5, Game::T6],
    };
    let shared = Arc::new(Mutex::new(Snapshot {
        games: Game::ALL.map(|game| GameStatus {
            game,
            phase: Phase::Paused,
            progress: Progress {
                phase: "Paused",
                completed: 0,
                total: 0,
            },
            timing: Timing::default(),
            queued: true,
            pausing: false,
            handoff: false,
            error: None,
        }),
        busy: false,
        queued: 2,
        error: None,
    }));
    Ok((
        temp,
        Engine::new(Catalog::bundled()?, data, settings, shared),
    ))
}
#[test]
fn one_failure_cancels_its_siblings_but_not_another_game() -> Result<()> {
    let (_temp, mut engine) = fixture()?;
    engine.enabled = [false, true, true, false];
    engine.admitted = engine.enabled;
    engine.running.insert(
        1,
        Running {
            key: Key::Extract(Game::T5),
            cancel: Cancellation::default(),
            started: std::time::Instant::now(),
            bytes: 0,
            meter: Arc::new(Mutex::new(Meter::default())),
        },
    );
    let other = Cancellation::default();
    engine.running.insert(
        2,
        Running {
            key: Key::Extract(Game::T6),
            cancel: other.clone(),
            started: std::time::Instant::now(),
            bytes: 0,
            meter: Arc::new(Mutex::new(Meter::default())),
        },
    );
    engine
        .tx
        .send(Completion {
            id: 1,
            result: Err(Error::Invalid("broken fixture".into())),
        })
        .map_err(|e| Error::Invalid(e.to_string()))?;
    engine.receive();
    assert!(!engine.enabled[1]);
    assert!(engine.enabled[2]);
    assert!(other.check().is_ok());
    assert!(engine.settings.queue.contains(&Game::T5));
    Ok(())
}
#[test]
fn pause_keeps_shared_download_needed_by_another_game() -> Result<()> {
    let (_temp, mut engine) = fixture()?;
    engine.enabled = [false, true, true, false];
    let cancel = Cancellation::default();
    engine.running.insert(
        1,
        Running {
            key: Key::Download(engine.catalog.plutonium.sha256.clone()),
            cancel: cancel.clone(),
            started: std::time::Instant::now(),
            bytes: 0,
            meter: Arc::new(Mutex::new(Meter::default())),
        },
    );
    engine.command(Command::Pause(Game::T5))?;
    assert!(cancel.check().is_ok());
    engine.command(Command::Pause(Game::T6))?;
    assert!(cancel.check().is_err());
    Ok(())
}
#[test]
fn resume_waits_for_cancelled_writers_to_stop() -> Result<()> {
    let (_temp, mut engine) = fixture()?;
    let cancel = Cancellation::default();
    cancel.pause();
    engine.running.insert(
        1,
        Running {
            key: Key::Extract(Game::T5),
            cancel,
            started: std::time::Instant::now(),
            bytes: 0,
            meter: Arc::new(Mutex::new(Meter::default())),
        },
    );
    engine.command(Command::Install(Game::T5))?;
    assert!(!engine.enabled[1]);
    engine.command(Command::ResumeAll)?;
    assert!(!engine.enabled[1]);
    assert!(engine.enabled[2]);
    Ok(())
}
#[test]
fn cached_pipeline_extracts_then_promotes_and_saves_queue() -> Result<()> {
    let (_temp, mut engine) = fixture()?;
    engine.settings.queue = vec![Game::T5];
    engine.enabled[1] = true;
    let game = engine
        .catalog
        .games
        .iter_mut()
        .find(|p| p.game == Game::T5)
        .ok_or_else(|| Error::Invalid("Missing test package".into()))?;
    game.expanded_bytes = 3;
    game.required_files = vec!["game.dat".into()];
    let archive = engine.settings.library.join("fixture.zip");
    let mut zip = zip::ZipWriter::new(std::fs::File::create(&archive)?);
    zip.start_file("t5/game.dat", zip::write::SimpleFileOptions::default())?;
    zip.write_all(b"abc")?;
    zip.finish()?;
    engine
        .verified
        .insert(game.archives[0].sha256.clone(), archive);
    let client = engine.settings.library.join("client.exe");
    std::fs::write(&client, b"test client is never executed")?;
    engine
        .verified
        .insert(engine.catalog.plutonium.sha256.clone(), client);
    let deadline = std::time::Instant::now() + Duration::from_secs(5);
    while !engine.settings.queue.is_empty() && std::time::Instant::now() < deadline {
        engine.drive()?;
        engine.receive();
        std::thread::sleep(Duration::from_millis(10));
    }
    assert!(engine.settings.queue.is_empty());
    assert_eq!(
        std::fs::read(engine.settings.library.join("t5/game.dat"))?,
        b"abc"
    );
    assert!(state::installed(
        &engine.settings.library,
        Game::T5,
        &engine.catalog
    )?);
    assert!(Settings::load(&engine.data)?.queue.is_empty());
    Ok(())
}
#[test]
fn download_capacity_counts_shared_artifact_once() -> Result<()> {
    let (_temp, mut engine) = fixture()?;
    engine.enabled = [false, true, true, false];
    for (id, hash) in [
        (1, engine.catalog.plutonium.sha256.clone()),
        (
            2,
            engine.catalog.package(Game::T5)?.archives[0].sha256.clone(),
        ),
    ] {
        engine.running.insert(
            id,
            Running {
                key: Key::Download(hash),
                cancel: Cancellation::default(),
                started: std::time::Instant::now(),
                bytes: 0,
                meter: Arc::new(Mutex::new(Meter::default())),
            },
        );
    }
    engine.drive()?;
    assert_eq!(engine.running.len(), 2);
    assert!(engine.uses(Game::T5, &engine.catalog.plutonium.sha256));
    assert!(engine.uses(Game::T6, &engine.catalog.plutonium.sha256));
    Ok(())
}
