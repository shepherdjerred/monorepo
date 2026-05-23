import Foundation

// MARK: - CodexProvider

/// Monitors OpenAI Codex plan usage (5-hour and 7-day windows).
/// Reads OAuth token from ~/.codex/auth.json.
struct CodexProvider: ServiceProvider {
    // MARK: Internal

    let id = "codex"
    let displayName = "Codex"
    let iconName = "chevron.left.forwardslash.chevron.right"
    let webURL: String? = "https://chatgpt.com/codex/settings/usage"

    /// Parse Codex usage response JSON into a ServiceSnapshot.
    static func parse(_ data: Data) throws -> ServiceSnapshot {
        let response = try JSONDecoder().decode(CodexUsageResponse.self, from: data)
        return self.buildSnapshot(from: response)
    }

    func fetchStatus() async -> ServiceSnapshot {
        let log = GlanceLogger.provider(self.id)
        let clockStart = ContinuousClock.now
        do {
            log.debug("Fetching usage from Codex API")
            let response = try await self.fetchUsage()
            let snapshot = Self.buildSnapshot(from: response)
            let duration = ContinuousClock.now - clockStart
            log.info("Fetch succeeded (\(duration, privacy: .public)): \(snapshot.summary, privacy: .public)")
            return snapshot
        } catch {
            let duration = ContinuousClock.now - clockStart
            log.error("Fetch failed (\(duration, privacy: .public)): \(error, privacy: .public)")
            return self.errorSnapshot(error.localizedDescription)
        }
    }

    func fetchDetail() async -> ServiceDetail {
        let snapshot = await self.fetchStatus()
        return snapshot.detail
    }

    // MARK: Private

    private static let usageURL = URL(string: "https://chatgpt.com/backend-api/wham/usage")

    private static let cacheKey = "codex-token"

    private static func buildSnapshot(from response: CodexUsageResponse) -> ServiceSnapshot {
        let rateLimit = response.rateLimit
        let fiveHour = rateLimit?.primaryWindow.map { window in
            UsageWindow(
                utilization: Double(window.usedPercent ?? 0),
                resetsAt: window.resetAt.map { Date(timeIntervalSince1970: TimeInterval($0)) },
            )
        }
        let sevenDay = rateLimit?.secondaryWindow.map { window in
            UsageWindow(
                utilization: Double(window.usedPercent ?? 0),
                resetsAt: window.resetAt.map { Date(timeIntervalSince1970: TimeInterval($0)) },
            )
        }

        let usage = CodexUsage(fiveHour: fiveHour, sevenDay: sevenDay)
        let maxUtil = max(fiveHour?.utilization ?? 0, sevenDay?.utilization ?? 0)
        let status: ServiceStatus = maxUtil >= 95 ? .error : maxUtil >= 80 ? .warning : .ok

        return ServiceSnapshot(
            id: "codex",
            displayName: "Codex",
            iconName: "chevron.left.forwardslash.chevron.right",
            status: status,
            summary: "5hr: \(Int(fiveHour?.utilization ?? 0))% · 7d: \(Int(sevenDay?.utilization ?? 0))%",
            detail: .codex(usage: usage),
            error: nil,
            timestamp: .now,
        )
    }

    private static func doRequest(url: URL, token: String) async throws -> (Data, URLResponse) {
        var request = URLRequest(url: url)
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        return try await URLSession.shared.data(for: request)
    }

    private func fetchUsage() async throws -> CodexUsageResponse {
        guard let url = Self.usageURL else {
            throw CodexAuthError.invalidURL
        }
        let token = try self.loadToken()
        let (data, response) = try await Self.doRequest(url: url, token: token)

        // If auth fails, refresh from source and retry
        if let http = response as? HTTPURLResponse, http.statusCode == 401 {
            if let fresh = self.refreshToken() {
                let (retryData, _) = try await Self.doRequest(url: url, token: fresh)
                return try JSONDecoder().decode(CodexUsageResponse.self, from: retryData)
            }
        }

        return try JSONDecoder().decode(CodexUsageResponse.self, from: data)
    }

    /// Re-read token from ~/.codex/auth.json, bypassing cache.
    private func refreshToken() -> String? {
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        let authPath = "\(home)/.codex/auth.json"
        guard let data = FileManager.default.contents(atPath: authPath),
              let auth = try? JSONDecoder().decode(CodexAuth.self, from: data),
              let token = auth.token, !token.isEmpty
        else {
            return nil
        }
        GlanceCache.write(key: Self.cacheKey, value: token)
        return token
    }

    private func loadToken() throws -> String {
        // 1. Try cache first (no "other app" access)
        if let token = GlanceCache.read(key: Self.cacheKey), !token.isEmpty {
            return token
        }

        // 2. Read from Codex's auth file (may trigger TCC prompt once)
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        let authPath = "\(home)/.codex/auth.json"
        guard let data = FileManager.default.contents(atPath: authPath) else {
            throw CodexAuthError.noCredentials
        }
        let auth = try JSONDecoder().decode(CodexAuth.self, from: data)
        guard let token = auth.token, !token.isEmpty else {
            throw CodexAuthError.noCredentials
        }
        GlanceCache.write(key: Self.cacheKey, value: token)
        return token
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

// MARK: - CodexAuthError

package enum CodexAuthError: Error, CustomStringConvertible {
    case noCredentials
    case invalidURL

    // MARK: Package

    package var description: String {
        switch self {
        case .noCredentials: "No Codex credentials found at ~/.codex/auth.json"
        case .invalidURL: "Invalid usage API URL"
        }
    }
}

// MARK: - CodexAuth

/// Format: {"tokens": {"access_token": "..."}, "auth_mode": "chatgpt", ...}
package struct CodexAuth: Codable {
    let tokens: CodexTokens?

    var token: String? {
        self.tokens?.accessToken
    }
}

// MARK: - CodexTokens

package struct CodexTokens: Codable {
    enum CodingKeys: String, CodingKey {
        case accessToken = "access_token"
    }

    let accessToken: String?
}

// MARK: - CodexUsageResponse

/// Response from chatgpt.com/backend-api/wham/usage
package struct CodexUsageResponse: Codable {
    enum CodingKeys: String, CodingKey {
        case rateLimit = "rate_limit"
    }

    let rateLimit: CodexRateLimit?
}

// MARK: - CodexRateLimit

package struct CodexRateLimit: Codable {
    enum CodingKeys: String, CodingKey {
        case primaryWindow = "primary_window"
        case secondaryWindow = "secondary_window"
    }

    let primaryWindow: CodexUsageWindow?
    let secondaryWindow: CodexUsageWindow?
}

// MARK: - CodexUsageWindow

package struct CodexUsageWindow: Codable {
    enum CodingKeys: String, CodingKey {
        case usedPercent = "used_percent"
        case resetAt = "reset_at"
    }

    let usedPercent: Int?
    let resetAt: Int?
}
