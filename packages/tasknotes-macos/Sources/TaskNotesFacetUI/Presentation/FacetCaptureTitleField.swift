#if os(iOS)
    import SwiftUI
    import TaskNotesKit
    import UIKit

    /// Use the field editor's own character positions so taps also work with RTL and emoji.
    internal struct FacetCaptureTitleField: UIViewRepresentable {
        @Binding var text: String
        let tokens: [FacetCaptureToken]
        let focusRequest: Int
        let makeLiteral: (FacetCaptureToken) -> Void
        let submit: () -> Void

        func makeCoordinator() -> Coordinator { Coordinator(self) }

        func makeUIView(context: Context) -> UITextField {
            let field = UITextField()
            field.placeholder = "Task name"
            field.returnKeyType = .done
            field.autocorrectionType = .no
            field.tintColor = UIColor(FacetNativeStyle.brand)
            field.font = .preferredFont(forTextStyle: .title3)
            field.adjustsFontForContentSizeCategory = true
            field.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
            field.delegate = context.coordinator
            field.accessibilityIdentifier = AccessibilityIdentifier.QuickAdd.field
            field.addTarget(
                context.coordinator, action: #selector(Coordinator.changed(_:)),
                for: .editingChanged)
            let tap = UITapGestureRecognizer(
                target: context.coordinator, action: #selector(Coordinator.tapped(_:)))
            tap.cancelsTouchesInView = false
            tap.delegate = context.coordinator
            field.addGestureRecognizer(tap)
            return field
        }

        func updateUIView(_ field: UITextField, context: Context) {
            let coordinator = context.coordinator
            coordinator.parent = self
            if coordinator.focusRequest != focusRequest {
                coordinator.focusRequest = focusRequest
                if text.isEmpty {
                    field.text = ""
                    coordinator.styledTokens = []
                }
                _Concurrency.Task { @MainActor [weak field] in field?.becomeFirstResponder() }
            }
            guard field.markedTextRange == nil, field.text == text,
                coordinator.styledTokens != tokens
            else { return }
            coordinator.styledTokens = tokens
            let base: [NSAttributedString.Key: Any] = [
                .font: UIFont.preferredFont(forTextStyle: .title3), .foregroundColor: UIColor.label,
            ]
            let styled = NSMutableAttributedString(string: text, attributes: base)
            for token in tokens {
                styled.addAttributes(
                    [
                        .foregroundColor: field.tintColor ?? UIColor.systemIndigo,
                        .backgroundColor: (field.tintColor ?? UIColor.systemIndigo)
                            .withAlphaComponent(0.12),
                    ], range: token.range)
            }
            guard field.attributedText != styled else { return }
            let selection = field.selectedTextRange.map {
                (
                    field.offset(from: field.beginningOfDocument, to: $0.start),
                    field.offset(from: field.beginningOfDocument, to: $0.end)
                )
            }
            field.attributedText = styled
            field.typingAttributes = base
            if let selection,
                let start = field.position(
                    from: field.beginningOfDocument, offset: min(selection.0, styled.length)),
                let end = field.position(
                    from: field.beginningOfDocument, offset: min(selection.1, styled.length))
            {
                field.selectedTextRange = field.textRange(from: start, to: end)
            }
        }

        @MainActor
        final class Coordinator: NSObject, UITextFieldDelegate, UIGestureRecognizerDelegate {
            var parent: FacetCaptureTitleField
            var focusRequest: Int?
            var styledTokens: [FacetCaptureToken] = []
            init(_ parent: FacetCaptureTitleField) { self.parent = parent }

            @objc func changed(_ field: UITextField) { parent.text = field.text ?? "" }
            func textFieldShouldReturn(_ textField: UITextField) -> Bool {
                parent.submit()
                return false
            }
            func gestureRecognizer(
                _ gestureRecognizer: UIGestureRecognizer,
                shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer
            ) -> Bool { true }
            @objc func tapped(_ gesture: UITapGestureRecognizer) {
                guard let field = gesture.view as? UITextField,
                    let range = field.characterRange(at: gesture.location(in: field))
                else { return }
                let offset = field.offset(from: field.beginningOfDocument, to: range.start)
                if let token = parent.tokens.first(where: { NSLocationInRange(offset, $0.range) }) {
                    parent.makeLiteral(token)
                }
            }
        }
    }
#elseif os(macOS)
    import AppKit
    import SwiftUI
    import TaskNotesKit

    internal struct FacetCaptureTitleField: NSViewRepresentable {
        @Binding var text: String
        let tokens: [FacetCaptureToken]
        let focusRequest: Int
        let makeLiteral: (FacetCaptureToken) -> Void
        let submit: () -> Void

        func makeCoordinator() -> Coordinator { Coordinator(self) }

        func makeNSView(context: Context) -> NSTextField {
            let field = NSTextField()
            field.placeholderString = "Task name"
            field.font = .preferredFont(forTextStyle: .title3)
            field.isBordered = false
            field.drawsBackground = false
            field.focusRingType = .none
            field.delegate = context.coordinator
            field.setAccessibilityIdentifier(AccessibilityIdentifier.QuickAdd.field)
            field.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
            return field
        }

        func updateNSView(_ field: NSTextField, context: Context) {
            let coordinator = context.coordinator
            coordinator.parent = self
            if coordinator.focusRequest != focusRequest {
                coordinator.focusRequest = focusRequest
                _Concurrency.Task { @MainActor [weak field] in
                    // AppKit owns the window of this main-thread attached control.
                    if let field { _ = unsafe field.window?.makeFirstResponder(field) }
                }
            }
            if field.stringValue != text { field.stringValue = text }
            if let editor = field.currentEditor() as? NSTextView {
                coordinator.highlight(in: editor)
            }
        }

        @MainActor
        final class Coordinator: NSObject, NSTextFieldDelegate {
            var parent: FacetCaptureTitleField
            var focusRequest: Int?
            private weak var activeEditor: NSTextView?
            private lazy var click = NSClickGestureRecognizer(
                target: self, action: #selector(clicked(_:)))

            init(_ parent: FacetCaptureTitleField) { self.parent = parent }

            func controlTextDidBeginEditing(_ notification: Notification) {
                guard let field = notification.object as? NSTextField,
                    let editor = field.currentEditor() as? NSTextView
                else { return }
                activeEditor = editor
                click.delaysPrimaryMouseButtonEvents = false
                editor.addGestureRecognizer(click)
                highlight(in: editor)
            }
            func controlTextDidChange(_ notification: Notification) {
                if let field = notification.object as? NSTextField {
                    parent.text = field.stringValue
                }
            }
            func controlTextDidEndEditing(_ notification: Notification) {
                if let editor = activeEditor {
                    editor.removeGestureRecognizer(click)
                    let range = NSRange(location: 0, length: editor.string.utf16.count)
                    // The field editor owns its text system throughout this synchronous callback.
                    unsafe editor.layoutManager?.removeTemporaryAttribute(
                        .backgroundColor, forCharacterRange: range)
                }
                activeEditor = nil
            }
            func control(
                _ control: NSControl, textView: NSTextView, doCommandBy commandSelector: Selector
            ) -> Bool {
                guard commandSelector == #selector(NSResponder.insertNewline(_:)) else {
                    return false
                }
                parent.submit()
                return true
            }
            func highlight(in editor: NSTextView) {
                guard !editor.hasMarkedText(), editor.string == parent.text,
                    let layout = unsafe editor.layoutManager
                else { return }
                let entire = NSRange(location: 0, length: editor.string.utf16.count)
                layout.removeTemporaryAttribute(.backgroundColor, forCharacterRange: entire)
                for token in parent.tokens {
                    layout.addTemporaryAttribute(
                        .backgroundColor,
                        value: NSColor(FacetNativeStyle.brand).withAlphaComponent(0.16),
                        forCharacterRange: token.range)
                }
            }
            @objc private func clicked(_ gesture: NSClickGestureRecognizer) {
                guard let editor = activeEditor else { return }
                let offset = editor.characterIndexForInsertion(at: gesture.location(in: editor))
                if let token = parent.tokens.first(where: { NSLocationInRange(offset, $0.range) }) {
                    parent.makeLiteral(token)
                }
            }
        }
    }
#endif
