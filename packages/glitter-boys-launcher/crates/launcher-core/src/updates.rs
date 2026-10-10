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
pub fn verify(envelope: &Envelope, profile: &Profile, current: &str, now: u64) -> Result<Release> {
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
    if !trusted {
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
    let _lock = state::exclusive_lock(&root.join("activation.lock"))?;
    let mut active = read_active(root)?;
    if recover(&mut active)? {
        state::write_json(&root.join("current.json"), &active)?;
    }
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
    // Keep the activation lock until the new process commits startup health or exits.
    // A killed bootstrap leaves attempted=true, causing recovery on the next start.
    for _ in 0..300 {
        let current = read_active(root)?;
        if !current.pending || current.version != active_version {
            return Ok(true);
        }
        if child.try_wait()?.is_some() {
            return Ok(true);
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    Ok(true)
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
#[derive(Clone, Default)]
pub struct UpdateState {
    pub supported: bool,
    pub checking: bool,
    pub message: String,
    pub ready: Option<String>,
}
pub struct Updater {
    state: Arc<Mutex<UpdateState>>,
    root: Option<PathBuf>,
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
            s.message = "Checking for updates…".into();
        }
        let root = self.root.clone();
        let state = self.state.clone();
        let spawned = std::thread::Builder::new()
            .name("launcher-update".into())
            .spawn(move || {
                let result = (|| -> Result<Option<String>> {
                    let profile = profile()?;
                    let Some(root) = root else {
                        return Ok(None);
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
                        return Ok(None);
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
                        return Ok(Some(release.version));
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
                        &[package],
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
                    Ok(Some(release.version))
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
                        Ok(Some(version)) => {
                            s.message = format!("Update {version} installs on exit");
                            s.ready = Some(version);
                        }
                        Ok(None) => s.message = "No launcher update available".into(),
                        Err(e) => s.message = e.to_string(),
                    }
                }
            });
        if let Err(e) = spawned
            && let Ok(mut s) = self.state.lock()
        {
            s.checking = false;
            s.message = e.to_string();
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
        let folder = tempfile::tempdir()?;
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
    fn retention_preserves_current_rollback_newer_and_unrecognized_folders() -> Result<()> {
        let root = tempfile::tempdir()?;
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
        prune_older_versions(root.path(), &active, &profile)?;
        assert!(!old.exists());
        for name in ["1.3.0", "1.4.0", "1.5.0", "0.9.0"] {
            assert!(root.path().join("versions").join(name).is_dir());
        }
        Ok(())
    }
    #[test]
    fn interrupted_extraction_cleanup_preserves_versions_and_downloads() -> Result<()> {
        let root = tempfile::tempdir()?;
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
}
