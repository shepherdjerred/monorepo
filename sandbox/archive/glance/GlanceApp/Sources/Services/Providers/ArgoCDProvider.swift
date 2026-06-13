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

    /// Parse ArgoCD applications JSON into a ServiceSnapshot.
    static func parse(_ data: Data) throws -> ServiceSnapshot {
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
            id: "argocd",
            displayName: "ArgoCD",
            iconName: "arrow.triangle.2.circlepath",
            status: status,
            summary: summary,
            detail: .argoCD(detail: ArgoCDDetail(applications: apps)),
            error: nil,
            timestamp: .now,
        )
    }

    func fetchStatus() async -> ServiceSnapshot {
        do {
            let token = try await secrets.read(reference: self.secretKey)
            let url = self.baseURL.appending(path: "/api/v1/applications")

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
            let url = self.baseURL.appending(path: "/api/v1/applications")

            var request = URLRequest(url: url)
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            request.timeoutInterval = 30

            let (data, _) = try await URLSession.shared.data(for: request)
            let response = try JSONDecoder().decode(ArgoCDAppList.self, from: data)
            let apps = response.items

            // Extract revision history from all apps
            var revisionHistory: [ArgoCDRevisionEntry] = []
            for app in apps {
                if let history = app.status.history {
                    for entry in history {
                        revisionHistory.append(ArgoCDRevisionEntry(
                            appName: app.metadata.name,
                            revision: entry.revision ?? "unknown",
                            deployedAt: entry.deployedAt,
                        ))
                    }
                }
            }

            let duration = ContinuousClock.now - start
            log.info("Deep fetch succeeded (\(duration, privacy: .public))")

            return .argoCD(detail: ArgoCDDetail(
                applications: apps,
                revisionHistory: revisionHistory,
            ))
        } catch {
            let duration = ContinuousClock.now - start
            log.error("Deep fetch failed (\(duration, privacy: .public)): \(error, privacy: .public)")
            return .empty
        }
    }

    // MARK: Private

    private let baseURL = URL(staticString: "https://argocd.tailnet-1a49.ts.net")
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

package struct ArgoCDAppList: Codable {
    let items: [ArgoCDApplication]
}
