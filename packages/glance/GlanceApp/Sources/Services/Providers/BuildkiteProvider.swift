import Foundation

// MARK: - BuildkiteProvider

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

    /// Parse Buildkite pipelines JSON into a ServiceSnapshot.
    static func parse(_ data: Data) throws -> ServiceSnapshot {
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
            id: "buildkite",
            displayName: "Buildkite",
            iconName: "hammer.fill",
            status: status,
            summary: parts.joined(separator: ", "),
            detail: .buildkite(detail: BuildkiteDetail(pipelines: pipelines)),
            error: nil,
            timestamp: .now,
        )
    }

    func fetchStatus() async -> ServiceSnapshot {
        do {
            let token = try await secrets.read(reference: self.secretKey)
            let url = self.baseURL.appending(path: "/organizations/\(self.org)/pipelines")

            var request = URLRequest(url: url)
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

            let (data, _) = try await URLSession.shared.data(for: request)
            return try Self.parse(data)
        } catch {
            return self.errorSnapshot(error.localizedDescription)
        }
    }

    func fetchDetail() async -> ServiceDetail {
        let log = GlanceLogger.provider(self.id)
        let start = ContinuousClock.now
        do {
            let token = try await self.secrets.read(reference: self.secretKey)

            log.debug("Fetching deep Buildkite data")

            // Fetch pipelines first
            let pipelinesURL = self.baseURL.appending(path: "/organizations/\(self.org)/pipelines")
            var pipelinesRequest = URLRequest(url: pipelinesURL)
            pipelinesRequest.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            pipelinesRequest.timeoutInterval = 30

            let (pipelinesData, _) = try await URLSession.shared.data(for: pipelinesRequest)
            let pipelines = try JSONDecoder().decode([BuildkitePipeline].self, from: pipelinesData)

            // Fetch recent builds for each pipeline
            var recentBuilds: [BuildkiteRecentBuild] = []
            for pipeline in pipelines {
                let buildsURL = self.baseURL.appending(
                    path: "/organizations/\(self.org)/pipelines/\(pipeline.slug)/builds",
                )
                var components = URLComponents(url: buildsURL, resolvingAgainstBaseURL: false)
                components?.queryItems = [
                    URLQueryItem(name: "per_page", value: "5"),
                ]
                guard let buildsRequestURL = components?.url else {
                    continue
                }

                var buildsRequest = URLRequest(url: buildsRequestURL)
                buildsRequest.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
                buildsRequest.timeoutInterval = 30

                if let (buildsData, _) = try? await URLSession.shared.data(for: buildsRequest) {
                    let builds = (try? JSONDecoder().decode([BuildkiteAPIBuild].self, from: buildsData)) ?? []
                    for build in builds {
                        recentBuilds.append(BuildkiteRecentBuild(
                            id: build.id,
                            pipelineName: pipeline.name,
                            number: build.number,
                            state: build.state,
                            message: build.message,
                            createdAt: build.createdAt,
                            branch: build.branch,
                        ))
                    }
                }
            }

            let duration = ContinuousClock.now - start
            log.info("Deep fetch succeeded (\(duration, privacy: .public))")

            return .buildkite(detail: BuildkiteDetail(
                pipelines: pipelines,
                recentBuilds: recentBuilds,
            ))
        } catch {
            let duration = ContinuousClock.now - start
            log.error("Deep fetch failed (\(duration, privacy: .public)): \(error, privacy: .public)")
            return .empty
        }
    }

    // MARK: Private

    private let baseURL = URL(staticString: "https://api.buildkite.com/v2")
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

// MARK: - BuildkiteAPIBuild

package struct BuildkiteAPIBuild: Codable {
    enum CodingKeys: String, CodingKey {
        case id
        case number
        case state
        case message
        case createdAt = "created_at"
        case branch
    }

    let id: String
    let number: Int
    let state: String
    let message: String?
    let createdAt: String?
    let branch: String?
}
