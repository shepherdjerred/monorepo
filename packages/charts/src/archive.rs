use std::collections::BTreeMap;
use std::io::{self, Read};
use std::path::{Component, Path};

use flate2::read::GzDecoder;
use serde::Deserialize;
use sha2::{Digest as _, Sha256};
use tar::{Archive, EntryType, Header};

use crate::error::AppError;

pub const MAX_ARCHIVE_BYTES: usize = 16 * 1024 * 1024; // 16 MiB
pub const MAX_UNPACKED_BYTES: u64 = 16 * 1024 * 1024; // 16 MiB
const MAX_DECOMPRESSED_STREAM_BYTES: u64 = MAX_UNPACKED_BYTES + 2 * 1024 * 1024;
const MAX_CHART_YAML_BYTES: u64 = 64 * 1024; // 64 KiB
pub const CONTENT_FINGERPRINT_ANNOTATION: &str = "ci.sjer.red/content-fingerprint";

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ParsedChartArchive {
    pub name: String,
    pub version: String,
    pub app_version: String,
    pub description: String,
    pub api_version: String,
    pub digest_hex: String,
    pub size_bytes: u64,
    pub content_fingerprint: Option<String>,
    pub archive_filename: String,
}

#[derive(Deserialize)]
struct RawChartYaml {
    name: String,
    version: String,
    #[serde(rename = "appVersion")]
    app_version: Option<String>,
    #[serde(rename = "apiVersion")]
    api_version: Option<String>,
    description: Option<String>,
    annotations: Option<BTreeMap<String, String>>,
}

struct BoundedReader<R> {
    inner: R,
    read_so_far: u64,
    limit: u64,
}

impl<R: Read> BoundedReader<R> {
    const fn new(inner: R, limit: u64) -> Self {
        Self {
            inner,
            read_so_far: 0,
            limit,
        }
    }
}

impl<R: Read> Read for BoundedReader<R> {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        let count = self.inner.read(buf)?;
        self.read_so_far = self.read_so_far.saturating_add(count as u64);
        if self.read_so_far > self.limit {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "unpacked chart archive exceeds 16 MiB limit",
            ));
        }
        Ok(count)
    }
}

/// Validates and parses an in-memory `.tgz` Helm chart archive.
pub fn parse_chart_archive(raw_tgz: &[u8]) -> Result<ParsedChartArchive, AppError> {
    if raw_tgz.is_empty() {
        return Err(AppError::BadRequest("chart archive is empty".to_owned()));
    }
    if raw_tgz.len() > MAX_ARCHIVE_BYTES {
        return Err(AppError::PayloadTooLarge(
            "chart archive exceeds 16 MiB limit".to_owned(),
        ));
    }

    let digest_hex = hex::encode(Sha256::digest(raw_tgz));
    let gz = GzDecoder::new(raw_tgz);
    let bounded_gz = BoundedReader::new(gz, MAX_DECOMPRESSED_STREAM_BYTES);
    let mut archive = Archive::new(bounded_gz);

    let entries = archive
        .entries()
        .map_err(|err| AppError::BadRequest(format!("invalid gzip/tar chart archive: {err}")))?;

    let mut total_unpacked: u64 = 0;
    let mut top_level_dir: Option<String> = None;
    let mut chart_yaml_bytes: Option<Vec<u8>> = None;

    for entry_result in entries {
        let mut entry = entry_result.map_err(|err| {
            AppError::BadRequest(format!("corrupt tar entry in chart archive: {err}"))
        })?;

        let entry_type = entry.header().entry_type();
        if !matches!(entry_type, EntryType::Regular | EntryType::Directory) {
            return Err(AppError::BadRequest(format!(
                "unsupported tar entry type '{entry_type:?}' (symlinks, links, and special files are forbidden)"
            )));
        }

        let raw_path = {
            let raw_path_bytes = entry.path_bytes();
            std::str::from_utf8(&raw_path_bytes)
                .map_err(|_| AppError::BadRequest("tar entry path is not valid UTF-8".to_owned()))?
                .to_owned()
        };
        let components = validate_relative_tar_path(&raw_path)?;
        let Some(entry_root) = components.first() else {
            return Err(AppError::BadRequest(
                "tar entry path must contain a chart directory".to_owned(),
            ));
        };

        if let Some(existing_root) = &top_level_dir {
            if existing_root != entry_root {
                return Err(AppError::BadRequest(format!(
                    "chart archive contains multiple top-level directories ('{existing_root}' and '{entry_root}')"
                )));
            }
        } else {
            top_level_dir = Some(entry_root.clone());
        }

        let declared_size = entry
            .header()
            .size()
            .map_err(|err| AppError::BadRequest(format!("invalid tar entry size header: {err}")))?;
        if total_unpacked.saturating_add(declared_size) > MAX_UNPACKED_BYTES {
            return Err(AppError::BadRequest(
                "unpacked chart archive exceeds 16 MiB limit".to_owned(),
            ));
        }

        let is_root_chart_yaml =
            components.len() == 2 && components.get(1).is_some_and(|name| name == "Chart.yaml");

        if is_root_chart_yaml {
            if !matches!(entry_type, EntryType::Regular) {
                return Err(AppError::BadRequest(
                    "Chart.yaml must be a regular file".to_owned(),
                ));
            }
            if chart_yaml_bytes.is_some() {
                return Err(AppError::BadRequest(
                    "duplicate Chart.yaml entry in chart archive".to_owned(),
                ));
            }
            if declared_size > MAX_CHART_YAML_BYTES {
                return Err(AppError::BadRequest(
                    "Chart.yaml exceeds 64 KiB limit".to_owned(),
                ));
            }
            let mut buf = Vec::new();
            let read_bytes = (&mut entry)
                .take(MAX_CHART_YAML_BYTES + 1)
                .read_to_end(&mut buf)
                .map_err(|err| AppError::BadRequest(format!("failed reading Chart.yaml: {err}")))?
                as u64;
            if read_bytes > MAX_CHART_YAML_BYTES {
                return Err(AppError::BadRequest(
                    "Chart.yaml exceeds 64 KiB limit".to_owned(),
                ));
            }
            total_unpacked = total_unpacked.saturating_add(read_bytes);
            if total_unpacked > MAX_UNPACKED_BYTES {
                return Err(AppError::BadRequest(
                    "unpacked chart archive exceeds 16 MiB limit".to_owned(),
                ));
            }
            chart_yaml_bytes = Some(buf);
        } else if matches!(entry_type, EntryType::Regular) {
            let remaining = MAX_UNPACKED_BYTES.saturating_sub(total_unpacked);
            let copied = io::copy(&mut (&mut entry).take(remaining + 1), &mut io::sink()).map_err(
                |err| {
                    AppError::BadRequest(format!("failed reading chart entry '{raw_path}': {err}"))
                },
            )?;
            total_unpacked = total_unpacked.saturating_add(copied);
            if total_unpacked > MAX_UNPACKED_BYTES {
                return Err(AppError::BadRequest(
                    "unpacked chart archive exceeds 16 MiB limit".to_owned(),
                ));
            }
        }
    }

    let Some(chart_dir) = top_level_dir else {
        return Err(AppError::BadRequest(
            "chart archive contains no entries".to_owned(),
        ));
    };
    let Some(yaml_bytes) = chart_yaml_bytes else {
        return Err(AppError::BadRequest(format!(
            "chart archive is missing '{chart_dir}/Chart.yaml'"
        )));
    };

    let metadata: RawChartYaml = serde_norway::from_slice(&yaml_bytes)
        .map_err(|err| AppError::BadRequest(format!("invalid Chart.yaml YAML syntax: {err}")))?;

    if !is_valid_chart_token(&metadata.name) {
        return Err(AppError::BadRequest(format!(
            "invalid chart name '{}' in Chart.yaml",
            metadata.name
        )));
    }
    if metadata.name != chart_dir {
        return Err(AppError::BadRequest(format!(
            "Chart.yaml name '{}' does not match archive directory '{chart_dir}'",
            metadata.name
        )));
    }
    if !is_valid_chart_version(&metadata.version) {
        return Err(AppError::BadRequest(format!(
            "invalid chart version '{}' in Chart.yaml",
            metadata.version
        )));
    }

    let api_version = metadata
        .api_version
        .map(|s| s.trim().to_owned())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "v2".to_owned());

    let app_version = metadata
        .app_version
        .map(|s| s.trim().to_owned())
        .unwrap_or_default();

    let description = metadata
        .description
        .map(|s| s.trim().to_owned())
        .unwrap_or_default();

    let content_fingerprint = metadata
        .annotations
        .as_ref()
        .and_then(|annotations| annotations.get(CONTENT_FINGERPRINT_ANNOTATION))
        .map(|s| s.trim().to_owned())
        .filter(|s| !s.is_empty());

    let archive_filename = format!("{}-{}.tgz", metadata.name, metadata.version);
    if !is_valid_archive_filename(&archive_filename) {
        return Err(AppError::BadRequest(format!(
            "derived archive filename '{archive_filename}' is invalid"
        )));
    }

    Ok(ParsedChartArchive {
        name: metadata.name,
        version: metadata.version,
        app_version,
        description,
        api_version,
        digest_hex,
        size_bytes: raw_tgz.len() as u64,
        content_fingerprint,
        archive_filename,
    })
}

fn validate_relative_tar_path(raw_path: &str) -> Result<Vec<String>, AppError> {
    if raw_path.is_empty()
        || raw_path.starts_with('/')
        || raw_path.contains('\\')
        || raw_path.contains('\0')
    {
        return Err(AppError::BadRequest(format!(
            "unsafe tar entry path '{raw_path}'"
        )));
    }

    let mut normal_segments = Vec::new();
    for component in Path::new(raw_path).components() {
        match component {
            Component::Normal(os_seg) => {
                let Some(seg) = os_seg.to_str() else {
                    return Err(AppError::BadRequest(
                        "non-UTF-8 segment in tar entry path".to_owned(),
                    ));
                };
                if seg.is_empty() || seg == "." || seg == ".." {
                    return Err(AppError::BadRequest(format!(
                        "unsafe segment in tar entry path '{raw_path}'"
                    )));
                }
                normal_segments.push(seg.to_owned());
            }
            Component::CurDir => {
                // Reject paths containing `.` segments rather than normalizing ambiguous archives.
                return Err(AppError::BadRequest(format!(
                    "dot segment in tar entry path '{raw_path}' is forbidden"
                )));
            }
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err(AppError::BadRequest(format!(
                    "path traversal in tar entry path '{raw_path}' is forbidden"
                )));
            }
        }
    }

    if normal_segments.is_empty() {
        return Err(AppError::BadRequest(format!(
            "empty normalized tar entry path '{raw_path}'"
        )));
    }

    Ok(normal_segments)
}

/// Validates `^[a-z0-9][a-z0-9.-]*$` with no `..` and bounded length.
pub fn is_valid_chart_token(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.is_empty() || bytes.len() > 128 || value.contains("..") {
        return false;
    }
    if !bytes[0].is_ascii_lowercase() && !bytes[0].is_ascii_digit() {
        return false;
    }
    bytes
        .iter()
        .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || *b == b'.' || *b == b'-')
}

/// Validates chart versions compatible with `^[a-z0-9][a-z0-9.-]*$` (including `v1.21.2` and `2.0.0-100042`).
pub fn is_valid_chart_version(value: &str) -> bool {
    is_valid_chart_token(value)
}

/// Validates `^[a-z0-9][a-z0-9.-]*\.tgz$` with no path traversal.
pub fn is_valid_archive_filename(filename: &str) -> bool {
    if filename.len() > 260 || filename.contains("..") {
        return false;
    }
    let Some(stem) = filename.strip_suffix(".tgz") else {
        return false;
    };
    is_valid_chart_token(stem)
}

/// Helper used by `--smoke` and tests to build a valid deterministic `.tgz` Helm chart in memory.
pub fn build_chart_tgz(
    name: &str,
    version: &str,
    app_version: &str,
    description: &str,
    content_fingerprint: Option<&str>,
    values_yaml: &str,
) -> Result<Vec<u8>, AppError> {
    use flate2::Compression;
    use flate2::write::GzEncoder;
    use tar::Builder;

    let mut chart_yaml = format!(
        "apiVersion: v2\nname: {name}\nversion: {version}\nappVersion: {app_version}\ndescription: {description}\n"
    );
    if let Some(fp) = content_fingerprint {
        chart_yaml.push_str(&format!(
            "annotations:\n  \"{CONTENT_FINGERPRINT_ANNOTATION}\": \"{fp}\"\n"
        ));
    }

    let encoder = GzEncoder::new(Vec::new(), Compression::default());
    let mut tar_builder = Builder::new(encoder);

    append_tar_file(
        &mut tar_builder,
        &format!("{name}/Chart.yaml"),
        chart_yaml.as_bytes(),
    )?;
    append_tar_file(
        &mut tar_builder,
        &format!("{name}/values.yaml"),
        values_yaml.as_bytes(),
    )?;

    let encoder = tar_builder
        .into_inner()
        .map_err(|err| AppError::Internal(format!("tar finalize failed: {err}")))?;
    encoder
        .finish()
        .map_err(|err| AppError::Internal(format!("gzip finalize failed: {err}")))
}

fn append_tar_file<W: io::Write>(
    builder: &mut tar::Builder<W>,
    path: &str,
    contents: &[u8],
) -> Result<(), AppError> {
    let mut header = Header::new_gnu();
    header.set_entry_type(EntryType::Regular);
    header.set_size(contents.len() as u64);
    header.set_mode(0o644);
    header.set_mtime(1_767_225_600);
    header.set_cksum();
    builder
        .append_data(&mut header, path, contents)
        .map_err(|err| AppError::Internal(format!("tar append failed for '{path}': {err}")))
}
