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

    func fetchStatus() async -> ServiceSnapshot {
        do {
            let token = try await secrets.read(reference: self.secretKey)
            let url = self.baseURL.appending(path: "/api/v1/provisioning/alert-rules")

            var request = URLRequest(url: url)
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

            let (data, _) = try await URLSession.shared.data(for: request)
            let rules = try JSONDecoder().decode([GrafanaAlertRule].self, from: data)

            let summary = "\(rules.count) alert rule\(rules.count == 1 ? "" : "s") configured"

            return ServiceSnapshot(
                id: self.id,
                displayName: self.displayName,
                iconName: self.iconName,
                status: .ok,
                summary: summary,
                detail: .grafana(alertRules: rules),
                error: nil,
                timestamp: .now,
            )
        } catch {
            return self.errorSnapshot(error.localizedDescription)
        }
    }

    // MARK: Private

    private let baseURL = URL(string: "https://grafana.tailnet-1a49.ts.net")!
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
