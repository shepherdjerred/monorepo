internal import AppKit
internal import SwiftUI

/// A single-line text field backed by a real `NSTextField`.
///
/// ## Why not SwiftUI's `TextField`
///
/// SwiftUI's `TextField` *is* an `NSTextField` underneath, so ⌃A/⌃E/⌃K/⌃Y and
/// the Services menu already work — those come from `NSResponder`'s standard
/// key bindings and from the window's shared field editor, which is an
/// `NSTextView`. Two things it does not give:
///
///  1. **Spell checking.** It is a property of the field editor, and SwiftUI
///     exposes no modifier for it on macOS. Reaching the editor requires being
///     the `NSTextField`.
///  2. **A submit that does not also dismiss.** `onSubmit` fires, but keeping
///     focus for the next entry — the behaviour that makes an inline compose
///     row usable for adding three tasks in a row — needs the field's own
///     action.
///
/// So this exists for the two things the platform only offers one level down,
/// not as a rewrite of a control that already works.
///
/// ## What is deliberately left to AppKit
///
/// Undo, the emoji picker, dictation, text substitutions, the Services menu,
/// and every emacs binding are all inherited by being a real text field. None
/// of them are re-implemented here, and none of them should be.
struct PlainTextField: NSViewRepresentable {
    @Binding var text: String

    /// The placeholder shown while empty.
    let prompt: String

    /// Return.
    let onSubmit: () -> Void

    /// Escape.
    let onCancel: () -> Void

    func makeNSView(context: Context) -> NSTextField {
        let field = SpellCheckedTextField(string: text)
        field.placeholderString = prompt
        field.delegate = context.coordinator
        field.target = context.coordinator
        field.action = #selector(Coordinator.submit(_:))

        // A compose row, not a form field: the surrounding row already draws
        // the affordance, and a bezel inside it reads as a box in a box.
        field.isBordered = false
        field.drawsBackground = false
        field.focusRingType = .none
        field.font = .preferredFont(forTextStyle: .body)
        field.lineBreakMode = .byTruncatingTail
        field.cell?.sendsActionOnEndEditing = false
        return field
    }

    func updateNSView(_ field: NSTextField, context: Context) {
        // Guarded: assigning `stringValue` unconditionally would reset the
        // insertion point on every redraw, so typing into the middle of a
        // string would jump the caret to the end after each character.
        if field.stringValue != text {
            field.stringValue = text
        }
        field.placeholderString = prompt
        context.coordinator.parent = self
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(parent: self)
    }

    @MainActor
    final class Coordinator: NSObject, NSTextFieldDelegate {
        var parent: PlainTextField

        init(parent: PlainTextField) {
            self.parent = parent
        }

        func controlTextDidChange(_ notification: Notification) {
            guard let field = notification.object as? NSTextField else { return }
            parent.text = field.stringValue
        }

        @objc func submit(_ sender: NSTextField) {
            parent.text = sender.stringValue
            parent.onSubmit()
        }

        /// Escape, routed through the responder chain rather than a key
        /// equivalent.
        ///
        /// `cancelOperation(_:)` is what the field editor sends for Escape *and*
        /// for ⌘. — so handling the one selector covers both spellings of
        /// "never mind" without either being hard-coded to a key.
        func control(
            _ control: NSControl,
            textView: NSTextView,
            doCommandBy selector: Selector
        ) -> Bool {
            guard selector == #selector(NSResponder.cancelOperation(_:)) else { return false }
            parent.onCancel()
            return true
        }
    }
}

/// An `NSTextField` that turns spell checking on in its field editor.
///
/// The editor is the window's shared `NSTextView` and is only attached once the
/// field is first responder, so the configuration has to happen here rather
/// than at construction — there is no editor to configure before then.
///
/// **Automatic spelling *correction* is off while checking is on**, and that is
/// a considered split rather than an oversight: a task title is full of project
/// names, jargon, and abbreviations, so silently rewriting words would corrupt
/// data, while underlining them costs nothing and still gets a real typo
/// noticed. Text *replacement* stays on, because that is the user's own
/// configured substitutions.
private final class SpellCheckedTextField: NSTextField {
    override func becomeFirstResponder() -> Bool {
        let became = super.becomeFirstResponder()
        if became, let editor = currentEditor() as? NSTextView {
            editor.isContinuousSpellCheckingEnabled = true
            editor.isGrammarCheckingEnabled = true
            editor.isAutomaticSpellingCorrectionEnabled = false
            editor.isAutomaticTextReplacementEnabled = true
        }
        return became
    }
}
