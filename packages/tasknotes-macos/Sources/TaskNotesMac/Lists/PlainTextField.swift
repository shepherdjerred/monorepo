internal import AppKit
internal import SwiftUI

/// A text field backed by a real `NSTextField`, single-line or wrapping.
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
///
/// ## Two shapes, one control
///
/// The compose row wants a single line that truncates: it is one row in a list
/// of rows, and a compose field that grew as you typed would push the list
/// down under the caret. An inspector's title field wants the opposite — it is
/// the *subject* of the pane, and truncating it to
/// `Reply to the landlord about the boiler inspec…` hides the thing the reader
/// opened the inspector to see, with no gesture that reveals the rest.
///
/// That is one property, not two controls, so it is ``wraps``. Everything else
/// — the spell-checked field editor, Return-submits-without-dismissing, Escape,
/// the borderless presentation — is shared, and a second wrapper would have had
/// to reproduce all of it.
struct PlainTextField: NSViewRepresentable {
    @Binding var text: String

    /// The placeholder shown while empty.
    let prompt: String

    /// Return.
    let onSubmit: () -> Void

    /// Escape.
    let onCancel: () -> Void

    /// Whether the field wraps onto as many lines as its content needs.
    ///
    /// `false` — the default, and what the compose row wants — is one line
    /// truncated at the tail. `true` reports its wrapped height back to SwiftUI
    /// through ``sizeThatFits(_:nsView:context:)``, without which SwiftUI sizes
    /// the representable to `intrinsicContentSize` and clips it to one line:
    /// the text wraps and nobody sees it, which looks exactly like not wrapping
    /// at all.
    ///
    /// ⚠️ **Return still submits when this is on.** A wrapping `NSTextField`
    /// hands `insertNewline(_:)` to the field editor, which would put a literal
    /// newline into a task title — a value the wire layer carries but no list
    /// row can render. The intercept below is what keeps "wraps" meaning *the
    /// display wraps*, not *this is a multi-line editor*. Task details, which
    /// genuinely are multi-line, are an `NSTextView` elsewhere.
    var wraps: Bool = false

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
        field.cell?.sendsActionOnEndEditing = false
        apply(wrapping: field)
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
        apply(wrapping: field)
        context.coordinator.parent = self
    }

    /// The height the text actually needs at the width SwiftUI is offering.
    ///
    /// `nil` for the single-line case, which means "use the intrinsic size" and
    /// is exactly right there. For the wrapping case the cell is asked to
    /// measure itself against the proposed width — the same measurement AppKit
    /// uses to draw it, so the reported height and the drawn height cannot
    /// disagree.
    ///
    /// The `width` guards matter: SwiftUI proposes `nil` and `.infinity` during
    /// its sizing passes, and measuring a wrapping cell against an unbounded
    /// width answers "one very long line", which would collapse the field to a
    /// single row exactly when it is being asked how tall it wants to be.
    func sizeThatFits(
        _ proposal: ProposedViewSize,
        nsView: NSTextField,
        context: Context
    ) -> CGSize? {
        guard wraps, let cell = nsView.cell else { return nil }
        guard let width = proposal.width, width > 0, width < .infinity else { return nil }
        let measured = cell.cellSize(
            forBounds: CGRect(x: 0, y: 0, width: width, height: .greatestFiniteMagnitude))
        return CGSize(width: width, height: max(measured.height, oneLineHeight(of: nsView)))
    }

    /// Match the field's presentation to ``wraps``.
    ///
    /// Applied on every update rather than only at construction, because
    /// `wraps` is a property of the view value and a caller is free to change
    /// it — a field that silently kept its first shape would be a state SwiftUI
    /// has no way to correct.
    private func apply(wrapping field: NSTextField) {
        field.usesSingleLineMode = !wraps
        field.lineBreakMode = wraps ? .byWordWrapping : .byTruncatingTail
        field.maximumNumberOfLines = wraps ? 0 : 1
        field.cell?.wraps = wraps
        // Scrolling and wrapping are mutually exclusive on `NSTextFieldCell`:
        // a scrollable cell keeps its content on one line and pans it, which is
        // the single-line behaviour and the opposite of what wrapping asks for.
        field.cell?.isScrollable = !wraps
    }

    /// One line's worth of height, so an empty wrapping field is still a field.
    ///
    /// A cell measuring an empty string can answer a height of zero, which
    /// would leave the placeholder with nowhere to draw and the caret with
    /// nothing to sit in.
    private func oneLineHeight(of field: NSTextField) -> CGFloat {
        let intrinsic = field.intrinsicContentSize.height
        // `noIntrinsicMetric` is `-1`, so this is a real check and not a
        // defensive one: an unbordered field can genuinely report it.
        guard intrinsic != NSView.noIntrinsicMetric else {
            return field.font?.boundingRectForFont.height ?? 0
        }
        return intrinsic
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

        /// Escape and, when the field wraps, Return — routed through the
        /// responder chain rather than as key equivalents.
        ///
        /// `cancelOperation(_:)` is what the field editor sends for Escape *and*
        /// for ⌘. — so handling the one selector covers both spellings of
        /// "never mind" without either being hard-coded to a key.
        ///
        /// `insertNewline(_:)` is only intercepted for a wrapping field, and the
        /// asymmetry is deliberate. A single-line field already turns Return
        /// into its `action`, so handling it here as well would either
        /// double-submit or move a working path for no reason. A wrapping field
        /// does not: the editor would insert a line break into the value, so
        /// this is the only place Return can be made to mean submit.
        func control(
            _ control: NSControl,
            textView: NSTextView,
            doCommandBy selector: Selector
        ) -> Bool {
            // `if`/`else` rather than a `switch`: a `Selector` is not a closed
            // set, so the only spelling of "anything else" is `default:`, which
            // this package bans for silently absorbing enum cases. Here it would
            // be absorbing every AppKit editing command there is.
            if selector == #selector(NSResponder.cancelOperation(_:)) {
                parent.onCancel()
                return true
            }
            if parent.wraps, selector == #selector(NSResponder.insertNewline(_:)) {
                parent.text = control.stringValue
                parent.onSubmit()
                return true
            }
            return false
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
