import Foundation

// MARK: - LokiProvider

/// Monitors recent error logs from Loki.
struct LokiProvider: ServiceProvider {
    // MARK: Internal

    let id = "loki"
    let displayName = "Loki"
    let iconName = "doc.text.magnifyingglass"
    let webURL: String? = "https://grafana.tailnet-1a49.ts.net/explore"

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
                    ? "No errors in last \(self.lookbackMinutes)m"
                    : "\(entries.count) error\(entries.count == 1 ? "" : "s") in last \(self.lookbackMinutes)m"

            return ServiceSnapshot(
                id: self.id,
                displayName: self.displayName,
                iconName: self.iconName,
                status: status,
                summary: summary,
                detail: .loki(entries: entries),
                error: nil,
                timestamp: .now,
            )
        } catch {
            return self.errorSnapshot(error.localizedDescription)
        }
    }

    // MARK: Private

    private let baseURL = URL(string: "https://loki.tailnet-1a49.ts.net")!
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

private struct LokiQueryResponse: Codable {
    struct LokiData: Codable {
        let result: [LokiStream]
    }

    struct LokiStream: Codable {
        let stream: [String: String]
        let values: [[String]]
    }

    let data: LokiData
}
