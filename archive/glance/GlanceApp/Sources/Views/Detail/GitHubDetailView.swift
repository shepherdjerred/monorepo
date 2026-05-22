import SwiftUI

/// Detail view showing open GitHub pull requests.
struct GitHubDetailView: View {
    // MARK: Internal

    let pullRequests: [GitHubPullRequest]

    var body: some View {
        if self.pullRequests.isEmpty {
            Label("No open pull requests", systemImage: "checkmark.seal.fill")
                .foregroundStyle(.green)
                .font(.headline)
        } else {
            Table(self.sortedPullRequests, sortOrder: self.$prSortOrder) {
                TableColumn("PR", value: \.number) { pr in
                    Text("#\(pr.number)")
                        .monospacedDigit()
                        .foregroundStyle(.secondary)
                }
                .width(50)
                TableColumn("Title", value: \.title) { pr in
                    HStack(spacing: 6) {
                        if pr.draft {
                            Text("DRAFT")
                                .font(.caption2.bold())
                                .foregroundStyle(.secondary)
                                .padding(.horizontal, 4)
                                .padding(.vertical, 1)
                                .background(.quaternary, in: RoundedRectangle(cornerRadius: 3))
                        }
                        Text(pr.title)
                            .fontWeight(.medium)
                            .lineLimit(1)
                    }
                }
                TableColumn("Author") { pr in
                    Text(pr.user.login)
                        .foregroundStyle(.secondary)
                }
                .width(100)
            }
            .alternatingRowBackgrounds()
            .frame(minHeight: 300)
            .contextMenu(forSelectionType: GitHubPullRequest.ID.self) { _ in } primaryAction: { ids in
                if let prID = ids.first {
                    self.selectedPR = self.sortedPullRequests.first { $0.id == prID }
                }
            }
            .sheet(item: self.$selectedPR) { pr in
                self.prDetailSheet(pr)
            }
        }
    }

    // MARK: Private

    @State private var prSortOrder = [KeyPathComparator(\GitHubPullRequest.number)]
    @State private var selectedPR: GitHubPullRequest?

    private var sortedPullRequests: [GitHubPullRequest] {
        self.pullRequests.sorted(using: self.prSortOrder)
    }

    // MARK: - PR Detail Sheet

    private func prDetailSheet(_ pr: GitHubPullRequest) -> some View {
        VStack(spacing: 0) {
            HStack {
                Text("Pull Request Details")
                    .font(.headline)
                Spacer()
                Button("Done") {
                    self.selectedPR = nil
                }
                .keyboardShortcut(.cancelAction)
            }
            .padding()

            Divider()

            Form {
                LabeledContent("Title", value: pr.title)
                LabeledContent("Number", value: "#\(pr.number)")
                LabeledContent("Author", value: pr.user.login)
                LabeledContent("State", value: pr.state)
                LabeledContent("Draft", value: pr.draft ? "Yes" : "No")
                LabeledContent("Created At", value: pr.createdAt)
                if let prURL = URL(string: pr.htmlUrl) {
                    LabeledContent("URL") {
                        Link(pr.htmlUrl, destination: prURL)
                            .lineLimit(1)
                    }
                }
            }
            .formStyle(.grouped)

            HStack {
                Spacer()
                if let url = URL(string: pr.htmlUrl) {
                    Link("Open in Browser", destination: url)
                }
                Spacer()
            }
            .padding(.bottom)
        }
        .frame(width: 500, height: 380)
    }
}
