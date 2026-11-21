public import Foundation

/// HTTP client communicating with `tasknotes-server` over `/api/v1/...` endpoints.
public final class FacetAPIClient: Sendable {
    public let baseURL: URL
    public let authToken: String?
    public let session: URLSession

    public init(
        baseURL: URL,
        authToken: String? = nil,
        session: URLSession = .shared
    ) {
        self.baseURL = baseURL
        self.authToken = authToken
        self.session = session
    }

    /// Synchronizes local commands and fetches server updates over `/api/v1/sync`.
    public func sync(request: SyncRequest) async throws -> SyncResponse {
        let encoder = JSONEncoder()
        let body = try encoder.encode(request)
        let urlRequest = makeRequest(path: "/api/v1/sync", method: "POST", body: body)
        return try await execute(urlRequest)
    }

    /// Fetches all active tasks over `/api/v1/tasks`.
    public func fetchTasks() async throws -> [Task] {
        let urlRequest = makeRequest(path: "/api/v1/tasks", method: "GET")
        return try await execute(urlRequest)
    }

    /// Creates a single task over `/api/v1/tasks`.
    public func createTask(args: TaskAddArgs) async throws -> Task {
        let encoder = JSONEncoder()
        let body = try encoder.encode(args)
        let urlRequest = makeRequest(path: "/api/v1/tasks", method: "POST", body: body)
        return try await execute(urlRequest)
    }

    /// Loads private bytes separately from task metadata, using the same service credentials.
    public func attachment(taskID: String, commentID: String) async throws -> Data {
        let path = "/api/v1/tasks/\(taskID)/comments/\(commentID)/file"
        var request = makeRequest(path: path, method: "GET")
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.setValue("application/octet-stream", forHTTPHeaderField: "Accept")
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            throw FacetAPIError.badServerResponse(
                statusCode: (response as? HTTPURLResponse)?.statusCode ?? -1,
                body: "Attachment unavailable")
        }
        return data
    }

    // MARK: - Private Helpers

    private func makeURL(path: String) -> URL {
        let trimmedBase =
            baseURL.absoluteString.hasSuffix("/")
            ? String(baseURL.absoluteString.dropLast())
            : baseURL.absoluteString
        let cleanPath = path.hasPrefix("/") ? path : "/\(path)"
        if let url = URL(string: trimmedBase + cleanPath) {
            return url
        }
        return baseURL.appendingPathComponent(path)
    }

    private func makeRequest(
        path: String,
        method: String,
        body: Data? = nil
    ) -> URLRequest {
        let url = makeURL(path: path)
        var request = URLRequest(url: url)
        request.httpMethod = method
        if let token = authToken, !token.isEmpty {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = body
        }
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        return request
    }

    private func execute<T: Decodable>(_ request: URLRequest) async throws -> T {
        let (data, response) = try await session.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw FacetAPIError.badServerResponse(statusCode: -1, body: "Non-HTTP response")
        }
        guard (200...299).contains(httpResponse.statusCode) else {
            let bodyString = String(bytes: data, encoding: .utf8) ?? ""
            throw FacetAPIError.badServerResponse(
                statusCode: httpResponse.statusCode, body: bodyString)
        }
        do {
            let decoder = JSONDecoder()
            return try decoder.decode(T.self, from: data)
        } catch {
            throw FacetAPIError.decodingError(error.localizedDescription)
        }
    }
}

/// Errors produced by `FacetAPIClient`.
public enum FacetAPIError: Error, LocalizedError, Equatable, Sendable {
    case invalidURL(String)
    case badServerResponse(statusCode: Int, body: String)
    case decodingError(String)

    public var errorDescription: String? {
        switch self {
        case .invalidURL(let url):
            return "Invalid URL: \(url)"
        case .badServerResponse(let statusCode, let body):
            return "Server responded with status \(statusCode): \(body)"
        case .decodingError(let details):
            return "Failed to decode response: \(details)"
        }
    }
}
