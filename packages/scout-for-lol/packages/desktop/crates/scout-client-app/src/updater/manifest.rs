//! The channel manifest: `<origin>/<channel>.json`.
//!
//! The contract is `data/src/scout-client/desktop-update-manifest.contract.json`.
//! The publication script validates it with Zod; this module validates the same
//! contract and fixtures with serde and the checks below (see the tests).
//!
//! The manifest is transport metadata, not the trust root: every artifact is
//! verified against a public key compiled into the build before anything runs.
//! Validation is still strict for everything this build uses, because a
//! malformed manifest is a broken publication, not something to guess around.
//!
//! The contract is versioned and read by builds that stay installed, so it is
//! forward compatible on purpose. `schema` is the major version: any other
//! major is refused with [`ManifestError::UnsupportedSchema`], before the rest
//! of the document is read, since a breaking change may reshape it (breaking
//! changes ship at a new manifest path, so this path keeps its major).
//! `schemaMinor` only grows with additive changes and any value is accepted.
//! Unknown fields are ignored, and so is every platform entry but the one for
//! the platform this build runs on, including platform keys it has never
//! heard of; that one entry is validated in full.

use std::collections::BTreeMap;

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
/// The contract major version this client reads.
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
    /// Linux builds do not update themselves, so this is `None` there.
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
    /// It is a major version of the contract this client does not read.
    #[error("the update manifest is schema {found}, this build reads schema {CONTRACT_VERSION}")]
    UnsupportedSchema {
        /// The major version the manifest names.
        found: u64,
    },
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

/// One platform's signed installer. Later additive fields are ignored.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
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

/// Just the major version, read first so another major is refused unread.
#[derive(Deserialize)]
struct SchemaProbe {
    schema: u64,
}

/// A manifest as this build reads it. Unknown fields are ignored; `platforms`
/// keeps every entry unparsed so only this build's own is held to the schema.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawManifest {
    /// Any minor is accepted; it is read only to prove the field is well formed.
    #[serde(rename = "schemaMinor")]
    _schema_minor: u32,
    channel: String,
    version: String,
    minimum_version: String,
    published_at: String,
    notes: String,
    platforms: BTreeMap<String, serde_json::Value>,
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
    artifact: Option<Artifact>,
}

impl Manifest {
    /// Read and validate a manifest fetched from `origin` for `channel`, for a
    /// build running on `platform`.
    ///
    /// # Errors
    ///
    /// Returns the first rule the manifest breaks.
    pub fn parse(
        bytes: &[u8],
        origin: &str,
        channel: &str,
        platform: Platform,
    ) -> Result<Self, ManifestError> {
        if bytes.len() > MAX_MANIFEST_BYTES {
            return Err(ManifestError::TooLarge);
        }
        let malformed = |error: serde_json::Error| ManifestError::Malformed(error.to_string());
        let probe: SchemaProbe = serde_json::from_slice(bytes).map_err(malformed)?;
        if probe.schema != u64::from(CONTRACT_VERSION) {
            return Err(ManifestError::UnsupportedSchema {
                found: probe.schema,
            });
        }
        let raw: RawManifest = serde_json::from_slice(bytes).map_err(malformed)?;
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
        if raw.platforms.is_empty() {
            return Err(ManifestError::Contract("no platform artifact"));
        }
        let artifact = raw
            .platforms
            .get(platform.key())
            .map(|entry| Artifact::deserialize(entry).map_err(malformed))
            .transpose()?;
        if let Some(artifact) = &artifact {
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
            artifact,
        })
    }

    /// The release's installer for the platform it was parsed for, when it
    /// ships one.
    #[must_use]
    pub const fn artifact(&self) -> Option<&Artifact> {
        self.artifact.as_ref()
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
        assert_eq!(contract["contractMinorVersion"], 0);
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

    const PLATFORMS: [Platform; 2] = [Platform::WindowsX86_64, Platform::DarwinUniversal];

    fn parse(body: &Value, channel: &str, platform: Platform) -> Result<Manifest, ManifestError> {
        Manifest::parse(
            body.to_string().as_bytes(),
            &origin().map_err(|error| ManifestError::Malformed(error.to_string()))?,
            channel,
            platform,
        )
    }

    #[test]
    fn every_valid_fixture_is_accepted() -> TestResult {
        let fixtures = fixtures()?;
        let valid = fixtures["valid"].as_array().ok_or("valid fixtures")?;
        assert_ne!(valid.len(), 0);
        for fixture in valid {
            let channel = fixture["channel"].as_str().ok_or("channel")?;
            for platform in PLATFORMS {
                let manifest = parse(fixture, channel, platform)?;
                assert_eq!(manifest.channel, channel);
                let shipped = fixture["platforms"].get(platform.key()).is_some();
                let artifact = manifest.artifact();
                assert_eq!(artifact.is_some(), shipped, "{}", platform.key());
                if let Some(artifact) = artifact {
                    assert_eq!(artifact.format, platform.format());
                }
            }
        }
        Ok(())
    }

    #[test]
    fn a_newer_manifest_is_read_by_this_client() -> TestResult {
        let fixtures = fixtures()?;
        let newer = fixtures["forwardCompatible"]
            .as_array()
            .ok_or("forwardCompatible fixtures")?;
        assert_ne!(newer.len(), 0);
        for fixture in newer {
            let reason = fixture["reason"].as_str().unwrap_or("?");
            let body = &fixture["body"];
            let channel = body["channel"].as_str().ok_or("channel")?;
            for platform in PLATFORMS {
                let manifest = parse(body, channel, platform)
                    .map_err(|error| format!("{reason} for {}: {error}", platform.key()))?;
                let shipped = body["platforms"].get(platform.key()).is_some();
                assert_eq!(manifest.artifact().is_some(), shipped, "{reason}");
            }
        }
        Ok(())
    }

    #[test]
    fn another_major_is_refused_with_a_typed_error_before_the_rest_is_read() {
        let body = serde_json::json!({ "schema": 3, "releases": [] });
        for platform in PLATFORMS {
            assert_eq!(
                parse(&body, "stable", platform),
                Err(ManifestError::UnsupportedSchema { found: 3 })
            );
        }
        let zero = serde_json::json!({ "schema": 0 });
        assert_eq!(
            parse(&zero, "stable", Platform::WindowsX86_64),
            Err(ManifestError::UnsupportedSchema { found: 0 })
        );
    }

    #[test]
    fn only_the_entry_for_this_platform_is_validated() -> TestResult {
        let mut body = fixtures()?["valid"][0].clone();
        body["platforms"]["windows-x86_64"]["sha256"] = "nope".into();
        let mac = parse(&body, "stable", Platform::DarwinUniversal)?;
        assert!(mac.artifact().is_some());
        assert!(matches!(
            parse(&body, "stable", Platform::WindowsX86_64),
            Err(ManifestError::Contract(_))
        ));
        let mut body = fixtures()?["valid"][0].clone();
        body["platforms"]["darwin-universal"] = serde_json::json!({ "url": 7 });
        assert!(parse(&body, "stable", Platform::WindowsX86_64).is_ok());
        assert!(matches!(
            parse(&body, "stable", Platform::DarwinUniversal),
            Err(ManifestError::Malformed(_))
        ));
        Ok(())
    }

    #[test]
    fn a_macos_build_reads_its_app_archive_and_nothing_else() -> TestResult {
        let fixtures = fixtures()?;
        let both = parse(&fixtures["valid"][0], "stable", Platform::DarwinUniversal)?;
        let mac = both.artifact().ok_or("a macOS artifact")?;
        assert_eq!(mac.format, ArtifactFormat::App);
        assert_eq!(
            artifact_file_name(&mac.url, &origin()?, "0.2.0").as_deref(),
            Some("scout-desktop-stable_0.2.0_universal.app.tar.gz")
        );
        let windows = parse(&fixtures["valid"][0], "stable", Platform::WindowsX86_64)?;
        assert_ne!(windows.artifact(), both.artifact());

        // A release that ships macOS first offers Windows nothing yet.
        let mac_only = &fixtures["valid"][2];
        assert!(
            parse(mac_only, "beta", Platform::DarwinUniversal)?
                .artifact()
                .is_some()
        );
        assert_eq!(
            parse(mac_only, "beta", Platform::WindowsX86_64)?.artifact(),
            None
        );
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
            let body = &fixture["body"];
            let channel = body["channel"].as_str().unwrap_or("stable");
            // A fault in a platform entry is the concern of builds for that
            // platform only; every other fault is refused by all of them.
            let named: Vec<Platform> = PLATFORMS
                .into_iter()
                .filter(|platform| body["platforms"].get(platform.key()).is_some())
                .collect();
            let platforms = if named.is_empty() {
                PLATFORMS.to_vec()
            } else {
                named
            };
            for platform in platforms {
                let accepted = parse(body, channel, platform).is_ok();
                assert!(!accepted, "{reason} must be refused for {}", platform.key());
            }
        }
        Ok(())
    }

    #[test]
    fn a_manifest_for_another_channel_is_refused() -> TestResult {
        let fixtures = fixtures()?;
        let error = parse(&fixtures["valid"][1], "stable", Platform::WindowsX86_64);
        assert!(matches!(error, Err(ManifestError::WrongChannel { .. })));
        Ok(())
    }

    #[test]
    fn an_oversized_manifest_is_refused_before_it_is_parsed() -> TestResult {
        let bytes = vec![b' '; MAX_MANIFEST_BYTES + 1];
        assert_eq!(
            Manifest::parse(&bytes, &origin()?, "stable", Platform::WindowsX86_64),
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
