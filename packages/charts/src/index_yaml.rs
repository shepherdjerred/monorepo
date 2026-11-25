use std::cmp::Ordering;
use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use sha2::{Digest as _, Sha256};

use crate::error::AppError;
use crate::storage::StoredRelease;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct ChartReleaseView {
    pub name: String,
    pub version: String,
    #[serde(rename = "appVersion")]
    pub app_version: String,
    #[serde(rename = "apiVersion")]
    pub api_version: String,
    pub description: String,
    pub urls: Vec<String>,
    pub digest: String,
    pub created: String,
    #[serde(rename = "sizeBytes")]
    pub size_bytes: u64,
    #[serde(rename = "contentFingerprint")]
    pub content_fingerprint: Option<String>,
}

impl From<&StoredRelease> for ChartReleaseView {
    fn from(row: &StoredRelease) -> Self {
        Self {
            name: row.name.clone(),
            version: row.version.clone(),
            app_version: row.app_version.clone(),
            api_version: row.api_version.clone(),
            description: row.description.clone(),
            urls: vec![format!("charts/{}", row.archive_filename)],
            digest: row.digest_hex.clone(),
            created: row.created_at.clone(),
            size_bytes: row.size_bytes,
            content_fingerprint: row.content_fingerprint.clone(),
        }
    }
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum ChartKind {
    FirstParty,
    Upstream,
}

pub fn classify_chart_version(version: &str) -> ChartKind {
    if let Some(suffix) = version.strip_prefix("2.0.0-")
        && !suffix.is_empty()
        && suffix.bytes().all(|b| b.is_ascii_digit())
    {
        return ChartKind::FirstParty;
    }
    ChartKind::Upstream
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct ChartSummaryItem {
    pub name: String,
    pub kind: ChartKind,
    #[serde(rename = "latestVersion")]
    pub latest_version: String,
    #[serde(rename = "latestAppVersion")]
    pub latest_app_version: String,
    pub description: String,
    #[serde(rename = "releaseCount")]
    pub release_count: usize,
    #[serde(rename = "totalBytes")]
    pub total_bytes: u64,
    #[serde(rename = "latestDigest")]
    pub latest_digest: String,
    #[serde(rename = "latestContentFingerprint")]
    pub latest_content_fingerprint: Option<String>,
    #[serde(rename = "latestCreated")]
    pub latest_created: String,
    #[serde(rename = "latestUrl")]
    pub latest_url: String,
    pub releases: Vec<ChartReleaseView>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct CatalogSummaryResponse {
    #[serde(rename = "chartCount")]
    pub chart_count: usize,
    #[serde(rename = "releaseCount")]
    pub release_count: usize,
    #[serde(rename = "totalBytes")]
    pub total_bytes: u64,
    #[serde(rename = "quotaBytes")]
    pub quota_bytes: u64,
    #[serde(rename = "catalogRevision")]
    pub catalog_revision: i64,
    pub charts: Vec<ChartSummaryItem>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct HelmIndexDocument {
    #[serde(rename = "apiVersion")]
    pub api_version: String,
    pub entries: BTreeMap<String, Vec<HelmIndexEntry>>,
    pub generated: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct HelmIndexEntry {
    #[serde(rename = "apiVersion")]
    pub api_version: String,
    #[serde(
        rename = "appVersion",
        skip_serializing_if = "String::is_empty",
        default
    )]
    pub app_version: String,
    pub created: String,
    #[serde(skip_serializing_if = "String::is_empty", default)]
    pub description: String,
    pub digest: String,
    pub name: String,
    pub urls: Vec<String>,
    pub version: String,
}

#[derive(Clone, Debug)]
pub struct RenderedIndexYaml {
    pub catalog_revision: i64,
    pub etag: String,
    pub body: String,
}

pub fn group_releases_newest_first(
    mut rows: Vec<StoredRelease>,
) -> BTreeMap<String, Vec<ChartReleaseView>> {
    rows.sort_by(|left, right| {
        left.name
            .cmp(&right.name)
            .then_with(|| compare_versions_newest_first(&left.version, &right.version))
            .then_with(|| right.created_at.cmp(&left.created_at))
    });

    let mut grouped: BTreeMap<String, Vec<ChartReleaseView>> = BTreeMap::new();
    for row in &rows {
        grouped
            .entry(row.name.clone())
            .or_default()
            .push(ChartReleaseView::from(row));
    }
    grouped
}

pub fn render_index_yaml(
    catalog_revision: i64,
    rows: Vec<StoredRelease>,
) -> Result<RenderedIndexYaml, AppError> {
    let generated = rows
        .iter()
        .map(|row| row.created_at.as_str())
        .max()
        .unwrap_or("1970-01-01T00:00:00Z")
        .to_owned();

    let grouped = group_releases_newest_first(rows);
    let mut entries: BTreeMap<String, Vec<HelmIndexEntry>> = BTreeMap::new();
    for (name, releases) in grouped {
        let helm_entries = releases
            .into_iter()
            .map(|r| HelmIndexEntry {
                api_version: r.api_version,
                app_version: r.app_version,
                created: r.created,
                description: r.description,
                digest: r.digest,
                name: r.name,
                urls: r.urls,
                version: r.version,
            })
            .collect();
        entries.insert(name, helm_entries);
    }

    let doc = HelmIndexDocument {
        api_version: "v1".to_owned(),
        entries,
        generated,
    };

    let body = serde_norway::to_string(&doc)
        .map_err(|err| AppError::Internal(format!("failed to serialize index.yaml: {err}")))?;
    let hash_hex = hex::encode(Sha256::digest(body.as_bytes()));
    let short_hash = hash_hex.get(..16).unwrap_or(&hash_hex);
    let etag = format!("\"rev-{catalog_revision}-{short_hash}\"");

    Ok(RenderedIndexYaml {
        catalog_revision,
        etag,
        body,
    })
}

pub fn if_none_match_matches(header_value: &str, current_etag: &str) -> bool {
    let trimmed = header_value.trim();
    if trimmed == "*" {
        return true;
    }
    let normalized_target = strip_weak_prefix(current_etag.trim());
    trimmed.split(',').any(|candidate| {
        let candidate_trimmed = strip_weak_prefix(candidate.trim());
        candidate_trimmed == normalized_target
    })
}

fn strip_weak_prefix(etag: &str) -> &str {
    etag.strip_prefix("W/").unwrap_or(etag)
}

/// Compares two chart version strings so newer versions sort BEFORE older versions.
pub fn compare_versions_newest_first(left: &str, right: &str) -> Ordering {
    compare_semver_asc(right, left)
}

#[derive(Debug, PartialEq, Eq)]
struct ParsedSemver<'a> {
    major: u64,
    minor: u64,
    patch: u64,
    prerelease: Option<&'a str>,
}

fn parse_semver(raw: &str) -> Option<ParsedSemver<'_>> {
    let stripped = raw.strip_prefix('v').unwrap_or(raw);
    let (core_and_pre, _build) = stripped.split_once('+').unwrap_or((stripped, ""));
    let (core, prerelease) = match core_and_pre.split_once('-') {
        Some((c, p)) => (c, Some(p)),
        None => (core_and_pre, None),
    };
    let mut parts = core.split('.');
    let major = parts.next()?.parse::<u64>().ok()?;
    let minor = parts.next()?.parse::<u64>().ok()?;
    let patch = parts.next()?.parse::<u64>().ok()?;
    if parts.next().is_some() {
        return None;
    }
    Some(ParsedSemver {
        major,
        minor,
        patch,
        prerelease,
    })
}

fn compare_semver_asc(a: &str, b: &str) -> Ordering {
    match (parse_semver(a), parse_semver(b)) {
        (Some(pa), Some(pb)) => pa
            .major
            .cmp(&pb.major)
            .then_with(|| pa.minor.cmp(&pb.minor))
            .then_with(|| pa.patch.cmp(&pb.patch))
            .then_with(|| compare_prerelease_asc(pa.prerelease, pb.prerelease))
            .then_with(|| a.cmp(b)),
        (Some(_), None) => Ordering::Greater,
        (None, Some(_)) => Ordering::Less,
        (None, None) => a.cmp(b),
    }
}

fn compare_prerelease_asc(a: Option<&str>, b: Option<&str>) -> Ordering {
    match (a, b) {
        (None, None) => Ordering::Equal,
        // Normal release > prerelease per SemVer 2.0.0.
        (None, Some(_)) => Ordering::Greater,
        (Some(_), None) => Ordering::Less,
        (Some(sa), Some(sb)) => {
            let mut ia = sa.split('.');
            let mut ib = sb.split('.');
            loop {
                match (ia.next(), ib.next()) {
                    (None, None) => return Ordering::Equal,
                    (None, Some(_)) => return Ordering::Less,
                    (Some(_), None) => return Ordering::Greater,
                    (Some(seg_a), Some(seg_b)) => {
                        let ord = match (seg_a.parse::<u64>(), seg_b.parse::<u64>()) {
                            (Ok(na), Ok(nb)) => na.cmp(&nb),
                            (Ok(_), Err(_)) => Ordering::Less,
                            (Err(_), Ok(_)) => Ordering::Greater,
                            (Err(_), Err(_)) => seg_a.cmp(seg_b),
                        };
                        if ord != Ordering::Equal {
                            return ord;
                        }
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        ChartKind, classify_chart_version, compare_versions_newest_first, if_none_match_matches,
    };

    #[test]
    fn sorts_build_revisions_and_semver_newest_first() {
        let mut versions = vec![
            "2.0.0-99999",
            "2.0.0-100010",
            "2.0.0-100002",
            "v1.9.0",
            "v1.21.2",
            "2.0.0",
        ];
        versions.sort_by(|a, b| compare_versions_newest_first(a, b));
        assert_eq!(
            versions,
            vec![
                "2.0.0",
                "2.0.0-100010",
                "2.0.0-100002",
                "2.0.0-99999",
                "v1.21.2",
                "v1.9.0",
            ]
        );
    }

    #[test]
    fn classifies_first_party_and_upstream_versions() {
        assert_eq!(
            classify_chart_version("2.0.0-100042"),
            ChartKind::FirstParty
        );
        assert_eq!(classify_chart_version("v1.21.2"), ChartKind::Upstream);
        assert_eq!(classify_chart_version("2.0.0-rc1"), ChartKind::Upstream);
    }

    #[test]
    fn matches_strong_and_multi_value_if_none_match() {
        assert!(if_none_match_matches("\"rev-3-abcd\"", "\"rev-3-abcd\""));
        assert!(if_none_match_matches(
            "\"rev-1-0000\", W/\"rev-3-abcd\"",
            "\"rev-3-abcd\""
        ));
        assert!(if_none_match_matches("*", "\"rev-3-abcd\""));
        assert!(!if_none_match_matches("\"rev-2-abcd\"", "\"rev-3-abcd\""));
    }
}
