internal import AppKit
internal import SwiftUI

/// The toolbar's search field, backed by a real `NSSearchField`.
///
/// ## Search is a field on this screen, not a screen of its own
///
/// The React Native app pushes a whole `SearchScreen` with its own task list,
/// because a phone has one column and no room for a field beside a title. A Mac
/// window has a toolbar, and every Mac application answers `⌘F` by putting the
/// caret in it. So search here **narrows the list you are already looking at**,
/// on all four screens, and the results keep every affordance the list already
/// has — selection, the context menu, the keyboard. The pushed screen is one of
/// the touch-to-desktop translations the plan calls for, and it is deleted
/// rather than ported.
///
/// ## Why not `.searchable`
///
/// `.searchable` produces this control and is one line. What it does not
/// produce is an `accessibilityIdentifier`: the field is created inside
/// SwiftUI's toolbar and there is no modifier that reaches it. "Namespaced
/// `accessibilityIdentifier` on every interactive element, defined in a module
/// shared with the UI test target" is in the definition of done, and a search
/// field a UI test can only locate by its placeholder string is exactly the
/// silent-drift failure that requirement exists to prevent.
///
/// Being an `NSSearchField` also brings the things it owns: the magnifier and
/// cancel affordances, `NSSearchField`'s recents behaviour, the field editor's
/// emacs bindings and Services menu, and Escape meaning "clear". None of them
/// are re-implemented here, and none of them should be. This follows exactly the
/// precedent ``PlainTextField`` set for the compose row.
struct SearchField: NSViewRepresentable {
    @Binding var text: String

    /// The placeholder shown while empty.
    let prompt: String

    func makeNSView(context: Context) -> NSSearchField {
        let field = NSSearchField(string: text)
        field.placeholderString = prompt
        field.delegate = context.coordinator
        field.sendsWholeSearchString = false
        // Live narrowing: the list is already in memory and the predicate is a
        // substring test, so there is nothing to debounce against. The React
        // Native screen debounces 300ms because each keystroke could re-render
        // a `FlatList` on a phone; here it would only add lag between typing
        // and seeing.
        field.sendsSearchStringImmediately = true
        return field
    }

    func updateNSView(_ field: NSSearchField, context: Context) {
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
    final class Coordinator: NSObject, NSSearchFieldDelegate {
        var parent: SearchField

        init(parent: SearchField) {
            self.parent = parent
        }

        func controlTextDidChange(_ notification: Notification) {
            guard let field = notification.object as? NSSearchField else { return }
            parent.text = field.stringValue
        }

        /// Escape clears the field rather than dismissing anything.
        ///
        /// `cancelOperation(_:)` is what the field editor sends for Escape *and*
        /// for ⌘. — so handling the one selector covers both spellings without
        /// either being hard-coded to a key. Returning `false` would let the
        /// responder chain carry Escape up to the window, where it means
        /// something else entirely.
        func control(
            _ control: NSControl,
            textView: NSTextView,
            doCommandBy selector: Selector
        ) -> Bool {
            guard selector == #selector(NSResponder.cancelOperation(_:)) else { return false }
            parent.text = ""
            control.stringValue = ""
            return true
        }
    }
}
