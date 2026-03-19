import SwiftUI

/// A single cell in the menu bar popover grid showing a service's status.
struct ServiceGridItem: View {
    let snapshot: ServiceSnapshot

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: self.snapshot.iconName)
                .font(.body)
                .foregroundStyle(.secondary)
                .frame(width: 20)

            VStack(alignment: .leading, spacing: 1) {
                Text(verbatim: self.snapshot.displayName)
                    .font(.caption.bold())
                    .lineLimit(1)

                Text(verbatim: self.snapshot.summary)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }

            Spacer()

            StatusBadge(status: self.snapshot.status)
        }
        .padding(.vertical, 4)
        .padding(.horizontal, 8)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(self.snapshot.displayName), \(self.snapshot.status.label)")
        .accessibilityValue(self.snapshot.summary)
        .accessibilityHint(String(localized: "Double-tap to open dashboard"))
    }
}
