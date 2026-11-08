//! Support bundles: one local zip with everything needed to understand a failure.
//!
//! The bundle is written only when the player asks for it and never leaves the machine on
//! its own. Plutonium's folder is never read, save and profile folders are listed by name
//! and size only, and the Windows user name is replaced in every text entry.
use crate::{
    Result,
    catalog::{Catalog, Game},
    problem::Problem,
    scheduler::Snapshot,
    state,
    updates::UpdateState,
};
use std::{
    fmt::Write as _,
    fs,
    io::{Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use zip::{CompressionMethod, ZipWriter, write::SimpleFileOptions};

/// Each entry keeps its newest bytes when larger than this.
const ENTRY_LIMIT: u64 = 20 * 1024 * 1024;
/// The bundle stops adding logs past this many uncompressed bytes.
const BUNDLE_LIMIT: u64 = 100 * 1024 * 1024;
/// Small client files worth reading from an IW4x folder.
const IW4X_FILE_LIMIT: u64 = 1024 * 1024;
const LISTING_LIMIT: usize = 20_000;

/// What the app knows at export time.
pub struct BundleInput<'a> {
    pub data: &'a Path,
    pub library: Option<&'a Path>,
    pub snapshot: Option<&'a Snapshot>,
    pub update: Option<&'a UpdateState>,
    pub launcher_problem: Option<&'a Problem>,
}

/// What was written, for the confirmation message.
pub struct BundleSummary {
    pub entries: usize,
    pub truncated: Vec<String>,
}

/// A support bundle file name in local-independent UTC: `glitter-boys-support-YYYYMMDD-HHMMSS.zip`.
pub fn file_name(now: SystemTime) -> String {
    let seconds = now
        .duration_since(UNIX_EPOCH)
        .unwrap_or(Duration::ZERO)
        .as_secs();
    let (year, month, day) = civil_date((seconds / 86_400) as i64);
    let rest = seconds % 86_400;
    format!(
        "glitter-boys-support-{year:04}{month:02}{day:02}-{:02}{:02}{:02}.zip",
        rest / 3600,
        rest % 3600 / 60,
        rest % 60
    )
}

/// Days since 1970-01-01 to a proleptic Gregorian date (Howard Hinnant's algorithm).
fn civil_date(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let month = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    let year = yoe + era * 400 + i64::from(month <= 2);
    (year, month, day)
}

/// Replace the Windows profile folder and user name in support text.
pub struct Redactor {
    /// (text to find, replacement, whole words only)
    replacements: Vec<(String, &'static str, bool)>,
}
impl Redactor {
    pub fn from_environment() -> Self {
        Self::new(
            std::env::var("USERPROFILE").ok().as_deref(),
            std::env::var("USERNAME").ok().as_deref(),
        )
    }
    pub fn new(profile: Option<&str>, user: Option<&str>) -> Self {
        let mut replacements = Vec::new();
        if let Some(profile) = profile.filter(|p| !p.trim_end_matches(['\\', '/']).is_empty()) {
            replacements.push((profile.to_owned(), "%USERPROFILE%", false));
            // JSON logs escape backslashes.
            replacements.push((profile.replace('\\', "\\\\"), "%USERPROFILE%", false));
            replacements.push((profile.replace('\\', "/"), "%USERPROFILE%", false));
        }
        // Any length of user name; whole words only, so a short name like "ab" does not
        // rewrite ordinary words that contain it.
        if let Some(user) = user.filter(|u| !u.is_empty()) {
            replacements.push((user.to_owned(), "<user>", true));
        }
        Self { replacements }
    }
    pub fn apply(&self, text: &str) -> String {
        let mut text = text.to_owned();
        for (needle, replacement, whole_word) in &self.replacements {
            text = replace_ignore_case(&text, needle, replacement, *whole_word);
        }
        text
    }
}
/// Remove terminal control sequences (colors, cursor moves) that client updaters print
/// for their progress bars, so captured output reads as plain text.
fn strip_terminal_codes(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        if c != '\u{1b}' {
            out.push(c);
            continue;
        }
        match chars.peek() {
            // CSI: ESC [ parameters... final byte in @..~
            Some('[') => {
                chars.next();
                for c in chars.by_ref() {
                    if ('@'..='~').contains(&c) {
                        break;
                    }
                }
            }
            // Other two-character escapes.
            Some(_) => {
                chars.next();
            }
            None => {}
        }
    }
    out
}
/// Case-insensitive (Unicode lowercase) replacement that works on characters, so it is
/// correct even where lowercasing changes a string's byte length.
fn replace_ignore_case(text: &str, needle: &str, replacement: &str, whole_word: bool) -> String {
    let wanted: Vec<char> = needle.chars().flat_map(char::to_lowercase).collect();
    if wanted.is_empty() {
        return text.to_owned();
    }
    let word = |c: char| c.is_alphanumeric() || c == '_';
    // Byte offset just past a match of `wanted` starting at `start`, if there is one.
    let match_at = |start: usize| -> Option<usize> {
        let mut want = wanted.iter();
        let mut pending = want.next();
        for (offset, c) in text[start..].char_indices() {
            for lower in c.to_lowercase() {
                if pending != Some(&lower) {
                    return None;
                }
                pending = want.next();
            }
            if pending.is_none() {
                return Some(start + offset + c.len_utf8());
            }
        }
        None
    };
    let mut out = String::with_capacity(text.len());
    let mut last = 0;
    let mut previous: Option<char> = None;
    for (index, c) in text.char_indices() {
        if index >= last
            && !(whole_word && previous.is_some_and(word))
            && let Some(end) = match_at(index)
            && !(whole_word && text[end..].chars().next().is_some_and(word))
        {
            out.push_str(&text[last..index]);
            out.push_str(replacement);
            last = end;
        }
        previous = Some(c);
    }
    out.push_str(&text[last..]);
    out
}

struct Bundle<W: Write + Seek> {
    zip: ZipWriter<W>,
    redactor: Redactor,
    written: u64,
    entries: usize,
    truncated: Vec<String>,
}
impl<W: Write + Seek> Bundle<W> {
    fn text(&mut self, name: &str, text: &str) -> Result<()> {
        let options = SimpleFileOptions::default()
            .compression_method(CompressionMethod::Deflated)
            .large_file(false);
        self.zip.start_file(name, options)?;
        let text = self.redactor.apply(&strip_terminal_codes(text));
        self.zip.write_all(text.as_bytes())?;
        self.written += text.len() as u64;
        self.entries += 1;
        Ok(())
    }
    /// Add a text file from disk, keeping its newest bytes within the entry limit.
    fn file(&mut self, name: &str, path: &Path) -> Result<()> {
        let mut file = match fs::File::open(path) {
            Ok(file) => file,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(e) => {
                return self.text(name, &format!("<could not read {}: {e}>", path.display()));
            }
        };
        let length = file.metadata()?.len();
        if self.written >= BUNDLE_LIMIT {
            self.truncated.push(format!("{name} (bundle size limit)"));
            return Ok(());
        }
        let limit = ENTRY_LIMIT.min(BUNDLE_LIMIT - self.written);
        let mut prefix = String::new();
        if length > limit {
            file.seek(SeekFrom::Start(length - limit))?;
            self.truncated.push(name.to_owned());
            prefix = format!("<truncated: kept the last {limit} of {length} bytes>\n");
        }
        let mut bytes = Vec::new();
        file.take(limit).read_to_end(&mut bytes)?;
        self.text(name, &(prefix + &String::from_utf8_lossy(&bytes)))
    }
}

/// Write the bundle atomically: a failed export leaves no partial zip behind.
pub fn write_bundle(path: &Path, input: &BundleInput<'_>) -> Result<BundleSummary> {
    let directory = path
        .parent()
        .ok_or_else(|| crate::Error::Invalid("Choose a folder for the support bundle".into()))?;
    let temporary = tempfile::NamedTempFile::new_in(directory)?;
    let mut bundle = Bundle {
        zip: ZipWriter::new(temporary.reopen()?),
        redactor: Redactor::from_environment(),
        written: 0,
        entries: 0,
        truncated: Vec::new(),
    };
    tracing::info!(path = %path.display(), "writing support bundle");
    add_everything(&mut bundle, input)?;
    let truncated = bundle.truncated.clone();
    bundle.text("README.txt", &readme(&truncated))?;
    let entries = bundle.entries;
    bundle.zip.finish()?.sync_all()?;
    temporary
        .persist(path)
        .map_err(|e| crate::Error::Io(e.error))?;
    Ok(BundleSummary { entries, truncated })
}

fn readme(truncated: &[String]) -> String {
    let mut text = String::from(
        "Glitter Boys support bundle\n\
         ===========================\n\n\
         Send this file to Jerred with a short description of what happened.\n\n\
         summary.json        launcher version, Windows, disks, game states and errors\n\
         logs/               launcher logs, event history, and game updater output\n\
         state/              launcher settings, install receipts, and update state\n\
         listings/           names and sizes of files in the game folders (no contents)\n\
         iw4x/               small MW2 launcher settings and logs\n\n\
         Not included: Plutonium account data, passwords, saves, player profiles,\n\
         and the contents of game config files. Your Windows user name is replaced\n\
         with <user>.\n",
    );
    if !truncated.is_empty() {
        text.push_str("\nShortened to fit:\n");
        for name in truncated {
            let _ = writeln!(text, "- {name}");
        }
    }
    text
}

fn add_everything<W: Write + Seek>(bundle: &mut Bundle<W>, input: &BundleInput<'_>) -> Result<()> {
    let install_root = std::env::var_os("GLITTER_BOYS_INSTALL_ROOT").map(PathBuf::from);
    bundle.text(
        "summary.json",
        &serde_json::to_string_pretty(&summary(input, install_root.as_deref()))?,
    )?;
    // State files.
    let data = input.data;
    bundle.file("state/settings.json", &data.join("settings.json"))?;
    bundle.file("state/network.json", &data.join("network.json"))?;
    bundle.file(
        "state/diagnostics-preferences.json",
        &data.join("diagnostics").join("preferences.json"),
    )?;
    if let Some(root) = &install_root {
        bundle.file("state/app/current.json", &root.join("current.json"))?;
        bundle.file(
            "state/app/failed-update.json",
            &root.join("failed-update.json"),
        )?;
        bundle.text("listings/app.txt", &listing(root, 2))?;
    }
    if let Some(library) = input.library {
        for game in Game::ALL {
            bundle.file(
                &format!("state/receipts/{}.json", game.id()),
                &library.join(game.id()).join(".glitter-boys-install.json"),
            )?;
        }
    }
    // Listings, never contents.
    bundle.text("listings/clients.txt", &listing(&data.join("Clients"), 2))?;
    if let Some(library) = input.library {
        bundle.text("listings/library.txt", &listing(library, 3))?;
        let mut staging = String::new();
        if let Ok(entries) = fs::read_dir(library) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().into_owned();
                if [".gb-stage-", ".gb-client-", ".gb-remove-"]
                    .iter()
                    .any(|prefix| name.starts_with(prefix))
                {
                    let _ = writeln!(staging, "== {name}");
                    staging.push_str(&listing(&entry.path(), 4));
                }
            }
        }
        bundle.text("listings/staging.txt", &staging)?;
        // Small IW4x launcher files from the installed and any staged MW2 folder.
        let mut folders = vec![library.join(Game::Iw4x.id())];
        if let Ok(entries) = fs::read_dir(library) {
            folders.extend(entries.flatten().filter_map(|e| {
                e.file_name()
                    .to_string_lossy()
                    .starts_with(".gb-stage-")
                    .then(|| e.path().join(Game::Iw4x.id()))
            }));
        }
        for (index, folder) in folders.iter().enumerate() {
            for file in iw4x_files(folder) {
                let name = file
                    .strip_prefix(folder)
                    .unwrap_or(&file)
                    .to_string_lossy()
                    .replace('\\', "/");
                bundle.file(&format!("iw4x/{index}/{name}"), &file)?;
            }
        }
    }
    // Logs last, so state always fits even when logs are large.
    let logs = data.join("diagnostics").join("logs");
    for (directory, prefix) in [
        (logs.clone(), "logs"),
        (logs.join("processes"), "logs/processes"),
    ] {
        let mut files: Vec<_> = fs::read_dir(&directory)
            .map(|entries| {
                entries
                    .flatten()
                    .filter(|e| e.file_type().is_ok_and(|t| t.is_file()))
                    .map(|e| e.path())
                    .collect()
            })
            .unwrap_or_default();
        // Newest first, so a size limit drops the oldest logs.
        files.sort_by_key(|p| std::cmp::Reverse(fs::metadata(p).and_then(|m| m.modified()).ok()));
        for file in files {
            let name = file
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default();
            bundle.file(&format!("{prefix}/{name}"), &file)?;
        }
    }
    Ok(())
}

/// IW4x files small enough and safe enough to include by name: launcher settings and
/// revision markers, the launcher's newest run logs (`cache/launcher_*.log`), and the
/// game console log its crash reporter keeps (`sentry/attachments/console.log`).
fn iw4x_files(folder: &Path) -> Vec<PathBuf> {
    // Contents are read only from real folders inside the game folder: a link or junction
    // could point anywhere, including at private files.
    let plain = |directory: &Path| {
        directory
            .strip_prefix(folder)
            .map(|relative| {
                std::iter::once(folder.to_path_buf())
                    .chain(
                        relative
                            .ancestors()
                            .filter(|a| !a.as_os_str().is_empty())
                            .map(|a| folder.join(a)),
                    )
                    .all(|path| {
                        fs::symlink_metadata(&path)
                            .is_ok_and(|m| m.is_dir() && !crate::storage::redirected(&m))
                    })
            })
            .unwrap_or(false)
    };
    let small_files = |directory: PathBuf| -> Vec<(PathBuf, String, SystemTime)> {
        if !plain(&directory) {
            return Vec::new();
        }
        fs::read_dir(directory)
            .map(|entries| {
                entries
                    .flatten()
                    .filter(|e| e.file_type().is_ok_and(|t| t.is_file()))
                    .filter_map(|e| {
                        let metadata = e.metadata().ok()?;
                        (metadata.len() <= IW4X_FILE_LIMIT).then(|| {
                            (
                                e.path(),
                                e.file_name().to_string_lossy().to_lowercase(),
                                metadata.modified().unwrap_or(UNIX_EPOCH),
                            )
                        })
                    })
                    .collect()
            })
            .unwrap_or_default()
    };
    let mut files: Vec<PathBuf> = small_files(folder.to_path_buf())
        .into_iter()
        .filter(|(_, name, _)| {
            name == ".iw4xrevision"
                || name == ".glitter-boys-install.json"
                || name.ends_with(".log")
                || (name.ends_with(".json") && name.contains("launcher"))
        })
        .map(|(path, _, _)| path)
        .collect();
    let mut runs: Vec<_> = small_files(folder.join("cache"))
        .into_iter()
        .filter(|(_, name, _)| name.starts_with("launcher_") && name.ends_with(".log"))
        .collect();
    runs.sort_by_key(|(_, _, modified)| std::cmp::Reverse(*modified));
    files.extend(runs.into_iter().take(3).map(|(path, _, _)| path));
    files.extend(
        small_files(folder.join("sentry").join("attachments"))
            .into_iter()
            .filter(|(_, name, _)| name.ends_with(".log"))
            .map(|(path, _, _)| path),
    );
    files
}

/// Folders whose file names may be listed but whose contents are never read or descended.
fn private_folder(name: &str) -> bool {
    let name = name.to_lowercase();
    name.starts_with("players") || name == "boiii_players" || name == ".saves"
}

/// A depth-limited `size  modified  path` listing.
fn listing(root: &Path, depth: usize) -> String {
    let mut out = String::new();
    let _ = writeln!(out, "# {}", root.display());
    let mut count = 0;
    walk(root, root, depth, &mut out, &mut count);
    if count >= LISTING_LIMIT {
        let _ = writeln!(out, "# listing stopped after {LISTING_LIMIT} entries");
    }
    out
}
fn walk(root: &Path, directory: &Path, depth: usize, out: &mut String, count: &mut usize) {
    let mut entries: Vec<_> = match fs::read_dir(directory) {
        Ok(entries) => entries.flatten().collect(),
        Err(e) => {
            let _ = writeln!(out, "# cannot read {}: {e}", directory.display());
            return;
        }
    };
    entries.sort_by_key(|e| e.file_name());
    for entry in entries {
        if *count >= LISTING_LIMIT {
            return;
        }
        *count += 1;
        let path = entry.path();
        let relative = path
            .strip_prefix(root)
            .unwrap_or(&path)
            .display()
            .to_string();
        let Ok(metadata) = fs::symlink_metadata(&path) else {
            let _ = writeln!(out, "?\t?\t{relative}");
            continue;
        };
        let modified = metadata
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_secs().to_string())
            .unwrap_or_else(|| "?".into());
        let kind = if crate::storage::redirected(&metadata) {
            "link"
        } else if metadata.is_dir() {
            "dir"
        } else {
            "file"
        };
        let _ = writeln!(out, "{kind}\t{}\t{modified}\t{relative}", metadata.len());
        let name = entry.file_name().to_string_lossy().into_owned();
        if kind == "dir" && depth > 1 && !private_folder(&name) {
            walk(root, &path, depth - 1, out, count);
        }
    }
}

fn summary(input: &BundleInput<'_>, install_root: Option<&Path>) -> serde_json::Value {
    let catalog = Catalog::bundled().ok();
    let system = sysinfo::System::new_with_specifics(
        sysinfo::RefreshKind::nothing()
            .with_memory(sysinfo::MemoryRefreshKind::nothing().with_ram())
            .with_cpu(sysinfo::CpuRefreshKind::nothing()),
    );
    let disk = |path: &Path| {
        let existing = path.ancestors().find(|p| p.exists());
        serde_json::json!({
            "path": path.display().to_string(),
            "exists": path.exists(),
            "free_bytes": existing.and_then(|p| fs2::available_space(p).ok()),
            "total_bytes": existing.and_then(|p| fs2::total_space(p).ok()),
        })
    };
    let mut disks = vec![disk(input.data)];
    if let Some(library) = input.library {
        disks.push(disk(library));
    }
    let problem = |p: &Problem| serde_json::json!({"title": p.title, "next_step": p.next_step, "details": p.details});
    let games: Vec<_> = Game::ALL
        .iter()
        .map(|game| {
            let status = input
                .snapshot
                .and_then(|s| s.games.iter().find(|g| g.game == *game));
            let receipt = input.library.and_then(|library| {
                fs::read(library.join(game.id()).join(".glitter-boys-install.json"))
                    .ok()
                    .and_then(|bytes| serde_json::from_slice::<state::Receipt>(&bytes).ok())
            });
            serde_json::json!({
                "id": game.id(),
                "phase": status.map(|g| format!("{:?}", g.phase)),
                "progress_phase": status.map(|g| g.progress.phase),
                "queued": status.map(|g| g.queued),
                "resumable": status.map(|g| g.resumable),
                "error": status.and_then(|g| g.error.as_ref()).map(problem),
                "receipt": receipt,
                "folder_exists": input.library.map(|l| l.join(game.id()).is_dir()),
                "prerequisites": prerequisites(*game),
            })
        })
        .collect();
    serde_json::json!({
        "launcher": {
            "version": env!("CARGO_PKG_VERSION"),
            "commit": crate::diagnostics::commit(),
            "catalog_version": catalog.as_ref().map(|c| c.version),
            "install": if install_root.is_some() { "managed" } else { "portable" },
            "install_root": install_root.map(|p| p.display().to_string()),
            "exe": std::env::current_exe().ok().map(|p| p.display().to_string()),
            "created_unix": SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0),
        },
        "os": {
            "name": sysinfo::System::long_os_version(),
            "kernel": sysinfo::System::kernel_long_version(),
            "cpu": system.cpus().first().map(|c| c.brand().to_owned()),
            "cpus": system.cpus().len(),
            "memory_bytes": system.total_memory(),
        },
        "disks": disks,
        "update": input.update.map(|u| serde_json::json!({
            "supported": u.supported,
            "checking": u.checking,
            "message": u.message,
            "ready": u.ready,
            "error": u.error,
        })),
        "launcher_problem": input.launcher_problem.map(problem),
        "snapshot": input.snapshot.map(|s| serde_json::json!({
            "busy": s.busy,
            "queued": s.queued,
            "error": s.error.as_ref().map(problem),
            "download_limit_mbps": s.download_limit_mbps,
            "storage": s.storage.report.as_ref().map(|r| format!("{r:?}")),
        })),
        "games": games,
        "processes": processes(),
        "diagnostics": {
            "automatic_enabled": crate::diagnostics::enabled(),
            "pending_events": crate::diagnostics::pending_count(),
        },
    })
}

#[cfg(windows)]
fn prerequisites(game: Game) -> serde_json::Value {
    match crate::prerequisites::inspect(game) {
        Ok(found) => serde_json::json!(
            found
                .into_iter()
                .map(|(id, ok)| serde_json::json!({"id": id, "satisfied": ok}))
                .collect::<Vec<_>>()
        ),
        Err(error) => serde_json::json!({"error": error.to_string()}),
    }
}
#[cfg(not(windows))]
fn prerequisites(_: Game) -> serde_json::Value {
    serde_json::Value::Null
}

/// Game, client, and launcher processes with their folders.
fn processes() -> serde_json::Value {
    const NAMES: &[&str] = &[
        "glitter-boys",
        "iw4x",
        "alterware",
        "plutonium",
        "boiii",
        "blackops3",
        "steam",
        "t5",
        "t6",
    ];
    let system = sysinfo::System::new_with_specifics(
        sysinfo::RefreshKind::nothing().with_processes(
            sysinfo::ProcessRefreshKind::nothing()
                .with_exe(sysinfo::UpdateKind::Always)
                .with_cwd(sysinfo::UpdateKind::Always),
        ),
    );
    let mut found: Vec<_> = system
        .processes()
        .iter()
        .filter(|(_, p)| {
            let name = p.name().to_string_lossy().to_lowercase();
            NAMES.iter().any(|prefix| name.starts_with(prefix))
        })
        .map(|(pid, p)| {
            serde_json::json!({
                "pid": pid.as_u32(),
                "name": p.name().to_string_lossy(),
                "exe": p.exe().map(|e| e.display().to_string()),
                "cwd": p.cwd().map(|c| c.display().to_string()),
                "started_unix": p.start_time(),
                "parent": p.parent().map(|p| p.as_u32()),
            })
        })
        .collect();
    found.sort_by_key(|p| p["pid"].as_u64());
    serde_json::Value::Array(found)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn file_names_use_utc_calendar_time() {
        // 2026-11-08T01:54:13Z
        let at = UNIX_EPOCH + Duration::from_secs(1_794_102_853);
        assert_eq!(file_name(at), "glitter-boys-support-20261108-015413.zip");
        assert_eq!(
            file_name(UNIX_EPOCH),
            "glitter-boys-support-19700101-000000.zip"
        );
    }

    #[test]
    fn terminal_progress_codes_are_removed_from_captured_output() {
        let raw = "\u{1b}[32m19:01:58.626 [I] all components synchronized\u{1b}[0m\u{1b}[0B\u{1b}[?25h done";
        assert_eq!(
            strip_terminal_codes(raw),
            "19:01:58.626 [I] all components synchronized done"
        );
    }

    #[test]
    fn redaction_replaces_profile_and_user_in_every_spelling() {
        let r = Redactor::new(Some(r"C:\Users\Jerred"), Some("Jerred"));
        let text =
            r#"C:\Users\Jerred\AppData "c:\\users\\jerred\\x" C:/Users/Jerred/y owner JERRED"#;
        let out = r.apply(text);
        assert!(!out.to_lowercase().contains("jerred"), "{out}");
        assert!(out.contains(r"%USERPROFILE%\AppData"));
        assert!(out.contains(r"%USERPROFILE%\\x"));
        assert!(out.contains("%USERPROFILE%/y"));
    }

    #[test]
    fn short_and_unicode_user_names_are_removed_as_whole_words() {
        let r = Redactor::new(Some(r"C:\Users\ab"), Some("ab"));
        let out = r.apply(r#"owner AB signed in; "C:\\Users\\Ab\\x"; table about ab_c"#);
        assert_eq!(
            out,
            r#"owner <user> signed in; "%USERPROFILE%\\x"; table about ab_c"#
        );
        // Lowercasing "Ⱥ" (2 bytes) gives "ⱥ" (3 bytes); matching must stay case-insensitive.
        let r = Redactor::new(None, Some("Ⱥnna"));
        assert_eq!(r.apply("ⱥnna wrote ȺNNA"), "<user> wrote <user>");
    }

    #[cfg(windows)]
    #[test]
    fn redirected_iw4x_log_folders_are_not_read() -> Result<()> {
        let temp = crate::test_tempdir()?;
        let game = temp.path().join("iw4x");
        let private = temp.path().join("private");
        fs::create_dir_all(&game)?;
        fs::create_dir_all(&private)?;
        fs::write(private.join("launcher_secret.log"), b"private")?;
        let status = std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J"])
            .arg(game.join("cache"))
            .arg(&private)
            .stdout(std::process::Stdio::null())
            .status()?;
        assert!(status.success(), "junction fixture");
        assert!(iw4x_files(&game).is_empty());
        Ok(())
    }

    #[test]
    fn bundle_has_state_logs_and_listings_but_never_private_contents() -> Result<()> {
        let temp = crate::test_tempdir()?;
        let data = temp.path().join("data");
        let library = data.join("Games");
        let logs = data.join("diagnostics").join("logs");
        fs::create_dir_all(logs.join("processes"))?;
        fs::create_dir_all(library.join("t7").join("boiii_players"))?;
        fs::create_dir_all(library.join(".gb-stage-abc").join("iw4x"))?;
        fs::write(data.join("settings.json"), br#"{"version":1}"#)?;
        fs::write(
            logs.join("launcher.2026-11-07.log"),
            b"{\"msg\":\"job failed\"}\n",
        )?;
        fs::write(logs.join("events-0.jsonl"), b"{}\n")?;
        fs::write(
            logs.join("processes").join("1-0-iw4x-update.log"),
            b"updating\n",
        )?;
        fs::write(
            library.join("t7").join("boiii_players").join("secret.cfg"),
            b"name PrivatePlayer",
        )?;
        fs::write(
            library.join("t7").join("config.cfg"),
            b"seta name PrivatePlayer",
        )?;
        fs::write(
            library
                .join(".gb-stage-abc")
                .join("iw4x")
                .join("launcher-settings.json"),
            b"{\"channel\":\"stable\"}",
        )?;
        let installed = library.join("iw4x");
        fs::create_dir_all(installed.join("cache"))?;
        fs::create_dir_all(installed.join("sentry").join("attachments"))?;
        fs::write(
            installed.join("cache").join("launcher_20261107_190242.log"),
            b"launching native game process",
        )?;
        fs::write(
            installed
                .join("sentry")
                .join("attachments")
                .join("console.log"),
            b"Getting bots...",
        )?;
        fs::write(
            installed
                .join("sentry")
                .join("attachments")
                .join("iw4x_config.cfg"),
            b"seta name PrivatePlayer",
        )?;
        let path = temp.path().join("bundle.zip");
        let summary = write_bundle(
            &path,
            &BundleInput {
                data: &data,
                library: Some(&library),
                snapshot: None,
                update: None,
                launcher_problem: Some(&Problem::new(
                    "A game file is in use",
                    "Close it",
                    "os error 32",
                )),
            },
        )?;
        assert!(summary.truncated.is_empty());
        let mut archive = zip::ZipArchive::new(fs::File::open(&path)?)?;
        let names = (0..archive.len())
            .map(|i| {
                archive
                    .by_index(i)
                    .and_then(|e| e.name().map(|n| n.into_owned()))
            })
            .collect::<std::result::Result<Vec<String>, _>>()?;
        for expected in [
            "README.txt",
            "summary.json",
            "state/settings.json",
            "listings/library.txt",
            "listings/staging.txt",
            "logs/launcher.2026-11-07.log",
            "logs/events-0.jsonl",
            "logs/processes/1-0-iw4x-update.log",
            "iw4x/1/launcher-settings.json",
            "iw4x/0/cache/launcher_20261107_190242.log",
            "iw4x/0/sentry/attachments/console.log",
        ] {
            assert!(
                names.iter().any(|n| n == expected),
                "missing {expected}: {names:?}"
            );
        }
        let mut everything = String::new();
        for index in 0..archive.len() {
            let mut entry = archive.by_index(index)?;
            entry.read_to_string(&mut everything)?;
        }
        assert!(
            !everything.contains("PrivatePlayer"),
            "save and config contents never leak"
        );
        assert!(
            everything.contains("config.cfg"),
            "config files are listed by name"
        );
        assert!(
            !everything.contains("secret.cfg"),
            "private folders are not descended"
        );
        assert!(everything.contains("os error 32"));
        assert!(!temp.path().join("bundle.zip.partial").exists());
        Ok(())
    }
}
