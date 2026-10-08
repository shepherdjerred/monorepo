//! Pure configuration provider precedence, validation, and task detection.

use crate::{Result, VaultError, relationships};
use regex::Regex;
use serde_json::{Map, Value, json};

/// Evaluate a configuration operation using an explicit host working directory.
///
/// # Errors
/// Rejects missing host context, invalid provider modes, and invalid known keys.
pub fn execute(operation: &str, input: &Value, base: &str) -> Result<Value> {
    match operation {
        "config.resolve_collection_path" => {
            let chosen = ["flagPath", "envPath", "persistedPath", "cwd"]
                .iter()
                .find_map(|key| {
                    input
                        .get(key)
                        .filter(|v| !v.is_null())
                        .map(stringify)
                        .filter(|v| !v.trim().is_empty())
                })
                .unwrap_or_else(|| base.to_owned());
            Ok(json!({"value":absolute(chosen.trim(),base)?}))
        }
        "config.spec_version_effective" => {
            let provider = text(input, "providerSpecVersion").trim();
            let target = text(input, "targetSpecVersion").trim();
            Ok(
                json!({"value":if provider.is_empty(){if target.is_empty(){"0.3.0-rc.3"}else{target}}else{provider},"synthesized":provider.is_empty()}),
            )
        }
        "config.merge_top_level" => {
            let mut result = Map::new();
            for provider in array(input, "providers") {
                if let Some(object) = provider.as_object() {
                    result.extend(object.clone());
                }
            }
            Ok(json!({"value":result}))
        }
        "config.provider_behavior" => {
            let mode = input
                .get("mode")
                .and_then(Value::as_str)
                .unwrap_or("strict");
            if !["strict", "permissive"].contains(&mode) {
                return Err(invalid("configuration mode unsupported"));
            }
            if mode == "strict"
                && (!boolean(input, "providersReadable") || !boolean(input, "hasRequiredKeys"))
            {
                return Err(invalid(
                    "strict configuration requires providers readable and required effective keys",
                ));
            }
            Ok(json!({"value":"accepted"}))
        }
        "config.validate_schema" => {
            validate_schema(
                text(input, "kind"),
                input.get("value").unwrap_or(&Value::Null),
            )?;
            Ok(json!({"value":"valid"}))
        }
        "config.map_tasknotes_plugin" => {
            Ok(json!({"value":map_plugin(input.get("data").unwrap_or(&Value::Null))}))
        }
        "config.detect_task_file" => Ok(json!({"value":detect(input)?})),
        _ => Err(invalid("unsupported_operation")),
    }
}

/// Resolve a lexical path without accessing a filesystem or environment.
///
/// # Errors
/// Requires an absolute host base and rejects NUL characters.
pub fn absolute(path: &str, base: &str) -> Result<String> {
    if !base.starts_with('/') || path.contains('\0') || base.contains('\0') {
        return Err(invalid("invalid_collection_path"));
    }
    let joined = if path.starts_with('/') {
        path.to_owned()
    } else {
        format!("{base}/{path}")
    };
    let mut parts = Vec::new();
    for part in joined.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                parts.pop();
            }
            _ => parts.push(part),
        }
    }
    Ok(format!("/{}", parts.join("/")))
}

/// Validate the supported semantic sections while preserving extension fields.
///
/// # Errors
/// Returns the offending section/key for invalid known values.
pub fn validate_schema(kind: &str, value: &Value) -> Result<()> {
    if !value.is_object() {
        return Err(invalid("configuration section must be an object"));
    }
    let enums: &[(&str, &[&str])] = match kind {
        "validation" => &[("mode", &["strict", "permissive"])],
        "title" => &[
            ("storage", &["filename", "frontmatter"]),
            ("filename_format", &["slug", "custom"]),
        ],
        "templating" => &[
            ("failure_mode", &["warning_fallback", "error_abort"]),
            ("unknown_variable_policy", &["preserve", "error", "empty"]),
        ],
        "task_detection" => &[("combine", &["and", "or"])],
        "dependencies" => &[
            ("default_reltype", &relationships::RELATIONSHIP_TYPES),
            ("unresolved_target_severity", &["warning", "error"]),
        ],
        "links" => &[("unresolved_default_severity", &["warning", "error"])],
        "reminders" | "time_tracking" | "status" => &[],
        _ => return Err(invalid(&format!("config kind unsupported:{kind}"))),
    };
    for (key, allowed) in enums {
        if let Some(v) = value.get(key)
            && !v.as_str().is_some_and(|s| allowed.contains(&s))
        {
            return Err(invalid(&format!("{kind}.{key} invalid unsupported")));
        }
    }
    let bools: &[&str] = match kind {
        "validation" => &["reject_unknown_fields"],
        "templating" => &["enabled"],
        "reminders" => &["apply_defaults_when_explicit"],
        "time_tracking" => &["auto_stop_on_complete", "auto_stop_notification"],
        _ => &[],
    };
    for key in bools {
        if value.get(key).is_some_and(|v| !v.is_boolean()) {
            return Err(invalid(&format!("{kind}.{key} invalid")));
        }
    }
    if kind == "title"
        && text(value, "filename_format") == "custom"
        && text(value, "custom_filename_template").trim().is_empty()
    {
        return Err(invalid("title.custom_filename_template missing"));
    }
    if kind == "templating"
        && boolean(value, "enabled")
        && text(value, "template_path").trim().is_empty()
    {
        return Err(invalid("templating.template_path missing"));
    }
    if kind == "reminders"
        && value
            .get("date_only_anchor_time")
            .is_some_and(|v| !v.as_str().is_some_and(valid_anchor_time))
    {
        return Err(invalid("reminders.date_only_anchor_time invalid"));
    }
    if kind == "links"
        && value
            .get("extensions")
            .is_some_and(|v| !v.as_array().is_some_and(|a| a.iter().all(Value::is_string)))
    {
        return Err(invalid("links.extensions invalid"));
    }
    if kind == "status" {
        if value.get("values").is_some_and(|v| !v.is_array()) {
            return Err(invalid("status.values invalid"));
        }
        if value.get("default").is_some_and(|v| !v.is_string()) {
            return Err(invalid("status.default invalid"));
        }
        let values = array(value, "values");
        if values.iter().any(|v| !v.is_string()) {
            return Err(invalid("status.values invalid"));
        }
        if value.get("default").is_some_and(Value::is_string)
            && !values.is_empty()
            && !values.contains(&value["default"])
        {
            return Err(invalid("status.default must be one of status.values"));
        }
        if let Some(completed) = value.get("completed_values") {
            let completed = completed
                .as_array()
                .filter(|a| !a.is_empty())
                .ok_or_else(|| invalid("status.completed_values non-empty"))?;
            if completed.iter().any(|v| !v.is_string()) {
                return Err(invalid("status.completed_values invalid"));
            }
            if !values.is_empty() && completed.iter().any(|v| !values.contains(v)) {
                return Err(invalid("status.completed_values must be in status.values"));
            }
        }
    }
    Ok(())
}

/// Derive spec configuration from recognized TaskNotes plugin settings.
#[must_use]
pub fn map_plugin(source: &Value) -> Value {
    let mut out = Map::new();
    if let Some(fields) = source.get("fieldMapping").and_then(Value::as_object) {
        let mapping = fields
            .iter()
            .filter(|(_, v)| v.as_str().is_some_and(|s| !s.trim().is_empty()))
            .map(|(key, v)| (snake(key), v.clone()))
            .collect::<Map<_, _>>();
        if !mapping.is_empty() {
            out.insert("mapping".into(), Value::Object(mapping));
        }
    }
    for (section, pairs) in [
        (
            "title",
            vec![
                ("taskFilenameFormat", "filename_format"),
                ("customFilenameTemplate", "custom_filename_template"),
            ],
        ),
        (
            "defaults",
            vec![
                ("defaultTaskStatus", "status"),
                ("defaultTaskPriority", "priority"),
            ],
        ),
        (
            "time_tracking",
            vec![
                ("autoStopTimeTrackingOnComplete", "auto_stop_on_complete"),
                ("autoStopTimeTrackingNotification", "auto_stop_notification"),
            ],
        ),
        (
            "archive",
            vec![
                ("moveArchivedTasks", "move_on_archive"),
                ("archiveFolder", "folder"),
            ],
        ),
        (
            "links",
            vec![("useFrontmatterMarkdownLinks", "use_markdown_format")],
        ),
    ] {
        let mut object = Map::new();
        for (from, to) in pairs {
            if let Some(v) = source.get(from).filter(|v| v.is_boolean() || v.is_string()) {
                object.insert(to.into(), v.clone());
            }
        }
        if !object.is_empty() {
            out.insert(section.into(), Value::Object(object));
        }
    }
    if let Some(filename) = source.get("storeTitleInFilename").and_then(Value::as_bool) {
        out.entry("title").or_insert_with(|| json!({}))["storage"] =
            json!(if filename { "filename" } else { "frontmatter" });
    }
    if let Some(defaults) = source.get("taskCreationDefaults").filter(|v| v.is_object()) {
        let mut templating = Map::new();
        for (from, to) in [
            ("useBodyTemplate", "enabled"),
            ("bodyTemplate", "template_path"),
        ] {
            if let Some(v) = defaults
                .get(from)
                .filter(|v| v.is_boolean() || v.is_string())
            {
                templating.insert(to.into(), v.clone());
            }
        }
        out.insert("templating".into(), Value::Object(templating));
    }
    map_status(source, &mut out);
    map_detection(source, &mut out);
    Value::Object(out)
}

fn map_status(source: &Value, out: &mut Map<String, Value>) {
    if source.get("customStatuses").is_some_and(Value::is_array)
        || source
            .get("defaultTaskStatus")
            .is_some_and(Value::is_string)
    {
        let mut status = Map::new();
        let entries = array(source, "customStatuses");
        for (key, completed) in [("values", false), ("completed_values", true)] {
            let vals = entries
                .iter()
                .filter(|v| !completed || boolean(v, "isCompleted"))
                .filter_map(|v| v.get("value").filter(|v| v.is_string()).cloned())
                .collect::<Vec<_>>();
            if !vals.is_empty() {
                status.insert(key.into(), json!(vals));
            }
        }
        if let Some(v) = source.get("defaultTaskStatus").filter(|v| v.is_string()) {
            status.insert("default".into(), v.clone());
        }
        out.insert("status".into(), json!(status));
    }
}

fn map_detection(source: &Value, out: &mut Map<String, Value>) {
    let mut detection = Map::new();
    if source
        .get("taskIdentificationMethod")
        .is_some_and(Value::is_string)
    {
        detection.insert("method".into(), source["taskIdentificationMethod"].clone());
        for (from, to) in [("taskTag", "tag"), ("taskPropertyValue", "property_value")] {
            if let Some(v) = source.get(from).filter(|v| v.is_string())
                && (to == "property_value" || !v.as_str().unwrap_or_default().trim().is_empty())
            {
                detection.insert(to.into(), v.clone());
            }
        }
        let name = source
            .get("taskPropertyName")
            .or_else(|| source.get("taskProperty"));
        if let Some(v) = name.filter(|v| v.as_str().is_some_and(|s| !s.trim().is_empty())) {
            detection.insert("property_name".into(), v.clone());
        }
    }
    for (from, to) in [
        ("tasksFolder", "default_folder"),
        ("excludedFolders", "excluded_folders"),
    ] {
        if let Some(v) = source
            .get(from)
            .filter(|v| v.as_str().is_some_and(|s| !s.trim().is_empty()))
        {
            detection.insert(to.into(), v.clone());
        }
    }
    if !detection.is_empty() {
        out.insert("task_detection".into(), json!(detection));
    }
}

/// Detect tasks from configured tags/properties, respecting path exclusions.
///
/// # Errors
/// Rejects an invalid internal pattern rather than ignoring it.
pub fn detect(input: &Value) -> Result<bool> {
    let detection = input.get("taskDetection").unwrap_or(&Value::Null);
    if path_excluded(input, detection) {
        return Ok(false);
    }
    evaluate_detection(input, detection)
}

fn path_excluded(input: &Value, detection: &Value) -> bool {
    let path = text(input, "filePath")
        .replace('\\', "/")
        .trim_start_matches('/')
        .to_owned();
    let excluded = detection.get("excluded_folders").map_or(Vec::new(), |v| {
        if let Some(a) = v.as_array() {
            a.iter()
                .filter_map(Value::as_str)
                .map(str::to_owned)
                .collect()
        } else {
            v.as_str()
                .unwrap_or_default()
                .split(',')
                .map(str::to_owned)
                .collect()
        }
    });
    excluded
        .iter()
        .map(|p| p.replace('\\', "/").trim_matches('/').trim().to_owned())
        .filter(|p| !p.is_empty())
        .any(|p| path == p || path.starts_with(&format!("{p}/")))
}

fn evaluate_detection(input: &Value, detection: &Value) -> Result<bool> {
    let methods = detection
        .get("methods")
        .and_then(Value::as_array)
        .map_or_else(
            || {
                detection
                    .get("method")
                    .and_then(Value::as_str)
                    .map(|s| vec![s.to_owned()])
                    .unwrap_or_default()
            },
            |a| {
                a.iter()
                    .filter_map(Value::as_str)
                    .map(str::to_owned)
                    .collect::<Vec<_>>()
            },
        );
    let mut methods = methods
        .into_iter()
        .map(|s| s.trim().to_lowercase())
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>();
    if methods.is_empty() && detection.get("tag").is_some_and(Value::is_string) {
        methods.push("tag".into());
    }
    let fm = input.get("frontmatter").unwrap_or(&Value::Null);
    let mut evaluations = Vec::new();
    let fence =
        Regex::new(r"(?s)```.*?```|`[^`]*`").map_err(|_| invalid("internal_detection_pattern"))?;
    let pattern = Regex::new(r"(?:^|[^\w])#([A-Za-z0-9][A-Za-z0-9/_-]*)")
        .map_err(|_| invalid("internal_detection_pattern"))?;
    for method in methods {
        match method.as_str() {
            "tag" => {
                let tag = detection
                    .get("tag")
                    .and_then(Value::as_str)
                    .unwrap_or("task")
                    .trim()
                    .trim_start_matches('#')
                    .to_lowercase();
                let field = input
                    .get("tagField")
                    .and_then(Value::as_str)
                    .unwrap_or("tags");
                let tags = fm.get(field).map_or(Vec::new(), |v| {
                    if let Some(a) = v.as_array() {
                        a.iter().filter_map(Value::as_str).collect()
                    } else {
                        v.as_str().into_iter().collect()
                    }
                });
                let frontmatter = tags
                    .iter()
                    .any(|s| s.trim().trim_start_matches('#').to_lowercase() == tag);
                let body = fence.replace_all(text(input, "body"), " ");
                let body = pattern
                    .captures_iter(&body)
                    .any(|c| c[1].to_lowercase() == tag);
                evaluations.push(!tag.is_empty() && (frontmatter || body));
            }
            "property" => {
                let name = text(detection, "property_name").trim();
                let expected = text(detection, "property_value");
                evaluations.push(
                    !name.is_empty()
                        && fm
                            .get(name)
                            .is_some_and(|v| expected.is_empty() || stringify(v) == expected),
                );
            }
            _ => {}
        }
    }
    Ok(!evaluations.is_empty()
        && if text(detection, "combine") == "and" {
            evaluations.iter().all(|v| *v)
        } else {
            evaluations.iter().any(|v| *v)
        })
}

fn snake(value: &str) -> String {
    let mut out = String::new();
    let mut previous = false;
    for c in value.chars() {
        if c.is_uppercase() && previous {
            out.push('_');
        }
        out.extend(c.to_lowercase());
        previous = c.is_lowercase() || c.is_ascii_digit();
    }
    out.replace('-', "_")
}

fn valid_anchor_time(value: &str) -> bool {
    let bytes = value.as_bytes();
    let [h1, h2, b':', m1, m2] = bytes else {
        return false;
    };
    [h1, h2, m1, m2].iter().all(|c| c.is_ascii_digit())
        && (*h1 - b'0') * 10 + (*h2 - b'0') < 24
        && (*m1 - b'0') * 10 + (*m2 - b'0') < 60
}
fn stringify(value: &Value) -> String {
    value
        .as_str()
        .map_or_else(|| value.to_string(), str::to_owned)
}
fn text<'a>(value: &'a Value, key: &str) -> &'a str {
    value.get(key).and_then(Value::as_str).unwrap_or_default()
}
fn array<'a>(value: &'a Value, key: &str) -> &'a [Value] {
    value
        .get(key)
        .and_then(Value::as_array)
        .map_or(&[], Vec::as_slice)
}
fn boolean(value: &Value, key: &str) -> bool {
    value.get(key).and_then(Value::as_bool) == Some(true)
}
fn invalid(message: &str) -> VaultError {
    VaultError::Configuration(message.to_owned())
}
