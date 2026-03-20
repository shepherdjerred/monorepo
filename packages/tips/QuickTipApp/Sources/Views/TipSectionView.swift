import SwiftUI

// MARK: - TipSectionView

/// Renders a section of tips with its heading and items.
struct TipSectionView: View {
    let section: TipSection

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(self.section.heading)
                .font(.headline)
                .foregroundStyle(.primary)

            ForEach(self.section.items) { item in
                TipItemRow(item: item)
            }
        }
    }
}

// MARK: - TipItemRow

/// A single tip item row, with optional keyboard shortcut.
struct TipItemRow: View {
    let item: TipItem

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            if let shortcut = item.shortcut {
                KeyCapView(shortcut: shortcut)
                Text(self.item.text)
                    .font(.body)
                    .foregroundStyle(.primary)
            } else {
                Image(systemName: "circle.fill")
                    .font(.system(size: 4))
                    .foregroundStyle(.tertiary)
                    .padding(.top, 6)
                    .accessibilityHidden(true)
                Text(self.item.text)
                    .font(.body)
                    .foregroundStyle(.primary)
            }
            Spacer()
        }
        .accessibilityElement(children: .combine)
        .draggable(self.item.formattedText)
    }
}

extension TipItem {
    /// Formatted text suitable for copying or dragging.
    var formattedText: String {
        if let shortcut {
            "\(shortcut) — \(text)"
        } else {
            text
        }
    }
}
