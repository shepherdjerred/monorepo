import SwiftUI

/// Detail view showing unresolved Bugsink issues.
struct BugsinkDetailView: View {
    let issues: [BugsinkIssue]

    var body: some View {
        if self.issues.isEmpty {
            Label("No unresolved issues", systemImage: "checkmark.seal.fill")
                .foregroundStyle(.green)
                .font(.headline)
        } else {
            Table(self.issues) {
                TableColumn("Title") { issue in
                    Text(issue.title)
                        .fontWeight(.medium)
                        .lineLimit(2)
                }
                TableColumn("Project") { issue in
                    Text(issue.project ?? "-")
                        .foregroundStyle(.secondary)
                }
                .width(120)
                TableColumn("Events") { issue in
                    Text("\(issue.eventCount ?? 0)")
                        .monospacedDigit()
                }
                .width(60)
            }
            .frame(minHeight: 300)
        }
    }
}
