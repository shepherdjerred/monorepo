import SwiftUI

/// Renders a keyboard shortcut as styled key caps.
struct KeyCapView: View {
    // MARK: Internal

    let shortcut: String

    var body: some View {
        Text(self.shortcut)
            .font(.system(.caption, design: .monospaced, weight: .medium))
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(.quaternary, in: RoundedRectangle(cornerRadius: 4))
            .foregroundStyle(.secondary)
            .accessibilityLabel(self.spokenShortcut)
    }

    // MARK: Private

    private var spokenShortcut: String {
        self.shortcut
            .replacingOccurrences(of: "⌘", with: "Command ")
            .replacingOccurrences(of: "⌥", with: "Option ")
            .replacingOccurrences(of: "⇧", with: "Shift ")
            .replacingOccurrences(of: "⌃", with: "Control ")
            .replacingOccurrences(of: "⌫", with: "Delete ")
            .replacingOccurrences(of: "⇥", with: "Tab ")
            .replacingOccurrences(of: "⎋", with: "Escape ")
            .replacingOccurrences(of: "↩", with: "Return ")
            .trimmingCharacters(in: .whitespaces)
    }
}
