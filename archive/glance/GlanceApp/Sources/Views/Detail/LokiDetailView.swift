import SwiftUI

/// Detail view showing recent Loki log entries.
struct LokiDetailView: View {
    let entries: [LokiLogEntry]

    var body: some View {
        if self.entries.isEmpty {
            Label("No recent error logs", systemImage: "checkmark.seal.fill")
                .foregroundStyle(.green)
                .font(.headline)
        } else {
            VStack(alignment: .leading, spacing: 8) {
                ForEach(self.entries) { entry in
                    VStack(alignment: .leading, spacing: 2) {
                        HStack {
                            Text(entry.timestamp)
                                .font(.caption.monospaced())
                                .foregroundStyle(.secondary)
                            if let namespace = entry.labels["namespace"] {
                                Text(namespace)
                                    .font(.caption2)
                                    .padding(.horizontal, 4)
                                    .padding(.vertical, 1)
                                    .background(.quaternary, in: RoundedRectangle(cornerRadius: 3))
                            }
                        }
                        Text(entry.message)
                            .font(.caption.monospaced())
                            .lineLimit(3)
                    }
                    Divider()
                }
            }
        }
    }
}
