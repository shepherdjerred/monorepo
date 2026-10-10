//! Provider selection shared by the real configured document/command runtime.

use crate::{
    Result, VaultError,
    config::{StatusDefinition, TaskNotesConfiguration},
    configuration,
    mapping::FieldMapping,
};
use indexmap::IndexMap;
use serde_json::{Map, Value, json};

pub(crate) fn resolve(
    mut selected: TaskNotesConfiguration,
    standard: &TaskNotesConfiguration,
    plugin: Option<&[u8]>,
    portable: Option<&[u8]>,
) -> Result<TaskNotesConfiguration> {
    let mut providers = Vec::new();
    let mut origins = Map::new();
    if let Some(bytes) = portable {
        let raw: Map<String, Value> = serde_saphyr::from_str(
            std::str::from_utf8(bytes).map_err(|_| invalid("portable settings must be UTF-8"))?,
        )
        .map_err(|_| invalid("portable settings violate their schema"))?;
        for (key, value) in &raw {
            if [
                "validation",
                "templating",
                "dependencies",
                "links",
                "reminders",
                "status",
                "task_detection",
            ]
            .contains(&key.as_str())
            {
                configuration::validate_schema(key, value)
                    .map_err(|_| invalid("portable configuration section is invalid"))?;
                if key == "task_detection" {
                    crate::detection_policy::methods(value)?;
                }
            }
        }
        add_provider(
            &mut providers,
            &mut origins,
            Value::Object(raw),
            "tasknotes-yaml",
        );
    }
    if let Some(bytes) = plugin {
        let raw: Value = serde_json::from_slice(bytes)
            .map_err(|_| invalid("plugin settings violate their schema"))?;
        let mapped = configuration::map_plugin(&raw);
        let object = mapped
            .as_object()
            .ok_or_else(|| invalid("plugin mapping must be an object"))?;
        for (key, value) in object {
            crate::plugin_boundary::mapped_section(key, value)?;
        }
        add_provider(&mut providers, &mut origins, mapped, "plugin-data-json");
    }
    let base = production_baseline(standard)?;
    let mut effective = base.clone();
    for provider in &providers {
        if let Some(object) = provider.as_object() {
            effective.extend(object.clone());
        }
    }
    resolve_status_default(&mut effective, &providers)?;
    // Provider objects replace lower-precedence objects. Only schema defaults
    // fill nested keys; a discarded lower provider never supplies a nested key.
    for (key, defaults) in &base {
        if key == "mapping" {
            continue;
        }
        if let (Some(defaults), Some(chosen)) = (
            defaults.as_object(),
            effective.get_mut(key).and_then(Value::as_object_mut),
        ) {
            for (key, value) in defaults {
                chosen.entry(key.clone()).or_insert_with(|| value.clone());
            }
        }
    }
    selected.mapping = effective_mapping(&effective)?;
    workflow(
        &mut selected,
        &effective,
        origins.get("status").and_then(Value::as_str) == Some("plugin-data-json"),
    )?;
    apply_title(&mut selected, &effective)?;
    apply_detection(&mut selected, &effective)?;
    for (key, value) in &effective {
        if !["mapping", "status", "defaults", "title", "task_detection"].contains(&key.as_str()) {
            selected
                .extra
                .entry(key.clone())
                .or_insert_with(|| value.clone());
        }
    }
    selected.effective = Value::Object(effective);
    selected
        .extra
        .insert("sectionOrigins".into(), Value::Object(origins));
    Ok(selected)
}

fn add_provider(
    providers: &mut Vec<Value>,
    origins: &mut Map<String, Value>,
    provider: Value,
    origin: &str,
) {
    if let Some(raw) = provider.as_object() {
        for key in raw.keys() {
            origins.insert(key.clone(), json!(origin));
        }
    }
    providers.push(provider);
}

fn effective_mapping(effective: &Map<String, Value>) -> Result<FieldMapping> {
    let mapping = effective
        .get("mapping")
        .and_then(Value::as_object)
        .ok_or_else(|| invalid("effective mapping is required"))?;
    let mapping: IndexMap<String, String> = mapping
        .iter()
        .map(|(key, value)| {
            Ok((
                key.clone(),
                value
                    .as_str()
                    .ok_or_else(|| invalid("mapping keys must be strings"))?
                    .to_owned(),
            ))
        })
        .collect::<Result<_>>()?;
    FieldMapping::from_plugin(&mapping)
}

fn apply_title(
    selected: &mut TaskNotesConfiguration,
    effective: &Map<String, Value>,
) -> Result<()> {
    let title = effective
        .get("title")
        .ok_or_else(|| invalid("effective title policy is missing"))?;
    selected.store_title_in_filename = match title.get("storage").and_then(Value::as_str) {
        Some("filename") => true,
        Some("frontmatter") => false,
        _ => return Err(invalid("unsupported title storage")),
    };
    selected.extra.entry("portableTitle".to_owned()).or_insert(
        title
            .as_object()
            .map(|v| {
                Value::Object(
                    v.iter()
                        .filter(|(key, _)| key.as_str() != "storage")
                        .map(|(k, v)| (k.clone(), v.clone()))
                        .collect(),
                )
            })
            .ok_or_else(|| invalid("title policy must be an object"))?,
    );
    Ok(())
}

fn apply_detection(
    selected: &mut TaskNotesConfiguration,
    effective: &Map<String, Value>,
) -> Result<()> {
    let detection = effective
        .get("task_detection")
        .ok_or_else(|| invalid("task detection is missing"))?;
    selected.identification.method = crate::detection_policy::methods(detection)?
        .into_iter()
        .next()
        .ok_or_else(|| invalid("detection method missing"))?;
    text(detection, "tag")?.clone_into(&mut selected.identification.tag);
    text(detection, "property_name")?.clone_into(&mut selected.identification.property_name);
    text(detection, "property_value")?.clone_into(&mut selected.identification.property_value);
    selected.identification.excluded_folders =
        detection
            .get("excluded_folders")
            .map_or(Ok(String::new()), |v| {
                if let Some(array) = v.as_array() {
                    array
                        .iter()
                        .map(|v| {
                            v.as_str()
                                .ok_or_else(|| invalid("excluded folders must be strings"))
                        })
                        .collect::<Result<Vec<_>>>()
                        .map(|v| v.join(","))
                } else {
                    v.as_str()
                        .map(str::to_owned)
                        .ok_or_else(|| invalid("excluded folders must be strings"))
                }
            })?;
    Ok(())
}

fn resolve_status_default(effective: &mut Map<String, Value>, providers: &[Value]) -> Result<()> {
    let supplied = providers
        .iter()
        .rev()
        .find_map(|provider| provider.get("defaults"));
    let default = supplied
        .and_then(|value| value.get("status"))
        .or_else(|| {
            effective
                .get("status")
                .and_then(|value| value.get("default"))
        })
        .cloned();
    if let Some(default) = default {
        effective
            .get_mut("defaults")
            .and_then(Value::as_object_mut)
            .ok_or_else(|| invalid("defaults must be an object"))?
            .insert("status".to_owned(), default);
    }
    Ok(())
}

fn workflow(
    selected: &mut TaskNotesConfiguration,
    effective: &Map<String, Value>,
    preserve_order: bool,
) -> Result<()> {
    let status = effective
        .get("status")
        .ok_or_else(|| invalid("status policy is missing"))?;
    let values = status
        .get("values")
        .and_then(Value::as_array)
        .ok_or_else(|| invalid("status values must be a list"))?;
    let completed = status
        .get("completed_values")
        .and_then(Value::as_array)
        .ok_or_else(|| invalid("completed status values must be a list"))?;
    let original = std::mem::take(&mut selected.statuses);
    selected.statuses = values
        .iter()
        .enumerate()
        .map(|(order, value)| {
            let value = value
                .as_str()
                .ok_or_else(|| invalid("status values must be strings"))?;
            let mut status = original
                .iter()
                .find(|s| s.value == value)
                .cloned()
                .unwrap_or(StatusDefinition {
                    id: value.to_owned(),
                    value: value.to_owned(),
                    label: value.to_owned(),
                    color: "#808080".to_owned(),
                    is_completed: false,
                    order: 0.0,
                    exclude_from_cycle: false,
                    next_status: None,
                    extra: IndexMap::new(),
                });
            if !preserve_order {
                status.order = f64::from(
                    u32::try_from(order).map_err(|_| invalid("too many workflow statuses"))?,
                );
            }
            status.is_completed = completed.iter().any(|v| v.as_str() == Some(value));
            Ok(status)
        })
        .collect::<Result<_>>()?;
    if preserve_order {
        selected.statuses.sort_by(|left, right| {
            // JS numeric sort treats both signs of zero as a stable tie.
            if left.order.abs().to_bits() == 0 && right.order.abs().to_bits() == 0 {
                std::cmp::Ordering::Equal
            } else {
                left.order.total_cmp(&right.order)
            }
        });
    }
    let default = effective
        .get("defaults")
        .and_then(|v| v.get("status"))
        .and_then(Value::as_str)
        .or_else(|| status.get("default").and_then(Value::as_str));
    selected.default_status = default
        .filter(|value| selected.statuses.iter().any(|s| s.value == *value))
        .map(str::to_owned);
    selected.default_priority = effective
        .get("defaults")
        .and_then(|v| v.get("priority"))
        .and_then(Value::as_str)
        .filter(|value| selected.priorities.iter().any(|p| p.value == *value))
        .map(str::to_owned);
    Ok(())
}

// The development model oracle deliberately remains byte-for-byte pinned.
// Production defaults follow TaskNotes 4.13.8 src/settings/defaults.ts and
// tasknotes-spec 0.3.0-rc.9 section 9 for supported fields, including filename titles.
fn production_baseline(config: &TaskNotesConfiguration) -> Result<Map<String, Value>> {
    let id = &config.identification;
    json!({"spec_version":"0.3.0-rc.9","mapping":config.mapping.role_to_field,
        "status":{"values":config.statuses.iter().map(|s|s.value.as_str()).collect::<Vec<_>>(),"completed_values":config.statuses.iter().filter(|s|s.is_completed).map(|s|s.value.as_str()).collect::<Vec<_>>(),"default":config.default_status},
        "defaults":{"status":config.default_status,"priority":config.default_priority},
        "validation":{"mode":"strict","reject_unknown_fields":false},
        "task_detection":{"method":id.method,"tag":id.tag,"property_name":"","property_value":"","excluded_folders":"","default_folder":"TaskNotes/Tasks"},
        "title":{"storage":"filename","filename_format":"title","custom_filename_template":"{title}"},
        "templating":{"enabled":false,"template_path":"","failure_mode":"warning_fallback","unknown_variable_policy":"preserve"},
        "archive":{"move_on_archive":false,"folder":"TaskNotes/Archive","mode":"field"},
        "links":{"use_markdown_format":false,"extensions":[".md"]},
        "dependencies":{"treat_missing_target_as_blocked":true,"require_resolved_uid_on_write":false},
        "occurrences":{"default_materialization":"manual","default_next_trigger":"completion","past_horizon":"P0D","future_horizon":"P14D"}
    }).as_object().cloned().ok_or_else(||invalid("built-in configuration violates its contract"))
}
fn text<'a>(value: &'a Value, key: &str) -> Result<&'a str> {
    value
        .get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| invalid("configuration key must be a string"))
}
fn invalid(value: &str) -> VaultError {
    VaultError::Configuration(value.to_owned())
}
