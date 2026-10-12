//! Signed updates stage beside the current app, then activate only on clean exit.
use crate::{
    Cancellation, Error, Result, archive,
    catalog::Artifact,
    diagnostics::{self, Operation, Outcome},
    download, state,
};
use ed25519_dalek::{Signature, VerifyingKey};
use serde::{Deserialize, Serialize};
use std::{
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::Duration,
};

#[derive(Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Profile {
    pub schema: u8,
    pub channel: String,
    pub manifest_url: String,
    pub public_keys: Vec<String>,
    pub publisher: Option<String>,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Envelope {
    pub payload: String,
    pub signature: String,
}
#[derive(Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Release {
    pub schema: u8,
    pub version: String,
    pub channel: String,
    pub target: String,
    pub minimum_bootstrap: u32,
    pub expires: u64,
    pub expanded_bytes: u64,
    pub executable_sha256: String,
    pub artifact: Artifact,
}
#[derive(Clone, Deserialize, Serialize, Debug)]
#[serde(deny_unknown_fields)]
pub struct Active {
    pub schema: u8,
    pub version: String,
    pub previous: Option<String>,
    pub pending: bool,
    pub attempted: bool,
}
pub fn profile() -> Result<Profile> {
    let p: Profile = serde_json::from_str(include_str!("../../../release-profile.json"))?;
    if p.schema != 1
        || !matches!(p.channel.as_str(), "preview" | "stable")
        || p.manifest_url != format!("https://glitter-boys.com/launcher/{}.json", p.channel)
        || p.public_keys
            .iter()
            .any(|key| key.len() != 64 || !key.bytes().all(|b| b.is_ascii_hexdigit()))
        || p.publisher.as_ref().is_some_and(|v| v.is_empty())
        || p.publisher.is_none() != p.public_keys.is_empty()
        || (p.channel == "stable" && p.publisher.is_none())
    {
        return Err(Error::Invalid("Invalid release profile".into()));
    }
    Ok(p)
}
pub fn version(value: &str) -> Result<[u64; 3]> {
    if value.len() > 48 {
        return Err(Error::Invalid("Invalid release version".into()));
    }
    let parts = value
        .split('.')
        .map(|v| {
            if v.is_empty()
                || (v.len() > 1 && v.starts_with('0'))
                || !v.bytes().all(|c| c.is_ascii_digit())
            {
                return Err(Error::Invalid("Invalid release version".into()));
            }
            v.parse::<u64>()
                .map_err(|_| Error::Invalid("Invalid release version".into()))
        })
        .collect::<Result<Vec<_>>>()?;
    parts
        .try_into()
        .map_err(|_| Error::Invalid("Release version must have three components".into()))
}
fn signature_trusted(envelope: &Envelope, profile: &Profile) -> Result<bool> {
    if envelope.payload.len() > 16 * 1024 {
        return Err(Error::Invalid("Release manifest exceeds size limit".into()));
    }
    let sig = hex::decode(&envelope.signature)
        .map_err(|_| Error::Invalid("Invalid update signature".into()))?;
    let signature = Signature::from_slice(&sig)
        .map_err(|_| Error::Invalid("Invalid update signature".into()))?;
    let message = format!("glitter-boys-release-v1\n{}", envelope.payload);
    let mut trusted = false;
    for key in &profile.public_keys {
        let bytes: [u8; 32] = hex::decode(key)
            .map_err(|_| Error::Invalid("Invalid release verification key".into()))?
            .try_into()
            .map_err(|_| Error::Invalid("Invalid release verification key".into()))?;
        let key = VerifyingKey::from_bytes(&bytes)
            .map_err(|_| Error::Invalid("Invalid release verification key".into()))?;
        if key.verify_strict(message.as_bytes(), &signature).is_ok() {
            trusted = true;
        }
    }
    Ok(trusted)
}
pub fn verify(envelope: &Envelope, profile: &Profile, current: &str, now: u64) -> Result<Release> {
    if !signature_trusted(envelope, profile)? {
        return Err(Error::Invalid(
            "Update signature could not be verified".into(),
        ));
    }
    let release: Release = serde_json::from_str(&envelope.payload)?;
    release.artifact.validate()?;
    let url = reqwest::Url::parse(&release.artifact.url)
        .map_err(|_| Error::Invalid("Invalid update URL".into()))?;
    if release.schema != 1
        || release.target != "x86_64-pc-windows-msvc"
        || release.channel != profile.channel
        || release.minimum_bootstrap > 1
        || release.expires <= now
        || release.expanded_bytes == 0
        || release.expanded_bytes > 512 * 1024 * 1024
        || release.artifact.bytes > 256 * 1024 * 1024
        || release.executable_sha256.len() != 64
        || !release
            .executable_sha256
            .bytes()
            .all(|c| c.is_ascii_hexdigit())
        || url.host_str() != Some("glitter-boys.com")
        || !url.path().starts_with("/launcher/releases/")
        || version(&release.version)? <= version(current)?
    {
        return Err(Error::Invalid(
            "Update is expired, incompatible, or not newer than this version".into(),
        ));
    }
    Ok(release)
}
fn validate_payload(directory: &Path, release: &Release) -> Result<()> {
    crate::install::ensure_plain_directory(directory)?;
    let executable = directory.join("glitter-boys.exe");
    let metadata = std::fs::symlink_metadata(&executable)?;
    if !metadata.is_file()
        || metadata.file_type().is_symlink()
        || download::digest(&executable, &Cancellation::default(), &mut |_| {})?
            != release.executable_sha256.to_ascii_lowercase()
    {
        return Err(Error::Invalid("Staged launcher checksum mismatch".into()));
    }
    for entry in std::fs::read_dir(directory)? {
        let entry = entry?;
        let name = entry.file_name();
        if name != "glitter-boys.exe" && name != "verified-release.json" {
            return Err(Error::Invalid("Unexpected file in launcher update".into()));
        }
    }
    Ok(())
}
fn recover(active: &mut Active) -> Result<bool> {
    if !active.pending || !active.attempted {
        return Ok(false);
    }
    active.version = active
        .previous
        .take()
        .ok_or_else(|| Error::Invalid("No rollback version available".into()))?;
    active.pending = false;
    active.attempted = false;
    Ok(true)
}
/// Called only while holding update.lock, so no live staging writer is removed.
fn prune_interrupted_staging(root: &Path) -> Result<()> {
    let resolved_root = root.canonicalize()?;
    for entry in std::fs::read_dir(root)? {
        let entry = entry?;
        if !entry.file_name().to_string_lossy().starts_with(".update-") {
            continue;
        }
        if !entry.file_type()?.is_dir() || entry.file_type()?.is_symlink() {
            continue;
        }
        let path = entry.path();
        if path.canonicalize()?.parent() != Some(resolved_root.as_path()) {
            return Err(Error::Invalid(
                "Update staging path escaped the install directory".into(),
            ));
        }
        std::fs::remove_dir_all(path)?;
    }
    Ok(())
}
fn read_active(root: &Path) -> Result<Active> {
    let state: Active = serde_json::from_slice(&std::fs::read(root.join("current.json"))?)?;
    version(&state.version)?;
    if let Some(previous) = &state.previous {
        version(previous)?;
    }
    if state.schema != 1 || (state.pending && state.previous.is_none()) {
        return Err(Error::Invalid("Invalid launcher activation state".into()));
    }
    Ok(state)
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct FailedUpdate {
    schema: u8,
    version: String,
}
fn failed_update(root: &Path) -> Result<Option<FailedUpdate>> {
    match std::fs::read(root.join("failed-update.json")) {
        Ok(bytes) => {
            let failed: FailedUpdate = serde_json::from_slice(&bytes)?;
            version(&failed.version)?;
            if failed.schema != 1 {
                return Err(Error::Invalid("Invalid failed update record".into()));
            }
            Ok(Some(failed))
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.into()),
    }
}
fn update_allowed(root: &Path, candidate: &str) -> Result<bool> {
    let candidate = version(candidate)?;
    Ok(match failed_update(root)? {
        Some(failed) => candidate > version(&failed.version)?,
        None => true,
    })
}
fn recover_startup(root: &Path) -> Result<Active> {
    let mut active = read_active(root)?;
    if active.pending && active.attempted {
        // Persist before rollback, so interruption cannot forget the failed release.
        // A separate file keeps current.json compatible with older bootstrap binaries.
        if update_allowed(root, &active.version)? {
            state::write_json(
                &root.join("failed-update.json"),
                &FailedUpdate {
                    schema: 1,
                    version: active.version.clone(),
                },
            )?;
        }
    }
    if recover(&mut active)? {
        state::write_json(&root.join("current.json"), &active)?;
    }
    Ok(active)
}
/// The installer places a stable bootstrap binary next to current.json.
pub fn bootstrap() -> Result<bool> {
    if std::env::var_os("GLITTER_BOYS_INSTALL_ROOT").is_some() {
        managed_root()?;
        return Ok(false);
    }
    let executable = std::env::current_exe()?;
    let root = executable
        .parent()
        .ok_or_else(|| Error::Invalid("Missing application directory".into()))?;
    if !root.join("current.json").exists() {
        return Ok(false);
    }
    let activation_lock = state::exclusive_lock(&root.join("activation.lock"))?;
    let mut active = recover_startup(root)?;
    let path = root
        .join("versions")
        .join(&active.version)
        .join("glitter-boys.exe");
    if !path.is_file() {
        return Err(Error::Invalid(
            "Launcher files are missing. Reinstall the launcher; game files are preserved.".into(),
        ));
    }
    let active_version = active.version.clone();
    if active.pending {
        active.attempted = true;
        state::write_json(&root.join("current.json"), &active)?;
    }
    let mut child = crate::launch::command(
        &path,
        path.parent()
            .ok_or_else(|| Error::Invalid("Invalid version path".into()))?,
    )
    .env("GLITTER_BOYS_INSTALL_ROOT", root)
    .args(std::env::args_os().skip(1))
    .spawn()?;
    observe_startup(
        root,
        &active_version,
        activation_lock,
        || Ok(child.try_wait()?.is_some()),
        || {
            std::thread::sleep(Duration::from_millis(100));
            Ok(())
        },
    )?;
    Ok(true)
}
// Own the activation lock until health is committed or the child actually exits.
// Slow initialization is not failure; elapsed time must never enable rollback.
fn observe_startup(
    root: &Path,
    active_version: &str,
    _activation_lock: std::fs::File,
    mut child_exited: impl FnMut() -> Result<bool>,
    mut pause: impl FnMut() -> Result<()>,
) -> Result<()> {
    loop {
        let current = read_active(root)?;
        if !current.pending || current.version != active_version {
            return Ok(());
        }
        if child_exited()? {
            return Ok(());
        }
        pause()?;
    }
}
pub fn managed_root() -> Result<Option<PathBuf>> {
    let Some(root) = std::env::var_os("GLITTER_BOYS_INSTALL_ROOT") else {
        return Ok(None);
    };
    let root = PathBuf::from(root).canonicalize()?;
    let exe = std::env::current_exe()?.canonicalize()?;
    let expected = root
        .join("versions")
        .join(env!("CARGO_PKG_VERSION"))
        .join("glitter-boys.exe")
        .canonicalize()?;
    if exe != expected {
        return Err(Error::Invalid("Invalid managed launcher location".into()));
    }
    Ok(Some(root))
}
pub fn commit_startup() -> Result<()> {
    if let Some(root) = managed_root()? {
        let mut active = read_active(&root)?;
        if active.version != env!("CARGO_PKG_VERSION") {
            return Err(Error::Invalid(
                "Launcher version does not match activation state".into(),
            ));
        }
        active.pending = false;
        active.attempted = false;
        state::write_json(&root.join("current.json"), &active)?;
        prune_older_versions(&root, &active, &profile()?)?;
    }
    Ok(())
}
/// Only earlier, signed payload directories are owned by automatic retention.
/// Keep the active version, its rollback version, and any newer staged update.
fn prune_older_versions(root: &Path, active: &Active, profile: &Profile) -> Result<()> {
    let versions = root.join("versions");
    crate::install::ensure_plain_directory(&versions)?;
    let resolved_versions = versions.canonicalize()?;
    for entry in std::fs::read_dir(&versions)? {
        let entry = entry?;
        let Some(name) = entry.file_name().to_str().map(str::to_owned) else {
            continue;
        };
        let Ok(number) = version(&name) else {
            continue;
        };
        if number >= version(&active.version)? || active.previous.as_deref() == Some(&name) {
            continue;
        }
        if !entry.file_type()?.is_dir() || entry.file_type()?.is_symlink() {
            continue;
        }
        let directory = entry.path();
        if directory.canonicalize()?.parent() != Some(resolved_versions.as_path()) {
            return Err(Error::Invalid(
                "Version cleanup path escaped the install directory".into(),
            ));
        }
        let metadata = directory.join("verified-release.json");
        if !metadata.is_file() {
            continue;
        }
        let envelope: Envelope = serde_json::from_slice(&std::fs::read(metadata)?)?;
        // A retired key or a changed signature cannot establish cleanup ownership.
        // Preserve the directory without trusting its payload or blocking startup.
        if !signature_trusted(&envelope, profile)? {
            continue;
        }
        // Historical signatures establish ownership even after their release expires.
        let release = verify(&envelope, profile, "0.0.0", 0)?;
        if release.version != name {
            return Err(Error::Invalid("Version cleanup manifest mismatch".into()));
        }
        validate_payload(&directory, &release)?;
        std::fs::remove_dir_all(directory)?;
    }
    Ok(())
}

/// Called only after the staged executable has been verified and promoted, under update.lock.
fn prune_completed_download(root: &Path, artifact: &Artifact) -> Result<()> {
    artifact.validate()?;
    let directory = root.join("update-cache").join(&artifact.sha256);
    if !directory.try_exists()? {
        return Ok(());
    }
    crate::install::ensure_plain_directory(&directory)?;
    let archive = directory.join(&artifact.file);
    match std::fs::symlink_metadata(&archive) {
        Ok(metadata) => {
            if !metadata.is_file()
                || crate::storage::redirected(&metadata)
                || metadata.len() != artifact.bytes
                || download::digest(&archive, &Cancellation::default(), &mut |_| {})?
                    != artifact.sha256.to_ascii_lowercase()
            {
                return Err(Error::Invalid(
                    "Unexpected completed update download".into(),
                ));
            }
            std::fs::remove_file(archive)?;
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error.into()),
    }
    // Never recursively delete cache contents: partial and unrelated entries survive.
    if std::fs::read_dir(&directory)?.next().transpose()?.is_none() {
        std::fs::remove_dir(directory)?;
    }
    Ok(())
}
#[derive(Clone, Default)]
pub struct UpdateState {
    pub error: Option<String>,
    pub supported: bool,
    pub checking: bool,
    pub message: String,
    pub ready: Option<String>,
}
pub struct Updater {
    state: Arc<Mutex<UpdateState>>,
    root: Option<PathBuf>,
}
enum UpdateCheckResult {
    Current,
    Ready(String),
    FailedRelease,
}
impl Updater {
    pub fn new() -> Result<Self> {
        let root = managed_root()?;
        let profile = profile()?;
        let supported =
            root.is_some() && !profile.public_keys.is_empty() && profile.publisher.is_some();
        Ok(Self {
            state: Arc::new(Mutex::new(UpdateState {
                supported,
                message: if supported { "Updates are checked automatically." } else { "Automatic updates aren't available in this preview. Get new versions from Jerred." }.into(),
                ..Default::default()
            })),
            root,
        })
    }
    pub fn snapshot(&self) -> Result<UpdateState> {
        self.state
            .lock()
            .map(|s| s.clone())
            .map_err(|_| Error::Invalid("Update state lock failed; restart the launcher".into()))
    }
    pub fn check(&self) {
        if let Ok(mut s) = self.state.lock() {
            if !s.supported || s.checking || s.ready.is_some() {
                return;
            }
            s.checking = true;
            s.error = None;
            s.message = "Checking for updates…".into();
        }
        let root = self.root.clone();
        let state = self.state.clone();
        let spawned = std::thread::Builder::new()
            .name("launcher-update".into())
            .spawn(move || {
                let result = (|| -> Result<UpdateCheckResult> {
                    let profile = profile()?;
                    let Some(root) = root else {
                        return Ok(UpdateCheckResult::Current);
                    };
                    if profile.public_keys.is_empty() || profile.publisher.is_none() {
                        return Err(Error::Invalid(
                            "Updates await release signing configuration".into(),
                        ));
                    }
                    let runtime = tokio::runtime::Builder::new_current_thread()
                        .enable_all()
                        .build()?;
                    let client = reqwest::Client::builder()
                        .https_only(true)
                        .timeout(Duration::from_secs(15))
                        .redirect(reqwest::redirect::Policy::none())
                        .build()?;
                    let envelope = runtime.block_on(async {
                        let mut response = client
                            .get(&profile.manifest_url)
                            .send()
                            .await?
                            .error_for_status()?;
                        let mut bytes = Vec::new();
                        while let Some(chunk) = response.chunk().await? {
                            if bytes.len() + chunk.len() > 32 * 1024 {
                                return Err(Error::Invalid(
                                    "Release manifest exceeds size limit".into(),
                                ));
                            }
                            bytes.extend_from_slice(&chunk);
                        }
                        Ok::<Envelope, Error>(serde_json::from_slice(&bytes)?)
                    })?;
                    // Equal-version manifests still need authenticity verification before being trusted.
                    let now = std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .map_err(|_| Error::Invalid("Windows clock is invalid".into()))?
                        .as_secs();
                    let release = verify(&envelope, &profile, "0.0.0", now)?;
                    if version(&release.version)? <= version(env!("CARGO_PKG_VERSION"))? {
                        return Ok(UpdateCheckResult::Current);
                    }
                    if !update_allowed(&root, &release.version)? {
                        return Ok(UpdateCheckResult::FailedRelease);
                    }
                    let destination = root.join("versions").join(&release.version);
                    let _staging_lock = state::exclusive_lock(&root.join("update.lock"))?;
                    prune_interrupted_staging(&root)?;
                    if destination.exists() {
                        validate_payload(&destination, &release)?;
                        #[cfg(windows)]
                        crate::windows_installer::verify_publisher(
                            &destination.join("glitter-boys.exe"),
                            profile.publisher.as_deref().ok_or_else(|| {
                                Error::Invalid("Missing release publisher".into())
                            })?,
                        )?;
                        state::write_json(&destination.join("verified-release.json"), &envelope)?;
                        prune_completed_download(&root, &release.artifact)?;
                        return Ok(UpdateCheckResult::Ready(release.version));
                    }
                    if install_space(&root)?
                        < release
                            .expanded_bytes
                            .saturating_add(release.artifact.bytes)
                            .saturating_add(512 * 1024 * 1024)
                    {
                        return Err(Error::Invalid(
                            "Not enough disk space for a launcher update".into(),
                        ));
                    }
                    let cancel = Cancellation::default();
                    let package = download::fetch(
                        &download::client()?,
                        &release.artifact,
                        &root.join("update-cache"),
                        &cancel,
                        &mut |_| {},
                    )?;
                    let staging = tempfile::Builder::new()
                        .prefix(".update-")
                        .tempdir_in(&root)?;
                    archive::extract_with_workers(
                        std::slice::from_ref(&package),
                        staging.path(),
                        release.expanded_bytes,
                        None,
                        &cancel,
                        &mut |_| {},
                        1,
                    )?;
                    validate_payload(staging.path(), &release)?;
                    #[cfg(windows)]
                    crate::windows_installer::verify_publisher(
                        &staging.path().join("glitter-boys.exe"),
                        profile
                            .publisher
                            .as_deref()
                            .ok_or_else(|| Error::Invalid("Missing release publisher".into()))?,
                    )?;
                    state::write_json(&staging.path().join("verified-release.json"), &envelope)?;
                    std::fs::create_dir_all(root.join("versions"))?;
                    std::fs::rename(staging.path(), &destination)?;
                    prune_completed_download(&root, &release.artifact)?;
                    Ok(UpdateCheckResult::Ready(release.version))
                })();
                diagnostics::record(
                    None,
                    Operation::UpdateCheck,
                    if result.is_ok() {
                        Outcome::Succeeded
                    } else {
                        Outcome::Failed
                    },
                    result.as_ref().err().and_then(diagnostics::failure),
                    0,
                    0,
                );
                if let Ok(mut s) = state.lock() {
                    s.checking = false;
                    match result {
                        Ok(UpdateCheckResult::Ready(version)) => {
                            s.message = format!("Version {version} is ready. It installs when you close Glitter Boys.");
                            s.ready = Some(version);
                        }
                        Ok(UpdateCheckResult::Current) => s.message = "You're up to date.".into(),
                        Ok(UpdateCheckResult::FailedRelease) => s.message = "The last update couldn't start. You're using your previous version until a newer update is available.".into(),
                        Err(e) => { s.message = "Couldn't check for updates. Try again later.".into(); s.error = Some(e.to_string()); },
                    }
                }
            });
        if let Err(e) = spawned
            && let Ok(mut s) = self.state.lock()
        {
            s.checking = false;
            s.message = "Couldn't check for updates. Try again later.".into();
            s.error = Some(e.to_string());
        }
    }
    pub fn apply_on_exit(&self) -> Result<()> {
        let Some(root) = &self.root else {
            return Ok(());
        };
        let Some(version) = self.snapshot()?.ready else {
            return Ok(());
        };
        let _lock = state::exclusive_lock(&root.join("activation.lock"))?;
        let current = read_active(root)?;
        let envelope: Envelope = serde_json::from_slice(&std::fs::read(
            root.join("versions")
                .join(&version)
                .join("verified-release.json"),
        )?)?;
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|_| Error::Invalid("Windows clock is invalid".into()))?
            .as_secs();
        let release = verify(&envelope, &profile()?, &current.version, now)?;
        if !update_allowed(root, &release.version)? {
            return Err(Error::Invalid(
                "This launcher update previously failed to start".into(),
            ));
        }
        if release.version != version {
            return Err(Error::Invalid("Staged update version mismatch".into()));
        }
        validate_payload(&root.join("versions").join(&version), &release)?;
        state::write_json(
            &root.join("current.json"),
            &Active {
                schema: 1,
                version,
                previous: Some(current.version),
                pending: true,
                attempted: false,
            },
        )?;
        diagnostics::record(None, Operation::UpdateApply, Outcome::Succeeded, None, 0, 0);
        Ok(())
    }
}
fn install_space(root: &Path) -> Result<u64> {
    Ok(fs2::available_space(root)?)
}
#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};
    fn fixture() -> (Envelope, Profile) {
        let key = SigningKey::from_bytes(&[7; 32]);
        let payload=serde_json::json!({"schema":1,"version":"1.2.3","channel":"stable","target":"x86_64-pc-windows-msvc","minimum_bootstrap":1,"expires":2000,"expanded_bytes":100,"executable_sha256":"b".repeat(64),"artifact":{"file":"launcher.zip","url":"https://glitter-boys.com/launcher/releases/1.2.3/launcher.zip","bytes":10,"sha256":"a".repeat(64)}}).to_string();
        let signature = hex::encode(
            key.sign(format!("glitter-boys-release-v1\n{payload}").as_bytes())
                .to_bytes(),
        );
        (
            Envelope { payload, signature },
            Profile {
                schema: 1,
                channel: "stable".into(),
                manifest_url: String::new(),
                public_keys: vec![hex::encode(key.verifying_key().to_bytes())],
                publisher: Some("test".into()),
            },
        )
    }
    #[test]
    fn tampering_expiry_channel_and_downgrades_fail() -> Result<()> {
        let (mut e, mut p) = fixture();
        assert_eq!(verify(&e, &p, "1.0.0", 1000)?.version, "1.2.3");
        assert!(verify(&e, &p, "1.2.3", 1000).is_err());
        assert!(verify(&e, &p, "1.0.0", 2000).is_err());
        p.channel = "preview".into();
        assert!(verify(&e, &p, "1.0.0", 1000).is_err());
        p.channel = "stable".into();
        e.payload = e.payload.replace("1.2.3", "9.2.3");
        assert!(verify(&e, &p, "1.0.0", 1000).is_err());
        Ok(())
    }
    #[test]
    fn versions_cannot_escape_the_install_directory() {
        for value in ["../1", "1.2", "1.2.3/../../", "01.2.3", "1.2.3-beta"] {
            assert!(version(value).is_err());
        }
    }
    #[test]
    fn interrupted_staging_is_reusable_but_changed_executables_are_rejected() -> Result<()> {
        let (envelope, profile) = fixture();
        let mut release = verify(&envelope, &profile, "1.0.0", 1000)?;
        let folder = crate::test_tempdir()?;
        let executable = folder.path().join("glitter-boys.exe");
        std::fs::write(&executable, b"fixture executable")?;
        release.executable_sha256 =
            download::digest(&executable, &Cancellation::default(), &mut |_| {})?;
        // Both a crash before saving the envelope and a completed staged update are reusable.
        validate_payload(folder.path(), &release)?;
        state::write_json(&folder.path().join("verified-release.json"), &envelope)?;
        validate_payload(folder.path(), &release)?;
        std::fs::write(&executable, b"changed executable")?;
        assert!(validate_payload(folder.path(), &release).is_err());
        Ok(())
    }
    #[test]
    fn slow_startup_keeps_activation_locked_until_health_is_committed() -> Result<()> {
        let root = crate::test_tempdir()?;
        let lock_path = root.path().join("activation.lock");
        let mut active = Active {
            schema: 1,
            version: "1.2.3".into(),
            previous: Some("1.0.0".into()),
            pending: true,
            attempted: true,
        };
        state::write_json(&root.path().join("current.json"), &active)?;
        let lock = state::exclusive_lock(&lock_path)?;
        let mut intervals = 0;
        observe_startup(
            root.path(),
            "1.2.3",
            lock,
            || Ok(false),
            || {
                // Model 35 seconds of initialization without delaying the test clock.
                assert!(state::exclusive_lock(&lock_path).is_err());
                assert_eq!(read_active(root.path())?.version, "1.2.3");
                assert!(failed_update(root.path())?.is_none());
                intervals += 1;
                if intervals == 350 {
                    active.pending = false;
                    active.attempted = false;
                    state::write_json(&root.path().join("current.json"), &active)?;
                }
                Ok(())
            },
        )?;
        assert_eq!(intervals, 350);
        let _lock = state::exclusive_lock(&lock_path)?;
        assert_eq!(recover_startup(root.path())?.version, "1.2.3");
        assert!(failed_update(root.path())?.is_none());
        Ok(())
    }
    #[test]
    fn exited_startup_child_releases_activation_for_recovery() -> Result<()> {
        let root = crate::test_tempdir()?;
        let lock_path = root.path().join("activation.lock");
        state::write_json(
            &root.path().join("current.json"),
            &Active {
                schema: 1,
                version: "1.2.3".into(),
                previous: Some("1.0.0".into()),
                pending: true,
                attempted: true,
            },
        )?;
        observe_startup(
            root.path(),
            "1.2.3",
            state::exclusive_lock(&lock_path)?,
            || Ok(true),
            || Err(Error::Invalid("An exited child must not wait".into())),
        )?;
        let _lock = state::exclusive_lock(&lock_path)?;
        assert_eq!(recover_startup(root.path())?.version, "1.0.0");
        assert!(!update_allowed(root.path(), "1.2.3")?);
        Ok(())
    }
    #[test]
    fn failed_startup_rolls_back_once_and_healthy_startup_stays_current() -> Result<()> {
        let mut state = Active {
            schema: 1,
            version: "1.2.3".into(),
            previous: Some("1.0.0".into()),
            pending: true,
            attempted: false,
        };
        assert!(!recover(&mut state)?);
        state.attempted = true;
        assert!(recover(&mut state)?);
        assert_eq!(state.version, "1.0.0");
        assert!(!recover(&mut state)?);
        state.version = "1.2.3".into();
        state.previous = Some("1.0.0".into());
        state.pending = false;
        assert!(!recover(&mut state)?);
        assert_eq!(state.version, "1.2.3");
        Ok(())
    }
    #[test]
    fn rollback_persists_rejection_until_the_signed_channel_advances() -> Result<()> {
        let root = crate::test_tempdir()?;
        let (envelope, profile) = fixture();
        let failed_release = verify(&envelope, &profile, "1.0.0", 1000)?;
        let failed_directory = root.path().join("versions").join(&failed_release.version);
        std::fs::create_dir_all(&failed_directory)?;
        let active = Active {
            schema: 1,
            version: failed_release.version.clone(),
            previous: Some("1.0.0".into()),
            pending: true,
            attempted: true,
        };
        state::write_json(&root.path().join("current.json"), &active)?;
        let recovered = recover_startup(root.path())?;
        assert_eq!(recovered.version, "1.0.0");
        assert!(!recovered.pending);
        assert!(failed_directory.is_dir());
        // Every subsequent check of the unchanged, authentic channel remains suppressed,
        // even though the failed payload still exists and the process has restarted.
        for _ in 0..3 {
            assert!(!update_allowed(root.path(), &failed_release.version)?);
            assert_eq!(recover_startup(root.path())?.version, "1.0.0");
        }
        assert!(!update_allowed(root.path(), "1.2.2")?);
        assert!(update_allowed(root.path(), "1.2.4")?);
        // A crash between recording rejection and writing rollback is safe to retry.
        state::write_json(&root.path().join("current.json"), &active)?;
        assert_eq!(recover_startup(root.path())?.version, "1.0.0");
        assert!(!update_allowed(root.path(), &failed_release.version)?);
        // Recovering an earlier attempted version must not forget the newer failure.
        let earlier = Active {
            version: "1.1.0".into(),
            ..active
        };
        state::write_json(&root.path().join("current.json"), &earlier)?;
        recover_startup(root.path())?;
        assert_eq!(
            failed_update(root.path())?.map(|failed| failed.version),
            Some("1.2.3".into())
        );
        std::fs::write(root.path().join("failed-update.json"), b"invalid")?;
        assert!(update_allowed(root.path(), "1.2.4").is_err());
        Ok(())
    }
    #[test]
    fn retention_preserves_current_rollback_newer_and_unrecognized_folders() -> Result<()> {
        let root = crate::test_tempdir()?;
        let (mut envelope, profile) = fixture();
        for name in ["1.2.3", "1.3.0", "1.4.0", "1.5.0", "0.9.0"] {
            std::fs::create_dir_all(root.path().join("versions").join(name))?;
        }
        let old = root.path().join("versions/1.2.3");
        let exe = old.join("glitter-boys.exe");
        std::fs::write(&exe, b"old executable")?;
        let mut payload: serde_json::Value = serde_json::from_str(&envelope.payload)?;
        payload["executable_sha256"] =
            download::digest(&exe, &Cancellation::default(), &mut |_| {})?.into();
        envelope.payload = payload.to_string();
        envelope.signature = hex::encode(
            SigningKey::from_bytes(&[7; 32])
                .sign(format!("glitter-boys-release-v1\n{}", envelope.payload).as_bytes())
                .to_bytes(),
        );
        state::write_json(&old.join("verified-release.json"), &envelope)?;
        let active = Active {
            schema: 1,
            version: "1.4.0".into(),
            previous: Some("1.3.0".into()),
            pending: false,
            attempted: false,
        };
        // Installed startup passes a canonical root, which uses a verbatim disk prefix on Windows.
        prune_older_versions(&root.path().canonicalize()?, &active, &profile)?;
        assert!(!old.exists());
        for name in ["1.3.0", "1.4.0", "1.5.0", "0.9.0"] {
            assert!(root.path().join("versions").join(name).is_dir());
        }
        Ok(())
    }
    #[test]
    fn interrupted_extraction_cleanup_preserves_versions_and_downloads() -> Result<()> {
        let root = crate::test_tempdir()?;
        for name in [".update-fixture", "versions", "update-cache"] {
            std::fs::create_dir(root.path().join(name))?;
        }
        std::fs::write(root.path().join(".update-fixture/partial.exe"), b"partial")?;
        let _lock = state::exclusive_lock(&root.path().join("update.lock"))?;
        prune_interrupted_staging(root.path())?;
        assert!(!root.path().join(".update-fixture").exists());
        assert!(root.path().join("versions").is_dir());
        assert!(root.path().join("update-cache").is_dir());
        Ok(())
    }
    #[test]
    fn retention_survives_retired_keys_without_trusting_tampered_history() -> Result<()> {
        let root = crate::test_tempdir()?;
        let old = root.path().join("versions/1.2.3");
        std::fs::create_dir_all(&old)?;
        let executable = old.join("glitter-boys.exe");
        std::fs::write(&executable, b"old executable")?;
        let (mut envelope, mut profile) = fixture();
        let mut payload: serde_json::Value = serde_json::from_str(&envelope.payload)?;
        payload["executable_sha256"] =
            download::digest(&executable, &Cancellation::default(), &mut |_| {})?.into();
        envelope.payload = payload.to_string();
        envelope.signature = hex::encode(
            SigningKey::from_bytes(&[7; 32])
                .sign(format!("glitter-boys-release-v1\n{}", envelope.payload).as_bytes())
                .to_bytes(),
        );
        let release = verify(&envelope, &profile, "0.0.0", 0)?;
        validate_payload(&old, &release)?;
        state::write_json(&old.join("verified-release.json"), &envelope)?;
        let active = Active {
            schema: 1,
            version: "1.4.0".into(),
            previous: Some("1.3.0".into()),
            pending: false,
            attempted: false,
        };
        profile.public_keys = vec![hex::encode(
            SigningKey::from_bytes(&[8; 32]).verifying_key().to_bytes(),
        )];
        prune_older_versions(root.path(), &active, &profile)?;
        assert!(old.is_dir());
        assert!(verify(&envelope, &profile, "0.0.0", 0).is_err());
        // A changed signature is indistinguishable from a retired key: keep, never execute/delete.
        let (_, original_profile) = fixture();
        envelope.payload = envelope.payload.replace("2000", "3000");
        state::write_json(&old.join("verified-release.json"), &envelope)?;
        prune_older_versions(root.path(), &active, &original_profile)?;
        assert!(old.is_dir());
        assert!(verify(&envelope, &original_profile, "0.0.0", 0).is_err());
        // Malformed local metadata remains an explicit error rather than being suppressed.
        envelope.signature = "malformed".into();
        state::write_json(&old.join("verified-release.json"), &envelope)?;
        assert!(prune_older_versions(root.path(), &active, &original_profile).is_err());
        Ok(())
    }
    #[test]
    fn completed_update_cache_cleanup_removes_only_verified_archives() -> Result<()> {
        use sha2::{Digest, Sha256};
        let root = crate::test_tempdir()?;
        let (envelope, profile) = fixture();
        let mut artifact = verify(&envelope, &profile, "0.0.0", 0)?.artifact;
        let contents = b"completed update archive";
        artifact.bytes = contents.len() as u64;
        artifact.sha256 = hex::encode(Sha256::digest(contents));
        let directory = root.path().join("update-cache").join(&artifact.sha256);
        std::fs::create_dir_all(&directory)?;
        let archive = directory.join(&artifact.file);
        let partial = directory.join(format!("{}.partial", artifact.file));
        std::fs::write(&partial, b"interrupted download")?;
        prune_completed_download(root.path(), &artifact)?;
        assert!(partial.is_file());
        std::fs::write(&archive, contents)?;
        std::fs::write(directory.join("unrelated"), b"keep")?;
        prune_completed_download(root.path(), &artifact)?;
        assert!(!archive.exists());
        assert!(partial.is_file());
        assert!(directory.join("unrelated").is_file());
        std::fs::write(&archive, b"corrupt archive")?;
        assert!(prune_completed_download(root.path(), &artifact).is_err());
        assert!(archive.is_file());
        std::fs::write(&archive, contents)?;
        std::fs::remove_file(partial)?;
        std::fs::remove_file(directory.join("unrelated"))?;
        prune_completed_download(root.path(), &artifact)?;
        assert!(!directory.exists());
        assert!(root.path().join("update-cache").is_dir());
        Ok(())
    }
    #[cfg(windows)]
    #[test]
    fn update_cache_cleanup_rejects_junctions_without_touching_the_target() -> Result<()> {
        let root = crate::test_tempdir()?;
        let outside = crate::test_tempdir()?;
        let (envelope, profile) = fixture();
        let artifact = verify(&envelope, &profile, "0.0.0", 0)?.artifact;
        let cache = root.path().join("update-cache");
        std::fs::create_dir(&cache)?;
        std::fs::write(outside.path().join(&artifact.file), b"keep")?;
        let junction = cache.join(&artifact.sha256);
        let output = std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J"])
            .arg(&junction)
            .arg(outside.path())
            .output()?;
        assert!(output.status.success(), "junction fixture failed");
        assert!(prune_completed_download(root.path(), &artifact).is_err());
        assert_eq!(std::fs::read(outside.path().join(&artifact.file))?, b"keep");
        std::fs::remove_dir(junction)?;
        Ok(())
    }
}
