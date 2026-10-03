//! Lossless Markdown documents and content-addressed conditional edit plans.

use std::{ops::Range, str::FromStr};

use serde_json::{Map, Value};
use sha2::{Digest, Sha256};
use yaml_edit::{Document, YamlFile};

use crate::{Result, VaultError, path::VaultPath};

/// Content revision used as a compare-and-swap precondition, not an mtime.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(transparent)]
pub struct ContentRevision(String);

impl ContentRevision {
    /// Hash the exact document bytes.
    #[must_use]
    pub fn of(bytes: &[u8]) -> Self {
        Self(hex::encode(Sha256::digest(bytes)))
    }

    /// Borrow the hexadecimal SHA-256 revision.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// Set or remove a physical frontmatter property.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum PropertyEdit {
    /// Set a property to a JSON-compatible YAML value.
    Set {
        /// Physical property name, after configuration mapping.
        key: String,
        /// New property value.
        value: Value,
    },
    /// Remove the entire property rather than writing YAML null.
    Remove {
        /// Physical property name.
        key: String,
    },
}

/// A fully planned write. Hosts must durably journal it and compare the
/// current bytes to `expected_revision` before replacing a file.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentWrite {
    /// Logical vault-relative target path.
    pub path: VaultPath,
    /// Exact prior content required for this write.
    pub expected_revision: ContentRevision,
    /// Complete replacement bytes, including unchanged Markdown and BOM.
    pub bytes: Vec<u8>,
    /// Content revision after the write.
    pub revision: ContentRevision,
}

impl DocumentWrite {
    /// Verify the host's freshly read bytes before a conditional write.
    ///
    /// # Errors
    /// Returns a conflict when the file changed since planning.
    pub fn check_current(&self, bytes: &[u8]) -> Result<()> {
        if ContentRevision::of(bytes) == self.expected_revision {
            Ok(())
        } else {
            Err(VaultError::Conflict)
        }
    }
}

/// A validated document retaining its original source rather than a
/// reserialized representation of every property.
#[derive(Debug, Clone)]
pub struct TaskDocument {
    path: VaultPath,
    text: String,
    frontmatter: Map<String, Value>,
    yaml_range: Option<Range<usize>>,
    body_start: usize,
    bom_length: usize,
    newline: &'static str,
}

impl TaskDocument {
    /// Parse UTF-8 Markdown and validate any frontmatter as a single mapping.
    /// No include resolution or plugin/script execution occurs.
    ///
    /// # Errors
    /// Rejects invalid UTF-8, unterminated or malformed YAML, duplicate keys,
    /// and non-mapping frontmatter. Parser diagnostics omit document contents.
    pub fn parse(path: VaultPath, bytes: &[u8]) -> Result<Self> {
        Self::from_bytes(path, bytes.to_vec())
    }

    /// Parse an owned document buffer without copying its UTF-8 text.
    ///
    /// # Errors
    /// Rejects the same invalid documents as [`Self::parse`].
    pub fn from_bytes(path: VaultPath, bytes: Vec<u8>) -> Result<Self> {
        let text = String::from_utf8(bytes)
            .map_err(|_| VaultError::Document("Markdown must be UTF-8".to_owned()))?;
        let bom_length = if text.starts_with('\u{feff}') {
            '\u{feff}'.len_utf8()
        } else {
            0
        };
        let content = text
            .get(bom_length..)
            .ok_or_else(|| VaultError::Document("invalid byte order mark".to_owned()))?;
        let newline = if content
            .split_inclusive('\n')
            .next()
            .is_some_and(|line| line.ends_with("\r\n"))
        {
            "\r\n"
        } else {
            "\n"
        };
        let mut yaml_range = None;
        let mut body_start = bom_length;
        let mut lines = content.split_inclusive('\n');
        if let Some(first) = lines
            .next()
            .filter(|line| line.trim_end_matches(['\r', '\n', ' ', '\t']) == "---")
        {
            let start = bom_length + first.len();
            let mut offset = start;
            for line in lines {
                if matches!(
                    line.trim_end_matches(['\r', '\n', ' ', '\t']),
                    "---" | "..."
                ) {
                    yaml_range = Some(start..offset);
                    body_start = offset + line.len();
                    break;
                }
                offset += line.len();
            }
            if yaml_range.is_none() {
                return Err(VaultError::Document(
                    "frontmatter closing delimiter is missing".to_owned(),
                ));
            }
        }
        let frontmatter = if let Some(range) = &yaml_range {
            let yaml = text
                .get(range.clone())
                .ok_or_else(|| VaultError::Document("invalid frontmatter range".to_owned()))?;
            if yaml
                .lines()
                .all(|line| line.trim().is_empty() || line.trim_start().starts_with('#'))
            {
                Map::new()
            } else {
                let parsed = YamlFile::parse(yaml);
                if !parsed.ok() {
                    return Err(VaultError::Document(
                        "frontmatter has invalid YAML syntax".to_owned(),
                    ));
                }
                serde_saphyr::from_str::<Map<String, Value>>(yaml).map_err(|_| {
                    VaultError::Document(
                        "frontmatter must be a valid mapping with unique keys".to_owned(),
                    )
                })?
            }
        } else {
            Map::new()
        };
        Ok(Self {
            path,
            text,
            frontmatter,
            yaml_range,
            body_start,
            bom_length,
            newline,
        })
    }

    /// Borrow the exact logical identity.
    #[must_use]
    pub fn path(&self) -> &VaultPath {
        &self.path
    }

    /// Borrow the parsed properties. Unknown properties remain present.
    #[must_use]
    pub fn frontmatter(&self) -> &Map<String, Value> {
        &self.frontmatter
    }

    /// Borrow the unchanged Markdown body, including its whitespace.
    #[must_use]
    pub fn body(&self) -> &str {
        // The parser only constructs this offset at UTF-8 line boundaries.
        self.text.split_at(self.body_start).1
    }

    /// Borrow the complete original bytes.
    #[must_use]
    pub fn bytes(&self) -> &[u8] {
        self.text.as_bytes()
    }

    /// Compute the exact content revision.
    #[must_use]
    pub fn revision(&self) -> ContentRevision {
        ContentRevision::of(self.bytes())
    }

    /// Plan targeted edits and an optional explicit body replacement.
    /// Unchanged properties are never serialized from their semantic values.
    ///
    /// # Errors
    /// Rejects malformed edit keys and changes that produce invalid YAML.
    pub fn plan(&self, edits: &[PropertyEdit], body: Option<&str>) -> Result<DocumentWrite> {
        if edits.is_empty() && body.is_none() {
            return Ok(self.write(self.text.clone().into_bytes()));
        }
        if edits.is_empty() {
            let mut result = self.text.split_at(self.body_start).0.to_owned();
            result.push_str(body.unwrap_or_else(|| self.body()));
            return Ok(self.write(result.into_bytes()));
        }
        let yaml = self
            .yaml_range
            .as_ref()
            .map(|r| {
                self.text
                    .get(r.clone())
                    .ok_or_else(|| VaultError::Document("invalid frontmatter range".to_owned()))
            })
            .transpose()?
            .unwrap_or("");
        let file = YamlFile::from_str(yaml)
            .map_err(|_| VaultError::Document("frontmatter cannot be edited safely".to_owned()))?;
        let existing_document = file.documents().next();
        let attached = existing_document.is_some();
        let document = existing_document.unwrap_or_else(Document::new_mapping);
        let mut expected = self.frontmatter.clone();
        let mut seen = indexmap::IndexSet::new();
        for edit in edits {
            let key = match edit {
                PropertyEdit::Set { key, .. } | PropertyEdit::Remove { key } => key,
            };
            if !seen.insert(key) {
                return Err(VaultError::Document(
                    "a property may only be edited once per plan".to_owned(),
                ));
            }
            match edit {
                PropertyEdit::Set { key, value } => {
                    validate_key(key)?;
                    if self.frontmatter.get(key) == Some(value) {
                        continue;
                    }
                    expected.insert(key.clone(), value.clone());
                    let fragment =
                        Document::from_str(&format!("value: {value}\n")).map_err(|_| {
                            VaultError::Document(
                                "new property cannot be represented as YAML".to_owned(),
                            )
                        })?;
                    let node = fragment.get("value").ok_or_else(|| {
                        VaultError::Document("new property value is missing".to_owned())
                    })?;
                    if !document.set(key.as_str(), node) {
                        return Err(VaultError::Document(
                            "frontmatter root is not a mapping".to_owned(),
                        ));
                    }
                }
                PropertyEdit::Remove { key } => {
                    validate_key(key)?;
                    expected.remove(key);
                    document.remove(key.as_str());
                }
            }
        }
        let mut rendered = if attached {
            file.to_string()
        } else {
            format!("{yaml}{document}")
        };
        if self.newline == "\r\n" && !yaml.replace("\r\n", "").contains('\n') {
            rendered = rendered.replace("\r\n", "\n").replace('\n', "\r\n");
        }
        if !rendered.is_empty() && !rendered.ends_with('\n') {
            rendered.push_str(self.newline);
        }
        let result = self.assemble(&rendered, body)?;
        let bytes = result.into_bytes();
        let reparsed = Self::parse(self.path.clone(), &bytes)?;
        if reparsed.frontmatter != expected {
            return Err(VaultError::Document(
                "the edit changed properties outside its plan".to_owned(),
            ));
        }
        Ok(self.write(bytes))
    }

    fn assemble(&self, rendered: &str, body: Option<&str>) -> Result<String> {
        let mut result = String::new();
        if let Some(range) = &self.yaml_range {
            result.push_str(
                self.text
                    .get(..range.start)
                    .ok_or_else(|| VaultError::Document("invalid frontmatter prefix".to_owned()))?,
            );
            result.push_str(rendered);
            result.push_str(
                self.text.get(range.end..self.body_start).ok_or_else(|| {
                    VaultError::Document("invalid frontmatter delimiter".to_owned())
                })?,
            );
        } else if !rendered.trim().is_empty() {
            result.push_str(
                self.text
                    .get(..self.bom_length)
                    .ok_or_else(|| VaultError::Document("invalid byte order mark".to_owned()))?,
            );
            result.push_str("---");
            result.push_str(self.newline);
            result.push_str(rendered);
            result.push_str("---");
            result.push_str(self.newline);
        } else {
            result.push_str(
                self.text
                    .get(..self.bom_length)
                    .ok_or_else(|| VaultError::Document("invalid byte order mark".to_owned()))?,
            );
        }
        result.push_str(body.unwrap_or_else(|| self.body()));
        Ok(result)
    }

    fn write(&self, bytes: Vec<u8>) -> DocumentWrite {
        DocumentWrite {
            path: self.path.clone(),
            expected_revision: self.revision(),
            revision: ContentRevision::of(&bytes),
            bytes,
        }
    }
}

fn validate_key(key: &str) -> Result<()> {
    if key.trim().is_empty() || key.chars().any(char::is_control) {
        Err(VaultError::Document(
            "property names must be nonempty and contain no control characters".to_owned(),
        ))
    } else {
        Ok(())
    }
}
