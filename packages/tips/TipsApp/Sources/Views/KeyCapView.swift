import SwiftUI

/// Renders a keyboard shortcut as styled key caps.
struct KeyCapView: View {
    let shortcut: String

    var body: some View {
        Text(self.shortcut)
            .font(.system(.caption, design: .monospaced, weight: .medium))
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(.quaternary, in: RoundedRectangle(cornerRadius: 4))
            .foregroundStyle(.secondary)
    }
}
