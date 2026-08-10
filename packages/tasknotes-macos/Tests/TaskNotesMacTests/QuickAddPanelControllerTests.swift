import Foundation
import TaskNotesKit
import TaskNotesTestSupport
import Testing

@testable import TaskNotesMac
@testable import TaskNotesUniFFI

/// What Return does to the field, and when.
///
/// ## Why this is worth its own file
///
/// The quick-add panel is the one surface in this app with no window behind it
/// that the user is looking at. It floats over somebody else's application, it
/// closes on the keystroke that commits, and the store's own error banner is
/// raised on a main window that is by definition not on screen at that moment.
/// So the panel clearing the field is a claim it cannot take back: whatever was
/// typed exists nowhere else afterwards.
///
/// That makes "cleared" and "created" the same event, and these two cases are
/// the two halves of it.
@Suite("The quick-add panel's submission")
@MainActor
struct QuickAddPanelControllerTests {
    /// ⚠️ The line the user typed is the only copy of it.
    ///
    /// A store with no engine is the cheapest way to a refused write, and it is
    /// the *same* refusal a full or momentarily unwritable queue file produces:
    /// `dispatch` returns `nil` having created nothing. Before this was checked,
    /// the panel cleared and dismissed on that outcome exactly as it does on a
    /// success, and the task was gone with no indication it had never existed.
    @Test("a refused write keeps the typed line, and says why")
    func aRefusedWriteKeepsTheLine() throws {
        // Held for the length of the case: the directory removes itself when it
        // is released, and a store writing into a deleted one would be a second
        // reason to refuse rather than the missing engine this is about.
        let directory = try TemporaryDirectory()
        let store = TaskNotesStore(storage: try FileHostStorage(directory: directory.url))
        defer { store.shutdown() }

        let controller = QuickAddPanelController(store: .success(store))
        controller.prepare()
        controller.text = "Fix the boiler"
        controller.submit()

        #expect(
            controller.text == "Fix the boiler",
            "the field is the only place the line still exists"
        )
        #expect(
            controller.submissionFailure != nil,
            "and a panel that silently did nothing on Return would be the same loss, slower"
        )
    }

    /// The other half: a persisted task still costs the field.
    ///
    /// Stated as a test because the retention above is only correct while this
    /// stays true — a panel that never cleared would satisfy the case above and
    /// re-add the task on the next summoning.
    @Test("a persisted task clears the field")
    func aPersistedTaskClearsTheField() throws {
        let directory = try TemporaryDirectory()
        let store = TaskNotesStore(storage: try FileHostStorage(directory: directory.url))
        defer { store.shutdown() }
        // An address nothing answers on. The command is queued optimistically
        // before anything is sent, which is the whole of what this asserts; the
        // pass `submit` arms is left to fail against a closed port.
        store.configure(serverURL: URL(string: "http://127.0.0.1:1/"), authToken: nil)

        let controller = QuickAddPanelController(store: .success(store))
        controller.prepare()
        controller.text = "Fix the boiler"
        controller.submit()

        #expect(controller.text.isEmpty, "the field was traded for a task")
        #expect(controller.submissionFailure == nil)
        #expect(store.tasks.count == 1, "and that is the task it was traded for")
    }
}
