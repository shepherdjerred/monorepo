import Foundation

/// Monitors active alerts from Alertmanager.
struct AlertmanagerProvider: ServiceProvider {
    // MARK: Internal

    let id = "alertmanager"
    let displayName = "Alertmanager"
    let iconName = "bell.badge.fill"
    let webURL: String? = "https://alertmanager.tailnet-1a49.ts.net"

    func fetchStatus() async -> ServiceSnapshot {
        do {
            let url = self.baseURL.appending(path: "/api/v2/alerts")
            var components = URLComponents(url: url, resolvingAgainstBaseURL: false)
            components?.queryItems = [
                URLQueryItem(name: "active", value: "true"),
                URLQueryItem(name: "silenced", value: "false"),
                URLQueryItem(name: "inhibited", value: "false"),
            ]

            guard let requestURL = components?.url else {
                return self.errorSnapshot("Invalid URL")
            }

            let (data, _) = try await URLSession.shared.data(from: requestURL)
            let alerts = try JSONDecoder().decode([AlertmanagerAlert].self, from: data)

            let firingAlerts = alerts.filter { $0.status.state == "active" }
            let hasCritical = firingAlerts.contains { $0.labels["severity"] == "critical" }

            let status: ServiceStatus =
                if firingAlerts.isEmpty {
                    .ok
                } else if hasCritical {
                    .error
                } else {
                    .warning
                }

            let summary =
                firingAlerts.isEmpty
                    ? "No active alerts"
                    : "\(firingAlerts.count) active alert\(firingAlerts.count == 1 ? "" : "s")"

            return ServiceSnapshot(
                id: self.id,
                displayName: self.displayName,
                iconName: self.iconName,
                status: status,
                summary: summary,
                detail: .alertmanager(alerts: firingAlerts),
                error: nil,
                timestamp: .now,
            )
        } catch {
            return self.errorSnapshot(error.localizedDescription)
        }
    }

    // MARK: Private

    private let baseURL = URL(string: "https://alertmanager.tailnet-1a49.ts.net")!

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
