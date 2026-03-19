import SwiftUI

/// Detail view showing unresolved Bugsink issues.
struct BugsinkDetailView: View {
    // MARK: Internal

    let issues: [BugsinkIssue]

    var body: some View {
        if self.issues.isEmpty {
            Label("No unresolved issues", systemImage: "checkmark.seal.fill")
                .foregroundStyle(.green)
                .font(.headline)
        } else {
            Table(self.sortedIssues, sortOrder: self.$issueSortOrder) {
                TableColumn("Title", value: \.title) { issue in
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
            .alternatingRowBackgrounds()
            .frame(minHeight: 300)
            .contextMenu(forSelectionType: BugsinkIssue.ID.self) { _ in } primaryAction: { ids in
                if let issueID = ids.first {
                    self.selectedIssue = self.sortedIssues.first { $0.id == issueID }
                }
            }
            .sheet(item: self.$selectedIssue) { issue in
                self.issueDetailSheet(issue)
            }
        }
    }

    // MARK: Private

    @State private var issueSortOrder = [KeyPathComparator(\BugsinkIssue.title)]
    @State private var selectedIssue: BugsinkIssue?

    private var sortedIssues: [BugsinkIssue] {
        self.issues.sorted(using: self.issueSortOrder)
    }

    // MARK: - Issue Detail Sheet

    private func issueDetailSheet(_ issue: BugsinkIssue) -> some View {
        VStack(spacing: 0) {
            HStack {
                Text("Issue Details")
                    .font(.headline)
                Spacer()
                Button("Done") {
                    self.selectedIssue = nil
                }
                .keyboardShortcut(.cancelAction)
            }
            .padding()

            Divider()

            Form {
                LabeledContent("Title", value: issue.title)
                LabeledContent("Project", value: issue.project ?? "-")
                LabeledContent("Event Count", value: "\(issue.eventCount ?? 0)")
                LabeledContent("Status", value: issue.status ?? "-")
            }
            .formStyle(.grouped)
        }
        .frame(width: 450, height: 260)
    }
}
