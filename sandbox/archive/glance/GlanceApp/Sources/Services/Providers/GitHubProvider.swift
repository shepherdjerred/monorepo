import Foundation

// MARK: - GitHubProvider

/// Monitors open GitHub pull requests.
struct GitHubProvider: ServiceProvider {
    // MARK: Lifecycle

    init(secrets: any SecretProvider) {
        self.secrets = secrets
    }

    // MARK: Internal

    let id = "github"
    let displayName = "GitHub"
    let iconName = "chevron.left.forwardslash.chevron.right"
    let webURL: String? = "https://github.com/shepherdjerred"

    /// Parse GitHub search response JSON into a ServiceSnapshot.
    static func parse(_ data: Data) throws -> ServiceSnapshot {
        let response = try JSONDecoder().decode(GitHubSearchResponse.self, from: data)

        let prs = response.items
        let summary = prs.isEmpty
            ? "No open PRs"
            : "\(prs.count) open PR\(prs.count == 1 ? "" : "s")"

        return ServiceSnapshot(
            id: "github",
            displayName: "GitHub",
            iconName: "chevron.left.forwardslash.chevron.right",
            status: .ok,
            summary: summary,
            detail: .github(pullRequests: prs),
            error: nil,
            timestamp: .now,
        )
    }

    func fetchStatus() async -> ServiceSnapshot {
        do {
            let token = try await secrets.read(reference: self.secretKey)

            let url = self.baseURL.appending(path: "/search/issues")
            var components = URLComponents(url: url, resolvingAgainstBaseURL: false)
            components?.queryItems = [
                URLQueryItem(name: "q", value: "is:pr is:open user:\(self.owner)"),
                URLQueryItem(name: "per_page", value: "30"),
            ]

            guard let requestURL = components?.url else {
                return self.errorSnapshot("Invalid URL")
            }

            var request = URLRequest(url: requestURL)
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            request.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")

            let (data, _) = try await URLSession.shared.data(for: request)
            return try Self.parse(data)
        } catch {
            return self.errorSnapshot(error.localizedDescription)
        }
    }

    func fetchDetail() async -> ServiceDetail {
        let snapshot = await self.fetchStatus()
        return snapshot.detail
    }

    // MARK: Private

    private let baseURL = URL(staticString: "https://api.github.com")
    private let secretKey = SecretRefs.github
    private let owner = "shepherdjerred"
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

// MARK: - GitHubSearchResponse

package struct GitHubSearchResponse: Codable {
    let items: [GitHubPullRequest]
}
