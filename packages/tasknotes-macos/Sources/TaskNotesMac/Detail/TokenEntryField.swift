internal import AppKit
internal import SwiftUI
internal import TaskNotesKit

/// The typing half of a token field: one line of text that hands six keys back
/// to its owner before the field editor sees them.
///
/// ## Why an `NSTextField` rather than SwiftUI's `TextField`
///
/// Not for spellcheck — a tag is a project name and an abbreviation, and
/// underlining it is noise. For **key interception**, which is the entire
/// interaction:
///
///   * `control(_:textView:doCommandBy:)` is AppKit's documented point of
///     interception, and it runs *before* the field editor acts. ↑ and ↓ in a
///     `TextField` are consumed by the field editor as caret movement, and
///     `onKeyPress` on a focused SwiftUI text field is not specified to see them
///     first.
///   * **Backspace at the start of an empty field has no SwiftUI spelling at
///     all.** There is no key event to observe, because nothing changed —
///     `deleteBackward(_:)` arriving with a zero-length selection at offset 0 is
///     the only evidence that it happened, and it is only reachable here.
///
/// It is worth being precise about what this is *not*. This is not the
/// `NSTokenField` the lint gate rejected: `NSTextFieldDelegate` returns `Bool`
/// and `String`, so no requirement here imports as an optional collection and
/// nothing needs suppressing. The tokens themselves, the completion list, the
/// focus ring and every accessibility element are SwiftUI, which is what lets
/// them animate, follow the appearance, and carry custom actions.
///
/// ## Focus travels in through SwiftUI and is reported back out by AppKit
///
/// The two directions genuinely need different mechanisms. `@FocusState` can
/// push focus *into* a representable — `.focused()` is what the owner uses — but
/// it never learns that a **click** landed here, so a suggestion list gated on it
/// would stay shut for the most common way of all to start typing.
/// ``onEditingChange`` closes that half with AppKit's own begin/end editing
/// notifications, which are a statement of fact rather than an inference.
///
/// Reaching for `window?.makeFirstResponder` instead would have been the third
/// option and is deliberately not taken: `NSView.window` is `unowned(unsafe)`,
/// so under this package's `.strictMemorySafety()` it has to be spelled `unsafe`
/// — and the house rule set by `TaskNotesServerProcess.reserveEphemeralPort` is
/// that `unsafe` is for where no safe API exists. Here one does.
struct TokenEntryField: NSViewRepresentable {
    /// What the field should be showing.
    let text: String

    /// The placeholder, drawn while the field is empty.
    ///
    /// A real `placeholderString`, unlike the previous `NSTokenField`, whose cell
    /// painted its placeholder in the control colour and read as a token actually
    /// named "Add project…".
    let prompt: String

    /// The field's new contents after any edit — typing, pasting, or dictation.
    let onChange: (String) -> Void

    /// A key the token field claims. The result is whether it was handled, which
    /// is exactly what `doCommandBy` has to return.
    let onKey: (TokenFieldKey) -> Bool

    /// Whether the field is the first responder, as AppKit reports it.
    let onEditingChange: (Bool) -> Void

    func makeNSView(context: Context) -> NSTextField {
        let field = NSTextField(string: text)
        field.placeholderString = prompt
        field.delegate = context.coordinator

        // Borderless: the token area around it draws the affordance and the
        // focus ring, so a bezel here would be a box inside a box — and a ring
        // around the caret rather than around the control would say the wrong
        // thing about what has focus.
        field.isBordered = false
        field.drawsBackground = false
        field.focusRingType = .none
        // `.callout`, matching the tokens beside it rather than the form body.
        // What you type here becomes a token, and at the body size the caret text
        // and the placeholder both came out visibly larger than the capsules they
        // sit next to — so committing a name appeared to shrink it.
        field.font = .preferredFont(forTextStyle: .callout)

        // One line, panning rather than wrapping. A token name that outgrows the
        // remainder of its row scrolls under the caret; the alternative is a
        // field that changes height while you type in it.
        field.usesSingleLineMode = true
        field.lineBreakMode = .byTruncatingTail
        field.maximumNumberOfLines = 1
        field.cell?.wraps = false
        field.cell?.isScrollable = true

        // Return is handled in `doCommandBy` and nowhere else. Wiring an action
        // as well would fire the same commit twice for one key press.
        field.cell?.sendsActionOnEndEditing = false

        // A tag is a project name, a jargon word, or an abbreviation. Underlining
        // every one of them in red would make the control look broken, and
        // correcting them would corrupt the vault.
        field.isAutomaticTextCompletionEnabled = false
        return field
    }

    func updateNSView(_ field: NSTextField, context: Context) {
        context.coordinator.parent = self
        // Guarded for the usual reason: assigning `stringValue` unconditionally
        // resets the insertion point, so typing into the middle of a name would
        // throw the caret to the end after every character.
        if field.stringValue != text {
            field.stringValue = text
        }
        field.placeholderString = prompt
    }

    /// One line tall, and as wide as the flow layout is offering.
    ///
    /// Without this the representable reports `intrinsicContentSize`, which for
    /// an unbordered field is the width of its current contents — zero when
    /// empty. An empty token field would then have no clickable text area at all,
    /// which is the state it spends most of its life in.
    func sizeThatFits(
        _ proposal: ProposedViewSize,
        nsView: NSTextField,
        context: Context
    ) -> CGSize? {
        guard let width = proposal.width, width > 0, width < .infinity else { return nil }
        return CGSize(width: width, height: lineHeight(of: nsView))
    }

    /// One line's worth of height.
    ///
    /// `noIntrinsicMetric` is `-1` and an unbordered field can genuinely report
    /// it, so this is a real branch rather than a defensive one.
    private func lineHeight(of field: NSTextField) -> CGFloat {
        let intrinsic = field.intrinsicContentSize.height
        guard intrinsic != NSView.noIntrinsicMetric, intrinsic > 0 else {
            return field.font?.boundingRectForFont.height ?? 16
        }
        return intrinsic
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(parent: self)
    }

    @MainActor
    final class Coordinator: NSObject, NSTextFieldDelegate {
        var parent: TokenEntryField

        init(parent: TokenEntryField) {
            self.parent = parent
        }

        func controlTextDidChange(_ notification: Notification) {
            guard let field = notification.object as? NSTextField else { return }
            parent.onChange(field.stringValue)
        }

        func controlTextDidBeginEditing(_ notification: Notification) {
            parent.onEditingChange(true)
        }

        func controlTextDidEndEditing(_ notification: Notification) {
            parent.onEditingChange(false)
        }

        /// The six keys the token field owns.
        ///
        /// `if`/`else` rather than a `switch`: a `Selector` is not a closed set,
        /// so the only spelling of "anything else" would be `default:`, which
        /// this package bans — and here it would be absorbing every editing
        /// command AppKit has.
        ///
        /// Returning `false` is not a fallthrough failure; it is the field editor
        /// keeping its normal behaviour, which is what ought to happen for ↑ with
        /// nothing highlighted (move to the start of the line) or for Escape in
        /// an empty field (dismiss whatever contains it).
        func control(
            _ control: NSControl,
            textView: NSTextView,
            doCommandBy selector: Selector
        ) -> Bool {
            if selector == #selector(NSResponder.moveUp(_:)) {
                return parent.onKey(.moveUp)
            }
            if selector == #selector(NSResponder.moveDown(_:)) {
                return parent.onKey(.moveDown)
            }
            if selector == #selector(NSResponder.insertNewline(_:)) {
                return parent.onKey(.commit)
            }
            if selector == #selector(NSResponder.cancelOperation(_:)) {
                return parent.onKey(.cancel)
            }
            if selector == #selector(NSResponder.deleteBackward(_:)), atStart(textView) {
                return parent.onKey(.deleteBackwardAtStart)
            }
            if selector == #selector(NSResponder.moveLeft(_:)), atEmptyStart(textView) {
                return parent.onKey(.moveLeftAtStart)
            }
            return false
        }

        /// Whether the insertion point is at offset zero with nothing selected.
        ///
        /// The length check is load-bearing rather than pedantic: a selection
        /// anchored at zero is a range the user asked to *delete*, and treating
        /// that Backspace as "remove the preceding token" would throw away both
        /// the selected text and a token nobody was pointing at.
        private func atStart(_ textView: NSTextView) -> Bool {
            let selection = textView.selectedRange()
            return selection.location == 0 && selection.length == 0
        }

        /// Whether the insertion point is at the start of an **empty** field.
        ///
        /// The stricter of the two conditions, and only ← uses it. Leaving the
        /// field commits what is typed, so `urg` becoming a tag because somebody
        /// pressed ← would be a write nobody asked for — whereas Backspace at the
        /// start of `urg` genuinely has nothing else it could mean.
        private func atEmptyStart(_ textView: NSTextView) -> Bool {
            atStart(textView) && textView.string.isEmpty
        }
    }
}
