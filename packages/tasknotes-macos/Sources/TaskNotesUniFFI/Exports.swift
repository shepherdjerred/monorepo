// The seam onto the machine-generated UniFFI bindings.
//
// Everything the Rust core exports reaches the app through this module and
// nowhere else. Two reasons that indirection earns its keep:
//
//  1. The generated module is named after the Rust namespace
//     (`TaskNotesCore`). Re-exporting it under a stable name means a rename
//     upstream is a one-line change here rather than a change at every call
//     site.
//  2. It is the single place allowed to be lint-exempt. `.swiftlint.yml`
//     excludes this directory because the module it re-exports is generated;
//     keeping authored code here to a re-export and a few aliases is what makes
//     that exemption honest.
//
// Keep this file trivial. Adapters, wrappers, and anything with behavior belong
// in `TaskNotesKit`, where the full lint posture applies.

@_exported import TaskNotesCore

/// The core's task record.
///
/// UniFFI names this `Task`, which collides with `_Concurrency.Task` at every
/// call site that also uses structured concurrency — and the collision resolves
/// silently in favour of whichever is in scope, which is exactly the class of
/// ambiguity the repository's principles exist to prevent. Authored code spells
/// it `CoreTask`.
public typealias CoreTask = TaskNotesCore.Task

/// The core's wall-clock capability.
///
/// Same problem as `CoreTask`, same fix. UniFFI names the host trait `Clock`,
/// which collides with `Swift.Clock` — the standard-library protocol behind
/// `Task.sleep(for:)` and `ContinuousClock`. Both are always in scope, so a
/// bare `Clock` in authored code is ambiguous rather than merely confusing.
public typealias CoreClock = TaskNotesCore.Clock
