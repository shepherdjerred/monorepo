import Foundation

/// Monitors Buildkite pipeline and build status.
struct BuildkiteProvider: ServiceProvider {
    // MARK: Lifecycle

    init(secrets: any SecretProvider) {
        self.secrets = secrets
    }

    // MARK: Internal

    let id = "buildkite"
    let displayName = "Buildkite"
    let iconName = "hammer.fill"
    let webURL: String? = "https://buildkite.com/shepherdjerred"

    func fetchStatus() async -> ServiceSnapshot {
        do {
            let token = try await secrets.read(reference: self.secretKey)
            let url = self.baseURL.appending(path: "/organizations/\(self.org)/pipelines")

            var request = URLRequest(url: url)
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

            let (data, _) = try await URLSession.shared.data(for: request)
            let pipelines = try JSONDecoder().decode([BuildkitePipeline].self, from: data)

            let failedPipelines = pipelines.filter { $0.latestBuild?.state == "failed" }
            let runningPipelines = pipelines.filter { $0.latestBuild?.state == "running" }

            let status: ServiceStatus =
                if failedPipelines.isEmpty {
                    .ok
                } else {
                    .error
                }

            var parts = ["\(pipelines.count) pipeline\(pipelines.count == 1 ? "" : "s")"]
            if !failedPipelines.isEmpty {
                parts.append("\(failedPipelines.count) failed")
            }
            if !runningPipelines.isEmpty {
                parts.append("\(runningPipelines.count) running")
            }

            return ServiceSnapshot(
                id: self.id,
                displayName: self.displayName,
                iconName: self.iconName,
                status: status,
                summary: parts.joined(separator: ", "),
                detail: .buildkite(pipelines: pipelines),
                error: nil,
                timestamp: .now,
            )
        } catch {
            return self.errorSnapshot(error.localizedDescription)
        }
    }

    // MARK: Private

    private let baseURL = URL(string: "https://api.buildkite.com/v2")!
    private let secretKey = SecretRefs.buildkite
    private let org = "personal-174"
    private let secrets: any SecretProvider

    private func errorSnapshot(_ message: String) -> ServiceSnapshot {
        ServiceSnapshot(
            id: self.id,
            displayName: self.displayName,
            iconName: self.iconName,
            status: .unknown,
            summary: "Unreachable",
            detail: .empty,
            error: message,
            timestamp: .now,
        )
    }
}
