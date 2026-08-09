internal import AppKit
internal import SwiftUI

/// A list of names — projects, contexts, tags — as a real `NSTokenField`.
///
/// ## Why a token field and not a row of chips
///
/// The React Native form shows every project in the vault as a scrolling
/// multi-select, because a phone has no better way to pick from a list you
/// cannot type into. On a Mac you can type, and `NSTokenField` is the control
/// the platform already has for "a set of short names, some of which exist
/// already": completion from the vault's own vocabulary, comma to tokenise,
/// backspace to remove, and — because it is an `NSTextField` underneath, editing
/// through the window's shared field editor — ⌃A/⌃E/⌃K/⌃Y, spellcheck, Services
/// and text drag-and-drop, which are definition-of-done items.
///
/// A hand-drawn row of SwiftUI capsules would lose every one of those silently,
/// and would also have to reinvent "type a name that does not exist yet", which
/// is the interaction the form is mostly for.
///
/// ## Represented objects are the **stored** spellings
///
/// A project lives in frontmatter as either a wikilink
/// (`[[Projects/Website|the site]]`) or a bare name. The token *displays* the
/// core's `projectDisplayName`, but the value carried in and out is the stored
/// string. Round-tripping the display name instead would rewrite every wikilink
/// in the vault into a bare name the first time anybody opened the inspector —
/// invisible in the app, plainly visible in `git diff`, and vaults are commonly
/// in git.
///
/// ## There is no placeholder here, and that is deliberate
///
/// `NSTokenFieldCell` draws its placeholder in the **control** colour rather
/// than in `placeholderTextColor`, and setting `placeholderAttributedString`
/// with an explicit foreground does not change that — measured, not assumed:
/// "Add project…" rendered as full-strength body text in both appearances and
/// read as a project genuinely named that. ``TokenListRow`` draws the prompt in
/// SwiftUI instead, where the semantic colour is reachable.
/// ## 🔴 There is no inline completion, and that is a reported lint conflict
///
/// `NSTokenField` offers completions through exactly one delegate method,
/// `tokenField(_:completionsForSubstring:indexOfToken:indexOfSelectedItem:)`,
/// whose Objective-C return type is `nullable NSArray *` and therefore imports
/// as `[Any]?` — an **optional collection**, which this package's
/// `discouraged_optional_collection` rule rejects and which it forbids
/// suppressing.
///
/// Three ways out were tried and only one works. Returning `[Any]` does not
/// compile ("different optionality than expected by protocol"). Exporting the
/// selector under a different Swift name does not compile either, because a
/// class that declares the conformance cannot provide a conflicting selector.
/// So the choice is a permanently red lint gate or a different affordance, and
/// the vocabulary is instead offered by the ▾ menu ``TokenListRow`` puts beside
/// this field — which is arguably *closer* to the React Native form, since that
/// shows the available names as a list rather than as type-ahead.
///
/// The rule is not wrong on the merits — `nil` and `[]` both mean "offer
/// nothing" there, so the optionality carries no information — it is simply
/// unsatisfiable against an AppKit signature. Reported rather than worked
/// around: the fix is either a per-declaration exemption in SwiftLint or an
/// Apple nullability annotation, and neither is ours.
struct TokenListField: NSViewRepresentable {
    /// The current values, as stored.
    let tokens: [String]

    /// How a stored value is shown.
    let display: (String) -> String

    /// Called with the new list when the field commits.
    let onCommit: ([String]) -> Void

    func makeNSView(context: Context) -> NSTokenField {
        let field = NSTokenField()
        field.delegate = context.coordinator
        field.target = context.coordinator
        field.action = #selector(Coordinator.commit(_:))
        field.objectValue = tokens

        // Comma tokenises, which is what everyone tries first. Return also does,
        // via the field's action.
        field.tokenStyle = .rounded
        field.tokenizingCharacterSet = CharacterSet(charactersIn: ",")

        // A form field rather than a compose row: the token background is the
        // affordance, and a bezel around a row of tokens reads as a box in a box.
        field.isBordered = false
        field.drawsBackground = false
        field.focusRingType = .default
        field.font = .preferredFont(forTextStyle: .body)

        // ⚠️ Wrapping is not cosmetic. A single-line token field clips to
        // whatever fits, and an inspector column is ~340 points wide — so a task
        // with two projects showed one and silently hid the other. A field that
        // lies about a task's data is worse than one that is taller.
        field.usesSingleLineMode = false
        field.maximumNumberOfLines = 0
        field.lineBreakMode = .byWordWrapping
        field.cell?.wraps = true
        field.cell?.isScrollable = false

        // Editing must not end just because focus moved — `commit` is called
        // explicitly from `controlTextDidEndEditing`, and having both fire would
        // dispatch the same update twice.
        field.cell?.sendsActionOnEndEditing = false
        return field
    }

    func updateNSView(_ field: NSTokenField, context: Context) {
        context.coordinator.parent = self
        // Guarded for the same reason a text field's `stringValue` is: assigning
        // unconditionally would drop the half-typed token on every redraw.
        if context.coordinator.currentTokens(of: field)?.values != tokens {
            field.objectValue = tokens
        }
    }

    /// How tall the field needs to be at the width SwiftUI is offering.
    ///
    /// Without this an `NSViewRepresentable` reports whatever AppKit's
    /// `intrinsicContentSize` says, which for a wrapping token field is one
    /// line's worth — so the field wraps internally and then gets clipped to a
    /// single row, which looks exactly like not wrapping at all.
    ///
    /// `nil` for an unconstrained proposal, which is SwiftUI's "answer with your
    /// natural size" and is the honest response when there is no width to wrap
    /// against yet.
    func sizeThatFits(
        _ proposal: ProposedViewSize,
        nsView: NSTokenField,
        context: Context
    ) -> CGSize? {
        guard let width = proposal.width, width > 0 else { return nil }
        nsView.preferredMaxLayoutWidth = width
        return CGSize(width: width, height: max(nsView.fittingSize.height, 20))
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(parent: self)
    }

    @MainActor
    final class Coordinator: NSObject, NSTokenFieldDelegate {
        var parent: TokenListField

        init(parent: TokenListField) {
            self.parent = parent
        }

        /// The field's value as strings.
        ///
        /// `objectValue` is `Any?` because a token field can carry arbitrary
        /// represented objects. Ours are always strings, and `as?` is the
        /// runtime check that says so — not an assertion, a validation.
        ///
        /// ⚠️ The result is wrapped rather than returned as `[String]?`, and the
        /// distinction is real rather than lint-driven: **an unreadable field
        /// and an empty field mean opposite things.** Committing `[]` clears the
        /// task's projects, so a `nil` that a caller might casually
        /// `?? []` would delete data. A `TokenFieldReading?` cannot be defaulted by
        /// accident, and `discouraged_optional_collection` is pointing at
        /// exactly that hazard rather than at a style preference.
        fileprivate func currentTokens(of field: NSTokenField) -> TokenFieldReading? {
            guard let values = field.objectValue as? [String] else { return nil }
            return TokenFieldReading(values: values)
        }

        @objc func commit(_ sender: NSTokenField) {
            guard let reading = currentTokens(of: sender) else { return }
            guard reading.values != parent.tokens else { return }
            parent.onCommit(reading.values)
        }

        func controlTextDidEndEditing(_ notification: Notification) {
            guard let field = notification.object as? NSTokenField else { return }
            commit(field)
        }

        func tokenField(
            _ tokenField: NSTokenField,
            displayStringForRepresentedObject representedObject: Any
        ) -> String? {
            guard let value = representedObject as? String else { return nil }
            return parent.display(value)
        }
    }
}

/// A token field's value, successfully read.
///
/// At file scope rather than nested inside the coordinator, which would be three
/// levels deep — and `nesting` is right about that being hard to name at a call
/// site.
private struct TokenFieldReading {
    let values: [String]
}
