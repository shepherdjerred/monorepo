//! Serde adapters that keep the JSON contract honest.
//!
//! Two distinctions the wire makes are easy to erase by accident, and both
//! matter:
//!
//! * **absent is not `null`.** Zod's `.optional()` accepts a missing key and
//!   *rejects* an explicit `null`. Plain `Option<T>` accepts both and folds
//!   them together, which would let a malformed payload through silently.
//!   [`present_only`] restores the distinction.
//! * **absent is not "clear".** On an update payload, a missing key means
//!   "leave this frontmatter key alone" and an explicit `null` means "delete
//!   it". [`FieldUpdate`] models the three states directly.

use core::{fmt, marker::PhantomData};

use serde::{
    Deserialize, Deserializer, Serialize, Serializer,
    de::{self, Visitor},
};

/// Deserialize an optional field that must be absent rather than `null`.
///
/// Pair with `#[serde(default, deserialize_with = "…", skip_serializing_if =
/// "Option::is_none")]`: a missing key yields `None` via `default`, a present
/// key is deserialized as `T` directly, and `null` therefore fails with a type
/// error the same way `z.string().optional()` does.
///
/// # Errors
///
/// Propagates the deserializer's error, including the type error a `null`
/// produces.
pub(crate) fn present_only<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    T::deserialize(deserializer).map(Some)
}

/// One field of a partial update: unchanged, cleared, or set.
///
/// The TypeScript `toWireTaskFields` drops `undefined` and passes `null`
/// through, because the two mean different things to the server: `undefined`
/// leaves the frontmatter key alone, `null` deletes it. `Option<T>` collapses
/// that to two states and `Option<Option<T>>` keeps three but names none of
/// them, so the update payloads use this instead — the state is spelled out at
/// every call site, and the sync layer's squash-on-enqueue can pattern-match it
/// exhaustively.
///
/// **FFI note.** This is generic, and UniFFI has no generics, so the FFI layer
/// cannot export it directly; it will need one concrete record per
/// instantiation. The instantiations in use are listed as type aliases beside
/// [`super::request::UpdateTaskRequest`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum FieldUpdate<T> {
    /// The key is absent from the payload: leave the stored value alone.
    Unchanged,
    /// The key is present and `null`: delete the stored value.
    Clear,
    /// The key is present with a value: store it.
    Set(T),
}

impl<T> Default for FieldUpdate<T> {
    /// [`FieldUpdate::Unchanged`], without requiring `T: Default` the way a
    /// derived implementation would.
    fn default() -> Self {
        Self::Unchanged
    }
}

impl<T> FieldUpdate<T> {
    /// Whether the field is absent from the payload.
    ///
    /// This is the `skip_serializing_if` predicate: an `Unchanged` field must
    /// not be emitted at all, and [`FieldUpdate::serialize`] fails loudly if it
    /// somehow is.
    #[must_use]
    pub const fn is_unchanged(&self) -> bool {
        matches!(*self, Self::Unchanged)
    }

    /// Whether the field explicitly clears the stored value.
    #[must_use]
    pub const fn is_clear(&self) -> bool {
        matches!(*self, Self::Clear)
    }

    /// The new value, if one was supplied.
    #[must_use]
    pub const fn value(&self) -> Option<&T> {
        match *self {
            Self::Set(ref value) => Some(value),
            Self::Unchanged | Self::Clear => None,
        }
    }

    /// Apply this update to a stored optional value.
    ///
    /// The whole point of the three-state model, in one place: `Unchanged`
    /// keeps what was there, `Clear` removes it, `Set` replaces it.
    #[must_use]
    pub fn apply(self, current: Option<T>) -> Option<T> {
        match self {
            Self::Unchanged => current,
            Self::Clear => None,
            Self::Set(value) => Some(value),
        }
    }
}

impl<T: Serialize> Serialize for FieldUpdate<T> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        match *self {
            // Reachable only if a container forgot `skip_serializing_if`.
            // Emitting `null` would turn "leave it alone" into "delete it",
            // so this fails instead of guessing.
            Self::Unchanged => Err(serde::ser::Error::custom(
                "an unchanged field must be skipped, not serialized: emitting it would clear the \
                 value it means to leave alone",
            )),
            Self::Clear => serializer.serialize_none(),
            Self::Set(ref value) => value.serialize(serializer),
        }
    }
}

impl<'de, T: Deserialize<'de>> Deserialize<'de> for FieldUpdate<T> {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        deserializer.deserialize_option(FieldUpdateVisitor::<T>(PhantomData))
    }
}

/// Distinguishes a present `null` from a present value.
///
/// A missing key never reaches this visitor — `#[serde(default)]` on the field
/// handles that case and yields [`FieldUpdate::Unchanged`].
struct FieldUpdateVisitor<T>(PhantomData<fn() -> T>);

impl<'de, T: Deserialize<'de>> Visitor<'de> for FieldUpdateVisitor<T> {
    type Value = FieldUpdate<T>;

    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("a value, or null to clear it")
    }

    fn visit_none<E: de::Error>(self) -> Result<Self::Value, E> {
        Ok(FieldUpdate::Clear)
    }

    fn visit_unit<E: de::Error>(self) -> Result<Self::Value, E> {
        Ok(FieldUpdate::Clear)
    }

    fn visit_some<D: Deserializer<'de>>(self, deserializer: D) -> Result<Self::Value, D::Error> {
        T::deserialize(deserializer).map(FieldUpdate::Set)
    }
}

#[cfg(test)]
mod tests {
    use super::{FieldUpdate, present_only};

    #[derive(Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
    struct Payload {
        #[serde(default, skip_serializing_if = "FieldUpdate::is_unchanged")]
        due: FieldUpdate<String>,
        #[serde(
            default,
            deserialize_with = "present_only",
            skip_serializing_if = "Option::is_none"
        )]
        title: Option<String>,
    }

    #[test]
    fn distinguishes_absent_from_null_from_set() {
        let absent: Payload = serde_json::from_str("{}").unwrap();
        assert_eq!(absent.due, FieldUpdate::Unchanged);

        let cleared: Payload = serde_json::from_str(r#"{"due": null}"#).unwrap();
        assert_eq!(cleared.due, FieldUpdate::Clear);

        let set: Payload = serde_json::from_str(r#"{"due": "2026-08-08"}"#).unwrap();
        assert_eq!(set.due, FieldUpdate::Set("2026-08-08".to_owned()));
    }

    #[test]
    fn serializes_unchanged_as_an_absent_key_and_clear_as_null() {
        let unchanged = Payload {
            due: FieldUpdate::Unchanged,
            title: None,
        };
        assert_eq!(serde_json::to_string(&unchanged).unwrap(), "{}");

        let cleared = Payload {
            due: FieldUpdate::Clear,
            title: None,
        };
        assert_eq!(serde_json::to_string(&cleared).unwrap(), r#"{"due":null}"#);
    }

    #[test]
    fn serializing_an_unchanged_field_outside_a_container_fails_loudly() {
        let error = serde_json::to_string(&FieldUpdate::<String>::Unchanged).unwrap_err();
        assert!(
            error.to_string().contains("must be skipped"),
            "unexpected error: {error}"
        );
    }

    #[test]
    fn applying_an_update_covers_the_three_states() {
        let current = || Some("old".to_owned());
        assert_eq!(FieldUpdate::Unchanged.apply(current()), current());
        assert_eq!(FieldUpdate::Clear.apply(current()), None);
        assert_eq!(
            FieldUpdate::Set("new".to_owned()).apply(current()),
            Some("new".to_owned())
        );
    }

    #[test]
    fn an_optional_field_rejects_an_explicit_null() {
        let absent: Payload = serde_json::from_str("{}").unwrap();
        assert_eq!(absent.title, None);

        let error = serde_json::from_str::<Payload>(r#"{"title": null}"#).unwrap_err();
        assert!(
            error.to_string().contains("invalid type: null"),
            "unexpected error: {error}"
        );
    }
}
