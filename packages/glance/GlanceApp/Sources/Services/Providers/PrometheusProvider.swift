import Foundation

// MARK: - PrometheusProvider

/// Monitors Prometheus scrape target health.
struct PrometheusProvider: ServiceProvider {
    // MARK: Internal

    let id = "prometheus"
    let displayName = "Prometheus"
    let iconName = "chart.line.uptrend.xyaxis"
    let webURL: String? = "https://prometheus.tailnet-1a49.ts.net"

    func fetchStatus() async -> ServiceSnapshot {
        do {
            let url = self.baseURL.appending(path: "/api/v1/targets")
            let (data, _) = try await URLSession.shared.data(from: url)
            let response = try JSONDecoder().decode(PrometheusTargetsResponse.self, from: data)

            let activeTargets = response.data.activeTargets
            let targets = activeTargets.map { target in
                PrometheusTarget(
                    job: target.labels["job"] ?? "unknown",
                    instance: target.labels["instance"] ?? "unknown",
                    health: target.health,
                )
            }

            let downCount = targets.count(where: { $0.health != "up" })
            let status: ServiceStatus =
                if downCount == 0 {
                    .ok
                } else if downCount > activeTargets.count / 4 {
                    .error
                } else {
                    .warning
                }

            let summary = "\(targets.count) targets, \(downCount) down"

            return ServiceSnapshot(
                id: self.id,
                displayName: self.displayName,
                iconName: self.iconName,
                status: status,
                summary: summary,
                detail: .prometheus(targets: targets),
                error: nil,
                timestamp: .now,
            )
        } catch {
            return self.errorSnapshot(error.localizedDescription)
        }
    }

    // MARK: Private

    private let baseURL = URL(string: "https://prometheus.tailnet-1a49.ts.net")!

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

// MARK: - PrometheusTargetsResponse

private struct PrometheusTargetsResponse: Codable {
    struct TargetsData: Codable {
        let activeTargets: [ActiveTarget]
    }

    struct ActiveTarget: Codable {
        let labels: [String: String]
        let health: String
    }

    let data: TargetsData
}
