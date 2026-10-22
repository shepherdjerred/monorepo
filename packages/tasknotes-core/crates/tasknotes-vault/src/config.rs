//! TaskNotes configuration providers and configurable workflow semantics.

use indexmap::IndexMap;
use serde::Deserialize;
use serde_json::Value;

use crate::{Result, VaultError, mapping::FieldMapping};

/// Plugin settings location relative to a vault.
pub const PLUGIN_CONFIGURATION_PATH: &str = ".obsidian/plugins/tasknotes/data.json";
/// Portable configuration location relative to a vault.
pub const PORTABLE_CONFIGURATION_PATH: &str = "tasknotes.yaml";

/// The provider supplying the effective configuration.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ConfigurationSource {
    /// Settings from the Obsidian TaskNotes plugin.
    PluginDataJson,
    /// Settings from the portable YAML file.
    TasknotesYaml,
    /// Explicitly selected upstream defaults.
    Standard,
}

/// A configured status, rather than a closed application enum.
#[derive(Debug, Clone, PartialEq, serde::Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusDefinition {
    /// Stable settings identifier.
    pub id: String,
    /// Exact frontmatter value.
    pub value: String,
    /// User-facing label.
    pub label: String,
    /// Configured display color.
    pub color: String,
    /// Whether this value completes a task.
    pub is_completed: bool,
    /// Workflow order.
    pub order: f64,
    /// Whether cycling omits this status.
    #[serde(default)]
    pub exclude_from_cycle: bool,
    /// Explicit workflow successor, when configured.
    #[serde(default)]
    pub next_status: Option<String>,
    /// Additional settings preserved for consumers implementing other roles.
    #[serde(flatten)]
    pub extra: IndexMap<String, Value>,
}

/// A configured priority with a user-defined value and ordering weight.
#[derive(Debug, Clone, PartialEq, serde::Serialize, Deserialize)]
pub struct PriorityDefinition {
    /// Stable settings identifier.
    pub id: String,
    /// Exact frontmatter value.
    pub value: String,
    /// User-facing label.
    pub label: String,
    /// Configured display color.
    pub color: String,
    /// Ordering weight.
    pub weight: f64,
    /// Additional settings preserved without reinterpretation.
    #[serde(flatten)]
    pub extra: IndexMap<String, Value>,
}

/// How the plugin recognizes task notes.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DetectionMethod {
    /// A frontmatter or inline tag identifies a task.
    Tag,
    /// A configured frontmatter property identifies a task.
    Property,
}

/// Task identification rules from the effective configuration.
#[derive(Debug, Clone, PartialEq, serde::Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskIdentification {
    /// Identification strategy.
    pub method: DetectionMethod,
    /// Task tag without its leading hash.
    pub tag: String,
    /// Identification property name.
    pub property_name: String,
    /// Identification property value, as stored by plugin settings.
    pub property_value: String,
    /// Comma/newline-separated excluded folder prefixes.
    #[serde(default)]
    pub excluded_folders: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ModelConfiguration {
    field_mapping: IndexMap<String, String>,
    statuses: Vec<StatusDefinition>,
    priorities: Vec<PriorityDefinition>,
    defaults: CreationDefaults,
    task_identification: TaskIdentification,
    store_title_in_filename: bool,
    #[serde(flatten)]
    extra: IndexMap<String, Value>,
}

#[derive(Debug, Clone, Deserialize)]
struct CreationDefaults {
    status: String,
    priority: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PluginSettings {
    field_mapping: Option<IndexMap<String, String>>,
    custom_statuses: Option<Vec<StatusDefinition>>,
    custom_priorities: Option<Vec<PriorityDefinition>>,
    task_tag: Option<String>,
    task_identification_method: Option<DetectionMethod>,
    task_property_name: Option<String>,
    task_property_value: Option<String>,
    excluded_folders: Option<String>,
    store_title_in_filename: Option<bool>,
    default_task_status: Option<String>,
    default_task_priority: Option<String>,
    #[serde(flatten)]
    extra: IndexMap<String, Value>,
}

#[derive(Deserialize)]
struct PortableSettings {
    spec_version: Option<String>,
    mapping: Option<IndexMap<String, String>>,
    status: Option<PortableStatus>,
    defaults: Option<IndexMap<String, Value>>,
    task_detection: Option<PortableDetection>,
    title: Option<PortableTitle>,
    #[serde(flatten)]
    extra: IndexMap<String, Value>,
}

#[derive(Deserialize)]
struct PortableStatus {
    values: Vec<String>,
    default: String,
    completed_values: Vec<String>,
}

#[derive(Deserialize)]
struct PortableDetection {
    #[serde(default = "tag_detection")]
    method: DetectionMethod,
    tag: Option<String>,
    property_name: Option<String>,
    property_value: Option<String>,
    excluded_folders: Option<Value>,
    #[serde(flatten)]
    extra: IndexMap<String, Value>,
}

fn tag_detection() -> DetectionMethod {
    DetectionMethod::Tag
}

#[derive(Deserialize)]
struct PortableTitle {
    storage: String,
    #[serde(flatten)]
    extra: IndexMap<String, Value>,
}

fn apply_portable(model: &mut ModelConfiguration, bytes: &[u8]) -> Result<()> {
    let text = std::str::from_utf8(bytes)
        .map_err(|_| VaultError::Configuration("portable settings must be UTF-8".to_owned()))?;
    let raw: serde_json::Map<String, Value> = serde_saphyr::from_str(text).map_err(|_| {
        VaultError::Configuration("portable settings violate their schema".to_owned())
    })?;
    for key in [
        "spec_version",
        "mapping",
        "status",
        "defaults",
        "task_detection",
        "title",
    ] {
        if raw.get(key).is_some_and(Value::is_null) {
            return Err(VaultError::Configuration(
                "portable settings contain an invalid null value".to_owned(),
            ));
        }
    }
    let settings: PortableSettings = serde_json::from_value(Value::Object(raw)).map_err(|_| {
        VaultError::Configuration("portable settings violate their schema".to_owned())
    })?;
    if let Some(version) = settings.spec_version
        && !semver::Version::parse(&version).is_ok_and(|version| version.major == 0)
    {
        return Err(VaultError::Configuration(
            "unsupported or malformed spec_version".to_owned(),
        ));
    }
    if let Some(mapping) = settings.mapping {
        for (role, field) in mapping {
            if crate::mapping::is_retired_role(&role) {
                // Preserve historical declarations without assigning a current
                // task role or reinterpreting the corresponding vault values.
                model.field_mapping.insert(role, field);
                continue;
            }
            let role = crate::mapping::canonical_role(&role)
                .ok_or_else(|| VaultError::Configuration("unsupported mapping role".to_owned()))?;
            model.field_mapping.insert(role.to_owned(), field);
        }
    }
    if let Some(status) = settings.status {
        apply_portable_status(model, status)?;
    }
    if let Some(defaults) = settings.defaults {
        apply_portable_defaults(model, defaults)?;
    }
    apply_portable_presentation(model, settings.task_detection, settings.title)?;
    model.extra.extend(settings.extra);
    Ok(())
}

fn apply_portable_status(model: &mut ModelConfiguration, status: PortableStatus) -> Result<()> {
    if status.completed_values.is_empty()
        || !status.values.contains(&status.default)
        || status
            .completed_values
            .iter()
            .any(|s| !status.values.contains(s))
    {
        return Err(VaultError::Configuration(
            "status defaults and completed values must belong to its value set".to_owned(),
        ));
    }
    model.defaults.status = status.default;
    model.statuses = status
        .values
        .into_iter()
        .enumerate()
        .map(|(index, value)| {
            let order = u32::try_from(index)
                .map(f64::from)
                .map_err(|_| VaultError::Configuration("too many statuses".to_owned()))?;
            Ok(StatusDefinition {
                id: value.clone(),
                label: value.clone(),
                is_completed: status.completed_values.contains(&value),
                value,
                color: "#808080".to_owned(),
                order,
                exclude_from_cycle: false,
                next_status: None,
                extra: IndexMap::new(),
            })
        })
        .collect::<Result<_>>()?;
    Ok(())
}

fn apply_portable_defaults(
    model: &mut ModelConfiguration,
    defaults: IndexMap<String, Value>,
) -> Result<()> {
    if let Some(status) = defaults.get("status") {
        let value = status
            .as_str()
            .filter(|value| model.statuses.iter().any(|status| status.value == *value))
            .ok_or_else(|| {
                VaultError::Configuration(
                    "default status must belong to the configured workflow".to_owned(),
                )
            })?;
        model.defaults.status = value.to_owned();
    }
    if let Some(priority) = defaults.get("priority") {
        let value = priority
            .as_str()
            .filter(|value| {
                model
                    .priorities
                    .iter()
                    .any(|priority| priority.value == *value)
            })
            .ok_or_else(|| {
                VaultError::Configuration(
                    "default priority must belong to the configured priorities".to_owned(),
                )
            })?;
        model.defaults.priority = value.to_owned();
    }
    model.extra.insert(
        "portableDefaults".to_owned(),
        serde_json::to_value(defaults)
            .map_err(|_| VaultError::Configuration("invalid portable defaults".to_owned()))?,
    );
    Ok(())
}

fn apply_portable_presentation(
    model: &mut ModelConfiguration,
    detection: Option<PortableDetection>,
    title: Option<PortableTitle>,
) -> Result<()> {
    if let Some(detection) = detection {
        if detection.extra.contains_key("field_presence")
            || detection.extra.contains_key("field_match")
        {
            return Err(VaultError::Configuration(
                "field detection extensions are not yet supported".to_owned(),
            ));
        }
        let mut policy: serde_json::Map<String, Value> = detection.extra.into_iter().collect();
        policy.insert(
            "method".to_owned(),
            serde_json::to_value(detection.method)
                .map_err(|_| VaultError::Configuration("invalid detection method".to_owned()))?,
        );
        if let Some(name) = &detection.property_name {
            policy.insert("property_name".to_owned(), Value::from(name.clone()));
        }
        if let Some(tag) = &detection.tag {
            policy.insert("tag".to_owned(), Value::from(tag.clone()));
        }
        model.task_identification.method =
            crate::detection_policy::methods(&Value::Object(policy))?
                .into_iter()
                .next()
                .ok_or_else(|| VaultError::Configuration("detection method missing".to_owned()))?;
        if let Some(value) = detection.tag {
            model.task_identification.tag = value;
        }
        if let Some(value) = detection.property_name {
            model.task_identification.property_name = value;
        }
        model.task_identification.property_value = detection.property_value.unwrap_or_default();
        if let Some(value) = detection.excluded_folders {
            model.task_identification.excluded_folders = match value {
                Value::String(value) => value,
                Value::Array(values) => values
                    .iter()
                    .map(|value| {
                        value.as_str().ok_or_else(|| {
                            VaultError::Configuration("excluded folders must be strings".to_owned())
                        })
                    })
                    .collect::<Result<Vec<_>>>()?
                    .join(","),
                _ => {
                    return Err(VaultError::Configuration(
                        "excluded folders must be a string or list".to_owned(),
                    ));
                }
            };
        }
    }
    if let Some(title) = title {
        model.store_title_in_filename = match title.storage.as_str() {
            "filename" => true,
            "frontmatter" => false,
            _ => {
                return Err(VaultError::Configuration(
                    "title.storage must be filename or frontmatter".to_owned(),
                ));
            }
        };
        model.extra.insert(
            "portableTitle".to_owned(),
            serde_json::to_value(title.extra)
                .map_err(|_| VaultError::Configuration("invalid title configuration".to_owned()))?,
        );
    }
    Ok(())
}

fn parse_plugin(bytes: &[u8]) -> Result<PluginSettings> {
    let raw: serde_json::Map<String, Value> = serde_json::from_slice(bytes).map_err(|_| {
        VaultError::Configuration("plugin settings violate their schema".to_owned())
    })?;
    crate::plugin_boundary::validate(&raw)?;
    for key in [
        "fieldMapping",
        "customStatuses",
        "customPriorities",
        "taskTag",
        "taskIdentificationMethod",
        "taskPropertyName",
        "taskPropertyValue",
        "excludedFolders",
        "storeTitleInFilename",
        "defaultTaskStatus",
        "defaultTaskPriority",
    ] {
        if raw.get(key).is_some_and(Value::is_null) {
            return Err(VaultError::Configuration(
                "plugin settings contain an invalid null value".to_owned(),
            ));
        }
    }
    serde_json::from_value(Value::Object(raw))
        .map_err(|_| VaultError::Configuration("plugin settings violate their schema".to_owned()))
}

/// Validated configuration shared by the vault parser and edit planner.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskNotesConfiguration {
    /// Normalized top-level provider selection with documented nested defaults.
    pub effective: Value,
    /// Provider selected by the explicit precedence chain.
    pub source: ConfigurationSource,
    /// Effective physical field mapping.
    pub mapping: FieldMapping,
    /// Configured status definitions, ordered for cycling.
    pub statuses: Vec<StatusDefinition>,
    /// Configured priority definitions.
    pub priorities: Vec<PriorityDefinition>,
    /// Task identification rules.
    pub identification: TaskIdentification,
    /// Read titles from filenames instead of frontmatter.
    pub store_title_in_filename: bool,
    /// Creation status; absent when upstream defaults do not match a workflow.
    pub default_status: Option<String>,
    /// Creation priority; absent when upstream defaults do not match priorities.
    pub default_priority: Option<String>,
    /// Additional configuration retained for other engine components.
    pub extra: IndexMap<String, Value>,
}

impl TaskNotesConfiguration {
    /// Resolve plugin settings, portable YAML, then explicitly approved defaults.
    /// Present invalid providers fail instead of falling through.
    ///
    /// # Errors
    /// Returns a configuration error for invalid providers, mappings, or workflows.
    pub fn resolve(
        plugin: Option<&[u8]>,
        portable: Option<&[u8]>,
        approve_standard: bool,
    ) -> Result<Self> {
        let selected = Self::resolve_single(
            plugin,
            if plugin.is_some() { None } else { portable },
            approve_standard,
        )?;
        let standard = Self::resolve_single(None, None, true)?;
        crate::effective::resolve(selected, &standard, plugin, portable)
    }

    fn resolve_single(
        plugin: Option<&[u8]>,
        portable: Option<&[u8]>,
        approve_standard: bool,
    ) -> Result<Self> {
        let mut model: ModelConfiguration = serde_json::from_str(include_str!("defaults.json"))
            .map_err(|_| {
                VaultError::Configuration("embedded defaults violate their schema".to_owned())
            })?;
        let source = if let Some(bytes) = plugin {
            let settings = parse_plugin(bytes)?;
            if let Some(mapping) = settings.field_mapping {
                model.field_mapping.extend(mapping);
            }
            if let Some(statuses) = settings.custom_statuses {
                model.statuses = statuses;
            }
            if let Some(priorities) = settings.custom_priorities {
                model.priorities = priorities;
            }
            if let Some(tag) = settings.task_tag {
                model.task_identification.tag = tag;
            }
            if let Some(method) = settings.task_identification_method {
                model.task_identification.method = method;
            }
            if let Some(name) = settings.task_property_name {
                model.task_identification.property_name = name;
            }
            if let Some(value) = settings.task_property_value {
                model.task_identification.property_value = value;
            }
            if let Some(folders) = settings.excluded_folders {
                model.task_identification.excluded_folders = folders;
            }
            if let Some(value) = settings.store_title_in_filename {
                model.store_title_in_filename = value;
            }
            if let Some(value) = settings.default_task_status {
                if !model.statuses.iter().any(|s| s.value == value) {
                    return Err(VaultError::Configuration(
                        "defaultTaskStatus is not in the configured workflow".to_owned(),
                    ));
                }
                model.defaults.status = value;
            }
            if let Some(value) = settings.default_task_priority {
                if !model.priorities.iter().any(|p| p.value == value) {
                    return Err(VaultError::Configuration(
                        "defaultTaskPriority is not in the configured priorities".to_owned(),
                    ));
                }
                model.defaults.priority = value;
            }
            model.extra.extend(settings.extra);
            ConfigurationSource::PluginDataJson
        } else if let Some(bytes) = portable {
            apply_portable(&mut model, bytes)?;
            ConfigurationSource::TasknotesYaml
        } else if approve_standard {
            ConfigurationSource::Standard
        } else {
            return Err(VaultError::Configuration(
                "select standard settings before editing a vault without configuration".to_owned(),
            ));
        };

        let mapping = FieldMapping::from_plugin(&model.field_mapping)?;
        model.statuses.sort_by(|left, right| {
            // JS numeric sort treats both signs of zero as a stable tie.
            if left.order.abs().to_bits() == 0 && right.order.abs().to_bits() == 0 {
                std::cmp::Ordering::Equal
            } else {
                left.order.total_cmp(&right.order)
            }
        });
        let result = Self {
            effective: Value::Null,
            source,
            mapping,
            default_status: model
                .statuses
                .iter()
                .any(|s| s.value == model.defaults.status)
                .then_some(model.defaults.status),
            default_priority: model
                .priorities
                .iter()
                .any(|p| p.value == model.defaults.priority)
                .then_some(model.defaults.priority),
            statuses: model.statuses,
            priorities: model.priorities,
            identification: model.task_identification,
            store_title_in_filename: model.store_title_in_filename,
            extra: model.extra,
        };
        result.validate()?;
        Ok(result)
    }

    fn validate(&self) -> Result<()> {
        if self.statuses.is_empty() || self.priorities.is_empty() {
            return Err(VaultError::Configuration(
                "statuses and priorities cannot be empty".to_owned(),
            ));
        }
        let mut values = IndexMap::new();
        let mut ids = IndexMap::new();
        for status in &self.statuses {
            if status.id.trim().is_empty()
                || status.value.trim().is_empty()
                || !status.order.is_finite()
                || values.insert(status.value.clone(), ()).is_some()
                || ids.insert(status.id.clone(), ()).is_some()
            {
                return Err(VaultError::Configuration(
                    "status IDs and values must be nonempty and unique".to_owned(),
                ));
            }
        }
        for status in &self.statuses {
            if status
                .next_status
                .as_ref()
                .is_some_and(|next| !next.is_empty() && !values.contains_key(next))
            {
                return Err(VaultError::Configuration(
                    "nextStatus references an unknown status".to_owned(),
                ));
            }
        }
        values.clear();
        ids.clear();
        for priority in &self.priorities {
            if priority.id.trim().is_empty()
                || priority.value.trim().is_empty()
                || !priority.weight.is_finite()
                || values.insert(priority.value.clone(), ()).is_some()
                || ids.insert(priority.id.clone(), ()).is_some()
            {
                return Err(VaultError::Configuration(
                    "priority IDs and values must be nonempty and unique".to_owned(),
                ));
            }
        }
        match self.identification.method {
            DetectionMethod::Tag
                if self
                    .identification
                    .tag
                    .trim()
                    .trim_start_matches('#')
                    .is_empty() =>
            {
                Err(VaultError::Configuration(
                    "taskTag cannot be empty".to_owned(),
                ))
            }
            DetectionMethod::Property if self.identification.property_name.trim().is_empty() => {
                Err(VaultError::Configuration(
                    "taskPropertyName cannot be empty".to_owned(),
                ))
            }
            _ => Ok(()),
        }
    }

    /// Determine completion using the configured workflow.
    ///
    /// # Errors
    /// Rejects unknown status values rather than treating them as open.
    pub fn is_completed(&self, value: &str) -> Result<bool> {
        self.statuses
            .iter()
            .find(|s| s.value == value)
            .map(|s| s.is_completed)
            .ok_or_else(|| {
                VaultError::Document("status is not present in the configured workflow".to_owned())
            })
    }

    /// Resolve displayed title according to the effective storage policy.
    /// Filename storage takes precedence over a retained frontmatter mirror.
    #[must_use]
    pub fn display_title(
        &self,
        frontmatter: &serde_json::Map<String, Value>,
        path: Option<&str>,
    ) -> Option<String> {
        if self.store_title_in_filename
            && let Some(filename) = path
                .and_then(|path| path.rsplit('/').next())
                .filter(|value| !value.is_empty())
        {
            return Some(filename.strip_suffix(".md").unwrap_or(filename).to_owned());
        }
        self.mapping.display_title(frontmatter, path)
    }

    /// Cycle a status using explicit successors and configured order.
    ///
    /// # Errors
    /// Rejects unknown values and workflows with no cycle participants.
    pub fn next_status(&self, value: &str) -> Result<&str> {
        let current = self
            .statuses
            .iter()
            .find(|s| s.value == value)
            .ok_or_else(|| {
                VaultError::Document("status is not present in the configured workflow".to_owned())
            })?;
        if let Some(next) = current.next_status.as_deref().filter(|s| !s.is_empty()) {
            return Ok(next);
        }
        let cycle: Vec<_> = self
            .statuses
            .iter()
            .filter(|s| !s.exclude_from_cycle)
            .collect();
        let next_index = cycle
            .iter()
            .position(|s| s.value == value)
            .map_or(0, |index| (index + 1) % cycle.len());
        cycle
            .get(next_index)
            .map(|s| s.value.as_str())
            .ok_or_else(|| {
                VaultError::Configuration(
                    "workflow has no statuses available for cycling".to_owned(),
                )
            })
    }
}
