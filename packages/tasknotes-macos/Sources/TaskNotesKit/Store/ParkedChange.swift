public import TaskNotesUniFFI

/// One permanently-failed mutation, as a row a person can read and act on.
///
/// ## Why this type exists
///
/// The engine parks a command when the server's refusal is *permanent* — a 400,
/// a 422, a 404 on anything but a delete. Retrying such a command forever would
/// wedge the queue behind it, so the drain moves it aside and keeps going, and
/// the optimistic edit is rolled back out of the visible list.
///
/// That is the correct engine behaviour and, on its own, it is also a way to
/// lose work quietly: the user's edit vanishes from the screen with no record
/// they can see, and the durable dead-letter list they could recover it from was
/// reachable only from code. This is that list in the vocabulary of the thing
/// the user actually did, so a screen can show it, and ``TaskNotesStore`` can
/// put it back or drop it on request.
///
/// Sans-SwiftUI on purpose — the wording and the ordering are what a test can
/// pin, and a view that built these strings inline would put them out of reach.
public struct ParkedChange: Identifiable, Sendable, Equatable {
    /// The command's idempotency key, which is also how it is retried or
    /// discarded.
    public let id: String

    /// What the user did, in their words rather than the queue's.
    public let summary: String

    /// Why the server refused it, with the status when there was one.
    public let reason: String

    /// When it was parked, in epoch milliseconds.
    public let failedAt: Int64

    /// The rows for a store snapshot, newest failure first.
    ///
    /// Newest first because a list of failures is read from the top and the most
    /// recent one is the one the user still remembers making.
    public static func all(_ entries: [DeadLetterEntry]) -> [ParkedChange] {
        entries.map(of).sorted { $0.failedAt > $1.failedAt }
    }

    public static func of(_ entry: DeadLetterEntry) -> ParkedChange {
        ParkedChange(
            id: commandId(of: entry.command),
            summary: summary(of: entry.command),
            reason: reason(of: entry.error),
            failedAt: entry.failedAt
        )
    }

    /// The exhaustive switch is the point: a sixth command variant has to be
    /// given a sentence here rather than silently rendering as a blank row.
    private static func summary(of command: Command) -> String {
        switch command {
        case .create(_, _, _, let payload):
            "New task “\(payload.title)”"
        case .update(_, _, let taskId, _):
            "Edit to “\(displayName(of: taskId))”"
        case .delete(_, _, let taskId):
            "Deletion of “\(displayName(of: taskId))”"
        case .setStatus(_, _, let taskId, let status):
            "“\(displayName(of: taskId))” marked \(word(for: status))"
        case .setInstanceComplete(_, _, let taskId, let date, let completed, _):
            completed
                ? "“\(displayName(of: taskId))” completed for \(date)"
                : "“\(displayName(of: taskId))” reopened for \(date)"
        }
    }

    private static func commandId(of command: Command) -> String {
        switch command {
        case .create(let id, _, _, _),
            .update(let id, _, _, _),
            .delete(let id, _, _),
            .setStatus(let id, _, _, _),
            .setInstanceComplete(let id, _, _, _, _, _):
            id
        }
    }

    private static func word(for status: TaskStatus) -> String {
        switch status {
        case .open: "open"
        case .inProgress: "in progress"
        case .done: "done"
        case .cancelled: "cancelled"
        case .waiting: "waiting"
        case .delegated: "delegated"
        }
    }

    /// A task's vault path as a name.
    ///
    /// The id is a vault-relative markdown path, and a row reading
    /// `Tasks/Projects/Water the plants.md` spends its width on the folder
    /// structure rather than on which task it is. A queued create that never
    /// landed has a temp id and no file name at all, which is why the whole
    /// path is the fallback rather than an empty string.
    private static func displayName(of taskId: TaskId) -> String {
        let name = taskId.split(separator: "/").last.map(String.init) ?? taskId
        guard name.hasSuffix(".md") else { return name }
        return String(name.dropLast(3))
    }

    private static func reason(of error: DeadLetterError) -> String {
        guard let status = error.status else { return error.message }
        return "\(error.message) (HTTP \(status))"
    }
}
