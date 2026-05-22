import Foundation

// MARK: - CloudflareProvider

/// Monitors Cloudflare zone status.
struct CloudflareProvider: ServiceProvider {
    // MARK: Lifecycle

    init(secrets: any SecretProvider) {
        self.secrets = secrets
    }

    // MARK: Internal

    let id = "cloudflare"
    let displayName = "Cloudflare"
    let iconName = "cloud.fill"
    let webURL: String? = "https://dash.cloudflare.com"

    /// Parse Cloudflare zones JSON into a ServiceSnapshot.
    static func parse(_ data: Data) throws -> ServiceSnapshot {
        let response = try JSONDecoder().decode(CloudflareZonesResponse.self, from: data)

        guard response.success else {
            let msg = response.errors.first?.message ?? "API error"
            return ServiceSnapshot(
                id: "cloudflare",
                displayName: "Cloudflare",
                iconName: "cloud.fill",
                status: .unknown,
                summary: "Unreachable",
                detail: .empty,
                error: msg,
                timestamp: .now,
            )
        }

        let zones = response.result
        let inactive = zones.filter { $0.status != "active" }
        let status: ServiceStatus = inactive.isEmpty ? .ok : .warning

        let summary =
            inactive.isEmpty
                ? "\(zones.count) zone\(zones.count == 1 ? "" : "s") active"
                : "\(inactive.count) zone\(inactive.count == 1 ? "" : "s") inactive"

        let tunnelModels = zones.map { zone in
            CloudflareTunnel(
                id: zone.id,
                name: zone.name,
                status: zone.status,
                createdAt: nil,
            )
        }

        return ServiceSnapshot(
            id: "cloudflare",
            displayName: "Cloudflare",
            iconName: "cloud.fill",
            status: status,
            summary: summary,
            detail: .cloudflare(tunnels: tunnelModels),
            error: nil,
            timestamp: .now,
        )
    }

    func fetchStatus() async -> ServiceSnapshot {
        do {
            let token = try await secrets.read(reference: self.tokenKey)
            let url = self.baseURL.appending(path: "/zones")

            var request = URLRequest(url: url)
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

            let (data, _) = try await URLSession.shared.data(for: request)
            return try Self.parse(data)
        } catch {
            return self.errorSnapshot(error.localizedDescription)
        }
    }

    func fetchDetail() async -> ServiceDetail {
        let snapshot = await self.fetchStatus()
        return snapshot.detail
    }

    // MARK: Private

    private let baseURL = URL(staticString: "https://api.cloudflare.com/client/v4")
    private let tokenKey = SecretRefs.cloudflareToken
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

// MARK: - CloudflareZonesResponse

package struct CloudflareZonesResponse: Codable {
    struct CloudflareZone: Codable {
        let id: String
        let name: String
        let status: String
    }

    struct CloudflareError: Codable {
        let message: String
    }

    let success: Bool
    let result: [CloudflareZone]
    let errors: [CloudflareError]
}
