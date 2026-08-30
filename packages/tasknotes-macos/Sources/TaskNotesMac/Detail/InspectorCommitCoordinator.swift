public import AppKit

internal import struct Foundation.UUID

/// The live inspector buffers that must reach durable storage before quitting.
///
/// Ordinary panel lifecycle commits happen in the view itself. Application
/// termination is different: AppKit can end the process before an unstructured
/// task launched from `onDisappear` reaches the engine queue. The application
/// delegate therefore asks this coordinator to await the same captured-value
/// commit path before allowing termination to continue.
@MainActor
final class InspectorCommitCoordinator {
    static let shared = InspectorCommitCoordinator()

    private typealias Commit = @MainActor () async -> Void
    private var commits: [UUID: Commit] = [:]

    init() {}

    var isEmpty: Bool { commits.isEmpty }

    func register(_ id: UUID, commit: @escaping @MainActor () async -> Void) {
        commits[id] = commit
    }

    func unregister(_ id: UUID) {
        commits[id] = nil
    }

    func commitAll() async {
        // Snapshot first: a successful commit can redraw or dismiss an
        // inspector, which unregisters it while this loop is suspended.
        let current = Array(commits.values)
        for commit in current {
            await commit()
        }
    }
}

/// Delays application termination until every live inspector has offered its
/// buffered text to the durable core queue.
@MainActor
public final class TaskNotesApplicationDelegate: NSObject, NSApplicationDelegate {
    public override init() {
        super.init()
    }

    public func applicationShouldTerminate(
        _ sender: NSApplication
    ) -> NSApplication.TerminateReply {
        let coordinator = InspectorCommitCoordinator.shared
        guard !coordinator.isEmpty else { return .terminateNow }

        _Concurrency.Task { @MainActor in
            await coordinator.commitAll()
            sender.reply(toApplicationShouldTerminate: true)
        }
        return .terminateLater
    }
}
