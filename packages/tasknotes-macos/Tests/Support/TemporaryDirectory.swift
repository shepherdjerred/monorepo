public import Foundation

/// A scratch directory that removes itself.
///
/// Here rather than in a test target's own `Support/` folder for the same
/// reason ``TaskNotesServerProcess`` is: both test targets need somewhere to put
/// a client's durable state, and a test target cannot import another one.
public final class TemporaryDirectory {
    public let url: URL

    public init() throws {
        url = FileManager.default.temporaryDirectory
            .appending(path: "tasknotes-test-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    }

    deinit {
        // Explicitly discarded rather than `try?`, which is banned for hiding
        // the error: `deinit` cannot propagate and a leftover `/tmp` directory
        // is not a test failure.
        _ = Result { try FileManager.default.removeItem(at: url) }
    }
}
