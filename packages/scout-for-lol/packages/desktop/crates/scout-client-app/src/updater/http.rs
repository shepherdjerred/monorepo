//! The production [`Updater`]: manifest and installers over HTTPS.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use minisign_verify::PublicKey;
use reqwest::redirect::Policy;
use semver::Version;
use tokio::io::AsyncWriteExt as _;

use super::install::Installer;
use super::manifest::{MAX_MANIFEST_BYTES, Manifest, Platform, artifact_file_name};
use super::verify::{parse_public_key, verify_file};
use super::{AvailableUpdate, StagedUpdate, UpdateError, Updater};

const MANIFEST_TIMEOUT: Duration = Duration::from_secs(30);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
/// A download that sends nothing for this long is dead.
const READ_TIMEOUT: Duration = Duration::from_secs(60);

/// Where a build looks for its updates.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UpdateEndpoint {
    /// The release origin, without a trailing slash.
    pub origin: String,
    /// `stable` or `beta`.
    pub channel: String,
}

impl UpdateEndpoint {
    /// The channel manifest's URL: `<origin>/<channel>.json`.
    #[must_use]
    pub fn manifest_url(&self) -> String {
        format!("{}/{}.json", self.origin, self.channel)
    }
}

/// Fetches the channel manifest and installers over HTTPS and verifies them
/// against the channel's compiled-in key.
pub struct HttpUpdater {
    client: reqwest::Client,
    endpoint: UpdateEndpoint,
    public_key: PublicKey,
    platform: Platform,
    staging: PathBuf,
    installer: Arc<dyn Installer>,
}

impl HttpUpdater {
    /// An updater for `endpoint` that stages installers under `staging`.
    ///
    /// # Errors
    ///
    /// The compiled-in key is not a minisign public key, or the HTTP client
    /// cannot be built. Either makes the build itself broken.
    pub fn new(
        endpoint: UpdateEndpoint,
        public_key: &str,
        platform: Platform,
        staging: PathBuf,
        installer: Arc<dyn Installer>,
    ) -> Result<Self, UpdateError> {
        let client = reqwest::Client::builder()
            // A release is one URL on one origin. A redirect would let the
            // bucket send the client somewhere the contract does not name.
            .redirect(Policy::none())
            .connect_timeout(CONNECT_TIMEOUT)
            .read_timeout(READ_TIMEOUT)
            .user_agent(concat!("scout-desktop/", env!("CARGO_PKG_VERSION")))
            .build()
            .map_err(|error| UpdateError::Network(error.to_string()))?;
        Ok(Self {
            client,
            endpoint,
            public_key: parse_public_key(public_key)?,
            platform,
            staging,
            installer,
        })
    }

    async fn fetch_manifest(&self) -> Result<Manifest, UpdateError> {
        let mut response = self
            .client
            .get(self.endpoint.manifest_url())
            .timeout(MANIFEST_TIMEOUT)
            .send()
            .await
            .map_err(|error| UpdateError::Network(error.to_string()))?;
        if response.status() != reqwest::StatusCode::OK {
            return Err(UpdateError::Status(response.status().as_u16()));
        }
        let mut body = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|error| UpdateError::Network(error.to_string()))?
        {
            if body.len() + chunk.len() > MAX_MANIFEST_BYTES {
                return Err(UpdateError::TooLarge);
            }
            body.extend_from_slice(&chunk);
        }
        Ok(Manifest::parse(
            &body,
            &self.endpoint.origin,
            &self.endpoint.channel,
            self.platform,
        )?)
    }

    async fn verified(&self, path: PathBuf, update: &AvailableUpdate) -> Result<(), UpdateError> {
        let artifact = update.artifact.clone();
        let key = self.public_key.clone();
        tokio::task::spawn_blocking(move || verify_file(&path, &artifact, &key))
            .await
            .map_err(|error| std::io::Error::other(error.to_string()))??;
        Ok(())
    }
}

impl Updater for HttpUpdater {
    async fn check(&self, current: &Version) -> Result<Option<AvailableUpdate>, UpdateError> {
        let manifest = self.fetch_manifest().await?;
        // Never downgrade, and never reinstall: only a strictly newer release
        // is an update.
        if manifest.version <= *current {
            // Whatever was staged is installed already or withdrawn.
            prune_staging(&self.staging, None).await;
            return Ok(None);
        }
        let Some(artifact) = manifest.artifact().cloned() else {
            return Ok(None);
        };
        let Some(file_name) = artifact_file_name(
            &artifact.url,
            &self.endpoint.origin,
            &manifest.version.to_string(),
        ) else {
            // `Manifest::parse` already refused such a URL.
            return Ok(None);
        };
        Ok(Some(AvailableUpdate {
            required: *current < manifest.minimum_version,
            version: manifest.version,
            notes: manifest.notes,
            artifact,
            file_name,
        }))
    }

    async fn download(&self, update: &AvailableUpdate) -> Result<StagedUpdate, UpdateError> {
        let directory = self.staging.join(update.version.to_string());
        let target = directory.join(&update.file_name);
        let staged = StagedUpdate {
            version: update.version.clone(),
            required: update.required,
            path: target.clone(),
            artifact: update.artifact.clone(),
        };
        // An installer that finished downloading in an earlier run is reused,
        // after the same verification a fresh one gets.
        if tokio::fs::try_exists(&target).await? {
            if self.verified(target.clone(), update).await.is_ok() {
                prune_staging(&self.staging, Some(&update.version)).await;
                return Ok(staged);
            }
            tokio::fs::remove_file(&target).await?;
        }
        tokio::fs::create_dir_all(&directory).await?;
        let partial = directory.join(format!("{}.partial", update.file_name));
        let downloaded = self.download_to(&partial, update).await;
        let verified = match downloaded {
            Ok(()) => self.verified(partial.clone(), update).await,
            Err(error) => Err(error),
        };
        if let Err(error) = verified {
            // A partial or distrusted file must not linger.
            let _ignored = tokio::fs::remove_file(&partial).await;
            return Err(error);
        }
        tokio::fs::rename(&partial, &target).await?;
        prune_staging(&self.staging, Some(&update.version)).await;
        Ok(staged)
    }

    fn install(&self, staged: &StagedUpdate, restart: bool) -> Result<(), UpdateError> {
        // Once more, right before it runs: this is the file about to execute.
        verify_file(&staged.path, &staged.artifact, &self.public_key)?;
        self.installer.install(&staged.path, restart)?;
        Ok(())
    }
}

impl HttpUpdater {
    async fn download_to(&self, path: &Path, update: &AvailableUpdate) -> Result<(), UpdateError> {
        let mut response = self
            .client
            .get(&update.artifact.url)
            .send()
            .await
            .map_err(|error| UpdateError::Network(error.to_string()))?;
        if response.status() != reqwest::StatusCode::OK {
            return Err(UpdateError::Status(response.status().as_u16()));
        }
        let limit = update.artifact.size;
        if response
            .content_length()
            .is_some_and(|length| length != limit)
        {
            return Err(UpdateError::TooLarge);
        }
        let mut file = tokio::fs::File::create(path).await?;
        let mut written: u64 = 0;
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|error| UpdateError::Network(error.to_string()))?
        {
            written = written.saturating_add(chunk.len() as u64);
            if written > limit {
                return Err(UpdateError::TooLarge);
            }
            file.write_all(&chunk).await?;
        }
        file.flush().await?;
        Ok(())
    }
}

/// Remove staged release directories other than `keep`. Only directories named
/// like a version are touched, so nothing a user or another tool put here is.
async fn prune_staging(root: &Path, keep: Option<&Version>) {
    let Ok(mut entries) = tokio::fs::read_dir(root).await else {
        return;
    };
    while let Ok(Some(entry)) = entries.next_entry().await {
        let name = entry.file_name();
        let Some(version) = name.to_str().and_then(|name| Version::parse(name).ok()) else {
            continue;
        };
        if keep == Some(&version) || !entry.file_type().await.is_ok_and(|kind| kind.is_dir()) {
            continue;
        }
        if let Err(error) = tokio::fs::remove_dir_all(entry.path()).await {
            tracing::warn!(%error, "could not remove a stale staged update");
        }
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicU32, Ordering};
    use std::sync::{Arc, Mutex, PoisonError};

    use semver::Version;
    use serde_json::json;
    use sha2::{Digest as _, Sha256};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    use super::{HttpUpdater, UpdateEndpoint};
    use crate::updater::install::Installer;
    use crate::updater::manifest::{ArtifactFormat, Platform};
    use crate::updater::verify::VerifyError;
    use crate::updater::verify::testing::{PAYLOAD, PAYLOAD_SIGNATURE, TEST_PUBLIC_KEY};
    use crate::updater::{UpdateError, Updater};

    type TestResult = Result<(), Box<dyn std::error::Error>>;

    /// What a fake release host answers for one path.
    #[derive(Clone)]
    struct Reply {
        status: u16,
        body: Vec<u8>,
    }

    struct Host {
        origin: String,
        routes: Arc<Mutex<HashMap<String, Reply>>>,
        requests: Arc<Mutex<Vec<String>>>,
    }

    impl Host {
        async fn start() -> Result<Self, Box<dyn std::error::Error>> {
            let listener = TcpListener::bind("127.0.0.1:0").await?;
            let origin = format!("http://{}", listener.local_addr()?);
            let routes: Arc<Mutex<HashMap<String, Reply>>> = Arc::default();
            let requests: Arc<Mutex<Vec<String>>> = Arc::default();
            let (served, seen) = (Arc::clone(&routes), Arc::clone(&requests));
            tokio::spawn(async move {
                while let Ok((mut stream, _)) = listener.accept().await {
                    let (served, seen) = (Arc::clone(&served), Arc::clone(&seen));
                    tokio::spawn(async move {
                        let mut buffer = vec![0_u8; 4096];
                        let Ok(read) = stream.read(&mut buffer).await else {
                            return;
                        };
                        let request = String::from_utf8_lossy(&buffer[..read]).into_owned();
                        let path = request
                            .split_whitespace()
                            .nth(1)
                            .unwrap_or_default()
                            .to_owned();
                        seen.lock()
                            .unwrap_or_else(PoisonError::into_inner)
                            .push(path.clone());
                        let reply = served
                            .lock()
                            .unwrap_or_else(PoisonError::into_inner)
                            .get(&path)
                            .cloned()
                            .unwrap_or(Reply {
                                status: 404,
                                body: Vec::new(),
                            });
                        let head = format!(
                            "HTTP/1.1 {} X\r\ncontent-length: {}\r\nconnection: close\r\n\r\n",
                            reply.status,
                            reply.body.len()
                        );
                        let _ = stream.write_all(head.as_bytes()).await;
                        let _ = stream.write_all(&reply.body).await;
                    });
                }
            });
            Ok(Self {
                origin,
                routes,
                requests,
            })
        }

        fn serve(&self, path: &str, status: u16, body: &[u8]) {
            self.routes
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .insert(
                    path.to_owned(),
                    Reply {
                        status,
                        body: body.to_vec(),
                    },
                );
        }

        fn requested(&self, path: &str) -> usize {
            self.requests
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .iter()
                .filter(|seen| seen.as_str() == path)
                .count()
        }

        /// Publish `version` on `channel` with the signed fixture installer.
        fn publish(&self, channel: &str, version: &str, minimum: &str) {
            self.publish_platforms(channel, version, minimum, &[Platform::WindowsX86_64]);
        }

        /// Publish `version` with the signed fixture as each platform's
        /// artifact.
        fn publish_platforms(
            &self,
            channel: &str,
            version: &str,
            minimum: &str,
            platforms: &[Platform],
        ) {
            let mut entries = serde_json::Map::new();
            for platform in platforms {
                let file = match platform {
                    Platform::WindowsX86_64 => "installer.exe",
                    Platform::DarwinUniversal => "scout-desktop.app.tar.gz",
                };
                entries.insert(
                    platform.key().to_owned(),
                    json!({
                        "url": format!("{}/releases/{version}/{file}", self.origin),
                        "sha256": hex::encode(Sha256::digest(PAYLOAD)),
                        "size": PAYLOAD.len(),
                        "signature": PAYLOAD_SIGNATURE.trim(),
                        "format": platform.format(),
                    }),
                );
                self.serve(&format!("/releases/{version}/{file}"), 200, PAYLOAD);
            }
            let manifest = json!({
                "schema": 1,
                "schemaMinor": 0,
                "channel": channel,
                "version": version,
                "minimumVersion": minimum,
                "publishedAt": "2026-11-14T12:00:00Z",
                "notes": "Notes.",
                "platforms": entries,
            });
            self.serve(
                &format!("/{channel}.json"),
                200,
                manifest.to_string().as_bytes(),
            );
        }
    }

    /// Records what it was asked to run, and starts nothing.
    #[derive(Default)]
    struct RecordingInstaller {
        runs: Mutex<Vec<(PathBuf, bool)>>,
        count: AtomicU32,
    }

    impl Installer for RecordingInstaller {
        fn install(&self, installer: &Path, restart: bool) -> std::io::Result<()> {
            self.count.fetch_add(1, Ordering::SeqCst);
            self.runs
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .push((installer.to_path_buf(), restart));
            Ok(())
        }
    }

    struct Fixture {
        host: Host,
        updater: HttpUpdater,
        installer: Arc<RecordingInstaller>,
        staging: PathBuf,
    }

    async fn fixture() -> Result<Fixture, Box<dyn std::error::Error>> {
        fixture_for(Platform::WindowsX86_64).await
    }

    async fn fixture_for(platform: Platform) -> Result<Fixture, Box<dyn std::error::Error>> {
        let host = Host::start().await?;
        let staging = std::env::temp_dir()
            .join(format!("scout-updater-{}", uuid::Uuid::new_v4()))
            .join("updates");
        let installer = Arc::new(RecordingInstaller::default());
        let updater = HttpUpdater::new(
            UpdateEndpoint {
                origin: host.origin.clone(),
                channel: "stable".to_owned(),
            },
            TEST_PUBLIC_KEY.trim(),
            platform,
            staging.clone(),
            Arc::clone(&installer) as Arc<dyn Installer>,
        )?;
        Ok(Fixture {
            host,
            updater,
            installer,
            staging,
        })
    }

    fn version(text: &str) -> Result<Version, semver::Error> {
        Version::parse(text)
    }

    #[tokio::test]
    async fn a_newer_release_is_offered_with_its_installer() -> TestResult {
        let fixture = fixture().await?;
        fixture.host.publish("stable", "0.2.0", "0.1.0");
        let update = fixture
            .updater
            .check(&version("0.1.0")?)
            .await?
            .ok_or("an update")?;
        assert_eq!(update.version, version("0.2.0")?);
        assert_eq!(update.file_name, "installer.exe");
        assert!(!update.required);
        Ok(())
    }

    #[tokio::test]
    async fn a_release_below_the_minimum_version_is_a_required_update() -> TestResult {
        let fixture = fixture().await?;
        fixture.host.publish("stable", "0.3.0", "0.2.0");
        let update = fixture
            .updater
            .check(&version("0.1.0")?)
            .await?
            .ok_or("an update")?;
        assert!(update.required);
        Ok(())
    }

    #[tokio::test]
    async fn the_channel_can_never_downgrade_or_reinstall_a_build() -> TestResult {
        let fixture = fixture().await?;
        fixture.host.publish("stable", "0.2.0", "0.1.0");
        assert_eq!(fixture.updater.check(&version("0.2.0")?).await?, None);
        assert_eq!(fixture.updater.check(&version("0.3.0")?).await?, None);
        assert_eq!(
            fixture.updater.check(&version("1.0.0-beta.1")?).await?,
            None
        );
        Ok(())
    }

    #[tokio::test]
    async fn a_manifest_for_another_channel_or_a_missing_one_is_an_error() -> TestResult {
        let fixture = fixture().await?;
        assert!(matches!(
            fixture.updater.check(&version("0.1.0")?).await,
            Err(UpdateError::Status(404))
        ));
        fixture.host.publish("beta", "0.2.0", "0.1.0");
        let beta = fixture
            .host
            .routes
            .lock()
            .unwrap_or_else(PoisonError::into_inner)["/beta.json"]
            .clone();
        fixture.host.serve("/stable.json", 200, &beta.body);
        assert!(matches!(
            fixture.updater.check(&version("0.1.0")?).await,
            Err(UpdateError::Manifest(_))
        ));
        Ok(())
    }

    #[tokio::test]
    async fn an_oversized_manifest_is_refused() -> TestResult {
        let fixture = fixture().await?;
        fixture.host.serve("/stable.json", 200, &vec![b' '; 70_000]);
        assert!(matches!(
            fixture.updater.check(&version("0.1.0")?).await,
            Err(UpdateError::TooLarge)
        ));
        Ok(())
    }

    #[tokio::test]
    async fn a_redirect_is_never_followed() -> TestResult {
        let fixture = fixture().await?;
        fixture.host.serve("/stable.json", 302, b"");
        assert!(matches!(
            fixture.updater.check(&version("0.1.0")?).await,
            Err(UpdateError::Status(302))
        ));
        Ok(())
    }

    #[tokio::test]
    async fn a_signed_installer_downloads_verifies_and_is_reused() -> TestResult {
        let fixture = fixture().await?;
        fixture.host.publish("stable", "0.2.0", "0.1.0");
        let update = fixture
            .updater
            .check(&version("0.1.0")?)
            .await?
            .ok_or("an update")?;
        let staged = fixture.updater.download(&update).await?;
        assert_eq!(std::fs::read(&staged.path)?, PAYLOAD);
        assert!(staged.path.starts_with(&fixture.staging));
        let again = fixture.updater.download(&update).await?;
        assert_eq!(again.path, staged.path);
        assert_eq!(fixture.host.requested("/releases/0.2.0/installer.exe"), 1);
        Ok(())
    }

    #[tokio::test]
    async fn a_tampered_installer_is_refused_and_leaves_nothing_behind() -> TestResult {
        let fixture = fixture().await?;
        fixture.host.publish("stable", "0.2.0", "0.1.0");
        let update = fixture
            .updater
            .check(&version("0.1.0")?)
            .await?
            .ok_or("an update")?;
        let mut tampered = PAYLOAD.to_vec();
        tampered[0] ^= 0xff;
        fixture
            .host
            .serve("/releases/0.2.0/installer.exe", 200, &tampered);
        let error = fixture.updater.download(&update).await;
        assert!(
            matches!(error, Err(UpdateError::Verify(VerifyError::Hash))),
            "{error:?}"
        );
        let leftovers = std::fs::read_dir(fixture.staging.join("0.2.0"))?.count();
        assert_eq!(leftovers, 0);
        Ok(())
    }

    #[tokio::test]
    async fn a_download_longer_than_announced_is_refused() -> TestResult {
        let fixture = fixture().await?;
        fixture.host.publish("stable", "0.2.0", "0.1.0");
        let update = fixture
            .updater
            .check(&version("0.1.0")?)
            .await?
            .ok_or("an update")?;
        let mut longer = PAYLOAD.to_vec();
        longer.extend_from_slice(b"extra");
        fixture
            .host
            .serve("/releases/0.2.0/installer.exe", 200, &longer);
        assert!(matches!(
            fixture.updater.download(&update).await,
            Err(UpdateError::TooLarge)
        ));
        Ok(())
    }

    #[tokio::test]
    async fn install_verifies_again_and_then_runs_the_installer() -> TestResult {
        let fixture = fixture().await?;
        fixture.host.publish("stable", "0.2.0", "0.1.0");
        let update = fixture
            .updater
            .check(&version("0.1.0")?)
            .await?
            .ok_or("an update")?;
        let staged = fixture.updater.download(&update).await?;
        fixture.updater.install(&staged, true)?;
        assert_eq!(
            fixture
                .installer
                .runs
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .clone(),
            [(staged.path.clone(), true)]
        );

        // Swapped on disk after it was verified: it must not run.
        std::fs::write(&staged.path, b"not the installer")?;
        assert!(fixture.updater.install(&staged, false).is_err());
        assert_eq!(fixture.installer.count.load(Ordering::SeqCst), 1);
        Ok(())
    }

    #[tokio::test]
    async fn only_the_newest_staged_release_is_kept() -> TestResult {
        let fixture = fixture().await?;
        fixture.host.publish("stable", "0.2.0", "0.1.0");
        let first = fixture
            .updater
            .check(&version("0.1.0")?)
            .await?
            .ok_or("an update")?;
        fixture.updater.download(&first).await?;
        fixture.host.publish("stable", "0.3.0", "0.1.0");
        let second = fixture
            .updater
            .check(&version("0.1.0")?)
            .await?
            .ok_or("an update")?;
        fixture.updater.download(&second).await?;
        assert!(!fixture.staging.join("0.2.0").exists());
        assert!(fixture.staging.join("0.3.0").exists());
        // Once the build catches up, nothing stays staged.
        fixture.updater.check(&version("0.3.0")?).await?;
        assert!(!fixture.staging.join("0.3.0").exists());
        Ok(())
    }

    #[tokio::test]
    async fn a_macos_build_downloads_and_installs_its_app_archive() -> TestResult {
        let fixture = fixture_for(Platform::DarwinUniversal).await?;
        fixture.host.publish_platforms(
            "stable",
            "0.2.0",
            "0.1.0",
            &[Platform::WindowsX86_64, Platform::DarwinUniversal],
        );
        let update = fixture
            .updater
            .check(&version("0.1.0")?)
            .await?
            .ok_or("an update")?;
        assert_eq!(update.file_name, "scout-desktop.app.tar.gz");
        assert_eq!(update.artifact.format, ArtifactFormat::App);
        let staged = fixture.updater.download(&update).await?;
        fixture.updater.install(&staged, false)?;
        assert_eq!(
            fixture
                .installer
                .runs
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .clone(),
            [(staged.path.clone(), false)]
        );
        assert_eq!(fixture.host.requested("/releases/0.2.0/installer.exe"), 0);
        Ok(())
    }

    #[tokio::test]
    async fn a_release_without_this_platform_offers_nothing() -> TestResult {
        let windows = fixture_for(Platform::WindowsX86_64).await?;
        windows
            .host
            .publish_platforms("stable", "0.2.0", "0.1.0", &[Platform::DarwinUniversal]);
        assert_eq!(windows.updater.check(&version("0.1.0")?).await?, None);

        let mac = fixture_for(Platform::DarwinUniversal).await?;
        mac.host
            .publish_platforms("stable", "0.2.0", "0.1.0", &[Platform::WindowsX86_64]);
        assert_eq!(mac.updater.check(&version("0.1.0")?).await?, None);
        Ok(())
    }
}
