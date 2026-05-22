import Foundation

// MARK: - PrometheusProvider

/// Monitors Prometheus scrape target health.
struct PrometheusProvider: ServiceProvider {
    // MARK: Internal

    let id = "prometheus"
    let displayName = "Prometheus"
    let iconName = "chart.line.uptrend.xyaxis"
    let webURL: String? = "https://prometheus.tailnet-1a49.ts.net"

    /// Parse Prometheus targets JSON into a ServiceSnapshot.
    static func parse(_ data: Data) throws -> ServiceSnapshot {
        let response = try JSONDecoder().decode(PrometheusTargetsResponse.self, from: data)

        let activeTargets = response.data.activeTargets
        let targets = activeTargets.map { target in
            PrometheusTarget(
                job: target.labels["job"] ?? "unknown",
                instance: target.labels["instance"] ?? "unknown",
                health: target.health,
                lastScrapeDuration: target.lastScrapeDuration,
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
            id: "prometheus",
            displayName: "Prometheus",
            iconName: "chart.line.uptrend.xyaxis",
            status: status,
            summary: summary,
            detail: .prometheus(detail: PrometheusDetail(targets: targets)),
            error: nil,
            timestamp: .now,
        )
    }

    func fetchStatus() async -> ServiceSnapshot {
        do {
            let url = self.baseURL.appending(path: "/api/v1/targets")
            let (data, _) = try await URLSession.shared.data(from: url)
            return try Self.parse(data)
        } catch {
            return self.errorSnapshot(error.localizedDescription)
        }
    }

    func fetchDetail() async -> ServiceDetail {
        let log = GlanceLogger.provider(self.id)
        let start = ContinuousClock.now
        do {
            log.debug("Fetching deep Prometheus data")

            // Fetch targets and rules in parallel
            let targetsURL = self.baseURL.appending(path: "/api/v1/targets")
            let rulesURL = self.baseURL.appending(path: "/api/v1/rules")

            async let targetsResult = URLSession.shared.data(from: targetsURL)
            async let rulesResult = URLSession.shared.data(from: rulesURL)

            let (targetsData, _) = try await targetsResult
            let (rulesData, _) = try await rulesResult

            let targetsResponse = try JSONDecoder().decode(PrometheusTargetsResponse.self, from: targetsData)
            let targets = targetsResponse.data.activeTargets.map { target in
                PrometheusTarget(
                    job: target.labels["job"] ?? "unknown",
                    instance: target.labels["instance"] ?? "unknown",
                    health: target.health,
                    lastScrapeDuration: target.lastScrapeDuration,
                )
            }

            let rulesResponse = try JSONDecoder().decode(PrometheusRulesResponse.self, from: rulesData)
            var alertRules: [PrometheusAlertRule] = []
            for group in rulesResponse.data.groups {
                for rule in group.rules where rule.type == "alerting" {
                    alertRules.append(PrometheusAlertRule(
                        name: rule.name,
                        state: rule.state ?? "inactive",
                        group: group.name,
                        severity: rule.labels?["severity"],
                    ))
                }
            }

            let duration = ContinuousClock.now - start
            log.info("Deep fetch succeeded (\(duration, privacy: .public))")

            return .prometheus(detail: PrometheusDetail(
                targets: targets,
                alertRules: alertRules,
            ))
        } catch {
            let duration = ContinuousClock.now - start
            log.error("Deep fetch failed (\(duration, privacy: .public)): \(error, privacy: .public)")
            return .empty
        }
    }

    // MARK: Private

    private let baseURL = URL(staticString: "https://prometheus.tailnet-1a49.ts.net")

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

package struct PrometheusTargetsResponse: Codable {
    struct TargetsData: Codable {
        let activeTargets: [ActiveTarget]
    }

    struct ActiveTarget: Codable {
        let labels: [String: String]
        let health: String
        let lastScrapeDuration: Double?
    }

    let data: TargetsData
}

// MARK: - PrometheusRulesResponse

package struct PrometheusRulesResponse: Codable {
    struct RulesData: Codable {
        let groups: [RuleGroup]
    }

    struct RuleGroup: Codable {
        let name: String
        let rules: [Rule]
    }

    struct Rule: Codable {
        let name: String
        let type: String
        let state: String?
        let labels: [String: String]?
    }

    let data: RulesData
}
