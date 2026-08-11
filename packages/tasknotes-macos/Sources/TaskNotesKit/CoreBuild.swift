// `internal`, not `public`: the core's version crosses this boundary as a
// `String`, so nothing in this file's public API mentions a type from the
// bindings. `InternalImportsByDefault` makes that distinction load-bearing —
// a `public import` here is a hard error, which is the point: it keeps
// generated types from leaking into `TaskNotesKit`'s public surface by
// accident.
internal import TaskNotesUniFFI

/// Facts about the linked Rust core.
///
/// The only reason this exists in Phase 7 is to prove the link: an app that
/// compiles against the bindings but was never actually linked to the static
/// archive fails at launch, not at build time. Reading a value out of Rust from
/// both the test target and the About panel turns that into a caught failure.
///
/// It is an enum with no cases rather than a `struct` so it cannot be
/// instantiated, and `nonisolated` because nothing here touches shared state.
public enum CoreBuild {
    /// The `CARGO_PKG_VERSION` of the linked `tasknotes-core-ffi` crate.
    ///
    /// Crosses the FFI on every call. It is cheap, and caching it would be a
    /// place for a stale value to hide after a rebuild.
    public static var version: String { coreVersion() }
}
