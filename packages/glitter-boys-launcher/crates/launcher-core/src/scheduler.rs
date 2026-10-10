//! A bounded background pipeline. The GUI only sends commands and reads snapshots.
#[cfg(test)]
mod tests;
mod timing;
use crate::{
    Cancellation, Error, Progress, Result, archive,
    catalog::{Artifact, Catalog, Game, Mode},
    download, install, launch,
    problem::{Activity, Problem},
    state::{self, Settings},
};
use std::{
    collections::HashMap,
    fs::File,
    path::PathBuf,
    sync::{
        Arc, Mutex,
        mpsc::{self, Receiver, Sender},
    },
    time::{Duration, Instant},
};
pub use timing::Timing;
use timing::{Clock, Meter};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Phase {
    Paused,
    Waiting,
    Downloading,
    Extracting,
    Preparing,
    Ready,
    Failed,
    Launching,
}
#[derive(Clone, Debug)]
pub struct GameStatus {
    pub game: Game,
    pub phase: Phase,
    pub progress: Progress,
    pub timing: Timing,
    pub queued: bool,
    pub pausing: bool,
    pub handoff: bool,
    pub error: Option<Problem>,
}
#[derive(Clone)]
pub struct Snapshot {
    pub games: [GameStatus; 4],
    pub busy: bool,
    pub queued: usize,
    pub error: Option<Problem>,
}
pub enum Command {
    Install(Game),
    Pause(Game),
    PauseAll,
    ResumeAll,
    Clear,
    Play(Game, Mode),
    Shutdown,
}
pub struct Scheduler {
    sender: Sender<Command>,
    snapshot: Arc<Mutex<Snapshot>>,
    thread: Option<std::thread::JoinHandle<()>>,
}
impl Scheduler {
    pub fn start(catalog: Catalog, data: PathBuf, settings: Settings) -> Result<Self> {
        let mut games = Vec::new();
        for game in Game::ALL {
            let ready = state::installed(&settings.library, game, &catalog)?;
            games.push(GameStatus {
                game,
                phase: if ready { Phase::Ready } else { Phase::Paused },
                progress: Progress {
                    phase: "Paused",
                    completed: 0,
                    total: 0,
                },
                error: None,
                timing: Timing::default(),
                queued: settings.queue.contains(&game),
                pausing: false,
                handoff: false,
            });
        }
        let games = games
            .try_into()
            .map_err(|_| Error::Invalid("Incomplete game state".into()))?;
        let snapshot = Arc::new(Mutex::new(Snapshot {
            games,
            busy: false,
            queued: settings.queue.len(),
            error: None,
        }));
        let (sender, receiver) = mpsc::channel();
        let shared = snapshot.clone();
        let thread = std::thread::Builder::new()
            .name("install-coordinator".into())
            .spawn(move || {
                let mut engine = Engine::new(catalog, data, settings, shared.clone());
                if let Err(error) = engine.run(receiver) {
                    engine.stop_all();
                    while !engine.running.is_empty() {
                        engine.receive();
                        std::thread::sleep(Duration::from_millis(20));
                    }
                    if let Ok(mut snapshot) = shared.lock() {
                        snapshot.error = Some(Problem::from_error(&error, Activity::Launcher));
                        snapshot.busy = false;
                    }
                }
            })?;
        Ok(Self {
            sender,
            snapshot,
            thread: Some(thread),
        })
    }
    pub fn send(&self, command: Command) -> Result<()> {
        if matches!(
            command,
            Command::Install(_) | Command::ResumeAll | Command::Play(_, _)
        ) && let Ok(mut state) = self.snapshot.lock()
        {
            state.busy = true;
        }
        self.sender.send(command).map_err(|_| {
            Error::Invalid("Installation coordinator stopped; restart the launcher".into())
        })
    }
    pub fn snapshot(&self) -> Result<Snapshot> {
        self.snapshot
            .lock()
            .map(|v| v.clone())
            .map_err(|_| Error::Invalid("Installation state lock failed".into()))
    }
}
impl Drop for Scheduler {
    fn drop(&mut self) {
        let _ = self.sender.send(Command::Shutdown);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}
fn index(game: Game) -> usize {
    match game {
        Game::Iw4x => 0,
        Game::T5 => 1,
        Game::T6 => 2,
        Game::T7 => 3,
    }
}
enum Work {
    Fetch(Artifact),
    Extract(Game, Vec<PathBuf>),
    Finish(Game, tempfile::TempDir, PathBuf),
    Play(Game, Mode),
}
enum Output {
    Download(PathBuf),
    Extraction(tempfile::TempDir),
    Finished,
}
#[derive(Clone)]
enum Key {
    Download(String),
    Extract(Game),
    Finish(Game),
    Play(Game),
}
struct Running {
    key: Key,
    cancel: Cancellation,
    started: std::time::Instant,
    bytes: u64,
    meter: Arc<Mutex<Meter>>,
}
struct Completion {
    id: u64,
    result: Result<Output>,
}
struct Engine {
    catalog: Catalog,
    data: PathBuf,
    settings: Settings,
    shared: Arc<Mutex<Snapshot>>,
    enabled: [bool; 4],
    admitted: [bool; 4],
    staged: [Option<tempfile::TempDir>; 4],
    verified: HashMap<String, PathBuf>,
    running: HashMap<u64, Running>,
    next: u64,
    tx: Sender<Completion>,
    rx: Receiver<Completion>,
    lock: Option<File>,
    stopping: bool,
    clocks: [Clock; 4],
}
impl Engine {
    fn new(
        catalog: Catalog,
        data: PathBuf,
        settings: Settings,
        shared: Arc<Mutex<Snapshot>>,
    ) -> Self {
        let (tx, rx) = mpsc::channel();
        Self {
            catalog,
            data,
            settings,
            shared,
            enabled: [false; 4],
            admitted: [false; 4],
            staged: std::array::from_fn(|_| None),
            verified: HashMap::new(),
            running: HashMap::new(),
            next: 0,
            tx,
            rx,
            lock: None,
            stopping: false,
            clocks: std::array::from_fn(|_| Clock::default()),
        }
    }
    fn status(&mut self, game: Game, phase: Phase, error: Option<Problem>) {
        let now = Instant::now();
        let clock = &mut self.clocks[index(game)];
        if phase == Phase::Launching {
            *clock = Clock::default();
        }
        clock.set_running(
            matches!(
                phase,
                Phase::Waiting
                    | Phase::Downloading
                    | Phase::Extracting
                    | Phase::Preparing
                    | Phase::Launching
            ),
            now,
        );
        if let Ok(mut s) = self.shared.lock() {
            let g = &mut s.games[index(game)];
            if phase != g.phase {
                g.progress = Progress {
                    phase: match phase {
                        Phase::Downloading => "Connecting",
                        Phase::Extracting => "Unpacking",
                        Phase::Preparing => "Preparing client",
                        _ => "Waiting",
                    },
                    completed: 0,
                    total: 0,
                };
                g.timing = Timing::default();
            }
            g.timing.elapsed = clock.elapsed(now);
            if phase == Phase::Launching {
                g.handoff = false;
            }
            g.phase = phase;
            g.error = error;
        }
    }
    fn stop_all(&mut self) {
        self.enabled = [false; 4];
        for clock in &mut self.clocks {
            clock.set_running(false, Instant::now());
        }
        for job in self.running.values() {
            job.cancel.pause();
        }
    }
    fn artifacts(&self, game: Game) -> Result<Vec<Artifact>> {
        let mut values = self.catalog.package(game)?.archives.clone();
        values.push(install::client_artifact(&self.catalog, game).clone());
        Ok(values)
    }
    fn uses(&self, game: Game, hash: &str) -> bool {
        self.artifacts(game)
            .is_ok_and(|values| values.iter().any(|a| a.sha256 == hash))
    }
    fn belongs(&self, key: &Key, game: Game) -> bool {
        match key {
            Key::Download(hash) => self.uses(game, hash),
            Key::Extract(g) | Key::Finish(g) | Key::Play(g) => *g == game,
        }
    }
    fn stopping_game(&self, game: Game) -> bool {
        self.running
            .values()
            .any(|r| self.belongs(&r.key, game) && r.cancel.check().is_err())
    }
    fn save(&self) -> Result<()> {
        self.settings.save(&self.data)
    }
    fn run(&mut self, commands: Receiver<Command>) -> Result<()> {
        loop {
            match commands.recv_timeout(Duration::from_millis(40)) {
                Ok(command) => self.command(command)?,
                Err(mpsc::RecvTimeoutError::Disconnected) => {
                    self.stopping = true;
                    self.stop_all();
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {}
            }
            self.receive();
            if !self.stopping {
                self.drive()?;
            }
            self.refresh_progress(Instant::now())?;
            let busy = !self.running.is_empty() || self.enabled.iter().any(|v| *v);
            if let Ok(mut s) = self.shared.lock() {
                s.busy = busy;
                s.queued = self.settings.queue.len();
            }
            if !busy {
                self.lock = None;
            }
            if self.stopping && self.running.is_empty() {
                return Ok(());
            }
        }
    }
    fn command(&mut self, command: Command) -> Result<()> {
        match command {
            Command::Install(game) => {
                if self.stopping_game(game) {
                    return Ok(());
                }
                if state::installed(&self.settings.library, game, &self.catalog)? {
                    return Ok(());
                }
                if !self.settings.queue.contains(&game) {
                    self.settings.queue.push(game);
                }
                self.enabled[index(game)] = true;
                self.status(game, Phase::Waiting, None);
                self.save()?;
            }
            Command::Pause(game) => {
                self.enabled[index(game)] = false;
                self.status(game, Phase::Paused, None);
                if !self.running.values().any(|r| self.belongs(&r.key, game)) {
                    self.staged[index(game)] = None;
                    self.admitted[index(game)] = false;
                }
            }
            Command::PauseAll => {
                self.stop_all();
                for game in self.settings.queue.clone() {
                    self.staged[index(game)] = None;
                    self.status(game, Phase::Paused, None);
                }
            }
            Command::ResumeAll => {
                for game in self.settings.queue.clone() {
                    if self.enabled[index(game)] || self.stopping_game(game) {
                        continue;
                    }
                    self.enabled[index(game)] = true;
                    self.status(game, Phase::Waiting, None);
                }
            }
            Command::Clear if self.running.is_empty() => {
                self.stop_all();
                for game in self.settings.queue.clone() {
                    self.status(game, Phase::Paused, None);
                    self.clocks[index(game)] = Clock::default();
                }
                self.settings.queue.clear();
                self.staged = std::array::from_fn(|_| None);
                self.admitted = [false; 4];
                self.save()?;
            }
            Command::Clear => {}
            Command::Play(game, mode)
                if self.running.is_empty() && !self.enabled.iter().any(|v| *v) =>
            {
                self.ensure_lock()?;
                self.status(game, Phase::Launching, None);
                self.spawn(Work::Play(game, mode))?;
            }
            Command::Play(_, _) => {}
            Command::Shutdown => {
                self.stopping = true;
                self.stop_all();
            }
        }
        for job in self.running.values() {
            let needed = match &job.key {
                Key::Download(hash) => Game::ALL
                    .iter()
                    .any(|g| self.enabled[index(*g)] && self.uses(*g, hash)),
                Key::Extract(g) | Key::Finish(g) => self.enabled[index(*g)],
                Key::Play(_) => !self.stopping,
            };
            if !needed {
                job.cancel.pause();
            }
        }
        Ok(())
    }
    fn ensure_lock(&mut self) -> Result<()> {
        if self.lock.is_none() {
            install::ensure_plain_directory(&self.settings.library)?;
            self.lock = Some(state::exclusive_lock(
                &self.settings.library.join(".install.lock"),
            )?);
        }
        Ok(())
    }
    /// Reserve only bytes still to be written, not bytes already reflected in free space.
    fn remaining(&self, game: Game) -> Result<u64> {
        let mut required = self.catalog.package(game)?.expanded_bytes;
        if let Ok(s) = self.shared.lock() {
            let p = &s.games[index(game)].progress;
            if matches!(s.games[index(game)].phase, Phase::Extracting) {
                required = required.saturating_sub(p.completed.min(required));
            }
        }
        if self.staged[index(game)].is_some()
            || self
                .running
                .values()
                .any(|r| matches!(r.key, Key::Finish(g) if g == game))
        {
            required = 0;
        }
        for a in self.artifacts(game)? {
            let dir = self.settings.library.join(".downloads").join(&a.sha256);
            let mut saved = 0;
            for name in [&a.file, &format!("{}.partial", a.file)] {
                match std::fs::symlink_metadata(dir.join(name)) {
                    Ok(m) if m.is_file() && !m.file_type().is_symlink() => {
                        saved = saved.max(m.len().min(a.bytes))
                    }
                    Ok(_) => return Err(Error::Invalid("Unexpected download cache entry".into())),
                    Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                    Err(e) => return Err(e.into()),
                }
            }
            required = required.saturating_add(a.bytes.saturating_sub(saved));
        }
        Ok(required)
    }
    fn drive(&mut self) -> Result<()> {
        for game in Game::ALL {
            if !self.enabled[index(game)]
                && !self.running.values().any(|r| self.belongs(&r.key, game))
            {
                self.admitted[index(game)] = false;
            }
        }
        if !self.enabled.iter().any(|v| *v) {
            return Ok(());
        }
        self.ensure_lock()?;
        for game in self.settings.queue.clone() {
            let i = index(game);
            if !self.enabled[i] {
                continue;
            }
            if !self.admitted[i] {
                let reserved = Game::ALL
                    .into_iter()
                    .filter(|g| self.admitted[index(*g)])
                    .try_fold(0u64, |n, g| self.remaining(g).map(|v| n.saturating_add(v)))?;
                let need = self
                    .remaining(game)?
                    .saturating_add(reserved)
                    .saturating_add(2 * 1024 * 1024 * 1024);
                if install::available_bytes(&self.settings.library)? < need {
                    if self.running.is_empty() {
                        self.enabled[i] = false;
                        self.status(game, Phase::Failed, Some(Problem::new("There's not enough space", "Free space on your game drive, then try again. To use another drive, remove paused installations in Settings first.", format!("At least {:.1} GB free is needed for the remaining installations.", need as f64 / 1e9))));
                    }
                    continue;
                }
                if self.settings.library.join(game.id()).exists() {
                    self.enabled[i] = false;
                    self.status(
                        game,
                        Phase::Failed,
                        Some(
                            Problem::new("A game folder already exists", "Your files are safe. Choose a different game folder in Settings, or save a support report from Help.", "Existing game files were preserved; they cannot be imported by this launcher."),
                        ),
                    );
                    continue;
                }
                self.admitted[i] = true;
            }
            let artifacts = self.artifacts(game)?;
            for a in artifacts
                .iter()
                .filter(|a| !self.verified.contains_key(&a.sha256))
                .cloned()
                .collect::<Vec<_>>()
            {
                if self
                    .running
                    .values()
                    .filter(|r| matches!(r.key, Key::Download(_)))
                    .count()
                    >= 2
                {
                    break;
                }
                if self
                    .running
                    .values()
                    .any(|r| matches!(&r.key, Key::Download(h) if h == &a.sha256))
                {
                    continue;
                }
                self.status(game, Phase::Downloading, None);
                self.spawn(Work::Fetch(a))?;
            }
            if !artifacts
                .iter()
                .all(|a| self.verified.contains_key(&a.sha256))
            {
                continue;
            }
            if self
                .running
                .values()
                .any(|r| matches!(r.key, Key::Extract(g)|Key::Finish(g) if g == game))
            {
                continue;
            }
            if let Some(staging) = self.staged[i].take() {
                // Client ZIP extraction shares the extraction slot; no nested pools compete.
                if self
                    .running
                    .values()
                    .any(|r| matches!(r.key, Key::Finish(_)))
                    || (game == Game::Iw4x
                        && self
                            .running
                            .values()
                            .any(|r| matches!(r.key, Key::Extract(_))))
                {
                    self.staged[i] = Some(staging);
                    self.status(game, Phase::Waiting, None);
                    continue;
                }
                let client = self
                    .verified
                    .get(&install::client_artifact(&self.catalog, game).sha256)
                    .ok_or_else(|| Error::Invalid("Client artifact was not verified".into()))?
                    .clone();
                self.status(game, Phase::Preparing, None);
                self.spawn(Work::Finish(game, staging, client))?;
            } else if !self
                .running
                .values()
                .any(|r| matches!(r.key, Key::Extract(_) | Key::Finish(Game::Iw4x)))
            {
                let paths = self
                    .catalog
                    .package(game)?
                    .archives
                    .iter()
                    .map(|a| {
                        self.verified
                            .get(&a.sha256)
                            .cloned()
                            .ok_or_else(|| Error::Invalid("Archive was not verified".into()))
                    })
                    .collect::<Result<Vec<_>>>()?;
                self.status(game, Phase::Extracting, None);
                self.spawn(Work::Extract(game, paths))?;
            } else {
                self.status(game, Phase::Waiting, None);
            }
        }
        Ok(())
    }
    /// Publish one coherent snapshot instead of letting parallel callbacks overwrite each other.
    fn refresh_progress(&self, now: Instant) -> Result<()> {
        let jobs = self
            .running
            .values()
            .filter(|job| job.cancel.check().is_ok())
            .map(|job| {
                let meter = job
                    .meter
                    .lock()
                    .map_err(|_| Error::Invalid("Task progress lock failed".into()))?;
                Ok((&job.key, meter.progress.clone(), meter.rate(now)))
            })
            .collect::<Result<Vec<_>>>()?;
        let mut snapshot = self
            .shared
            .lock()
            .map_err(|_| Error::Invalid("Installation state lock failed".into()))?;
        for g in &mut snapshot.games {
            g.queued = self.settings.queue.contains(&g.game);
            g.pausing = self.stopping_game(g.game);
            g.timing.elapsed = self.clocks[index(g.game)].elapsed(now);
            g.timing.bytes_per_second = None;
            g.timing.remaining = None;
            if matches!(g.phase, Phase::Paused | Phase::Ready | Phase::Failed) {
                continue;
            }
            let matching: Vec<_> = jobs
                .iter()
                .filter(|(key, _, _)| self.belongs(key, g.game))
                .collect();
            if matches!(g.phase, Phase::Downloading | Phase::Waiting) {
                if matching.is_empty() {
                    g.phase = Phase::Waiting;
                    continue;
                }
                g.phase = Phase::Downloading;
                let transferring: Vec<_> = matching
                    .iter()
                    .filter(|(_, p, _)| p.as_ref().is_some_and(|p| p.phase == "Downloading"))
                    .collect();
                if !transferring.is_empty() {
                    let mut completed = 0;
                    let mut total = 0;
                    for a in self.artifacts(g.game)? {
                        total += a.bytes;
                        completed += if self.verified.contains_key(&a.sha256) {
                            a.bytes
                        } else {
                            matching
                                .iter()
                                .find_map(|(key, p, _)| {
                                    if matches!(key, Key::Download(hash) if hash == &a.sha256) {
                                        p.as_ref().map(|p| {
                                            if p.phase == "Checking download" {
                                                a.bytes
                                            } else {
                                                p.completed.min(a.bytes)
                                            }
                                        })
                                    } else {
                                        None
                                    }
                                })
                                .unwrap_or(0)
                        };
                    }
                    g.progress = Progress {
                        phase: if transferring.len() > 1 {
                            "Downloading (2 files)"
                        } else {
                            "Downloading"
                        },
                        completed,
                        total,
                    };
                    // Every active transfer must have warmed up; never mix hashing and network speed.
                    g.timing.bytes_per_second = transferring.iter().map(|(_, _, rate)| *rate).sum();
                } else {
                    let checking: Vec<_> = matching
                        .iter()
                        .filter(|(_, p, _)| {
                            p.as_ref().is_some_and(|p| p.phase == "Checking download")
                        })
                        .collect();
                    g.progress = Progress {
                        phase: if checking.is_empty() {
                            "Connecting"
                        } else {
                            "Checking download"
                        },
                        completed: checking
                            .iter()
                            .filter_map(|(_, p, _)| p.as_ref())
                            .map(|p| p.completed)
                            .sum(),
                        total: checking
                            .iter()
                            .filter_map(|(_, p, _)| p.as_ref())
                            .map(|p| p.total)
                            .sum(),
                    };
                    if !checking.is_empty() {
                        g.timing.bytes_per_second = checking.iter().map(|(_, _, rate)| *rate).sum();
                    }
                }
            } else if let Some((_, Some(progress), rate)) = matching.first() {
                g.progress = progress.clone();
                g.timing.bytes_per_second = *rate;
            }
            g.timing.remaining = timing::eta(
                g.progress.total.saturating_sub(g.progress.completed),
                g.timing.bytes_per_second,
            );
        }
        Ok(())
    }
    fn spawn(&mut self, work: Work) -> Result<()> {
        let key = match &work {
            Work::Fetch(a) => Key::Download(a.sha256.clone()),
            Work::Extract(g, _) => Key::Extract(*g),
            Work::Finish(g, _, _) => Key::Finish(*g),
            Work::Play(g, _) => Key::Play(*g),
        };
        let id = self.next;
        self.next += 1;
        let cancel = Cancellation::default();
        let signal = cancel.clone();
        let tx = self.tx.clone();
        let meter = Arc::new(Mutex::new(Meter::default()));
        let progress_meter = meter.clone();
        let catalog = self.catalog.clone();
        let root = self.settings.library.clone();
        let data = self.data.clone();
        std::thread::Builder::new()
            .name("launcher-task".into())
            .spawn(move || {
                let mut progress_failed = false;
                let mut progress = |p: Progress| match progress_meter.lock() {
                    Ok(mut meter) => meter.update(p, Instant::now()),
                    Err(_) => progress_failed = true,
                };
                let result =
                    std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| -> Result<Output> {
                        match work {
                            Work::Fetch(a) => download::fetch(
                                &download::client()?,
                                &a,
                                &root.join(".downloads"),
                                &signal,
                                &mut progress,
                            )
                            .map(Output::Download),
                            Work::Extract(game, paths) => {
                                let staging = tempfile::Builder::new()
                                    .prefix(".gb-stage-")
                                    .tempdir_in(&root)?;
                                archive::extract(
                                    &paths,
                                    staging.path(),
                                    catalog.package(game)?.expanded_bytes,
                                    Some(game.id()),
                                    &signal,
                                    &mut progress,
                                )?;
                                Ok(Output::Extraction(staging))
                            }
                            Work::Finish(game, staging, client) => {
                                install::finalize(
                                    &catalog,
                                    game,
                                    install::InstallLocations {
                                        library: &root,
                                        data: &data,
                                    },
                                    staging,
                                    &client,
                                    &signal,
                                    &mut progress,
                                )?;
                                Ok(Output::Finished)
                            }
                            Work::Play(game, mode) => {
                                launch::play(game, mode, &root, &data.join("Clients"), &signal)?;
                                Ok(Output::Finished)
                            }
                        }
                    }))
                    .unwrap_or_else(|_| {
                        Err(Error::Invalid(
                            "A background operation stopped unexpectedly; retry the game.".into(),
                        ))
                    });
                let result = if progress_failed {
                    Err(Error::Invalid("Task progress lock failed".into()))
                } else {
                    result
                };
                let _ = tx.send(Completion { id, result });
            })?;
        let bytes = match &key {
            Key::Download(h) => Game::ALL
                .iter()
                .find_map(|g| {
                    self.artifacts(*g)
                        .ok()?
                        .into_iter()
                        .find(|a| &a.sha256 == h)
                        .map(|a| a.bytes)
                })
                .unwrap_or(0),
            Key::Extract(g) => self.catalog.package(*g)?.expanded_bytes,
            _ => 0,
        };
        crate::diagnostics::record(
            key.game(),
            key.operation(),
            crate::diagnostics::Outcome::Started,
            None,
            0,
            0,
        );
        self.running.insert(
            id,
            Running {
                key,
                cancel,
                started: std::time::Instant::now(),
                bytes,
                meter,
            },
        );
        Ok(())
    }
    fn receive(&mut self) {
        while let Ok(completion) = self.rx.try_recv() {
            let Some(job) = self.running.remove(&completion.id) else {
                continue;
            };
            let outcome = match &completion.result {
                Ok(_) => crate::diagnostics::Outcome::Succeeded,
                Err(Error::Paused) => crate::diagnostics::Outcome::Paused,
                Err(_) => crate::diagnostics::Outcome::Failed,
            };
            crate::diagnostics::record(
                job.key.game(),
                job.key.operation(),
                outcome,
                completion
                    .result
                    .as_ref()
                    .err()
                    .and_then(crate::diagnostics::failure),
                job.started.elapsed().as_millis().min(u64::MAX as u128) as u64,
                if completion.result.is_ok() {
                    job.bytes
                } else {
                    0
                },
            );
            match completion.result {
                Ok(Output::Download(path)) => {
                    if let Key::Download(hash) = job.key {
                        self.verified.insert(hash, path);
                    }
                }
                Ok(Output::Extraction(staging)) => {
                    if let Key::Extract(game) = job.key {
                        if self.enabled[index(game)] {
                            self.staged[index(game)] = Some(staging);
                        } else {
                            self.admitted[index(game)] = false;
                        }
                    }
                }
                Ok(Output::Finished) => match job.key {
                    Key::Finish(game) => {
                        self.enabled[index(game)] = false;
                        self.admitted[index(game)] = false;
                        self.settings.queue.retain(|g| *g != game);
                        self.status(game, Phase::Ready, None);
                        if let Err(e) = self.save() {
                            if let Ok(mut s) = self.shared.lock() {
                                s.error = Some(Problem::from_error(&e, Activity::Launcher));
                            }
                            self.stop_all();
                        }
                        // Release only archives with no pending consumer; shared clients stay cached.
                        if let Ok(package) = self.catalog.package(game) {
                            for a in &package.archives {
                                if !self.settings.queue.iter().any(|g| self.uses(*g, &a.sha256))
                                    && let Some(path) = self.verified.remove(&a.sha256)
                                    && let Err(e) = std::fs::remove_file(path)
                                    && let Ok(mut s) = self.shared.lock()
                                {
                                    s.error = Some(Problem::new(
                                        "Installed, but cleanup needs attention",
                                        "You can play. Save a support report from Help if the extra files remain.",
                                        e.to_string(),
                                    ));
                                }
                            }
                        }
                    }
                    Key::Play(game) => {
                        self.status(game, Phase::Ready, None);
                        if let Ok(mut s) = self.shared.lock() {
                            s.games[index(game)].handoff = true;
                        }
                    }
                    _ => {}
                },
                Err(error) => {
                    let games: Vec<Game> = match &job.key {
                        Key::Download(hash) => self
                            .settings
                            .queue
                            .iter()
                            .copied()
                            .filter(|g| self.enabled[index(*g)] && self.uses(*g, hash))
                            .collect(),
                        Key::Extract(g) | Key::Finish(g) | Key::Play(g) => vec![*g],
                    };
                    for game in games {
                        self.enabled[index(game)] = false;
                        for other in self.running.values() {
                            if self.belongs(&other.key, game)
                                && !matches!(&other.key,Key::Download(h) if Game::ALL.iter().any(|g| *g != game && self.enabled[index(*g)] && self.uses(*g,h)))
                            {
                                other.cancel.pause();
                            }
                        }
                        self.staged[index(game)] = None;
                        self.status(
                            game,
                            if matches!(job.key, Key::Play(_)) {
                                Phase::Ready
                            } else if matches!(error, Error::Paused) {
                                Phase::Paused
                            } else {
                                Phase::Failed
                            },
                            if matches!(error, Error::Paused) {
                                None
                            } else {
                                Some(Problem::from_error(
                                    &error,
                                    if matches!(job.key, Key::Play(_)) {
                                        Activity::Launch
                                    } else {
                                        Activity::Installation
                                    },
                                ))
                            },
                        );
                    }
                }
            }
        }
    }
}

impl Key {
    fn game(&self) -> Option<Game> {
        match self {
            Self::Download(_) => None,
            Self::Extract(g) | Self::Finish(g) | Self::Play(g) => Some(*g),
        }
    }
    fn operation(&self) -> crate::diagnostics::Operation {
        use crate::diagnostics::Operation;
        match self {
            Self::Download(_) => Operation::Download,
            Self::Extract(_) => Operation::Extract,
            Self::Finish(_) => Operation::Prepare,
            Self::Play(_) => Operation::Launch,
        }
    }
}
