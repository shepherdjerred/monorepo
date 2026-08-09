//! Custom-type conversions for the values UniFFI has no native shape for.
//!
//! Two kinds of type land here.
//!
//! **The validated string newtypes.** `TaskId`, `ProjectName`, `ContextName`,
//! `TagName`, and `TaskTitle` are parse-don't-validate wrappers whose whole
//! point is that an existing value already satisfies its invariant. They cross
//! the FFI as `String`, and the `try_lift` side re-runs the core's parser — so
//! a host that hands the core `"Tasks/a.txt"` or an empty title gets a typed
//! failure at the boundary, not a corrupt value inland. Swift sees a
//! `typealias`, which is the honest shape: the invariant lives in Rust.
//!
//! **`ExtraFields`.** UniFFI has no `Any` type, so preserved frontmatter keys
//! cross as a JSON object string, exactly as the plan specifies.
//!
//! ⚠️ Every conversion here is declared `remote`: the types belong to
//! `tasknotes-core`, so the blanket `impl<UT> FfiConverter<UT>` a local
//! `custom_type!` would emit is barred by the orphan rule. `remote` narrows it
//! to this crate's `UniFfiTag`, which is the local type that makes it legal.

use serde_json::{Map, Value};
use tasknotes_core::domain::{ContextName, ExtraFields, ProjectName, TagName, TaskId, TaskTitle};

/// Render preserved frontmatter keys as a compact JSON object string.
///
/// Deliberately **total**, where [`ExtraFields::to_json`] is fallible.
/// `lower` has no way to report a failure — its signature returns the FFI type
/// directly — so a fallible call here would need either a panic (banned behind
/// an FFI: `catch_unwind` turns it into an untyped internal error) or a silent
/// fallback (banned outright). Building a [`Value`] and rendering it through
/// `Display` has neither problem: `serde_json`'s `Display` cannot fail, and
/// with the workspace's `preserve_order` feature a [`Map`] is an `IndexMap`, so
/// the vault's key order survives.
///
/// A test pins this byte-for-byte against [`ExtraFields::to_json`], so the two
/// renderings cannot drift.
fn render_extra_fields(fields: &ExtraFields) -> String {
    let object: Map<String, Value> = fields
        .as_map()
        .iter()
        .map(|(key, value)| (key.clone(), value.clone()))
        .collect();
    Value::Object(object).to_string()
}

uniffi::custom_type!(ExtraFields, String, {
    remote,
    lower: |value| render_extra_fields(&value),
    try_lift: |value| Ok(ExtraFields::from_json(&value)?),
});

uniffi::custom_type!(TaskId, String, {
    remote,
    lower: |value| value.into_string(),
    try_lift: |value| Ok(TaskId::parse(value)?),
});

uniffi::custom_type!(ProjectName, String, {
    remote,
    lower: |value| value.into_string(),
    try_lift: |value| Ok(ProjectName::parse(value)?),
});

uniffi::custom_type!(ContextName, String, {
    remote,
    lower: |value| value.into_string(),
    try_lift: |value| Ok(ContextName::parse(value)?),
});

uniffi::custom_type!(TagName, String, {
    remote,
    lower: |value| value.into_string(),
    try_lift: |value| Ok(TagName::parse(value)?),
});

uniffi::custom_type!(TaskTitle, String, {
    remote,
    lower: |value| value.into_string(),
    try_lift: |value| Ok(TaskTitle::parse(value)?),
});

#[cfg(test)]
mod tests {
    use tasknotes_core::domain::ExtraFields;
    use uniffi::{Lift, Lower};

    use super::render_extra_fields;
    use crate::UniFfiTag;

    /// Round-trip a value through the FFI buffer the way a real call does.
    fn round_trip<T: Lower<UniFfiTag> + Lift<UniFfiTag>>(value: T) -> T {
        let mut buffer = Vec::new();
        <T as Lower<UniFfiTag>>::write(value, &mut buffer);
        let mut cursor = buffer.as_slice();
        <T as Lift<UniFfiTag>>::try_read(&mut cursor).unwrap()
    }

    #[test]
    fn the_total_renderer_agrees_with_the_core_serializer() {
        for json in [
            "{}",
            r#"{"zebra":1,"apple":2,"middle":3}"#,
            r#"{"nested":{"b":[1,2,{"c":null}],"a":"x"},"unicode":"é\n"}"#,
        ] {
            let fields = ExtraFields::from_json(json).unwrap();
            assert_eq!(render_extra_fields(&fields), fields.to_json().unwrap());
            assert_eq!(render_extra_fields(&fields), json);
        }
    }

    #[test]
    fn preserved_fields_survive_the_ffi_buffer_in_vault_order() {
        let fields = ExtraFields::from_json(r#"{"zebra":1,"apple":2}"#).unwrap();
        let lifted = round_trip(fields.clone());
        assert_eq!(lifted, fields);
        assert_eq!(lifted.to_json().unwrap(), r#"{"zebra":1,"apple":2}"#);
    }

    #[test]
    fn lifting_rejects_a_value_the_core_parser_would_reject() {
        let mut buffer = Vec::new();
        <String as Lower<UniFfiTag>>::write("Tasks/a.txt".to_owned(), &mut buffer);
        let mut cursor = buffer.as_slice();
        let error =
            <tasknotes_core::domain::TaskId as Lift<UniFfiTag>>::try_read(&mut cursor).unwrap_err();
        assert!(
            error.to_string().contains("Lifting custom type"),
            "unexpected error: {error}"
        );
    }
}
