import Foundation

// MARK: - OpenAIProvider

/// Monitors OpenAI API cost and token usage for the current billing period.
struct OpenAIProvider: ServiceProvider {
    // MARK: Lifecycle

    init(secrets: any SecretProvider) {
        self.secrets = secrets
    }

    // MARK: Internal

    let id = "openai-api"
    let displayName = "OpenAI API"
    let iconName = "sparkles"
    let webURL: String? = "https://platform.openai.com/usage"

    /// Parse OpenAI cost and usage data into a ServiceSnapshot.
    static func parse(costData: Data, usageData: Data) throws -> ServiceSnapshot {
        let costResponse = try JSONDecoder().decode(OpenAICostResponse.self, from: costData)
        let usageResponse = try JSONDecoder().decode(OpenAIUsageResponse.self, from: usageData)

        let totalCost = costResponse.data.reduce(0.0) { total, bucket in
            total + bucket.results.reduce(0.0) { subtotal, result in
                subtotal + (result.amount?.value ?? 0)
            }
        }

        let modelBreakdown = self.aggregateByModel(usageResponse)

        let now = Date()
        let startOfMonth = Calendar.current.date(
            from: Calendar.current.dateComponents([.year, .month], from: now),
        ) ?? now

        let usage = OpenAIAPIUsage(
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
            id: "openai-api",
            displayName: "OpenAI API",
            iconName: "sparkles",
            status: status,
            summary: summary,
            detail: .openAIAPI(usage: usage),
            error: nil,
            timestamp: .now,
        )
    }

    func fetchStatus() async -> ServiceSnapshot {
        let log = GlanceLogger.provider(self.id)
        let start = ContinuousClock.now
        do {
            let token = try await secrets.read(reference: SecretRefs.openaiAdmin)
            let now = Date()
            guard let startOfMonth = Calendar.current.date(
                from: Calendar.current.dateComponents([.year, .month], from: now),
            ) else {
                throw OpenAIAPIError.invalidDate
            }
            let startUnix = Int(startOfMonth.timeIntervalSince1970)

            log.debug("Fetching cost and usage reports")
            async let costData = self.fetchCostData(token: token, startUnix: startUnix)
            async let usageData = self.fetchUsageData(token: token, startUnix: startUnix)

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

    private let baseURL = URL(string: "https://api.openai.com")
    private let secrets: any SecretProvider

    private static func aggregateByModel(_ response: OpenAIUsageResponse) -> [OpenAIModelUsage] {
        var byModel: [String: OpenAIModelUsage] = [:]
        for bucket in response.data {
            for result in bucket.results {
                let model = result.model ?? "unknown"
                let existing = byModel[model]
                byModel[model] = OpenAIModelUsage(
                    model: model,
                    inputTokens: (existing?.inputTokens ?? 0) + (result.inputTokens ?? 0),
                    outputTokens: (existing?.outputTokens ?? 0) + (result.outputTokens ?? 0),
                    requests: (existing?.requests ?? 0) + (result.numModelRequests ?? 0),
                )
            }
        }
        return byModel.values.sorted { $0.inputTokens + $0.outputTokens > $1.inputTokens + $1.outputTokens }
    }

    private static func formatCurrency(_ amount: Double) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .currency
        formatter.currencyCode = "USD"
        return formatter.string(from: NSNumber(value: amount)) ?? "$\(amount)"
    }

    private func buildURL(path: String, queryItems: [URLQueryItem]) throws -> URL {
        guard let base = self.baseURL else {
            throw OpenAIAPIError.invalidURL
        }
        guard var components = URLComponents(
            url: base.appending(path: path),
            resolvingAgainstBaseURL: false,
        ) else {
            throw OpenAIAPIError.invalidURL
        }
        components.queryItems = queryItems
        guard let url = components.url else {
            throw OpenAIAPIError.invalidURL
        }
        return url
    }

    private func makeRequest(url: URL, token: String) -> URLRequest {
        var request = URLRequest(url: url)
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        return request
    }

    private func fetchCostData(token: String, startUnix: Int) async throws -> Data {
        let url = try self.buildURL(path: "/v1/organization/costs", queryItems: [
            URLQueryItem(name: "start_time", value: String(startUnix)),
            URLQueryItem(name: "bucket_width", value: "1d"),
        ])
        let request = self.makeRequest(url: url, token: token)
        let (data, _) = try await URLSession.shared.data(for: request)
        return data
    }

    private func fetchUsageData(token: String, startUnix: Int) async throws -> Data {
        let url = try self.buildURL(path: "/v1/organization/usage/completions", queryItems: [
            URLQueryItem(name: "start_time", value: String(startUnix)),
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

// MARK: - OpenAIAPIError

package enum OpenAIAPIError: Error, CustomStringConvertible {
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

// MARK: - OpenAICostResponse

package struct OpenAICostResponse: Codable {
    let data: [OpenAICostBucket]
}

// MARK: - OpenAICostBucket

package struct OpenAICostBucket: Codable {
    let results: [OpenAICostResult]
}

// MARK: - OpenAICostResult

package struct OpenAICostResult: Codable {
    let amount: OpenAICostAmount?
}

// MARK: - OpenAICostAmount

package struct OpenAICostAmount: Codable {
    let value: Double?
}

// MARK: - OpenAIUsageResponse

package struct OpenAIUsageResponse: Codable {
    let data: [OpenAIUsageBucket]
}

// MARK: - OpenAIUsageBucket

package struct OpenAIUsageBucket: Codable {
    let results: [OpenAIUsageResult]
}

// MARK: - OpenAIUsageResult

package struct OpenAIUsageResult: Codable {
    enum CodingKeys: String, CodingKey {
        case model
        case inputTokens = "input_tokens"
        case outputTokens = "output_tokens"
        case numModelRequests = "num_model_requests"
    }

    let model: String?
    let inputTokens: Int?
    let outputTokens: Int?
    let numModelRequests: Int?
}
