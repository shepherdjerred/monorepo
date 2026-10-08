//! Conservative shipped-support declarations, shared by hosts and corpus adapters.

use super::{Engine, Result, Value, params};
use serde_json::json;

struct Registration {
    name: &'static str,
    missing: &'static [&'static str],
}

// Empty requirements are permitted only after the public runtime operations and
// their durable behavior are implemented. Pure corpus coverage alone is insufficient.
const CAPABILITIES: &[Registration] = &[
    Registration {
        name: "batch",
        missing: &[],
    },
    Registration {
        name: "concurrency",
        missing: &[],
    },
    Registration {
        name: "time-tracking",
        missing: &[],
    },
    Registration {
        name: "dependencies",
        missing: &["scoped_dependency_operations"],
    },
    Registration {
        name: "reminders",
        missing: &["reminder_operations_and_delivery_projection"],
    },
    Registration {
        name: "links",
        missing: &["scoped_attachment_operations"],
    },
    Registration {
        name: "rename",
        missing: &["moved_document_relative_references"],
    },
    Registration {
        name: "archive",
        missing: &["archive_path_restoration_policy"],
    },
    Registration {
        name: "dry-run",
        missing: &["general_mutation_preview"],
    },
    Registration {
        name: "migration",
        missing: &["published_migration_policy_and_version_boundary"],
    },
    Registration {
        name: "templating",
        missing: &["all_portable_variables_and_yaml_quoting"],
    },
    Registration {
        name: "materialized-occurrences",
        missing: &["materialized_occurrence_operations"],
    },
];

const PROFILES: &[Registration] = &[
    Registration {
        name: "core-lite",
        missing: &["canonical_temporal_writes"],
    },
    Registration {
        name: "recurrence",
        missing: &[
            "canonical_temporal_writes",
            "skip_unskip_instance_operations",
            "strict_instance_list_invariants",
        ],
    },
    Registration {
        name: "extended",
        missing: &[
            "recurrence_profile",
            "scoped_dependency_operations",
            "reminder_operations_and_delivery_projection",
            "scoped_attachment_operations",
        ],
    },
    Registration {
        name: "templating",
        missing: &[
            "core_lite_profile",
            "all_portable_variables_and_yaml_quoting",
        ],
    },
    Registration {
        name: "materialized-occurrences",
        missing: &[
            "recurrence_profile",
            "materialized_occurrence_operations_and_identity_validation",
        ],
    },
];

fn ready(registrations: &[Registration]) -> Vec<&str> {
    registrations
        .iter()
        .filter(|entry| entry.missing.is_empty())
        .map(|entry| entry.name)
        .collect()
}

fn readiness(registrations: &[Registration]) -> Vec<Value> {
    registrations.iter().map(|entry| json!({"name":entry.name,"implemented":entry.missing.is_empty(),"missing":entry.missing})).collect()
}

impl Engine {
    pub(super) fn conformance(&self, id: &str) -> Result<Value> {
        self.database(|db| {
            let configuration: Option<String> = db.query_row("SELECT configuration FROM profiles WHERE id=?", [id], |row| row.get(0))?;
            let configuration: Option<Value> = configuration.as_deref().map(serde_json::from_str).transpose()?;
            let mut available = Vec::new();
            for (path, provider) in [(super::PLUGIN_CONFIGURATION_PATH,"plugin-data-json"),(super::PORTABLE_CONFIGURATION_PATH,"tasknotes-yaml")] {
                let present: bool = db.query_row("SELECT EXISTS(SELECT 1 FROM files WHERE profile=? AND path=? AND revision IS NOT NULL)",params![id,path],|row|row.get(0))?;
                if present { available.push(provider); }
            }
            let profile: String = db.query_row("SELECT json FROM profiles WHERE id=?", [id], |row|row.get(0))?;
            let profile: super::Profile = serde_json::from_str(&profile)?;
            if profile.approve_standard { available.push("standard"); }
            Ok(json!({
                "schemaVersion":1,
                "implementation":"Facet-Rust",
                "version":env!("CARGO_PKG_VERSION"),
                "spec_version":"0.3.0-rc.9",
                "validation_modes":["strict"],
                "profiles":ready(PROFILES),
                "capabilities":ready(CAPABILITIES),
                "profileReadiness":readiness(PROFILES),
                "capabilityReadiness":readiness(CAPABILITIES),
                "known_deviations":["Profiles with outstanding runtime requirements are not claimed"],
                "compatibility_mode":"disabled; normalization is explicit",
                "configurationProviders":{"available":available,"selected":configuration.as_ref().and_then(|value|value.get("source")),"precedence":"plugin-data-json > tasknotes-yaml > standard; top-level section replacement","fallback":"none","state":if configuration.is_some(){"cached"}else{"waiting"}}
            }))
        })
    }
}
