//! The channel manifest: `<origin>/<channel>.json`.
//!
//! The contract is `data/src/scout-client/desktop-update-manifest.contract.json`.
//! The publication script validates it with Zod; this module validates the same
//! contract and fixtures with serde and the checks below (see the tests).
//!
//! The manifest is transport metadata, not the trust root: every artifact is
//! verified against a public key compiled into the build before anything runs.
//! Validation is still strict, because a malformed manifest is a broken
//! publication, not something to guess around.

use chrono::DateTime;
use semver::Version;
use serde::{Deserialize, Serialize};
use url::Url;

/// The largest manifest the client reads, in bytes.
pub const MAX_MANIFEST_BYTES: usize = 65_536;
/// The longest release note, in bytes.
const MAX_NOTES_BYTES: usize = 8_192;
/// The longest signature, in bytes.
const MAX_SIGNATURE_BYTES: usize = 2_048;
/// The largest installer, in bytes.
pub const MAX_ARTIFACT_BYTES: u64 = 268_435_456;
/// The contract version this client reads.
const CONTRACT_VERSION: u8 = 1;
/// The longest file name inside a release directory.
const MAX_FILE_NAME_BYTES: usize = 128;

/// A platform the update channel ships an installer for.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Platform {
    /// Windows on x86-64, installed from a `cargo-packager` NSIS installer.
    WindowsX86_64,
    /// macOS on Apple silicon or Intel, updated from an archive of the
    /// universal `.app` bundle.
    DarwinUniversal,
}

impl Platform {
    /// The platform this build runs on, when the updater can install for it.
    /// Linux builds do not update themselves, so only tests call this there.
    #[cfg(any(windows, target_os = "macos", test))]
    #[must_use]
    pub const fn current() -> Option<Self> {
        if cfg!(all(windows, target_arch = "x86_64")) {
            Some(Self::WindowsX86_64)
        } else if cfg!(target_os = "macos") {
            Some(Self::DarwinUniversal)
        } else {
            None
        }
    }

    /// The platform's key in the manifest's `platforms`.
    #[cfg(test)]
    #[must_use]
    pub const fn key(self) -> &'static str {
        match self {
            Self::WindowsX86_64 => "windows-x86_64",
            Self::DarwinUniversal => "darwin-universal",
        }
    }

    /// The one artifact format this platform installs from.
    #[must_use]
    pub const fn format(self) -> ArtifactFormat {
        match self {
            Self::WindowsX86_64 => ArtifactFormat::Nsis,
            Self::DarwinUniversal => ArtifactFormat::App,
        }
    }
}

/// Why a manifest cannot be used.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum ManifestError {
    /// It is larger than the contract allows.
    #[error("the update manifest is larger than {MAX_MANIFEST_BYTES} bytes")]
    TooLarge,
    /// It is not JSON of the contract's shape.
    #[error("the update manifest is not valid: {0}")]
    Malformed(String),
    /// It breaks a rule JSON shape cannot express.
    #[error("the update manifest breaks the contract: {0}")]
    Contract(&'static str),
    /// It describes another channel than the one asked for.
    #[error("the manifest is for channel {found}, not {expected}")]
    WrongChannel {
        /// The channel this build follows.
        expected: String,
        /// The channel the manifest names.
        found: String,
    },
}

/// The installer format of an artifact.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ArtifactFormat {
    /// A `cargo-packager` NSIS installer.
    Nsis,
    /// A gzipped tar of the signed, notarized and stapled `.app` bundle.
    App,
}

/// One platform's signed installer.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Artifact {
    /// Where the installer is downloaded from.
    pub url: String,
    /// Lowercase hex SHA-256 of the installer.
    pub sha256: String,
    /// Installer size in bytes.
    pub size: u64,
    /// Base64 of the minisign signature file `cargo packager` wrote.
    pub signature: String,
    /// What kind of installer it is.
    pub format: ArtifactFormat,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
struct Platforms {
    #[serde(rename = "windows-x86_64")]
    windows_x86_64: Option<Artifact>,
    #[serde(rename = "darwin-universal")]
    darwin_universal: Option<Artifact>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RawManifest {
    schema: u8,
    channel: String,
    version: String,
    minimum_version: String,
    published_at: String,
    notes: String,
    platforms: Platforms,
}

/// A manifest that passed every contract rule.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Manifest {
    /// The channel it was published to.
    pub channel: String,
    /// The release it announces.
    pub version: Version,
    /// Builds below this must update.
    pub minimum_version: Version,
    /// Release notes, plain text.
    pub notes: String,
    windows_x86_64: Option<Artifact>,
    darwin_universal: Option<Artifact>,
}

impl Manifest {
    /// Read and validate a manifest fetched from `origin` for `channel`.
    ///
    /// # Errors
    ///
    /// Returns the first rule the manifest breaks.
    pub fn parse(bytes: &[u8], origin: &str, channel: &str) -> Result<Self, ManifestError> {
        if bytes.len() > MAX_MANIFEST_BYTES {
            return Err(ManifestError::TooLarge);
        }
        let raw: RawManifest = serde_json::from_slice(bytes)
            .map_err(|error| ManifestError::Malformed(error.to_string()))?;
        if raw.schema != CONTRACT_VERSION {
            return Err(ManifestError::Contract("unknown schema version"));
        }
        if raw.channel != channel {
            return Err(ManifestError::WrongChannel {
                expected: channel.to_owned(),
                found: raw.channel,
            });
        }
        let version = parse_version(&raw.version)?;
        let minimum_version = parse_version(&raw.minimum_version)?;
        if minimum_version > version {
            return Err(ManifestError::Contract(
                "minimumVersion is newer than version",
            ));
        }
        if raw.notes.len() > MAX_NOTES_BYTES {
            return Err(ManifestError::Contract("notes are too long"));
        }
        validate_published_at(&raw.published_at)?;
        let artifacts = [
            (
                Platform::WindowsX86_64,
                raw.platforms.windows_x86_64.as_ref(),
            ),
            (
                Platform::DarwinUniversal,
                raw.platforms.darwin_universal.as_ref(),
            ),
        ];
        if artifacts.iter().all(|(_, artifact)| artifact.is_none()) {
            return Err(ManifestError::Contract("no platform artifact"));
        }
        for (platform, artifact) in artifacts {
            let Some(artifact) = artifact else { continue };
            if artifact.format != platform.format() {
                return Err(ManifestError::Contract(
                    "an artifact is not in its platform's format",
                ));
            }
            validate_artifact(artifact, origin, &raw.version)?;
        }
        Ok(Self {
            channel: raw.channel,
            version,
            minimum_version,
            notes: raw.notes,
            windows_x86_64: raw.platforms.windows_x86_64,
            darwin_universal: raw.platforms.darwin_universal,
        })
    }

    /// The release's installer for `platform`, when it ships one.
    #[must_use]
    pub fn artifact(&self, platform: Platform) -> Option<&Artifact> {
        match platform {
            Platform::WindowsX86_64 => self.windows_x86_64.as_ref(),
            Platform::DarwinUniversal => self.darwin_universal.as_ref(),
        }
    }
}

fn parse_version(text: &str) -> Result<Version, ManifestError> {
    if !scout_client_core::telemetry::is_app_version(text) {
        return Err(ManifestError::Contract(
            "a version is not a bounded semantic version",
        ));
    }
    Version::parse(text).map_err(|_| ManifestError::Contract("a version is not semantic"))
}

fn validate_published_at(text: &str) -> Result<(), ManifestError> {
    // The contract admits `YYYY-MM-DDTHH:MM:SSZ` only.
    let shaped = text.len() == 20 && text.ends_with('Z');
    if shaped && DateTime::parse_from_rfc3339(text).is_ok() {
        Ok(())
    } else {
        Err(ManifestError::Contract(
            "publishedAt is not a UTC timestamp",
        ))
    }
}

fn validate_artifact(
    artifact: &Artifact,
    origin: &str,
    version: &str,
) -> Result<(), ManifestError> {
    if artifact.size == 0 || artifact.size > MAX_ARTIFACT_BYTES {
        return Err(ManifestError::Contract("an artifact size is out of range"));
    }
    let hash_ok = artifact.sha256.len() == 64
        && artifact
            .sha256
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte));
    if !hash_ok {
        return Err(ManifestError::Contract(
            "an artifact sha256 is not lowercase hex",
        ));
    }
    let signature_ok = (16..=MAX_SIGNATURE_BYTES).contains(&artifact.signature.len())
        && artifact
            .signature
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'+' | b'/' | b'='));
    if !signature_ok {
        return Err(ManifestError::Contract(
            "an artifact signature is not base64",
        ));
    }
    artifact_file_name(&artifact.url, origin, version)
        .map(|_| ())
        .ok_or(ManifestError::Contract(
            "an artifact url is not <origin>/releases/<version>/<file>",
        ))
}

/// The file name of an artifact URL, when it is exactly
/// `<origin>/releases/<version>/<file>` with a plain lowercase file name.
#[must_use]
pub fn artifact_file_name(url: &str, origin: &str, version: &str) -> Option<String> {
    let parsed = Url::parse(url).ok()?;
    if parsed.origin().ascii_serialization() != origin
        || parsed.query().is_some()
        || parsed.fragment().is_some()
    {
        return None;
    }
    let file = parsed
        .path()
        .strip_prefix(&format!("/releases/{version}/"))?;
    let mut characters = file.bytes();
    let first_ok = characters
        .next()
        .is_some_and(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit());
    let rest_ok = characters.all(|byte| {
        byte.is_ascii_lowercase() || byte.is_ascii_digit() || matches!(byte, b'.' | b'_' | b'-')
    });
    (first_ok && rest_ok && file.len() <= MAX_FILE_NAME_BYTES).then(|| file.to_owned())
}

#[cfg(test)]
mod tests {
    use serde_json::Value;

    use super::{
        ArtifactFormat, MAX_ARTIFACT_BYTES, MAX_FILE_NAME_BYTES, MAX_MANIFEST_BYTES,
        MAX_NOTES_BYTES, MAX_SIGNATURE_BYTES, Manifest, ManifestError, Platform,
        artifact_file_name,
    };

    const CONTRACT: &str =
        include_str!("../../../../../data/src/scout-client/desktop-update-manifest.contract.json");
    const FIXTURES: &str =
        include_str!("../../../../../data/src/scout-client/desktop-update-manifest.fixtures.json");

    type TestResult = Result<(), Box<dyn std::error::Error>>;

    fn contract() -> Result<Value, serde_json::Error> {
        serde_json::from_str(CONTRACT)
    }

    fn fixtures() -> Result<Value, serde_json::Error> {
        serde_json::from_str(FIXTURES)
    }

    fn origin() -> Result<String, Box<dyn std::error::Error>> {
        Ok(contract()?["origin"].as_str().ok_or("origin")?.to_owned())
    }

    #[test]
    fn the_constants_match_the_shared_contract() -> TestResult {
        let contract = contract()?;
        let limit = |name: &'static str| contract["limits"][name].as_u64().ok_or(name);
        assert_eq!(limit("manifestMaxBytes")?, MAX_MANIFEST_BYTES as u64);
        assert_eq!(limit("notesMaxBytes")?, MAX_NOTES_BYTES as u64);
        assert_eq!(limit("signatureMaxBytes")?, MAX_SIGNATURE_BYTES as u64);
        assert_eq!(limit("artifactMaxBytes")?, MAX_ARTIFACT_BYTES);
        assert_eq!(contract["contractVersion"], 1);
        assert_eq!(contract["manifestPath"], "/{channel}.json");
        assert_eq!(contract["releasePath"], "/releases/{version}/{file}");
        assert_eq!(contract["channels"], serde_json::json!(["stable", "beta"]));
        assert_eq!(
            contract["platforms"],
            serde_json::json!({
                "windows-x86_64": { "formats": ["nsis"] },
                "darwin-universal": { "formats": ["app"] },
            })
        );
        for platform in [Platform::WindowsX86_64, Platform::DarwinUniversal] {
            let format = serde_json::to_value(platform.format())?;
            assert_eq!(
                contract["platforms"][platform.key()]["formats"],
                serde_json::json!([format]),
                "{}",
                platform.key()
            );
        }
        assert_eq!(
            contract["fileNamePattern"],
            format!("^[a-z0-9][a-z0-9._-]{{0,{}}}$", MAX_FILE_NAME_BYTES - 1)
        );
        Ok(())
    }

    #[test]
    fn the_release_profiles_point_at_the_contract_origin() -> TestResult {
        use scout_client_core::profile::{BETA, STABLE};
        assert_eq!(STABLE.update_origin, origin()?);
        assert_eq!(BETA.update_origin, origin()?);
        Ok(())
    }

    #[test]
    fn every_valid_fixture_is_accepted() -> TestResult {
        let fixtures = fixtures()?;
        let valid = fixtures["valid"].as_array().ok_or("valid fixtures")?;
        assert_ne!(valid.len(), 0);
        for fixture in valid {
            let channel = fixture["channel"].as_str().ok_or("channel")?;
            let manifest = Manifest::parse(fixture.to_string().as_bytes(), &origin()?, channel)?;
            assert_eq!(manifest.channel, channel);
            for platform in [Platform::WindowsX86_64, Platform::DarwinUniversal] {
                let shipped = fixture["platforms"].get(platform.key()).is_some();
                let artifact = manifest.artifact(platform);
                assert_eq!(artifact.is_some(), shipped, "{}", platform.key());
                if let Some(artifact) = artifact {
                    assert_eq!(artifact.format, platform.format());
                }
            }
        }
        Ok(())
    }

    #[test]
    fn a_macos_build_reads_its_app_archive_and_nothing_else() -> TestResult {
        let fixtures = fixtures()?;
        let both = Manifest::parse(
            fixtures["valid"][0].to_string().as_bytes(),
            &origin()?,
            "stable",
        )?;
        let mac = both
            .artifact(Platform::DarwinUniversal)
            .ok_or("a macOS artifact")?;
        assert_eq!(mac.format, ArtifactFormat::App);
        assert_eq!(
            artifact_file_name(&mac.url, &origin()?, "0.2.0").as_deref(),
            Some("scout-desktop-stable_0.2.0_universal.app.tar.gz")
        );
        assert_ne!(
            both.artifact(Platform::WindowsX86_64),
            both.artifact(Platform::DarwinUniversal)
        );

        // A release that ships macOS first offers Windows nothing yet.
        let mac_only = Manifest::parse(
            fixtures["valid"][2].to_string().as_bytes(),
            &origin()?,
            "beta",
        )?;
        assert!(mac_only.artifact(Platform::DarwinUniversal).is_some());
        assert_eq!(mac_only.artifact(Platform::WindowsX86_64), None);
        Ok(())
    }

    #[test]
    fn this_build_knows_its_platform() {
        let expected = if cfg!(all(windows, target_arch = "x86_64")) {
            Some(Platform::WindowsX86_64)
        } else if cfg!(target_os = "macos") {
            Some(Platform::DarwinUniversal)
        } else {
            None
        };
        assert_eq!(Platform::current(), expected);
    }

    #[test]
    fn every_invalid_fixture_is_refused() -> TestResult {
        let fixtures = fixtures()?;
        let invalid = fixtures["invalid"].as_array().ok_or("invalid fixtures")?;
        assert_ne!(invalid.len(), 0);
        for fixture in invalid {
            let reason = fixture["reason"].as_str().unwrap_or("?");
            let body = fixture["body"].to_string();
            let channel = fixture["body"]["channel"].as_str().unwrap_or("stable");
            let accepted = Manifest::parse(body.as_bytes(), &origin()?, channel).is_ok();
            assert!(!accepted, "{reason} must be refused");
        }
        Ok(())
    }

    #[test]
    fn a_manifest_for_another_channel_is_refused() -> TestResult {
        let fixtures = fixtures()?;
        let beta = fixtures["valid"][1].to_string();
        let error = Manifest::parse(beta.as_bytes(), &origin()?, "stable");
        assert!(matches!(error, Err(ManifestError::WrongChannel { .. })));
        Ok(())
    }

    #[test]
    fn an_oversized_manifest_is_refused_before_it_is_parsed() -> TestResult {
        let bytes = vec![b' '; MAX_MANIFEST_BYTES + 1];
        assert_eq!(
            Manifest::parse(&bytes, &origin()?, "stable"),
            Err(ManifestError::TooLarge)
        );
        Ok(())
    }

    #[test]
    fn artifact_urls_must_sit_in_their_own_release_directory() {
        let origin = "https://download.scout-for-lol.com";
        let good = "https://download.scout-for-lol.com/releases/0.2.0/scout-desktop-stable_0.2.0_x64-setup.exe";
        assert_eq!(
            artifact_file_name(good, origin, "0.2.0").as_deref(),
            Some("scout-desktop-stable_0.2.0_x64-setup.exe")
        );
        for bad in [
            "https://download.scout-for-lol.com/releases/0.1.0/x.exe",
            "https://example.com/releases/0.2.0/x.exe",
            "http://download.scout-for-lol.com/releases/0.2.0/x.exe",
            "https://download.scout-for-lol.com/releases/0.2.0/../0.1.0/x.exe",
            "https://download.scout-for-lol.com/releases/0.2.0/x.exe?a=1",
            "https://download.scout-for-lol.com/releases/0.2.0/X.exe",
            "https://download.scout-for-lol.com/releases/0.2.0/",
            "https://download.scout-for-lol.com:8443/releases/0.2.0/x.exe",
        ] {
            assert_eq!(artifact_file_name(bad, origin, "0.2.0"), None, "{bad}");
        }
    }
}
