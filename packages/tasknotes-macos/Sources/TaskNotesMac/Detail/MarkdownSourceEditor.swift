internal import AppKit
internal import SwiftUI

/// The note body's editor: a real `NSTextView` over plain markdown source.
///
/// ## Why this is a definition-of-done item rather than a text box
///
/// The brief's list — ⌃A/⌃E/⌃K/⌃Y, system spellcheck, the Services menu, text
/// drag-and-drop — is not a feature list to implement. Every item on it is
/// something `NSTextView` already does, and the only way to lose them is to
/// draw text with something else. The emacs bindings come from `NSResponder`'s
/// standard key bindings, Services comes from being a text view in the responder
/// chain, and dragging a selection out to another app comes from
/// `NSTextView`'s own drag source. Nothing below implements any of them; the
/// point of this file is that nothing *prevents* them either.
///
/// SwiftUI's `TextEditor` is an `NSTextView` too, so it inherits most of that —
/// but it exposes no way to reach the view, and reaching it is the whole job
/// here: **the substitutions have to be turned off**, and that is not a
/// preference.
///
/// ## Smart quotes corrupt markdown, silently
///
/// macOS ships with smart quotes and smart dashes on. In prose they are right.
/// In markdown source they are data corruption with no error message:
///
///   * `"quoted"` becomes `“quoted”`, so a fenced block's `--flag="value"` stops
///     being a flag.
///   * `--` becomes `–`, so `-- separator` and every `--option` change meaning.
///   * `...` becomes `…`, which is fine to read and wrong to store.
///
/// The user then saves a file whose bytes are not what they typed, and finds out
/// when something else reads it. So quote substitution, dash substitution and
/// automatic spelling *correction* are all off here.
///
/// **Continuous spell checking stays on**, and text *replacement* stays on. The
/// split is the same one ``PlainTextField`` makes for the same reason: underlining
/// a real typo costs nothing and is the definition-of-done item, while silently
/// rewriting a word inside a note full of project names and jargon is the thing
/// being avoided. Text replacement is the user's own configured expansions,
/// which they asked for explicitly.
///
/// ## Plain text, deliberately
///
/// `isRichText = false` and `usesFontPanel = false`: this edits markdown
/// *source*, so pasting styled text must arrive as characters and ⌘B must do
/// nothing. The app does not do WYSIWYG — the React Native app does not either,
/// and that is what makes macOS 15 cost nothing here, since the rich
/// `TextEditor` that needs macOS 26 would only matter if it did.
struct MarkdownSourceEditor: NSViewRepresentable {
    @Binding var text: String

    /// Called when editing ends — focus left the view, or Escape reverted it.
    let onCommit: () -> Void

    func makeNSView(context: Context) -> NSScrollView {
        // A non-zero starting frame is load-bearing, not arbitrary. The text
        // view is the scroll view's document view and grows by *autoresizing
        // deltas*, so one that starts at `.zero` and whose container tracks its
        // width lays out into nothing — the snapshot of it came back as a single
        // flat colour, which is what an offscreen render of a zero-width text
        // view looks like. Any real size works; the scroll view corrects it on
        // the first layout pass.
        let textView = NSTextView(
            frame: NSRect(x: 0, y: 0, width: 320, height: 320),
            textContainer: context.coordinator.container
        )
        textView.delegate = context.coordinator

        // Plain text in, plain text out.
        textView.isRichText = false
        textView.usesFontPanel = false
        textView.isEditable = true
        textView.isSelectable = true
        textView.allowsUndo = true
        textView.font = .monospacedSystemFont(ofSize: NSFont.systemFontSize, weight: .regular)

        // See the type's documentation. These four lines are the reason this
        // file exists.
        textView.isAutomaticQuoteSubstitutionEnabled = false
        textView.isAutomaticDashSubstitutionEnabled = false
        textView.isAutomaticSpellingCorrectionEnabled = false
        textView.isContinuousSpellCheckingEnabled = true
        textView.isGrammarCheckingEnabled = true
        textView.isAutomaticTextReplacementEnabled = true

        // Semantic colours, so the editor follows the system appearance without
        // an in-app toggle — and so a dark-mode note is not black on white.
        textView.drawsBackground = true
        textView.backgroundColor = .textBackgroundColor
        textView.textColor = .textColor
        textView.insertionPointColor = .textColor
        textView.textContainerInset = NSSize(width: 6, height: 8)

        // Grow downwards, wrap sideways: the classic scrollable-text-view
        // geometry. The container half of it is configured in ``container()``
        // before the view exists — see there for why it is not set through
        // `textView.textContainer`.
        textView.minSize = NSSize(width: 0, height: 0)
        textView.maxSize = NSSize(
            width: CGFloat.greatestFiniteMagnitude, height: CGFloat.greatestFiniteMagnitude)
        textView.isVerticallyResizable = true
        textView.isHorizontallyResizable = false
        textView.autoresizingMask = [.width]
        textView.string = text

        let scrollView = NSScrollView()
        scrollView.documentView = textView
        scrollView.hasVerticalScroller = true
        scrollView.hasHorizontalScroller = false
        scrollView.autohidesScrollers = true
        scrollView.drawsBackground = false
        scrollView.borderType = .noBorder
        return scrollView
    }

    func updateNSView(_ scrollView: NSScrollView, context: Context) {
        context.coordinator.parent = self
        guard let textView = scrollView.documentView as? NSTextView else { return }
        // Guarded, or every redraw would reset the insertion point and typing
        // into the middle of a paragraph would jump the caret to the end after
        // each character.
        if textView.string != text {
            context.coordinator.undoManager.removeAllActions()
            textView.string = text
        }
    }

    static func dismantleNSView(_ scrollView: NSScrollView, coordinator: Coordinator) {
        guard let textView = scrollView.documentView as? NSTextView else { return }
        // Detach every callback target before the coordinator-owned TextKit
        // stack is released. Undo registrations can otherwise retain selectors
        // against text objects that no longer exist after the inspector closes.
        textView.delegate = nil
        textView.allowsUndo = false
        coordinator.undoManager.removeAllActions()
        scrollView.documentView = nil
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(parent: self)
    }

    @MainActor
    final class Coordinator: NSObject, NSTextViewDelegate {
        var parent: MarkdownSourceEditor

        /// The TextKit stack, assembled here and **owned** here.
        ///
        /// ⚠️ Two separate reasons this is not `NSTextView()` plus a couple of
        /// property assignments, and both were found by running it.
        ///
        /// **Ownership.** TextKit 1's retain chain runs storage → layout manager
        /// → container, and the container's back-reference to its layout manager
        /// is weak. A helper that built the stack in a local and returned only
        /// the container therefore let the storage and the layout manager
        /// deallocate the moment it returned: the text view kept a live
        /// container attached to a dead stack, laid out nothing, and rendered as
        /// a flat rectangle. The coordinator outlives the view, so holding all
        /// three here is what keeps them alive.
        ///
        /// **Safety.** `NSTextView.textContainer` is declared `unowned(unsafe)`,
        /// so `textView.textContainer?.widthTracksTextView = true` is an unsafe
        /// expression under `.strictMemorySafety()`. The house rule set by
        /// `TaskNotesServerProcess.reserveEphemeralPort` is that marking an
        /// expression `unsafe` compiles, but using an API that is not unsafe in
        /// the first place is better — and here there is one:
        /// `NSTextView(frame:textContainer:)` takes an already-configured
        /// container, so the `unowned(unsafe)` property is never read.
        let storage = NSTextStorage()
        let layoutManager = NSLayoutManager()
        let container = NSTextContainer(
            size: NSSize(width: 0, height: CGFloat.greatestFiniteMagnitude))

        /// Undo history belongs to this editor instance and no other.
        let undoManager = UndoManager()

        /// What the text was when editing began, for Escape to restore.
        private var original: String?

        init(parent: MarkdownSourceEditor) {
            self.parent = parent
            super.init()
            // Without this the container keeps its initial width and long lines
            // run off the edge instead of wrapping.
            container.widthTracksTextView = true
            layoutManager.addTextContainer(container)
            storage.addLayoutManager(layoutManager)
        }

        func textDidBeginEditing(_ notification: Notification) {
            guard let textView = notification.object as? NSTextView else { return }
            original = textView.string
        }

        /// AppKit's supported hook for scoping undo to this text view.
        func undoManager(for view: NSTextView) -> UndoManager? {
            undoManager
        }

        func textDidChange(_ notification: Notification) {
            guard let textView = notification.object as? NSTextView else { return }
            parent.text = textView.string
        }

        /// Commit on losing focus.
        ///
        /// An inspector has no Save button — that is the platform idiom, and the
        /// three-state payload makes it safe, because a field that was never
        /// edited sends nothing at all rather than sending `null`. Blur is the
        /// commit point for a multi-line field specifically because Return has
        /// to stay a newline in a markdown body.
        func textDidEndEditing(_ notification: Notification) {
            guard let textView = notification.object as? NSTextView else { return }
            parent.text = textView.string
            original = nil
            parent.onCommit()
        }

        /// Escape restores what was there when editing began.
        ///
        /// Routed through `cancelOperation(_:)` rather than a key equivalent, so
        /// it covers ⌘. as well — the text view sends the same selector for both
        /// spellings of "never mind". This is the only undo-shaped thing
        /// implemented here; ⌘Z is `allowsUndo` and belongs to AppKit.
        ///
        /// Focus is deliberately **not** dropped afterwards. Resigning it would
        /// mean reaching `textView.window`, which is `unowned(unsafe)` and would
        /// need an `unsafe` spelling for no benefit — and leaving the caret
        /// where it was is the better behaviour anyway, since a revert is
        /// usually followed by typing the sentence again. The commit that fires
        /// when focus does eventually leave is a no-op by construction:
        /// `TaskTextEdit.rewriting` answers `nil` when the text matches what is
        /// stored, which after a revert it does.
        func textView(
            _ textView: NSTextView,
            doCommandBy selector: Selector
        ) -> Bool {
            guard selector == #selector(NSResponder.cancelOperation(_:)) else { return false }
            guard let original else { return false }
            textView.string = original
            parent.text = original
            return true
        }
    }
}
