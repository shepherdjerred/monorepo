import Foundation

/// Monitors active alerts from Alertmanager.
struct AlertmanagerProvider: ServiceProvider {
    // MARK: Internal

    let id = "alertmanager"
    let displayName = "Alertmanager"
    let iconName = "bell.badge.fill"
    let webURL: String? = "https://alertmanager.tailnet-1a49.ts.net"

    /// Parse Alertmanager alerts JSON into a ServiceSnapshot.
    static func parse(_ data: Data) throws -> ServiceSnapshot {
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
            id: "alertmanager",
            displayName: "Alertmanager",
            iconName: "bell.badge.fill",
            status: status,
            summary: summary,
            detail: .alertmanager(detail: AlertmanagerDetail(alerts: firingAlerts)),
            error: nil,
            timestamp: .now,
        )
    }

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
            return try Self.parse(data)
        } catch {
            return self.errorSnapshot(error.localizedDescription)
        }
    }

    func fetchDetail() async -> ServiceDetail {
        let log = GlanceLogger.provider(self.id)
        let start = ContinuousClock.now
        do {
            log.debug("Fetching deep Alertmanager data")

            // Fetch alerts and silences in parallel
            let alertsURL = self.baseURL.appending(path: "/api/v2/alerts")
            let silencesURL = self.baseURL.appending(path: "/api/v2/silences")

            async let alertsResult = URLSession.shared.data(from: alertsURL)
            async let silencesResult = URLSession.shared.data(from: silencesURL)

            let (alertsData, _) = try await alertsResult
            let (silencesData, _) = try await silencesResult

            let alerts = try JSONDecoder().decode([AlertmanagerAlert].self, from: alertsData)
            let allSilences = try JSONDecoder().decode([AlertmanagerSilence].self, from: silencesData)

            // Only include active silences
            let activeSilences = allSilences.filter { $0.status.state == "active" }

            let duration = ContinuousClock.now - start
            log.info("Deep fetch succeeded (\(duration, privacy: .public))")

            return .alertmanager(detail: AlertmanagerDetail(
                alerts: alerts.filter { $0.status.state == "active" },
                silences: activeSilences,
            ))
        } catch {
            let duration = ContinuousClock.now - start
            log.error("Deep fetch failed (\(duration, privacy: .public)): \(error, privacy: .public)")
            return .empty
        }
    }

    // MARK: Private

    private let baseURL = URL(staticString: "https://alertmanager.tailnet-1a49.ts.net")

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
