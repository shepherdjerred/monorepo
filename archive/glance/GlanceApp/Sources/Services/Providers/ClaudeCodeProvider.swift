import Foundation
import Security

// MARK: - ClaudeCodeProvider

/// Monitors Claude Code plan usage (5-hour and 7-day windows).
/// Reads OAuth token from macOS Keychain or ~/.claude/.credentials.json.
struct ClaudeCodeProvider: ServiceProvider {
    // MARK: Internal

    let id = "claude-code"
    let displayName = "Claude Code"
    let iconName = "terminal.fill"
    let webURL: String? = "https://console.anthropic.com/settings/usage"

    /// Parse OAuth usage response JSON into a ServiceSnapshot.
    static func parse(_ data: Data) throws -> ServiceSnapshot {
        let response = try JSONDecoder().decode(OAuthUsageResponse.self, from: data)
        return self.buildSnapshot(from: response)
    }

    func fetchStatus() async -> ServiceSnapshot {
        let log = GlanceLogger.provider(self.id)
        let start = ContinuousClock.now
        do {
            log.debug("Fetching usage from Claude Code API")
            let response = try await self.fetchUsage()
            let snapshot = Self.buildSnapshot(from: response)
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

    private static let usageURL = URL(string: "https://api.anthropic.com/api/oauth/usage")

    private static let cacheKey = "claude-code-token"

    private static let responseCacheKey = "claude-code-response"

    private static func buildSnapshot(from response: OAuthUsageResponse) -> ServiceSnapshot {
        let fiveHour = response.fiveHour.map { window in
            UsageWindow(utilization: window.utilization ?? 0, resetsAt: window.resetsAt.flatMap(self.parseISO8601))
        }
        let sevenDay = response.sevenDay.map { window in
            UsageWindow(utilization: window.utilization ?? 0, resetsAt: window.resetsAt.flatMap(self.parseISO8601))
        }

        let usage = ClaudeCodeUsage(fiveHour: fiveHour, sevenDay: sevenDay)
        let maxUtil = max(fiveHour?.utilization ?? 0, sevenDay?.utilization ?? 0)
        let status: ServiceStatus = maxUtil >= 95 ? .error : maxUtil >= 80 ? .warning : .ok

        return ServiceSnapshot(
            id: "claude-code",
            displayName: "Claude Code",
            iconName: "terminal.fill",
            status: status,
            summary: "5hr: \(Int(fiveHour?.utilization ?? 0))% · 7d: \(Int(sevenDay?.utilization ?? 0))%",
            detail: .claudeCode(usage: usage),
            error: nil,
            timestamp: .now,
        )
    }

    private static func parseISO8601(_ string: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.date(from: string) ?? {
            let basic = ISO8601DateFormatter()
            basic.formatOptions = [.withInternetDateTime]
            return basic.date(from: string)
        }()
    }

    private static func loadFromClaudeKeychain() -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: "Claude Code-credentials",
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]

        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        guard status == errSecSuccess, let data = result as? Data,
              let json = String(data: data, encoding: .utf8), !json.isEmpty,
              let jsonData = json.data(using: .utf8),
              let creds = try? JSONDecoder().decode(ClaudeCodeCredentials.self, from: jsonData),
              let token = creds.token, !token.isEmpty
        else {
            return nil
        }
        return token
    }

    private static func request(url: URL, token: String) async throws -> (Data, URLResponse) {
        var request = URLRequest(url: url)
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("oauth-2025-04-20", forHTTPHeaderField: "anthropic-beta")
        return try await URLSession.shared.data(for: request)
    }

    private static func cacheResponse(_ data: Data) {
        if let json = String(data: data, encoding: .utf8) {
            GlanceCache.write(key: self.responseCacheKey, value: json)
        }
    }

    private static func loadCachedResponse() -> OAuthUsageResponse? {
        guard let json = GlanceCache.read(key: self.responseCacheKey),
              let data = json.data(using: .utf8)
        else {
            return nil
        }
        return try? JSONDecoder().decode(OAuthUsageResponse.self, from: data)
    }

    private func fetchUsage() async throws -> OAuthUsageResponse {
        guard let url = Self.usageURL else {
            throw ClaudeCodeAuthError.invalidURL
        }
        let token = try self.loadToken()
        let (data, response) = try await Self.request(url: url, token: token)
        let http = response as? HTTPURLResponse

        // Rate limited — return cached response if available
        if http?.statusCode == 429 {
            if let cached = Self.loadCachedResponse() {
                return cached
            }
            throw ClaudeCodeAuthError.rateLimited
        }

        // Auth failed — refresh token and retry once
        if http?.statusCode == 401 {
            if let fresh = self.refreshToken() {
                let (retryData, _) = try await Self.request(url: url, token: fresh)
                let decoded = try JSONDecoder().decode(OAuthUsageResponse.self, from: retryData)
                Self.cacheResponse(retryData)
                return decoded
            }
        }

        let decoded = try JSONDecoder().decode(OAuthUsageResponse.self, from: data)
        Self.cacheResponse(data)
        return decoded
    }

    /// Re-fetch token from original sources, bypassing cache.
    private func refreshToken() -> String? {
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        let credPath = "\(home)/.claude/.credentials.json"
        if let credData = FileManager.default.contents(atPath: credPath),
           let creds = try? JSONDecoder().decode(ClaudeCodeCredentials.self, from: credData),
           let token = creds.token, !token.isEmpty
        {
            GlanceCache.write(key: Self.cacheKey, value: token)
            return token
        }
        if let token = Self.loadFromClaudeKeychain() {
            GlanceCache.write(key: Self.cacheKey, value: token)
            return token
        }
        return nil
    }

    private func loadToken() throws -> String {
        // 1. Try our own keychain cache (no prompts)
        if let token = GlanceCache.read(key: Self.cacheKey), !token.isEmpty {
            return token
        }

        // 2. Try credentials file
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        let credPath = "\(home)/.claude/.credentials.json"
        if let credData = FileManager.default.contents(atPath: credPath),
           let creds = try? JSONDecoder().decode(ClaudeCodeCredentials.self, from: credData),
           let token = creds.token, !token.isEmpty
        {
            GlanceCache.write(key: Self.cacheKey, value: token)
            return token
        }

        // 3. Last resort: read Claude Code's keychain entry (may prompt once)
        if let token = Self.loadFromClaudeKeychain() {
            GlanceCache.write(key: Self.cacheKey, value: token)
            return token
        }

        throw ClaudeCodeAuthError.noCredentials
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

// MARK: - ClaudeCodeAuthError

package enum ClaudeCodeAuthError: Error, CustomStringConvertible {
    case noCredentials
    case invalidURL
    case rateLimited

    // MARK: Package

    package var description: String {
        switch self {
        case .noCredentials: "No Claude Code credentials found in Keychain or ~/.claude/.credentials.json"
        case .invalidURL: "Invalid usage API URL"
        case .rateLimited: "Rate limited — no cached data available"
        }
    }
}

// MARK: - ClaudeCodeCredentials

/// Keychain format: {"claudeAiOauth": {"accessToken": "..."}}
/// File format: {"claudeAiOauth": {"accessToken": "..."}} or {"access_token": "..."}
package struct ClaudeCodeCredentials: Codable {
    struct OAuthTokens: Codable {
        let accessToken: String?
    }

    let claudeAiOauth: OAuthTokens?

    var token: String? {
        self.claudeAiOauth?.accessToken
    }
}

// MARK: - OAuthUsageResponse

package struct OAuthUsageResponse: Codable {
    enum CodingKeys: String, CodingKey {
        case fiveHour = "five_hour"
        case sevenDay = "seven_day"
    }

    let fiveHour: OAuthUsageWindow?
    let sevenDay: OAuthUsageWindow?
}

// MARK: - OAuthUsageWindow

package struct OAuthUsageWindow: Codable {
    enum CodingKeys: String, CodingKey {
        case utilization
        case resetsAt = "resets_at"
    }

    let utilization: Double?
    let resetsAt: String?
}
