public import Foundation
import TaskNotesUniFFI

internal final class FacetAccountRedirectPolicy: NSObject, URLSessionTaskDelegate {
    func urlSession(
        _ session: URLSession, task: URLSessionTask,
        willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
        completionHandler: @escaping @Sendable (URLRequest?) -> Void
    ) {
        completionHandler(nil)
    }
}

/// Content-free evidence distinguishing the official preflight and POST.
public struct FacetAccountExchangeDiagnostic: Codable, Equatable, Sendable {
    public enum Stage: String, Codable, Sendable { case preflight, post }
    public let stage: Stage
    public let statusCode: UInt16?
    public let failureClassification: String?
    public let boundaryCode: String?
    public let requestID: UUID
    public let capturedAt: String
    internal init(
        stage: Stage, statusCode: UInt16?, failureClassification: String?,
        boundaryCode: String? = nil, requestID: UUID = UUID()
    ) {
        self.stage = stage
        self.statusCode = statusCode
        self.failureClassification = failureClassification
        self.boundaryCode = boundaryCode
        self.requestID = requestID
        capturedAt = Date().formatted(
            .iso8601.year().month().day().time(includingFractionalSeconds: true).timeZone(
                separator: .omitted))
    }
    enum CodingKeys: String, CodingKey {
        case stage, statusCode, failureClassification, boundaryCode, requestID, capturedAt
    }
    public func encode(to encoder: any Encoder) throws {
        var fields = encoder.container(keyedBy: CodingKeys.self)
        try fields.encode(stage, forKey: .stage)
        try fields.encode(statusCode, forKey: .statusCode)
        try fields.encode(failureClassification, forKey: .failureClassification)
        try fields.encode(boundaryCode, forKey: .boundaryCode)
        try fields.encode(requestID, forKey: .requestID)
        try fields.encode(capturedAt, forKey: .capturedAt)
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
        let requestID = UUID()
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
            _ = try await exchange(
                preflight, context: (.preflight, requestID), send: send,
                diagnostic: { if ownsAttempt() { diagnostic($0) } })
            try check(ownsAttempt)
        }
        var native = URLRequest(url: url)
        native.httpMethod = "POST"
        native.httpBody = Data(request.body.utf8)
        for header in request.headers {
            native.setValue(header.value, forHTTPHeaderField: header.name)
        }
        try check(ownsAttempt)
        let response = try await exchange(
            native, context: (.post, requestID), send: send,
            diagnostic: { if ownsAttempt() { diagnostic($0) } })
        try check(ownsAttempt)
        return response
    }

    private static func exchange(
        _ request: URLRequest, context: (FacetAccountExchangeDiagnostic.Stage, UUID),
        send: (URLRequest) async throws -> (UInt16, Data),
        diagnostic: (FacetAccountExchangeDiagnostic) -> Void
    ) async throws -> (UInt16, Data) {
        diagnostic(
            FacetAccountExchangeDiagnostic(
                stage: context.0, statusCode: nil, failureClassification: nil, requestID: context.1)
        )
        do {
            let response = try await send(request)
            diagnostic(
                FacetAccountExchangeDiagnostic(
                    stage: context.0, statusCode: response.0, failureClassification: nil,
                    requestID: context.1))
            return response
        } catch {
            let failure = FacetFailureDiagnostic(error)
            diagnostic(
                FacetAccountExchangeDiagnostic(
                    stage: context.0, statusCode: nil,
                    failureClassification: failure.classification,
                    boundaryCode: failure.boundaryCode,
                    requestID: context.1))
            throw error
        }
    }

    static func decoded<Response>(
        _ response: (UInt16, Data), diagnostic: FacetAccountExchangeDiagnostic,
        decode: (UInt16, String) throws -> Response,
        publish: (FacetAccountExchangeDiagnostic) -> Void
    ) throws -> Response {
        do {
            guard let body = String(data: response.1, encoding: .utf8) else {
                throw FacetContractError.unsupportedResponse
            }
            return try decode(response.0, body)
        } catch {
            let failure = FacetFailureDiagnostic(error)
            publish(
                FacetAccountExchangeDiagnostic(
                    stage: diagnostic.stage, statusCode: response.0,
                    failureClassification: failure.classification,
                    boundaryCode: failure.boundaryCode,
                    requestID: diagnostic.requestID))
            throw error
        }
    }

    private static func check(_ ownsAttempt: () -> Bool) throws {
        try _Concurrency.Task.checkCancellation()
        guard ownsAttempt() else { throw FacetSyncError.cancelled }
    }
}
