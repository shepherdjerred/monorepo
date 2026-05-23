import Foundation

// MARK: - PagerDutyProvider

/// Monitors PagerDuty incidents and on-call schedules.
struct PagerDutyProvider: ServiceProvider {
    // MARK: Lifecycle

    init(secrets: any SecretProvider) {
        self.secrets = secrets
    }

    // MARK: Internal

    let id = "pagerduty"
    let displayName = "PagerDuty"
    let iconName = "phone.badge.waveform.fill"
    let webURL: String? = "https://app.pagerduty.com"

    /// Parse PagerDuty incidents and on-calls JSON data into a ServiceSnapshot.
    static func parse(incidentsData: Data, onCallsData: Data) throws -> ServiceSnapshot {
        let incidentsResponse = try JSONDecoder().decode(PagerDutyIncidentsResponse.self, from: incidentsData)
        let onCallsResponse = try JSONDecoder().decode(PagerDutyOnCallsResponse.self, from: onCallsData)

        let incidents = incidentsResponse.incidents
        let onCall = onCallsResponse.oncalls

        let triggered = incidents.filter { $0.status == "triggered" }
        let acknowledged = incidents.filter { $0.status == "acknowledged" }

        let status: ServiceStatus =
            if triggered.isEmpty, acknowledged.isEmpty {
                .ok
            } else if !triggered.isEmpty {
                .error
            } else {
                .warning
            }

        let summary: String
        if triggered.isEmpty, acknowledged.isEmpty {
            summary = "No active incidents"
        } else {
            let parts = [
                triggered.isEmpty ? nil : "\(triggered.count) triggered",
                acknowledged.isEmpty ? nil : "\(acknowledged.count) acknowledged",
            ].compactMap(\.self)
            summary = parts.joined(separator: ", ")
        }

        return ServiceSnapshot(
            id: "pagerduty",
            displayName: "PagerDuty",
            iconName: "phone.badge.waveform.fill",
            status: status,
            summary: summary,
            detail: .pagerDuty(incidents: incidents, onCall: onCall),
            error: nil,
            timestamp: .now,
        )
    }

    func fetchStatus() async -> ServiceSnapshot {
        do {
            let token = try await secrets.read(reference: self.secretKey)
            guard !token.isEmpty else {
                throw SecretError.notLoaded(reference: self.secretKey)
            }

            async let incidentsResult = self.fetchIncidentsData(token: token)
            async let onCallResult = self.fetchOnCallsData(token: token)

            return try await Self.parse(incidentsData: incidentsResult, onCallsData: onCallResult)
        } catch is SecretError {
            return ServiceSnapshot(
                id: self.id,
                displayName: self.displayName,
                iconName: self.iconName,
                status: .unknown,
                summary: "API token not configured",
                detail: .empty,
                error: "Create a PagerDuty REST API token and store in 1Password",
                timestamp: .now,
            )
        } catch {
            return self.errorSnapshot(error.localizedDescription)
        }
    }

    func fetchDetail() async -> ServiceDetail {
        let snapshot = await self.fetchStatus()
        return snapshot.detail
    }

    // MARK: Private

    private let baseURL = URL(staticString: "https://api.pagerduty.com")
    private let secretKey = SecretRefs.pagerDuty
    private let secrets: any SecretProvider

    private func fetchIncidentsData(token: String) async throws -> Data {
        let url = self.baseURL.appending(path: "/incidents")
        var components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        components?.queryItems = [
            URLQueryItem(name: "statuses[]", value: "triggered"),
            URLQueryItem(name: "statuses[]", value: "acknowledged"),
        ]

        guard let requestURL = components?.url else {
            return Data("{\"incidents\":[]}".utf8)
        }

        var request = URLRequest(url: requestURL)
        request.setValue("Token token=\(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let (data, _) = try await URLSession.shared.data(for: request)
        return data
    }

    private func fetchOnCallsData(token: String) async throws -> Data {
        let url = self.baseURL.appending(path: "/oncalls")

        var request = URLRequest(url: url)
        request.setValue("Token token=\(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let (data, _) = try await URLSession.shared.data(for: request)
        return data
    }

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

// MARK: - PagerDutyIncidentsResponse

package struct PagerDutyIncidentsResponse: Codable {
    let incidents: [PagerDutyIncident]
}

// MARK: - PagerDutyOnCallsResponse

package struct PagerDutyOnCallsResponse: Codable {
    let oncalls: [PagerDutyOnCall]
}
