import TaskNotesKit
import Testing

@testable import TaskNotesFacetUI

@MainActor
struct FacetCompletionFeedbackTests {
    @Test("Apple acknowledges completion and its reversal, while routine edits stay quiet")
    func completionSounds() {
        #expect(FacetFeedbackEvent.completed.completionSound == "complete")
        #expect(FacetFeedbackEvent.reopened.completionSound == "reverse")
        #expect(FacetFeedbackEvent.undone.completionSound == "reverse")
        #expect(FacetFeedbackEvent.created.completionSound == nil)
        #expect(FacetFeedbackEvent.saved.completionSound == nil)
        #expect(FacetFeedbackEvent.deleted.completionSound == nil)
    }

    @Test(
        "Rapid completions are durable immediately, keep independent checkmarks, and Undo the named task"
    )
    func rapidCompletion() throws {
        let local = FacetLocalStore(database: try FacetSQLiteDatabase(inMemoryNamed: ":memory:"))
        let store = FacetStore(localStore: local, tokenStore: InMemoryTokenStore())
        let first = try #require(store.createQuickTask(rawInput: "Buy milk"))
        let second = try #require(store.createQuickTask(rawInput: "Return books"))
        store.toggleTaskCompletion(first)
        let firstReceipt = try #require(store.completionRow(for: first.id)?.receipt)
        store.toggleTaskCompletion(second)
        let secondReceipt = try #require(store.completionRow(for: second.id)?.receipt)
        #expect(firstReceipt != secondReceipt)
        #expect(store.todayCount == 0)
        #expect(store.openListPresentationTasks.map(\.id) == [first.id, second.id])
        store.undoAction(for: firstReceipt)
        #expect(store.completedTasks.count == 2)
        store.undoAction(for: secondReceipt)
        #expect(store.todayCount == 1)
        #expect(store.completionRow(for: second.id) == nil)
        #expect(store.completionRow(for: first.id)?.receipt == firstReceipt)
        store.destination = .section(.completed)
        #expect(store.completedTasks(from: store.listPresentationTasks).map(\.id) == [first.id])
    }

    @Test("Completion focus keeps the same action on an adjacent task or the list heading")
    func focusAfterCompletion() {
        let tasks = ["a", "b", "c"]
        #expect(
            FacetTaskFocusTarget.completion("a").afterRemovingRows(
                from: tasks, remaining: ["b", "c"]) == .completion("b"))
        #expect(
            FacetTaskFocusTarget.title("c").afterRemovingRows(from: tasks, remaining: ["a", "b"])
                == .title("b"))
        #expect(
            FacetTaskFocusTarget.completion("b").afterRemovingRows(from: tasks, remaining: [])
                == .heading)
    }

    @Test("Haptics acknowledge the second quick tap even when its sound is suppressed")
    func hapticWithBusyAudio() async {
        var calls = [String]()
        await FacetSensoryDelivery.deliver(
            soundEnabled: true,
            audio: {
                calls.append("audio")
                return false
            },
            current: { true },
            haptic: { calls.append("haptic") })
        #expect(calls == ["haptic", "audio"])
    }
}
