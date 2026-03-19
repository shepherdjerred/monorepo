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
            let response = try JSONDecoder().decode(GitHubSearchResponse.self, from: data)

            let prs = response.items
            let summary = prs.isEmpty
                ? "No open PRs"
                : "\(prs.count) open PR\(prs.count == 1 ? "" : "s")"

            return ServiceSnapshot(
                id: self.id,
                displayName: self.displayName,
                iconName: self.iconName,
                status: .ok,
                summary: summary,
                detail: .github(pullRequests: prs),
                error: nil,
                timestamp: .now,
            )
        } catch {
            return self.errorSnapshot(error.localizedDescription)
        }
    }

    // MARK: Private

    private let baseURL = URL(string: "https://api.github.com")!
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

private struct GitHubSearchResponse: Codable {
    let items: [GitHubPullRequest]
}
