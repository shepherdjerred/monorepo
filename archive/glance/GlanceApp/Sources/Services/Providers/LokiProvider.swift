import Foundation

// MARK: - LokiProvider

/// Monitors recent error logs from Loki.
struct LokiProvider: ServiceProvider {
    // MARK: Internal

    let id = "loki"
    let displayName = "Loki"
    let iconName = "doc.text.magnifyingglass"
    let webURL: String? = "https://grafana.tailnet-1a49.ts.net/explore"

    /// Parse Loki query response JSON into a ServiceSnapshot.
    static func parse(_ data: Data, lookbackMinutes: Int = 30) throws -> ServiceSnapshot {
        let response = try JSONDecoder().decode(LokiQueryResponse.self, from: data)

        let entries = response.data.result.flatMap { stream -> [LokiLogEntry] in
            stream.values.map { value in
                LokiLogEntry(
                    id: "\(value[0])-\(value[1].prefix(20))",
                    timestamp: value[0],
                    message: value[1],
                    labels: stream.stream,
                )
            }
        }

        let status: ServiceStatus =
            if entries.isEmpty {
                .ok
            } else if entries.count > 20 {
                .error
            } else {
                .warning
            }

        let summary =
            entries.isEmpty
                ? "No errors in last \(lookbackMinutes)m"
                : "\(entries.count) error\(entries.count == 1 ? "" : "s") in last \(lookbackMinutes)m"

        return ServiceSnapshot(
            id: "loki",
            displayName: "Loki",
            iconName: "doc.text.magnifyingglass",
            status: status,
            summary: summary,
            detail: .loki(entries: entries),

            error: nil,
            timestamp: .now,
        )
    }

    func fetchStatus() async -> ServiceSnapshot {
        do {
            let url = self.baseURL.appending(path: "/loki/api/v1/query_range")
            let end = Date.now
            let start = end.addingTimeInterval(TimeInterval(-self.lookbackMinutes * 60))

            var components = URLComponents(url: url, resolvingAgainstBaseURL: false)
            components?.queryItems = [
                URLQueryItem(name: "query", value: "{level=\"error\"} | line_format \"{{.message}}\""),
                URLQueryItem(name: "start", value: String(Int(start.timeIntervalSince1970))),
                URLQueryItem(name: "end", value: String(Int(end.timeIntervalSince1970))),
                URLQueryItem(name: "limit", value: "50"),
            ]

            guard let requestURL = components?.url else {
                return self.errorSnapshot("Invalid URL")
            }

            let (data, _) = try await URLSession.shared.data(from: requestURL)
            return try Self.parse(data, lookbackMinutes: self.lookbackMinutes)
        } catch {
            return self.errorSnapshot(error.localizedDescription)
        }
    }

    func fetchDetail() async -> ServiceDetail {
        let snapshot = await self.fetchStatus()
        return snapshot.detail
    }

    // MARK: Private

    private let baseURL = URL(staticString: "https://loki.tailnet-1a49.ts.net")
    private let lookbackMinutes = 30

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

// MARK: - LokiQueryResponse

package struct LokiQueryResponse: Codable {
    struct LokiData: Codable {
        let result: [LokiStream]
    }

    struct LokiStream: Codable {
        let stream: [String: String]
        let values: [[String]]
    }

    let data: LokiData
}
