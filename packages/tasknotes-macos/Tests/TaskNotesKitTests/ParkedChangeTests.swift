internal import TaskNotesKit
internal import TaskNotesUniFFI
import Testing

/// The dead-letter list, as a person reads it.
///
/// The wording is the whole feature. A parked command is work the user did that
/// the server refused for good, and the optimistic edit is already gone from the
/// list — so a row that said `set_instance_complete Tasks/a.md` would be a
/// record they cannot match to anything they remember doing.
@Suite("Parked changes")
struct ParkedChangeTests {
    private func entry(
        _ command: Command,
        error: DeadLetterError = DeadLetterError(
            name: "ApiError", message: "Unprocessable", status: 422),
        failedAt: Int64 = 1
    ) -> DeadLetterEntry {
        DeadLetterEntry(command: command, error: error, failedAt: failedAt)
    }

    @Test("every command variant gets a sentence naming what was done")
    func everyVariantReads() {
        let path = "Tasks/Projects/Water the plants.md"
        let summaries = ParkedChange.all([
            entry(
                .create(
                    id: "c1", createdAt: 1, tempId: "tmp-1-1",
                    payload: CreateTaskRequest(
                        title: "Buy milk", details: nil, status: nil, priority: nil,
                        due: nil, scheduled: nil, contexts: nil, projects: nil, tags: nil,
                        recurrence: nil, recurrenceAnchor: nil, timeEstimate: nil,
                        extraFields: nil)),
                failedAt: 5),
            entry(
                .update(
                    id: "c2", createdAt: 1, taskId: path,
                    payload: UpdateTaskRequest.settingPriority(.high)),
                failedAt: 4),
            entry(.delete(id: "c3", createdAt: 1, taskId: path), failedAt: 3),
            entry(
                .setStatus(id: "c4", createdAt: 1, taskId: path, status: .inProgress),
                failedAt: 2),
            entry(
                .setInstanceComplete(
                    id: "c5", createdAt: 1, taskId: path, date: "2026-07-04",
                    completed: true, restore: nil),
                failedAt: 1),
        ]).map(\.summary)

        #expect(
            summaries == [
                "New task “Buy milk”",
                "Edit to “Water the plants”",
                "Deletion of “Water the plants”",
                "“Water the plants” marked in progress",
                "“Water the plants” completed for 2026-07-04",
            ])
    }

    @Test("the newest failure is at the top")
    func newestFirst() {
        let ordered = ParkedChange.all([
            entry(.delete(id: "old", createdAt: 1, taskId: "Tasks/a.md"), failedAt: 10),
            entry(.delete(id: "new", createdAt: 1, taskId: "Tasks/b.md"), failedAt: 30),
            entry(.delete(id: "mid", createdAt: 1, taskId: "Tasks/c.md"), failedAt: 20),
        ])
        #expect(ordered.map(\.id) == ["new", "mid", "old"])
    }

    /// The id is the command's idempotency key, and it is what
    /// `retryDeadLetter`/`discardDeadLetter` take — a row carrying the wrong one
    /// would act on somebody else's parked command.
    @Test("the row's id is the command id the store acts on")
    func idIsTheCommandId() {
        let change = ParkedChange.of(
            entry(
                .setInstanceComplete(
                    id: "cmd-42", createdAt: 1, taskId: "Tasks/a.md", date: "2026-07-04",
                    completed: false, restore: nil)))
        #expect(change.id == "cmd-42")
        #expect(change.summary == "“a” reopened for 2026-07-04")
    }

    @Test("the reason carries the status when the server sent one")
    func reasonIncludesStatus() {
        #expect(
            ParkedChange.of(entry(.delete(id: "c", createdAt: 1, taskId: "Tasks/a.md"))).reason
                == "Unprocessable (HTTP 422)")
        #expect(
            ParkedChange.of(
                entry(
                    .delete(id: "c", createdAt: 1, taskId: "Tasks/a.md"),
                    error: DeadLetterError(
                        name: "ValidationError", message: "not a date", status: nil))
            ).reason == "not a date")
    }
}
