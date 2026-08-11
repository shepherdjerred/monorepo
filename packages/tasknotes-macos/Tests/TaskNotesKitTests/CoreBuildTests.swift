internal import TaskNotesKit
internal import TaskNotesUniFFI
import Testing

/// Proves the Rust core is actually linked and callable.
///
/// This is the only test Phase 7 needs and it is not a formality: the bindings
/// compile against a header, so a build can succeed while the static archive is
/// missing, stale, or built for the wrong architecture. Calling into Rust is
/// the only thing that distinguishes "the Swift compiles" from "the app will
/// launch".
@Suite("Rust core linkage")
struct CoreBuildTests {
    @Test("the linked core reports a semantic version")
    func coreVersionIsSemantic() throws {
        let version = CoreBuild.version
        let components = version.split(separator: ".")
        #expect(components.count == 3, "expected MAJOR.MINOR.PATCH, got \(version)")
        for component in components {
            #expect(UInt(component) != nil, "non-numeric component in \(version)")
        }
    }

    /// A round trip through a real exported function with a real return value,
    /// so the test fails if the FFI buffer plumbing is broken and not merely if
    /// the symbol is missing.
    @Test("status parsing round-trips through the core")
    func statusRoundTrip() throws {
        let parsed = try taskStatusParse(raw: "in-progress")
        #expect(parsed == .inProgress)
        #expect(taskStatusWireValue(status: parsed) == "in-progress")
        #expect(taskStatusIsActive(status: parsed))
    }

    /// The core owns the closed status enum; the shell must not re-declare it.
    /// If Rust gains or loses a status this fails loudly rather than silently
    /// leaving a menu incomplete.
    @Test("the core exposes the full status set")
    func statusSetIsComplete() throws {
        #expect(taskStatusAll().count == 6)
    }
}
