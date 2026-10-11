import Foundation
import TaskNotesUniFFI

/// Content-free evidence distinguishing the official preflight and POST.
public struct FacetAccountExchangeDiagnostic: Codable, Equatable, Sendable {
    public enum Stage: String, Codable, Sendable { case preflight, post }
    public let stage: Stage
    public let statusCode: UInt16?
    public let failureClassification: String?
    enum CodingKeys: String, CodingKey { case stage, statusCode, failureClassification }
    public func encode(to encoder: any Encoder) throws {
        var fields = encoder.container(keyedBy: CodingKeys.self)
        try fields.encode(stage, forKey: .stage)
        try fields.encode(statusCode, forKey: .statusCode)
        try fields.encode(failureClassification, forKey: .failureClassification)
    }
}

/// Every suspension in an account exchange must preserve the original intent.
/// The injected sender is also the production URLSession boundary.
internal enum FacetAccountHTTP {
    static func perform(
        _ request: ObsidianHttpRequest,
        ownsAttempt: () -> Bool,
        send: (URLRequest) async throws -> (UInt16, Data),
        diagnostic: (FacetAccountExchangeDiagnostic) -> Void = { _ in }
    ) async throws -> (UInt16, Data) {
        try check(ownsAttempt)
        guard let url = URL(string: request.url), url.scheme == "https" else {
            throw FacetSyncError.transport
        }
        if request.preflight {
            var preflight = URLRequest(url: url)
            preflight.httpMethod = "OPTIONS"
            for header in request.headers where header.name.lowercased() == "origin" {
                preflight.setValue(header.value, forHTTPHeaderField: header.name)
            }
            try check(ownsAttempt)
            _ = try await exchange(preflight, stage: .preflight, send: send, diagnostic: diagnostic)
            try check(ownsAttempt)
        }
        var native = URLRequest(url: url)
        native.httpMethod = "POST"
        native.httpBody = Data(request.body.utf8)
        for header in request.headers {
            native.setValue(header.value, forHTTPHeaderField: header.name)
        }
        try check(ownsAttempt)
        let response = try await exchange(native, stage: .post, send: send, diagnostic: diagnostic)
        try check(ownsAttempt)
        return response
    }

    private static func exchange(
        _ request: URLRequest, stage: FacetAccountExchangeDiagnostic.Stage,
        send: (URLRequest) async throws -> (UInt16, Data),
        diagnostic: (FacetAccountExchangeDiagnostic) -> Void
    ) async throws -> (UInt16, Data) {
        diagnostic(
            FacetAccountExchangeDiagnostic(
                stage: stage, statusCode: nil, failureClassification: nil))
        do {
            let response = try await send(request)
            diagnostic(
                FacetAccountExchangeDiagnostic(
                    stage: stage, statusCode: response.0, failureClassification: nil))
            return response
        } catch {
            diagnostic(
                FacetAccountExchangeDiagnostic(
                    stage: stage, statusCode: nil,
                    failureClassification: FacetFailureDiagnostic(error).classification))
            throw error
        }
    }

    private static func check(_ ownsAttempt: () -> Bool) throws {
        try _Concurrency.Task.checkCancellation()
        guard ownsAttempt() else { throw FacetSyncError.cancelled }
    }
}
