import SwiftUI

/// Detail view showing Buildkite pipeline and build status.
struct BuildkiteDetailView: View {
    // MARK: Internal

    let pipelines: [BuildkitePipeline]

    var body: some View {
        if self.pipelines.isEmpty {
            Text("No pipelines found.")
                .foregroundStyle(.secondary)
        } else {
            Table(self.pipelines) {
                TableColumn("Pipeline") { pipeline in
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
            .frame(minHeight: 300)
        }
    }

    // MARK: Private

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
