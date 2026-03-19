import Charts
import SwiftUI

/// Detail view showing Buildkite pipeline and build status.
struct BuildkiteDetailView: View {
    // MARK: Internal

    let detail: BuildkiteDetail

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            self.pipelinesSection
            if !self.detail.recentBuilds.isEmpty {
                self.recentBuildsSection
            }
        }
        .sheet(item: self.$selectedBuild) { build in
            self.buildDetailSheet(build)
        }
    }

    // MARK: Private

    @State private var pipelineSortOrder = [KeyPathComparator(\BuildkitePipeline.name)]
    @State private var buildSortOrder = [KeyPathComparator(\BuildkiteRecentBuild.pipelineName)]
    @State private var selectedBuild: BuildkiteRecentBuild?

    private var sortedPipelines: [BuildkitePipeline] {
        self.detail.pipelines.sorted(using: self.pipelineSortOrder)
    }

    private var sortedBuilds: [BuildkiteRecentBuild] {
        self.detail.recentBuilds.sorted(using: self.buildSortOrder)
    }

    @ViewBuilder
    private var pipelinesSection: some View {
        Text("Pipelines")
            .font(.headline)

        if self.detail.pipelines.isEmpty {
            Text("No pipelines found.")
                .foregroundStyle(.secondary)
        } else {
            Table(self.sortedPipelines, sortOrder: self.$pipelineSortOrder) {
                TableColumn("Pipeline", value: \.name) { pipeline in
                    Text(pipeline.name)
                        .fontWeight(.medium)
                }
                TableColumn("Latest Build") { pipeline in
                    if let build = pipeline.latestBuild {
                        HStack(spacing: 4) {
                            self.buildStatusIcon(build.state)
                            Text("#\(build.number)")
                                .monospacedDigit()
                        }
                    } else {
                        Text("-")
                            .foregroundStyle(.secondary)
                    }
                }
                .width(120)
                TableColumn("Status") { pipeline in
                    if let build = pipeline.latestBuild {
                        Text(build.state)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    } else {
                        Text("-")
                            .foregroundStyle(.secondary)
                    }
                }
                .width(100)
            }
            .alternatingRowBackgrounds()
            .frame(minHeight: 200)
        }
    }

    @ViewBuilder
    private var recentBuildsSection: some View {
        Text("Recent Builds")
            .font(.headline)

        Table(self.sortedBuilds, sortOrder: self.$buildSortOrder) {
            TableColumn("Pipeline", value: \.pipelineName) { build in
                Text(build.pipelineName)
                    .fontWeight(.medium)
            }
            TableColumn("Build", value: \.number) { build in
                HStack(spacing: 4) {
                    self.buildStatusIcon(build.state)
                    Text("#\(build.number)")
                        .monospacedDigit()
                }
            }
            .width(80)
            TableColumn("Branch") { build in
                Text(build.branch ?? "-")
                    .font(.caption.monospaced())
                    .foregroundStyle(.secondary)
            }
            .width(120)
            TableColumn("Message") { build in
                Text(build.message ?? "-")
                    .font(.caption)
                    .lineLimit(1)
            }
            TableColumn("State", value: \.state) { build in
                Text(build.state)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .width(80)
        }
        .alternatingRowBackgrounds()
        .frame(minHeight: 200)
        .contextMenu(forSelectionType: BuildkiteRecentBuild.ID.self) { _ in } primaryAction: { ids in
            if let buildID = ids.first {
                self.selectedBuild = self.sortedBuilds.first { $0.id == buildID }
            }
        }
    }

    // MARK: - Build Detail Sheet

    private func buildDetailSheet(_ build: BuildkiteRecentBuild) -> some View {
        VStack(spacing: 0) {
            HStack {
                Text("Build Details")
                    .font(.headline)
                Spacer()
                Button("Done") {
                    self.selectedBuild = nil
                }
                .keyboardShortcut(.cancelAction)
            }
            .padding()

            Divider()

            Form {
                LabeledContent("Pipeline", value: build.pipelineName)
                LabeledContent("Build Number", value: "#\(build.number)")
                LabeledContent("State", value: build.state)
                LabeledContent("Branch", value: build.branch ?? "-")
                LabeledContent("Message", value: build.message ?? "-")
                LabeledContent("Created At", value: build.createdAt ?? "-")
            }
            .formStyle(.grouped)
        }
        .frame(width: 450, height: 320)
    }

    @ViewBuilder
    private func buildStatusIcon(_ state: String) -> some View {
        let color: Color =
            switch state {
            case "passed":
                .green
            case "failed":
                .red
            case "running":
                .blue
            case "canceled",
                 "cancelled":
                .secondary
            default:
                .secondary
            }
        Circle()
            .fill(color)
            .frame(width: 8, height: 8)
    }
}
