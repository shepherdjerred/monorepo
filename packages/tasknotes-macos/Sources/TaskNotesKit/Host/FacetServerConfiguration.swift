public import Foundation

/// Validation errors when configuring the Facet sync server URL.
public enum FacetServerConfigError: Error, LocalizedError, Sendable, Equatable {
    case invalidURL(String)

    public var errorDescription: String? {
        switch self {
        case .invalidURL(let raw):
            "Enter a valid http:// or https:// server URL (received '\(raw)')."
        }
    }
}

/// Persisted server endpoint configuration backed by `UserDefaults`.
public struct FacetServerConfiguration: Sendable {
    public static let defaultBaseURLString = "https://tasknotes.tailnet-1a49.ts.net"
    public static let baseURLDefaultsKey = UITesting.serverAddressDefaultsKey

    private let suiteName: String?
    private let overrideKey: String

    public init(
        suiteName: String? = nil,
        overrideKey: String = Self.baseURLDefaultsKey
    ) {
        self.suiteName = suiteName
        self.overrideKey = overrideKey
    }

    private var defaults: UserDefaults {
        if let suiteName, let suite = UserDefaults(suiteName: suiteName) {
            return suite
        }
        return .standard
    }

    public func baseURLString() -> String {
        if let stored = defaults.string(forKey: overrideKey),
            !stored.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        {
            return stored.trimmingCharacters(in: .whitespacesAndNewlines)
        }
        return Self.defaultBaseURLString
    }

    public func validatedBaseURL() throws(FacetServerConfigError) -> URL {
        try Self.parseBaseURL(baseURLString())
    }

    public func setBaseURLString(_ raw: String) throws(FacetServerConfigError) -> URL {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        let candidate = trimmed.isEmpty ? Self.defaultBaseURLString : trimmed
        let parsed = try Self.parseBaseURL(candidate)
        defaults.set(candidate, forKey: overrideKey)
        return parsed
    }

    public static func parseBaseURL(_ raw: String) throws(FacetServerConfigError) -> URL {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let components = URLComponents(string: trimmed),
            let scheme = components.scheme?.lowercased(),
            scheme == "http" || scheme == "https",
            let host = components.host,
            !host.isEmpty,
            let url = components.url
        else {
            throw .invalidURL(raw)
        }
        return url
    }
}
