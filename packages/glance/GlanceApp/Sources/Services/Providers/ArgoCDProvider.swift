import Foundation

// MARK: - ArgoCDProvider

/// Monitors ArgoCD application sync and health status.
struct ArgoCDProvider: ServiceProvider {
    // MARK: Lifecycle

    init(secrets: any SecretProvider) {
        self.secrets = secrets
    }

    // MARK: Internal

    let id = "argocd"
    let displayName = "ArgoCD"
    let iconName = "arrow.triangle.2.circlepath"
    let webURL: String? = "https://argocd.tailnet-1a49.ts.net"

    func fetchStatus() async -> ServiceSnapshot {
        do {
            let token = try await secrets.read(reference: self.secretKey)
            let url = self.baseURL.appending(path: "/api/v1/applications")

            var request = URLRequest(url: url)
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

            let (data, _) = try await URLSession.shared.data(for: request)
            let response = try JSONDecoder().decode(ArgoCDAppList.self, from: data)
            let apps = response.items

            let unhealthy = apps.filter { $0.status.health.status != "Healthy" }
            let outOfSync = apps.filter { $0.status.sync.status != "Synced" }

            let status: ServiceStatus =
                if unhealthy.isEmpty, outOfSync.isEmpty {
                    .ok
                } else if unhealthy.contains(where: { $0.status.health.status == "Degraded" }) {
                    .error
                } else {
                    .warning
                }

            let summary = "\(apps.count) apps, \(unhealthy.count) unhealthy, \(outOfSync.count) out-of-sync"

            return ServiceSnapshot(
                id: self.id,
                displayName: self.displayName,
                iconName: self.iconName,
                status: status,
                summary: summary,
                detail: .argoCD(applications: apps),
                error: nil,
                timestamp: .now,
            )
        } catch {
            return self.errorSnapshot(error.localizedDescription)
        }
    }

    // MARK: Private

    private let baseURL = URL(string: "https://argocd.tailnet-1a49.ts.net")!
    private let secretKey = SecretRefs.argoCD
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

// MARK: - ArgoCDAppList

private struct ArgoCDAppList: Codable {
    let items: [ArgoCDApplication]
}
