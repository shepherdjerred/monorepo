//! Configurable semantic-role mappings shared by every native host.

use indexmap::IndexMap;
use serde_json::{Map, Value};

use crate::{Result, VaultError};

/// Roles understood by the standalone vault engine.
pub const ROLES: &[&str] = &[
    "title",
    "status",
    "priority",
    "due",
    "scheduled",
    "completedDate",
    "tags",
    "contexts",
    "projects",
    "attachments",
    "timeEstimate",
    "dateCreated",
    "dateModified",
    "recurrence",
    "recurrenceAnchor",
    "completeInstances",
    "skippedInstances",
    "timeEntries",
    "blockedBy",
    "reminders",
    "recurrenceParent",
    "occurrenceDate",
    "occurrenceMaterialization",
    "occurrenceNextTrigger",
    "occurrenceTemplate",
    "occurrencePastHorizon",
    "occurrenceFutureHorizon",
    "archiveTag",
    "pomodoros",
    "icsEventId",
    "icsEventTag",
    "googleCalendarEventId",
    "googleCalendarExceptionEventId",
    "googleCalendarExceptionOriginalScheduled",
    "googleCalendarMovedOriginalDates",
    "sortOrder",
];

/// Normalize accepted role aliases without normalizing physical field names.
#[must_use]
pub fn canonical_role(role: &str) -> Option<&str> {
    let canonical = match role {
        "completed_date" => "completedDate",
        "date_created" => "dateCreated",
        "date_modified" => "dateModified",
        "time_estimate" => "timeEstimate",
        "time_entries" => "timeEntries",
        "recurrence_anchor" => "recurrenceAnchor",
        "complete_instances" => "completeInstances",
        "skipped_instances" => "skippedInstances",
        "blocked_by" => "blockedBy",
        "recurrence_parent" => "recurrenceParent",
        "occurrence_date" => "occurrenceDate",
        "occurrence_materialization" => "occurrenceMaterialization",
        "occurrence_next_trigger" => "occurrenceNextTrigger",
        "occurrence_template" => "occurrenceTemplate",
        "occurrence_past_horizon" => "occurrencePastHorizon",
        "occurrence_future_horizon" => "occurrenceFutureHorizon",
        other => other,
    };
    ROLES.contains(&canonical).then_some(canonical)
}

/// Ordered role-to-field and field-to-role lookup tables.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FieldMapping {
    /// Primary physical key used for each role.
    pub role_to_field: IndexMap<String, String>,
    /// Recognized physical keys and their semantic roles.
    pub field_to_role: IndexMap<String, String>,
    /// Preferred display-title key.
    pub display_name_key: String,
    /// Completed values declared or inferred by the spec mapping rules.
    pub completed_statuses: Vec<String>,
}

impl Default for FieldMapping {
    fn default() -> Self {
        Self {
            role_to_field: ROLES
                .iter()
                .map(|role| ((*role).to_owned(), (*role).to_owned()))
                .collect(),
            field_to_role: ROLES
                .iter()
                .map(|role| ((*role).to_owned(), (*role).to_owned()))
                .collect(),
            display_name_key: "title".to_owned(),
            completed_statuses: vec!["done".to_owned(), "cancelled".to_owned()],
        }
    }
}

impl FieldMapping {
    /// Build a mapping from spec field declarations. First declaration wins
    /// when several physical fields declare the same semantic role.
    ///
    /// # Errors
    /// Returns a configuration error for a malformed field declaration.
    pub fn from_fields(
        fields: &Map<String, Value>,
        display_name_key: Option<&str>,
    ) -> Result<Self> {
        let mut result = Self::default();
        result.field_to_role.clear();
        let mut explicit = IndexMap::new();
        for (field, declaration) in fields {
            let object = declaration.as_object().ok_or_else(|| {
                VaultError::Configuration("field declarations must be objects".to_owned())
            })?;
            let Some(role) = object.get("tn_role") else {
                continue;
            };
            let role = role
                .as_str()
                .ok_or_else(|| VaultError::Configuration("tn_role must be a string".to_owned()))?;
            if let Some(role) = canonical_role(role)
                && !explicit.contains_key(role)
            {
                explicit.insert(role.to_owned(), field.clone());
                result.field_to_role.insert(field.clone(), role.to_owned());
            }
        }
        result.role_to_field.extend(explicit);
        for role in ROLES {
            if result.field(role) == *role && fields.contains_key(*role) {
                result
                    .field_to_role
                    .insert((*role).to_owned(), (*role).to_owned());
            }
        }
        result.display_name_key = display_name_key
            .filter(|s| !s.trim().is_empty())
            .map_or_else(|| result.field("title").to_owned(), str::to_owned);
        if let Some(definition) = fields
            .get(result.field("status"))
            .and_then(Value::as_object)
        {
            let explicit_values = definition
                .get("tn_completed_values")
                .and_then(Value::as_array)
                .map(|values| {
                    values
                        .iter()
                        .filter_map(Value::as_str)
                        .map(str::trim)
                        .filter(|s| !s.is_empty())
                        .map(str::to_owned)
                        .collect::<Vec<_>>()
                });
            if let Some(values) = explicit_values.filter(|values| !values.is_empty()) {
                result.completed_statuses = values;
            } else if definition.get("tn_role").and_then(Value::as_str) == Some("status") {
                let inferred = definition
                    .get("values")
                    .and_then(Value::as_array)
                    .map(|values| {
                        values
                            .iter()
                            .filter_map(Value::as_str)
                            .filter(|s| {
                                let lower = s.to_lowercase();
                                ["done", "complete", "cancel", "finish"]
                                    .iter()
                                    .any(|word| lower.contains(word))
                            })
                            .map(str::to_owned)
                            .collect::<Vec<_>>()
                    });
                if let Some(values) = inferred.filter(|values| !values.is_empty()) {
                    result.completed_statuses = values;
                }
            }
        }
        Ok(result)
    }

    /// Build the plugin's role-to-key representation.
    ///
    /// # Errors
    /// Rejects empty keys, unknown roles, and two roles using one physical key.
    pub fn from_plugin(mapping: &IndexMap<String, String>) -> Result<Self> {
        let mut result = Self::default();
        for (role, field) in mapping {
            let canonical = canonical_role(role).ok_or_else(|| {
                VaultError::Configuration("unsupported field mapping role".to_owned())
            })?;
            if field.trim().is_empty() {
                return Err(VaultError::Configuration(
                    "field mapping keys cannot be empty".to_owned(),
                ));
            }
            result
                .role_to_field
                .insert(canonical.to_owned(), field.clone());
        }
        let mut reverse = IndexMap::new();
        for (role, field) in &result.role_to_field {
            if reverse.insert(field.clone(), role.clone()).is_some() {
                return Err(VaultError::Configuration(
                    "two roles map to the same field".to_owned(),
                ));
            }
        }
        result.field_to_role = reverse;
        result.display_name_key = result.field("title").to_owned();
        Ok(result)
    }

    /// Look up a known role's physical field.
    #[must_use]
    pub fn field<'a>(&'a self, role: &'a str) -> &'a str {
        self.role_to_field.get(role).map_or(role, String::as_str)
    }

    /// Project physical properties to role names, preserving unknown keys.
    #[must_use]
    pub fn normalize(&self, frontmatter: &Map<String, Value>) -> Map<String, Value> {
        let mut result = Map::new();
        for (key, value) in frontmatter {
            let role = self
                .field_to_role
                .get(key)
                .map_or(key.as_str(), String::as_str);
            result.insert(role.to_owned(), value.clone());
        }
        result
    }

    /// Project role data to physical properties, preserving unknown keys.
    #[must_use]
    pub fn denormalize(&self, roles: &Map<String, Value>) -> Map<String, Value> {
        let mut result = Map::new();
        for (role, value) in roles {
            result.insert(self.field(role).to_owned(), value.clone());
        }
        result
    }

    /// Upstream display-title precedence: configured key, title, filename.
    #[must_use]
    pub fn display_title(
        &self,
        frontmatter: &Map<String, Value>,
        path: Option<&str>,
    ) -> Option<String> {
        [&self.display_name_key, "title"]
            .iter()
            .find_map(|key| {
                frontmatter
                    .get(*key)
                    .and_then(Value::as_str)
                    .filter(|s| !s.trim().is_empty())
            })
            .map(str::to_owned)
            .or_else(|| {
                path.filter(|s| !s.is_empty()).map(|p| {
                    let filename = p.rsplit('/').next().unwrap_or_default();
                    filename.strip_suffix(".md").unwrap_or(filename).to_owned()
                })
            })
    }
}
