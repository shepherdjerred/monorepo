import Foundation

// MARK: - AnthropicProvider

/// Monitors Anthropic API cost and token usage for the current billing period.
struct AnthropicProvider: ServiceProvider {
    // MARK: Lifecycle

    init(secrets: any SecretProvider) {
        self.secrets = secrets
    }

    // MARK: Internal

    let id = "anthropic-api"
    let displayName = "Anthropic API"
    let iconName = "brain.head.profile"
    let webURL: String? = "https://console.anthropic.com/settings/billing"

    /// Parse Anthropic cost and usage data into a ServiceSnapshot.
    static func parse(costData: Data, usageData: Data) throws -> ServiceSnapshot {
        let costResponse = try JSONDecoder().decode(AnthropicCostResponse.self, from: costData)
        let usageResponse = try JSONDecoder().decode(AnthropicUsageResponse.self, from: usageData)

        let totalCost = costResponse.data.reduce(0.0) { total, bucket in
            total + bucket.costs.reduce(0.0) { subtotal, cost in
                subtotal + (Double(cost.amount) ?? 0)
            }
        }

        let modelBreakdown = self.aggregateByModel(usageResponse)

        let now = Date()
        let startOfMonth = Calendar.current.date(
            from: Calendar.current.dateComponents([.year, .month], from: now),
        ) ?? now

        let usage = AnthropicAPIUsage(
            totalCost: totalCost,
            modelBreakdown: modelBreakdown,
            billingPeriodStart: startOfMonth,
            billingPeriodEnd: now,
        )

        let status: ServiceStatus =
            if totalCost >= 100 {
                .error
            } else if totalCost >= 50 {
                .warning
            } else {
                .ok
            }

        let costString = self.formatCurrency(totalCost)
        let modelCount = modelBreakdown.count
        let summary = "\(costString) this month (\(modelCount) model\(modelCount == 1 ? "" : "s"))"

        return ServiceSnapshot(
            id: "anthropic-api",
            displayName: "Anthropic API",
            iconName: "brain.head.profile",
            status: status,
            summary: summary,
            detail: .anthropicAPI(usage: usage),
            error: nil,
            timestamp: .now,
        )
    }

    func fetchStatus() async -> ServiceSnapshot {
        let log = GlanceLogger.provider(self.id)
        let start = ContinuousClock.now
        do {
            let token = try await secrets.read(reference: SecretRefs.anthropicAdmin)
            let now = Date()
            guard let startOfMonth = Calendar.current.date(
                from: Calendar.current.dateComponents([.year, .month], from: now),
            ) else {
                throw AnthropicAPIError.invalidDate
            }

            log.debug("Fetching cost and usage reports")
            async let costData = self.fetchCostData(token: token, from: startOfMonth)
            async let usageData = self.fetchUsageData(token: token, from: startOfMonth)

            let snapshot = try await Self.parse(costData: costData, usageData: usageData)
            let duration = ContinuousClock.now - start
            log.info("Fetch succeeded (\(duration, privacy: .public)): \(snapshot.summary, privacy: .public)")
            return snapshot
        } catch {
            let duration = ContinuousClock.now - start
            log.error("Fetch failed (\(duration, privacy: .public)): \(error, privacy: .public)")
            return self.errorSnapshot(error.localizedDescription)
        }
    }

    func fetchDetail() async -> ServiceDetail {
        let snapshot = await self.fetchStatus()
        return snapshot.detail
    }

    // MARK: Private

    private let baseURL = URL(string: "https://api.anthropic.com")
    private let secrets: any SecretProvider

    private static func aggregateByModel(_ response: AnthropicUsageResponse) -> [AnthropicModelUsage] {
        var byModel: [String: AnthropicModelUsage] = [:]
        for bucket in response.data {
            for entry in bucket.usage {
                let model = entry.model ?? "unknown"
                let existing = byModel[model]
                byModel[model] = AnthropicModelUsage(
                    model: model,
                    inputTokens: (existing?.inputTokens ?? 0) + (entry.inputTokens ?? 0),
                    outputTokens: (existing?.outputTokens ?? 0) + (entry.outputTokens ?? 0),
                    cacheCreationTokens: (existing?.cacheCreationTokens ?? 0)
                        + (entry.cacheCreationInputTokens ?? 0),
                    cacheReadTokens: (existing?.cacheReadTokens ?? 0)
                        + (entry.cacheReadInputTokens ?? 0),
                )
            }
        }
        return byModel.values.sorted { $0.inputTokens + $0.outputTokens > $1.inputTokens + $1.outputTokens }
    }

    private static func iso8601(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.string(from: date)
    }

    private static func formatCurrency(_ amount: Double) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .currency
        formatter.currencyCode = "USD"
        return formatter.string(from: NSNumber(value: amount)) ?? "$\(amount)"
    }

    private func buildURL(path: String, queryItems: [URLQueryItem]) throws -> URL {
        guard let base = self.baseURL else {
            throw AnthropicAPIError.invalidURL
        }
        guard var components = URLComponents(
            url: base.appending(path: path),
            resolvingAgainstBaseURL: false,
        ) else {
            throw AnthropicAPIError.invalidURL
        }
        components.queryItems = queryItems
        guard let url = components.url else {
            throw AnthropicAPIError.invalidURL
        }
        return url
    }

    private func makeRequest(url: URL, token: String) -> URLRequest {
        var request = URLRequest(url: url)
        request.setValue(token, forHTTPHeaderField: "x-api-key")
        request.setValue("2023-06-01", forHTTPHeaderField: "anthropic-version")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        return request
    }

    private func fetchCostData(token: String, from startDate: Date) async throws -> Data {
        let url = try self.buildURL(path: "/v1/organizations/cost_report", queryItems: [
            URLQueryItem(name: "starting_at", value: Self.iso8601(startDate)),
            URLQueryItem(name: "bucket_width", value: "1d"),
        ])

        let request = self.makeRequest(url: url, token: token)
        let (data, _) = try await URLSession.shared.data(for: request)
        return data
    }

    private func fetchUsageData(token: String, from startDate: Date) async throws -> Data {
        let url = try self.buildURL(path: "/v1/organizations/usage_report/messages", queryItems: [
            URLQueryItem(name: "starting_at", value: Self.iso8601(startDate)),
            URLQueryItem(name: "bucket_width", value: "1d"),
            URLQueryItem(name: "group_by[]", value: "model"),
        ])

        let request = self.makeRequest(url: url, token: token)
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

// MARK: - AnthropicAPIError

package enum AnthropicAPIError: Error, CustomStringConvertible {
    case invalidURL
    case invalidDate

    // MARK: Package

    package var description: String {
        switch self {
        case .invalidURL: "Failed to construct API URL"
        case .invalidDate: "Failed to compute billing period"
        }
    }
}

// MARK: - AnthropicCostResponse

package struct AnthropicCostResponse: Codable {
    let data: [AnthropicCostBucket]
}

// MARK: - AnthropicCostBucket

package struct AnthropicCostBucket: Codable {
    let costs: [AnthropicCostEntry]
}

// MARK: - AnthropicCostEntry

package struct AnthropicCostEntry: Codable {
    let amount: String
}

// MARK: - AnthropicUsageResponse

package struct AnthropicUsageResponse: Codable {
    let data: [AnthropicUsageBucket]
}

// MARK: - AnthropicUsageBucket

package struct AnthropicUsageBucket: Codable {
    let usage: [AnthropicUsageEntry]
}

// MARK: - AnthropicUsageEntry

package struct AnthropicUsageEntry: Codable {
    enum CodingKeys: String, CodingKey {
        case model
        case inputTokens = "input_tokens"
        case outputTokens = "output_tokens"
        case cacheCreationInputTokens = "cache_creation_input_tokens"
        case cacheReadInputTokens = "cache_read_input_tokens"
    }

    let model: String?
    let inputTokens: Int?
    let outputTokens: Int?
    let cacheCreationInputTokens: Int?
    let cacheReadInputTokens: Int?
}
