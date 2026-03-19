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

    func fetchStatus() async -> ServiceSnapshot {
        do {
            let token = try await secrets.read(reference: self.tokenKey)
            let url = self.baseURL.appending(path: "/zones")

            var request = URLRequest(url: url)
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

            let (data, _) = try await URLSession.shared.data(for: request)
            let response = try JSONDecoder().decode(CloudflareZonesResponse.self, from: data)

            guard response.success else {
                let msg = response.errors.first?.message ?? "API error"
                return self.errorSnapshot(msg)
            }

            let zones = response.result
            let inactive = zones.filter { $0.status != "active" }
            let status: ServiceStatus = inactive.isEmpty ? .ok : .warning

            let summary =
                inactive.isEmpty
                    ? "\(zones.count) zone\(zones.count == 1 ? "" : "s") active"
                    : "\(inactive.count) zone\(inactive.count == 1 ? "" : "s") inactive"

            // Reuse CloudflareTunnel model for zones (name + status)
            let tunnelModels = zones.map { zone in
                CloudflareTunnel(
                    id: zone.id,
                    name: zone.name,
                    status: zone.status,
                    createdAt: nil,
                )
            }

            return ServiceSnapshot(
                id: self.id,
                displayName: self.displayName,
                iconName: self.iconName,
                status: status,
                summary: summary,
                detail: .cloudflare(tunnels: tunnelModels),
                error: nil,
                timestamp: .now,
            )
        } catch {
            return self.errorSnapshot(error.localizedDescription)
        }
    }

    // MARK: Private

    private let baseURL = URL(string: "https://api.cloudflare.com/client/v4")!
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

private struct CloudflareZonesResponse: Codable {
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
