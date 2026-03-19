import Foundation

/// Monitors Grafana alert rule status.
struct GrafanaProvider: ServiceProvider {
    // MARK: Lifecycle

    init(secrets: any SecretProvider) {
        self.secrets = secrets
    }

    // MARK: Internal

    let id = "grafana"
    let displayName = "Grafana"
    let iconName = "chart.bar.xaxis"
    let webURL: String? = "https://grafana.tailnet-1a49.ts.net"

    /// Parse Grafana alert rules JSON into a ServiceSnapshot.
    static func parse(_ data: Data) throws -> ServiceSnapshot {
        let rules = try JSONDecoder().decode([GrafanaAlertRule].self, from: data)

        let summary = "\(rules.count) alert rule\(rules.count == 1 ? "" : "s") configured"

        return ServiceSnapshot(
            id: "grafana",
            displayName: "Grafana",
            iconName: "chart.bar.xaxis",
            status: .ok,
            summary: summary,
            detail: .grafana(detail: GrafanaDetail(alertRules: rules)),
            error: nil,
            timestamp: .now,
        )
    }

    func fetchStatus() async -> ServiceSnapshot {
        do {
            let token = try await secrets.read(reference: self.secretKey)
            let url = self.baseURL.appending(path: "/api/v1/provisioning/alert-rules")

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

            log.debug("Fetching deep Grafana data")

            // Fetch alert rules and dashboards in parallel
            let rulesURL = self.baseURL.appending(path: "/api/v1/provisioning/alert-rules")
            let dashboardsURL = self.baseURL.appending(path: "/api/search")

            var rulesRequest = URLRequest(url: rulesURL)
            rulesRequest.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            rulesRequest.timeoutInterval = 30

            var dashComponents = URLComponents(url: dashboardsURL, resolvingAgainstBaseURL: false)
            dashComponents?.queryItems = [
                URLQueryItem(name: "type", value: "dash-db"),
            ]
            guard let dashURL = dashComponents?.url else {
                return .empty
            }
            var dashRequest = URLRequest(url: dashURL)
            dashRequest.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            dashRequest.timeoutInterval = 30

            async let rulesResult = URLSession.shared.data(for: rulesRequest)
            async let dashResult = URLSession.shared.data(for: dashRequest)

            let (rulesData, _) = try await rulesResult
            let (dashData, _) = try await dashResult

            let rules = try JSONDecoder().decode([GrafanaAlertRule].self, from: rulesData)
            let dashboards = try JSONDecoder().decode([GrafanaDashboard].self, from: dashData)

            let duration = ContinuousClock.now - start
            log.info("Deep fetch succeeded (\(duration, privacy: .public))")

            return .grafana(detail: GrafanaDetail(
                alertRules: rules,
                dashboards: dashboards,
            ))
        } catch {
            let duration = ContinuousClock.now - start
            log.error("Deep fetch failed (\(duration, privacy: .public)): \(error, privacy: .public)")
            return .empty
        }
    }

    // MARK: Private

    private let baseURL = URL(staticString: "https://grafana.tailnet-1a49.ts.net")
    private let secretKey = SecretRefs.grafana
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
