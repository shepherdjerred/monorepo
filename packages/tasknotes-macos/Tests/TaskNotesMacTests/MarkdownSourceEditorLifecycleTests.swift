internal import AppKit
internal import SwiftUI
internal import Testing

@testable import TaskNotesMac

@Suite("The markdown editor lifecycle", .serialized)
@MainActor
struct MarkdownSourceEditorLifecycleTests {
    @Test("undo and redo stay scoped to one live editor")
    func undoAndRedo() throws {
        let fixture = fixture(text: "Before")
        fixture.textView.setSelectedRange(NSRange(location: 6, length: 0))
        fixture.textView.insertText(" after", replacementRange: NSRange(location: 6, length: 0))

        #expect(fixture.coordinator.undoManager.canUndo)
        fixture.coordinator.undoManager.undo()
        #expect(fixture.textView.string == "Before")
        #expect(fixture.coordinator.undoManager.canRedo)
        fixture.coordinator.undoManager.redo()
        #expect(fixture.textView.string == "Before after")
    }

    @Test("closing an editor clears history before its TextKit stack is released")
    func closingClearsHistoryAndARecreatedEditorWorks() throws {
        let first = fixture(text: "First")
        first.textView.insertText(" edit", replacementRange: NSRange(location: 5, length: 0))
        #expect(first.coordinator.undoManager.canUndo)

        MarkdownSourceEditor.dismantleNSView(first.scrollView, coordinator: first.coordinator)
        #expect(!first.coordinator.undoManager.canUndo)
        #expect(first.textView.delegate == nil)
        #expect(first.scrollView.documentView == nil)

        // Invoking the retired manager is now a no-op, not a message to a
        // deallocated TextKit object.
        first.coordinator.undoManager.undo()

        let second = fixture(text: "Second")
        second.textView.insertText(" edit", replacementRange: NSRange(location: 6, length: 0))
        #expect(second.coordinator.undoManager.canUndo)
        second.coordinator.undoManager.undo()
        #expect(second.textView.string == "Second")
    }

    private func fixture(text: String) -> EditorFixture {
        var bound = text
        let editor = MarkdownSourceEditor(
            text: Binding(get: { bound }, set: { bound = $0 }),
            onCommit: {}
        )
        let coordinator = editor.makeCoordinator()
        let textView = NSTextView(
            frame: NSRect(x: 0, y: 0, width: 320, height: 200),
            textContainer: coordinator.container
        )
        textView.delegate = coordinator
        textView.allowsUndo = true
        textView.string = text

        let scrollView = NSScrollView(frame: textView.frame)
        scrollView.documentView = textView
        let window = NSWindow(
            contentRect: scrollView.frame,
            styleMask: [.borderless],
            backing: .buffered,
            defer: false
        )
        window.contentView = scrollView
        _ = window.makeFirstResponder(textView)
        return EditorFixture(
            coordinator: coordinator,
            textView: textView,
            scrollView: scrollView,
            window: window
        )
    }
}

@MainActor
private struct EditorFixture {
    let coordinator: MarkdownSourceEditor.Coordinator
    let textView: NSTextView
    let scrollView: NSScrollView
    let window: NSWindow
}
