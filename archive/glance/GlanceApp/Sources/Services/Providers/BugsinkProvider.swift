import Foundation

// MARK: - BugsinkProvider

/// Monitors unresolved issues from Bugsink.
struct BugsinkProvider: ServiceProvider {
    // MARK: Lifecycle

    init(secrets: any SecretProvider) {
        self.secrets = secrets
    }

    // MARK: Internal

    let id = "bugsink"
    let displayName = "Bugsink"
    let iconName = "ladybug.fill"
    let webURL: String? = "https://bugsink.tailnet-1a49.ts.net"

    /// Parse Bugsink projects and their issue data into a ServiceSnapshot.
    static func parse(
        issueDataByProject: [(project: BugsinkProject, issuesData: Data)],
    ) throws -> ServiceSnapshot {
        var allIssues: [BugsinkIssue] = []
        for (project, issuesData) in issueDataByProject {
            let response = try JSONDecoder().decode(BugsinkPagedResponse<BugsinkAPIIssue>.self, from: issuesData)
            let unresolvedIssues = response.results.filter { !$0.isResolved }
            allIssues.append(contentsOf: unresolvedIssues.map { issue in
                BugsinkIssue(
                    id: issue.digestOrder,
                    title: "\(issue.calculatedType): \(issue.calculatedValue)",
                    status: issue.isResolved ? "resolved" : "unresolved",
                    project: project.name,
                    eventCount: issue.digestedEventCount,
                )
            })
        }

        let projectCount = issueDataByProject.count
        let unresolvedCount = allIssues.count
        let status: ServiceStatus =
            if unresolvedCount == 0 {
                .ok
            } else if unresolvedCount > 20 {
                .error
            } else {
                .warning
            }

        let summary =
            unresolvedCount == 0
                ? "No unresolved issues"
                : "\(unresolvedCount) unresolved across \(projectCount) projects"

        return ServiceSnapshot(
            id: "bugsink",
            displayName: "Bugsink",
            iconName: "ladybug.fill",
            status: status,
            summary: summary,
            detail: .bugsink(issues: allIssues),
            error: nil,
            timestamp: .now,
        )
    }

    func fetchStatus() async -> ServiceSnapshot {
        do {
            let token = try await secrets.read(reference: self.secretKey)

            let projects = try await fetchProjects(token: token)

            var issueDataByProject: [(project: BugsinkProject, issuesData: Data)] = []
            for project in projects {
                let data = try await fetchUnresolvedIssuesData(token: token, projectId: project.id)
                issueDataByProject.append((project: project, issuesData: data))
            }

            return try Self.parse(issueDataByProject: issueDataByProject)
        } catch is SecretError {
            return self.errorSnapshot("API token not configured")
        } catch {
            return self.errorSnapshot(error.localizedDescription)
        }
    }

    func fetchDetail() async -> ServiceDetail {
        let snapshot = await self.fetchStatus()
        return snapshot.detail
    }

    // MARK: Private

    private let baseURL = URL(staticString: "https://bugsink.tailnet-1a49.ts.net/api/canonical/0")
    private let secretKey = SecretRefs.bugsink
    private let secrets: any SecretProvider

    private func fetchProjects(token: String) async throws -> [BugsinkProject] {
        let url = self.baseURL.appending(path: "/projects/")
        var request = URLRequest(url: url)
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.timeoutInterval = 10

        let (data, _) = try await URLSession.shared.data(for: request)
        let response = try JSONDecoder().decode(BugsinkPagedResponse<BugsinkProject>.self, from: data)
        return response.results
    }

    private func fetchUnresolvedIssuesData(token: String, projectId: Int) async throws -> Data {
        let url = self.baseURL.appending(path: "/issues/")
        var components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        components?.queryItems = [
            URLQueryItem(name: "project", value: String(projectId)),
        ]

        guard let requestURL = components?.url else {
            return Data("{ \"results\": [] }".utf8)
        }

        var request = URLRequest(url: requestURL)
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.timeoutInterval = 10

        let (data, _) = try await URLSession.shared.data(for: request)
        return data
    }

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

// MARK: - BugsinkPagedResponse

package struct BugsinkPagedResponse<T: Codable>: Codable {
    let results: [T]
}

// MARK: - BugsinkProject

package struct BugsinkProject: Codable {
    enum CodingKeys: String, CodingKey {
        case id
        case name
        case digestedEventCount = "digested_event_count"
    }

    let id: Int
    let name: String
    let digestedEventCount: Int
}

// MARK: - BugsinkAPIIssue

package struct BugsinkAPIIssue: Codable {
    enum CodingKeys: String, CodingKey {
        case id
        case digestOrder = "digest_order"
        case calculatedType = "calculated_type"
        case calculatedValue = "calculated_value"
        case digestedEventCount = "digested_event_count"
        case isResolved = "is_resolved"
        case lastSeen = "last_seen"
    }

    let id: String
    let digestOrder: Int
    let calculatedType: String
    let calculatedValue: String
    let digestedEventCount: Int
    let isResolved: Bool
    let lastSeen: String
}
