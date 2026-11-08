//! Storage operations touch only launcher-owned files, under the library lock.
use crate::{
    Error, Result,
    catalog::{Catalog, Game},
    install, launch, state,
};
use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
};
const REMOVAL: &str = ".glitter-boys-removal.json";
#[derive(serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct Removal {
    version: u32,
    game: Game,
    keep_saves: bool,
}
fn removal(path: &Path) -> Result<Removal> {
    let removal: Removal = serde_json::from_slice(&fs::read(path.join(REMOVAL))?)?;
    if removal.version != 1
        || !path.file_name().is_some_and(|name| {
            name.to_string_lossy()
                .starts_with(&format!(".gb-remove-{}-", removal.game.id()))
        })
    {
        return Err(Error::Invalid("Invalid unfinished game removal".into()));
    }
    Ok(removal)
}

#[derive(Clone, Copy, Debug)]
pub enum Action {
    Analyze,
    Cleanup,
    Cancel(Game),
    Uninstall(Game, bool),
}
impl Action {
    pub fn game(self) -> Option<Game> {
        match self {
            Self::Cancel(g) | Self::Uninstall(g, _) => Some(g),
            _ => None,
        }
    }
}
#[derive(Clone, Debug, Default)]
pub struct GameUsage {
    pub files: u64,
    pub downloads: u64,
    pub temporary: u64,
    pub saves: u64,
}
impl GameUsage {
    pub fn total(&self) -> u64 {
        self.files + self.downloads + self.temporary + self.saves
    }
}
#[derive(Clone, Debug, Default)]
pub struct Report {
    pub reclaimable: u64,
    pub games: [GameUsage; 4],
    pub launcher: u64,
    pub shared: u64,
    pub other: u64,
}
impl Report {
    pub fn total(&self) -> u64 {
        self.games.iter().map(GameUsage::total).sum::<u64>()
            + self.launcher
            + self.shared
            + self.other
    }
}
#[derive(Clone, Debug, Default)]
pub struct Status {
    pub busy: bool,
    pub report: Option<Report>,
    pub message: Option<String>,
}

pub(crate) fn redirected(metadata: &fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        metadata.file_type().is_symlink() || metadata.file_attributes() & 0x400 != 0
    }
    #[cfg(not(windows))]
    {
        metadata.file_type().is_symlink()
    }
}

// Validate the complete tree before any recursive mutation. Never follow reparse points.
fn bytes(path: &Path) -> Result<u64> {
    let metadata = fs::symlink_metadata(path)?;
    if redirected(&metadata) {
        return Err(Error::Invalid(
            "This folder contains a link or junction. No files were removed.".into(),
        ));
    }
    if metadata.is_file() {
        return Ok(metadata.len());
    }
    if !metadata.is_dir() {
        return Err(Error::Invalid("Unexpected file type in game folder".into()));
    }
    let mut total = 0_u64;
    for entry in fs::read_dir(path)? {
        total = total.saturating_add(bytes(&entry?.path())?);
    }
    Ok(total)
}
fn owned(root: &Path, path: &Path) -> Result<()> {
    install::ensure_plain_directory(root)?;
    let root = root.canonicalize()?;
    let resolved = path.canonicalize()?;
    if resolved == root || !resolved.starts_with(&root) {
        return Err(Error::Invalid(
            "Refusing to remove files outside the game folder".into(),
        ));
    }
    bytes(path)?;
    Ok(())
}
fn remove(root: &Path, path: &Path) -> Result<()> {
    owned(root, path)?;
    let metadata = fs::symlink_metadata(path)?;
    if metadata.is_dir() {
        fs::remove_dir_all(path)?;
    } else {
        fs::remove_file(path)?;
    }
    Ok(())
}
fn candidates(catalog: &Catalog, library: &Path, queue: &[Game]) -> Result<Vec<PathBuf>> {
    install::ensure_plain_directory(library)?;
    let mut protected = HashSet::new();
    for game in queue {
        for archive in &catalog.package(*game)?.archives {
            protected.insert(archive.sha256.clone());
        }
        protected.insert(install::client_artifact(catalog, *game).sha256.clone());
    }
    let mut result = Vec::new();
    let downloads = library.join(".downloads");
    if downloads.exists() {
        owned(library, &downloads)?;
        for entry in fs::read_dir(&downloads)? {
            let entry = entry?;
            let name = entry.file_name().to_string_lossy().into_owned();
            if name.len() == 64
                && name.bytes().all(|b| b.is_ascii_hexdigit())
                && !protected.contains(&name)
            {
                owned(library, &entry.path())?;
                result.push(entry.path());
            }
        }
    }
    for entry in fs::read_dir(library)? {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with(".gb-stage-") || name.starts_with(".gb-client-") {
            owned(library, &entry.path())?;
            result.push(entry.path());
        }
        if name.starts_with(".gb-remove-") {
            owned(library, &entry.path())?;
            if fs::read_dir(entry.path())?.next().is_some() {
                removal(&entry.path())?;
            }
            result.push(entry.path());
        }
    }
    Ok(result)
}
pub fn analyze(catalog: &Catalog, library: &Path, queue: &[Game]) -> Result<Report> {
    let mut report = Report::default();
    let mut hashes = std::collections::HashMap::<String, Vec<usize>>::new();
    let mut protected = HashSet::new();
    for (i, game) in Game::ALL.iter().enumerate() {
        for artifact in catalog
            .package(*game)?
            .archives
            .iter()
            .chain(std::iter::once(install::client_artifact(catalog, *game)))
        {
            let consumers = hashes.entry(artifact.sha256.clone()).or_default();
            if !consumers.contains(&i) {
                consumers.push(i);
            }
            if queue.contains(game) {
                protected.insert(artifact.sha256.clone());
            }
        }
    }
    scan_files(library, &[], &mut |path, size| {
        let relative = path
            .strip_prefix(library)
            .map_err(|_| Error::Invalid("Storage path escaped the game folder".into()))?;
        let parts: Vec<_> = relative.iter().collect();
        let first = parts[0].to_string_lossy();
        if let Some(i) = Game::ALL.iter().position(|g| g.id() == first) {
            if parts.get(1).is_some_and(|p| personal(Path::new(p))) {
                report.games[i].saves += size;
            } else {
                report.games[i].files += size;
            }
        } else if first == ".saves" && parts.len() > 2 {
            if let Some(i) = Game::ALL.iter().position(|g| parts[1] == g.id()) {
                report.games[i].saves += size;
            } else {
                report.other += size;
            }
        } else if first == ".downloads" && parts.len() > 2 {
            let hash = parts[1].to_string_lossy();
            match hashes.get(hash.as_ref()).map(Vec::as_slice) {
                Some([i]) => report.games[*i].downloads += size,
                Some(_) => report.shared += size,
                None => report.other += size,
            }
            if hash.len() == 64
                && hash.bytes().all(|b| b.is_ascii_hexdigit())
                && !protected.contains(hash.as_ref())
            {
                report.reclaimable += size;
            }
        } else if first.starts_with(".gb-stage-") || first.starts_with(".gb-client-") {
            let game = if first.starts_with(".gb-client-") {
                Some(0)
            } else {
                parts
                    .get(1)
                    .and_then(|p| Game::ALL.iter().position(|g| *p == g.id()))
            };
            if let Some(i) = game {
                report.games[i].temporary += size;
            } else {
                report.other += size;
            }
            report.reclaimable += size;
        } else if first.starts_with(".gb-remove-") {
            let record = removal(&library.join(parts[0]))?;
            let i = Game::ALL
                .iter()
                .position(|g| *g == record.game)
                .ok_or_else(|| Error::Invalid("Unknown game in removal record".into()))?;
            if record.keep_saves && parts.get(1).is_some_and(|p| personal(Path::new(p))) {
                report.games[i].saves += size;
            } else {
                report.games[i].temporary += size;
                report.reclaimable += size;
            }
        } else {
            report.other += size;
        }
        Ok(())
    })?;
    Ok(report)
}

/// File sizes at scan time. Read-only scans tolerate files disappearing during installation;
/// deletion validation remains strict and never follows links or junctions.
fn scan_files(
    root: &Path,
    excluded: &[PathBuf],
    visit: &mut impl FnMut(&Path, u64) -> Result<()>,
) -> Result<()> {
    let mut pending = vec![root.to_owned()];
    while let Some(path) = pending.pop() {
        if excluded.contains(&path) {
            continue;
        }
        let metadata = match fs::symlink_metadata(&path) {
            Ok(metadata) => metadata,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => continue,
            Err(e) => return Err(e.into()),
        };
        if redirected(&metadata) {
            tracing::warn!(path = %path.display(), "storage scan found a link or junction");
            return Err(Error::Invalid(format!(
                "Storage contains a link or junction at {}. Choose a local folder without links.",
                path.display()
            )));
        }
        if metadata.is_file() {
            visit(&path, metadata.len())?;
        } else if metadata.is_dir() {
            let entries = match fs::read_dir(&path) {
                Ok(entries) => entries,
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => continue,
                Err(e) => return Err(e.into()),
            };
            for entry in entries {
                match entry {
                    Ok(entry) => pending.push(entry.path()),
                    Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                    Err(e) => return Err(e.into()),
                }
            }
        } else {
            return Err(Error::Invalid("Unexpected file type in storage".into()));
        }
    }
    Ok(())
}

pub fn analyze_app(
    catalog: &Catalog,
    library: &Path,
    data: &Path,
    queue: &[Game],
) -> Result<Report> {
    let mut report = analyze(catalog, library, queue)?;
    let executable = std::env::current_exe()?;
    let application = crate::updates::managed_root()?.unwrap_or(executable);
    add_app_usage(
        &mut report,
        library,
        data,
        &application,
        &launch::plutonium_directory()?,
    )?;
    Ok(report)
}

fn add_app_usage(
    report: &mut Report,
    library: &Path,
    data: &Path,
    application: &Path,
    plutonium: &Path,
) -> Result<()> {
    // Canonical roots prevent a custom library nested inside app data from being counted twice.
    let roots: Vec<_> = [library, data, application, plutonium]
        .iter()
        .map(|p| {
            if let Ok(metadata) = fs::symlink_metadata(p)
                && redirected(&metadata)
            {
                return Err(Error::Invalid(
                    "Storage contains a link or junction. Choose a local folder without links."
                        .into(),
                ));
            }
            match p.canonicalize() {
                Ok(path) => Ok(path),
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(p.to_path_buf()),
                Err(e) => Err(e.into()),
            }
        })
        .collect::<Result<_>>()?;
    for (i, root) in roots.iter().enumerate().skip(1) {
        if roots[..i].iter().any(|previous| root.starts_with(previous)) {
            continue;
        }
        let excluded: Vec<_> = roots[..i]
            .iter()
            .filter(|other| *other != root && other.starts_with(root))
            .cloned()
            .collect();
        let mut count = |path: &Path, size: u64| {
            if i == 3 || (i == 1 && path.starts_with(root.join("Clients"))) {
                report.shared += size;
            } else {
                report.launcher += size;
            }
            Ok(())
        };
        if i == 2 && root.is_dir() {
            // The install folder can be shared with other software (for example a
            // general Games folder), so count only what the launcher owns there.
            for entry in fs::read_dir(root)? {
                let entry = entry?;
                if launcher_owned(&entry.file_name().to_string_lossy()) {
                    scan_files(&entry.path(), &excluded, &mut count)?;
                }
            }
        } else {
            scan_files(root, &excluded, &mut count)?;
        }
    }
    Ok(())
}

/// Entries the installer and updater create in the launcher's install folder.
fn launcher_owned(name: &str) -> bool {
    let name = name.to_ascii_lowercase();
    matches!(
        name.as_str(),
        "versions"
            | "update-cache"
            | "licenses"
            | "current.json"
            | "failed-update.json"
            | "activation.lock"
            | "update.lock"
            | "glitter-boys.exe"
            | "uninstall.exe"
    ) || name.starts_with(".update-")
}
fn reclaimable(path: &Path) -> Result<u64> {
    let total = bytes(path)?;
    if path
        .file_name()
        .is_some_and(|n| n.to_string_lossy().starts_with(".gb-remove-"))
        && fs::read_dir(path)?.next().is_some()
        && removal(path)?.keep_saves
    {
        let mut kept = 0_u64;
        for entry in fs::read_dir(path)? {
            let entry = entry?;
            if personal(&entry.path()) {
                kept = kept.saturating_add(bytes(&entry.path())?);
            }
        }
        return Ok(total.saturating_sub(kept));
    }
    Ok(total)
}
pub fn cleanup(catalog: &Catalog, library: &Path, queue: &[Game]) -> Result<u64> {
    let paths = candidates(catalog, library, queue)?;
    let mut recovered = 0;
    for path in paths {
        let size = reclaimable(&path)?;
        if path
            .file_name()
            .is_some_and(|n| n.to_string_lossy().starts_with(".gb-remove-"))
            && fs::read_dir(&path)?.next().is_some()
        {
            finish_removal(library, &path)?;
        } else {
            remove(library, &path)?;
        }
        recovered += size;
    }
    Ok(recovered)
}
pub fn cancel_downloads(
    catalog: &Catalog,
    library: &Path,
    game: Game,
    queue: &[Game],
) -> Result<u64> {
    install::ensure_plain_directory(library)?;
    let mut protected = HashSet::new();
    for other in queue {
        for archive in &catalog.package(*other)?.archives {
            protected.insert(archive.sha256.clone());
        }
        protected.insert(install::client_artifact(catalog, *other).sha256.clone());
    }
    let mut hashes: HashSet<_> = catalog
        .package(game)?
        .archives
        .iter()
        .map(|a| a.sha256.clone())
        .collect();
    hashes.insert(install::client_artifact(catalog, game).sha256.clone());
    let mut freed = 0;
    for hash in hashes.difference(&protected) {
        let path = library.join(".downloads").join(hash);
        match fs::symlink_metadata(&path) {
            Ok(_) => {
                let size = bytes(&path)?;
                remove(library, &path)?;
                freed += size;
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(e.into()),
        };
    }
    Ok(freed)
}
fn personal(path: &Path) -> bool {
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default();
    matches!(
        name.as_str(),
        "players"
            | "players2"
            | "boiii_players"
            | "userraw"
            | "mods"
            | "usermaps"
            | "demos"
            | "screenshots"
    ) || name.ends_with(".cfg")
        || name.ends_with(".ini")
}
pub fn uninstall(catalog: &Catalog, library: &Path, game: Game, keep_saves: bool) -> Result<()> {
    if launch::game_running(game) {
        return Err(Error::ActionRequired {
            title: "Close your game first",
            next_step: "Close the game and its launcher, then try uninstalling again.",
        });
    }
    let directory = library.join(game.id());
    owned(library, &directory)?;
    if !state::installed(library, game, catalog)? {
        return Err(Error::Invalid(
            "This game was not installed by Glitter Boys".into(),
        ));
    }
    let saves = library.join(".saves").join(game.id());
    if keep_saves {
        install::ensure_plain_directory(&saves)?;
        for entry in fs::read_dir(&directory)? {
            let entry = entry?;
            if personal(&entry.path()) {
                let target = saves.join(entry.file_name());
                if target.exists() {
                    return Err(Error::Invalid("Saved game data already exists. Open the game folder to review it before uninstalling.".into()));
                }
            }
        }
    } else if saves.exists() {
        remove(library, &saves)?;
    }
    let tomb = tempfile::Builder::new()
        .prefix(&format!(".gb-remove-{}-", game.id()))
        .tempdir_in(library)?;
    let tomb = tomb.keep();
    fs::remove_dir(&tomb)?;
    state::write_json(
        &directory.join(REMOVAL),
        &Removal {
            version: 1,
            game,
            keep_saves,
        },
    )?;
    fs::rename(&directory, &tomb)?;
    finish_removal(library, &tomb)
}
fn finish_removal(library: &Path, tomb: &Path) -> Result<()> {
    owned(library, tomb)?;
    let removal = removal(tomb)?;
    if launch::game_running(removal.game) {
        return Err(Error::Invalid(
            "Close the game and its launcher before cleaning up".into(),
        ));
    }
    if removal.keep_saves {
        let saves = library.join(".saves").join(removal.game.id());
        install::ensure_plain_directory(&saves)?;
        for entry in fs::read_dir(tomb)? {
            let entry = entry?;
            if personal(&entry.path()) {
                let target = saves.join(entry.file_name());
                if target.exists() {
                    return Err(Error::Invalid("Saved data already exists. Your files were kept; open the game folder to review them.".into()));
                }
                fs::rename(entry.path(), target)?;
            }
        }
    }
    // Keep the receipt until last, so a failed deletion can be retried safely.
    for entry in fs::read_dir(tomb)? {
        let entry = entry?;
        if entry.file_name() != ".glitter-boys-install.json" && entry.file_name() != REMOVAL {
            remove(library, &entry.path())?;
        }
    }
    if tomb.join(".glitter-boys-install.json").exists() {
        fs::remove_file(tomb.join(".glitter-boys-install.json"))?;
    }
    fs::remove_file(tomb.join(REMOVAL))?;
    fs::remove_dir(tomb)?;
    Ok(())
}
pub(crate) fn restore_saves(library: &Path, game: Game, staged: &Path) -> Result<()> {
    let saves = library.join(".saves").join(game.id());
    if !saves.exists() {
        return Ok(());
    }
    owned(library, &saves)?;
    owned(library, staged)?;
    for entry in fs::read_dir(&saves)? {
        let entry = entry?;
        if !personal(&entry.path()) {
            return Err(Error::Invalid("Unexpected saved game data".into()));
        }
        let target = staged.join(entry.file_name());
        if target.exists() {
            remove(library, &target)?;
        }
        copy_tree(&entry.path(), &target)?;
    }
    Ok(())
}
fn copy_tree(source: &Path, target: &Path) -> Result<()> {
    if fs::symlink_metadata(source)?.is_dir() {
        fs::create_dir_all(target)?;
        for entry in fs::read_dir(source)? {
            let entry = entry?;
            copy_tree(&entry.path(), &target.join(entry.file_name()))?;
        }
    } else {
        fs::copy(source, target)?;
    }
    Ok(())
}
pub(crate) fn saves_restored(library: &Path, game: Game) -> Result<()> {
    let saves = library.join(".saves").join(game.id());
    if saves.exists() {
        remove(library, &saves)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn storage_totals_include_partial_downloads_staging_and_shared_files_once() -> Result<()> {
        let root = crate::test_tempdir()?;
        let data = root.path().join("data");
        let library = data.join("Games");
        let app = root.path().join("app");
        let plutonium = root.path().join("Plutonium");
        let catalog = Catalog::bundled()?;
        let archive = &catalog.package(Game::T7)?.archives[0];
        let files = [
            (library.join("t7/game.dat"), 10),
            (library.join("t7/boiii_players/config.cfg"), 2),
            (library.join(".saves/t5/config.cfg"), 3),
            (
                library
                    .join(".downloads")
                    .join(&archive.sha256)
                    .join("part.partial"),
                7,
            ),
            (
                library
                    .join(".downloads")
                    .join(&catalog.plutonium.sha256)
                    .join("plutonium.exe"),
                5,
            ),
            (library.join(".gb-stage-test/t7/game.dat"), 11),
            (library.join("personal.txt"), 13),
            (data.join("Clients/plutonium.exe"), 17),
            (data.join("diagnostics/logs/events.jsonl"), 19),
            (app.join("versions/1/glitter-boys.exe"), 23),
            (plutonium.join("bin/client.exe"), 29),
        ];
        for (path, size) in &files {
            fs::create_dir_all(
                path.parent()
                    .ok_or_else(|| Error::Invalid("parent".into()))?,
            )?;
            fs::write(path, vec![0; *size])?;
        }
        let mut report = analyze(&catalog, &library, &[Game::T7, Game::T5])?;
        add_app_usage(&mut report, &library, &data, &app, &plutonium)?;
        assert_eq!(report.games[3].files, 10);
        assert_eq!(report.games[3].downloads, 7);
        assert_eq!(report.games[3].temporary, 11);
        assert_eq!(report.games[3].saves, 2);
        assert_eq!(report.games[1].saves, 3);
        assert_eq!(report.shared, 5 + 17 + 29);
        assert_eq!(report.launcher, 19 + 23);
        assert_eq!(report.other, 13);
        assert_eq!(
            report.total(),
            files.iter().map(|(_, n)| *n as u64).sum::<u64>()
        );
        assert_eq!(report.reclaimable, 11); // Queued downloads are protected.
        Ok(())
    }

    /// A launcher installed into a shared folder (such as a general Games folder that
    /// also holds the library and other games with junctions) counts only its own files.
    #[cfg(windows)]
    #[test]
    fn shared_install_folder_counts_only_launcher_files() -> Result<()> {
        let temp = crate::test_tempdir()?;
        let app = temp.path().join("Games");
        let library = app.join("Glitter").join("GlitterBoys");
        let data = temp.path().join("data");
        let plutonium = temp.path().join("Plutonium");
        for directory in [&library, &data, &plutonium, &app.join("versions/0.1.9")] {
            fs::create_dir_all(directory)?;
        }
        fs::write(app.join("versions/0.1.9/glitter-boys.exe"), vec![0; 23])?;
        fs::write(app.join("current.json"), vec![0; 7])?;
        // Someone else's game folder with a junction, beside the launcher files.
        let other = app.join("OtherGame");
        fs::create_dir_all(other.join("real"))?;
        fs::write(other.join("real").join("big.pak"), vec![0; 1000])?;
        let status = std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J"])
            .arg(other.join("linked"))
            .arg(other.join("real"))
            .stdout(std::process::Stdio::null())
            .status()?;
        assert!(status.success(), "junction fixture");
        let mut report = Report::default();
        add_app_usage(&mut report, &library, &data, &app, &plutonium)?;
        assert_eq!(report.launcher, 23 + 7);
        // A link the launcher does own is still refused, and named.
        let error = scan_files(&other, &[], &mut |_, _| Ok(()));
        assert!(error.is_err_and(|e| e.to_string().contains("linked")));
        Ok(())
    }

    #[test]
    fn read_only_scan_tolerates_files_removed_after_directory_listing() -> Result<()> {
        let root = crate::test_tempdir()?;
        fs::write(root.path().join("one"), b"abc")?;
        fs::write(root.path().join("two"), b"abcd")?;
        let mut counted = 0;
        scan_files(root.path(), &[], &mut |path, size| {
            counted += size;
            let sibling = if path.ends_with("one") { "two" } else { "one" };
            fs::remove_file(root.path().join(sibling))?;
            Ok(())
        })?;
        assert!(counted == 3 || counted == 4);
        Ok(())
    }
    #[test]
    fn cancel_removes_only_selected_unshared_downloads() -> Result<()> {
        let root = crate::test_tempdir()?;
        let catalog = Catalog::bundled()?;
        let paths = [
            &catalog.package(Game::T5)?.archives[0],
            &catalog.package(Game::T7)?.archives[0],
            &catalog.plutonium,
        ];
        for artifact in paths {
            let dir = root.path().join(".downloads").join(&artifact.sha256);
            fs::create_dir_all(&dir)?;
            fs::write(dir.join(&artifact.file), b"abc")?;
        }
        assert_eq!(
            cancel_downloads(&catalog, root.path(), Game::T5, &[Game::T6])?,
            3
        );
        assert!(
            root.path()
                .join(".downloads")
                .join(&catalog.plutonium.sha256)
                .exists()
        );
        assert!(
            root.path()
                .join(".downloads")
                .join(&catalog.package(Game::T7)?.archives[0].sha256)
                .exists()
        );
        Ok(())
    }
    #[cfg(windows)]
    #[test]
    fn cleanup_rejects_junctions_without_touching_the_target() -> Result<()> {
        let root = crate::test_tempdir()?;
        let outside = crate::test_tempdir()?;
        fs::write(outside.path().join("keep.txt"), b"safe")?;
        let cache = root.path().join(".downloads");
        fs::create_dir_all(&cache)?;
        let output = std::process::Command::new("cmd.exe")
            .args(["/C", "mklink", "/J"])
            .arg(cache.join("a".repeat(64)))
            .arg(outside.path())
            .output()?;
        assert!(
            output.status.success(),
            "junction fixture: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        assert!(cleanup(&Catalog::bundled()?, root.path(), &[]).is_err());
        assert!(analyze(&Catalog::bundled()?, root.path(), &[]).is_err());
        assert_eq!(fs::read(outside.path().join("keep.txt"))?, b"safe");
        Ok(())
    }
    #[test]
    fn interrupted_removal_keeps_saves_and_can_be_completed() -> Result<()> {
        let root = crate::test_tempdir()?;
        let tomb = root.path().join(".gb-remove-t7-test");
        fs::create_dir_all(tomb.join("boiii_players"))?;
        fs::write(tomb.join("boiii_players/config.cfg"), b"settings")?;
        fs::write(tomb.join("game.dat"), b"game")?;
        state::write_json(
            &tomb.join(REMOVAL),
            &Removal {
                version: 1,
                game: Game::T7,
                keep_saves: true,
            },
        )?;
        let expected = bytes(&tomb)?.saturating_sub(b"settings".len() as u64);
        assert_eq!(
            analyze(&Catalog::bundled()?, root.path(), &[])?.reclaimable,
            expected
        );
        assert_eq!(cleanup(&Catalog::bundled()?, root.path(), &[])?, expected);
        assert!(!tomb.exists());
        assert_eq!(
            fs::read(root.path().join(".saves/t7/boiii_players/config.cfg"))?,
            b"settings"
        );
        Ok(())
    }
    #[test]
    fn interrupted_save_moves_resume_without_replacing_saved_data() -> Result<()> {
        let root = crate::test_tempdir()?;
        let tomb = root.path().join(".gb-remove-t7-partial");
        let saves = root.path().join(".saves/t7");
        fs::create_dir_all(tomb.join("boiii_players"))?;
        fs::create_dir_all(&saves)?;
        fs::write(tomb.join("boiii_players/config.cfg"), b"settings")?;
        fs::write(tomb.join("profile.ini"), b"profile")?;
        fs::write(tomb.join("game.dat"), b"game")?;
        state::write_json(
            &tomb.join(REMOVAL),
            &Removal {
                version: 1,
                game: Game::T7,
                keep_saves: true,
            },
        )?;
        // Simulate process loss after one atomic save rename but before the next.
        fs::rename(tomb.join("boiii_players"), saves.join("boiii_players"))?;
        cleanup(&Catalog::bundled()?, root.path(), &[])?;
        assert!(!tomb.exists());
        assert_eq!(
            fs::read(saves.join("boiii_players/config.cfg"))?,
            b"settings"
        );
        assert_eq!(fs::read(saves.join("profile.ini"))?, b"profile");
        Ok(())
    }
    #[test]
    fn cleanup_protects_queued_artifacts_and_personal_files() -> Result<()> {
        let root = crate::test_tempdir()?;
        let catalog = Catalog::bundled()?;
        for game in [Game::T5, Game::T7] {
            let dir = root
                .path()
                .join(".downloads")
                .join(&catalog.package(game)?.archives[0].sha256);
            fs::create_dir_all(&dir)?;
            fs::write(dir.join("archive.partial"), b"abc")?;
        }
        fs::create_dir_all(root.path().join(".saves/t5"))?;
        fs::write(root.path().join(".saves/t5/config.cfg"), b"safe")?;
        assert_eq!(cleanup(&catalog, root.path(), &[Game::T5])?, 3);
        assert!(
            root.path()
                .join(".downloads")
                .join(&catalog.package(Game::T5)?.archives[0].sha256)
                .exists()
        );
        assert!(root.path().join(".saves/t5/config.cfg").exists());
        Ok(())
    }
    #[test]
    fn uninstall_preserves_and_restores_personal_files() -> Result<()> {
        let root = crate::test_tempdir()?;
        let catalog = Catalog::bundled()?;
        let game = Game::T7;
        let directory = root.path().join(game.id());
        for file in &catalog.package(game)?.required_files {
            let path = directory.join(file);
            fs::create_dir_all(
                path.parent()
                    .ok_or_else(|| Error::Invalid("parent".into()))?,
            )?;
            fs::write(path, b"game")?;
        }
        fs::create_dir_all(directory.join("boiii_players"))?;
        fs::write(directory.join("boiii_players/config.cfg"), b"settings")?;
        state::write_json(
            &directory.join(".glitter-boys-install.json"),
            &state::Receipt {
                version: 1,
                catalog_version: catalog.version,
                game,
                prerequisites_complete: false,
            },
        )?;
        uninstall(&catalog, root.path(), game, true)?;
        assert!(!directory.exists());
        let staged = root.path().join(".gb-stage-test/t7");
        fs::create_dir_all(&staged)?;
        restore_saves(root.path(), game, &staged)?;
        assert_eq!(
            fs::read(staged.join("boiii_players/config.cfg"))?,
            b"settings"
        );
        // Restore is non-destructive until the new install has been promoted.
        assert!(
            root.path()
                .join(".saves/t7/boiii_players/config.cfg")
                .exists()
        );
        Ok(())
    }
    #[test]
    fn unowned_directories_are_preserved() -> Result<()> {
        let root = crate::test_tempdir()?;
        let catalog = Catalog::bundled()?;
        fs::create_dir_all(root.path().join("t7"))?;
        fs::write(root.path().join("t7/personal.txt"), b"safe")?;
        assert!(uninstall(&catalog, root.path(), Game::T7, false).is_err());
        assert_eq!(fs::read(root.path().join("t7/personal.txt"))?, b"safe");
        assert!(owned(root.path(), root.path()).is_err());
        Ok(())
    }
}
