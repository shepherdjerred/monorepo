import SwiftUI

/// Detail view showing open GitHub pull requests.
struct GitHubDetailView: View {
    let pullRequests: [GitHubPullRequest]

    var body: some View {
        if self.pullRequests.isEmpty {
            Label("No open pull requests", systemImage: "checkmark.seal.fill")
                .foregroundStyle(.green)
                .font(.headline)
        } else {
            Table(self.pullRequests) {
                TableColumn("PR") { pr in
                    Text("#\(pr.number)")
                        .monospacedDigit()
                        .foregroundStyle(.secondary)
                }
                .width(50)
                TableColumn("Title") { pr in
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
            .frame(minHeight: 300)
        }
    }
}
