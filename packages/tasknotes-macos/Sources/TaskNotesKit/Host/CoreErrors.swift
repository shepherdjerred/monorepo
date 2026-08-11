internal import Foundation
public import TaskNotesUniFFI

/// Turning an untyped Swift failure into the core's typed `CoreError`.
///
/// Two unrelated sources of untyped errors meet here:
///
///   * **Foundation**, which throws `any Error` because almost everything in it
///     predates typed throws.
///   * **The generated bindings.** UniFFI emits plain `throws` even for a Rust
///     function whose only failure type is `CoreError`, so `taskFromJson` and
///     friends hand back an `any Error` that is *already* a `CoreError`.
///     ``rethrowingCore(_:_:)`` recovers that rather than flattening it, which
///     is what keeps a `Validation` from the core from arriving as an
///     `Invariant` from here.
///
/// ## Why `Result(catching:)` and not `do`/`catch`
///
/// Inside a `throws(CoreError)` function a `catch` clause must be exhaustive,
/// and the only exhaustive form is an untyped `catch` — which is precisely what
/// the `untyped_error_in_catch` rule exists to reject. `Result` gives the same
/// coverage with the error still typed at the point of use, and no `catch`
/// keyword for the linter to object to.
///
/// ⚠️ Do not "simplify" any of this into `catch let error as NSError`. That
/// combination inside a typed-throws function crashes the Swift 6.4 compiler
/// outright — `SILBuilder.h:2244`,
/// `assertion failed: FormalConcreteType->isBridgeableObjectType()`.
public enum CoreErrors {
    /// Turn a typed-throwing call into a `Result` without losing the type.
    ///
    /// `Result.init(catching:)` is still `where Failure == any Error`, so it
    /// flattens a `throws(CoreError)` call back to an existential and every
    /// caller then has to re-narrow it. This does not.
    ///
    /// The bare `catch` is exhaustive *because* the body's throw type is
    /// `CoreError`, which is what makes it legal here and illegal inside a
    /// `throws(CoreError)` function. `untyped_error_in_catch` bans
    /// `catch let error`, not this — the error is already typed, and nothing is
    /// being erased.
    public static func capturing<T>(
        _ body: () throws(CoreError) -> T
    ) -> Result<T, CoreError> {
        do {
            return .success(try body())
        } catch {
            return .failure(error)
        }
    }

    /// Run a call into the generated bindings, preserving the `CoreError` it
    /// actually threw.
    ///
    /// A failure that is *not* a `CoreError` means the bindings threw something
    /// undocumented, which is an invariant violation rather than a caller
    /// mistake — so it is reported as one instead of being reshaped into
    /// whatever the call site happened to expect.
    static func rethrowingCore<T>(
        _ what: String,
        _ body: () throws -> T
    ) throws(CoreError) -> T {
        switch Result(catching: body) {
        case .success(let value):
            return value
        case .failure(let error):
            guard let coreError = error as? CoreError else {
                throw CoreError.Invariant(message: "\(what): \(error.localizedDescription)")
            }
            throw coreError
        }
    }

    /// Run a call whose failure means the data was malformed.
    static func validating<T>(
        _ what: String,
        _ body: () throws -> T
    ) throws(CoreError) -> T {
        switch Result(catching: body) {
        case .success(let value):
            return value
        case .failure(let error):
            throw CoreError.Validation(message: "\(what): \(error.localizedDescription)")
        }
    }

    /// Run a call whose failure means the host's storage layer failed.
    ///
    /// ⚠️ `CoreError` has no storage or I/O variant — its six cases are
    /// `Invariant`, `Network`, `Api`, `Validation`, `NotFound` and `Connection`
    /// — so a disk failure has to arrive as `Invariant`. That is the honest
    /// nearest fit rather than the right one, and it is a gap in the core's
    /// error enum, not a choice made here.
    static func storing<T>(
        _ what: String,
        _ body: () throws -> T
    ) throws(CoreError) -> T {
        switch Result(catching: body) {
        case .success(let value):
            return value
        case .failure(let error):
            throw CoreError.Invariant(message: "\(what): \(error.localizedDescription)")
        }
    }
}

extension Data {
    /// Decode as UTF-8, or fail loudly.
    ///
    /// `String(bytes:encoding:)` rather than `String(decoding:as:)`, and the
    /// distinction matters: the latter substitutes U+FFFD for every invalid
    /// byte and always succeeds, which is exactly the silent fallback this
    /// repository's principles ban. A truncated cache file or a server response
    /// in the wrong encoding would read back as a plausible-looking string and
    /// fail somewhere further away instead of here.
    func decodedAsUtf8(describing what: String) throws(CoreError) -> String {
        guard let text = String(bytes: self, encoding: .utf8) else {
            throw CoreError.Validation(message: "\(what) is not valid UTF-8")
        }
        return text
    }
}
