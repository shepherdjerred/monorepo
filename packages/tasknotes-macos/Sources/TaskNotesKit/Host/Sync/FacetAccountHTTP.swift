public import Foundation
import TaskNotesUniFFI

extension FacetAccountHTTP {
    internal static func response(_ request: URLRequest, transport: URLSession) async throws
        -> (UInt16, Data)
    {
        let (stream, nativeResponse) = try await transport.bytes(for: request)
        guard let response = nativeResponse as? HTTPURLResponse,
            let status = UInt16(exactly: response.statusCode)
        else { throw FacetSyncError.transport }
        let limit = 4 * 1024 * 1024
        guard response.expectedContentLength <= Int64(limit) else {
            throw FacetSyncError.responseTooLarge
        }
        var bytes = Data()
        for try await byte in stream {
            guard bytes.count < limit else { throw FacetSyncError.responseTooLarge }
            bytes.append(byte)
        }
        return (status, bytes)
    }
}

internal final class FacetAccountRedirectPolicy: NSObject, URLSessionTaskDelegate {
    func urlSession(
        _ session: URLSession, task: URLSessionTask,
        willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
        completionHandler: @escaping @Sendable (URLRequest?) -> Void
    ) {
        completionHandler(nil)
    }
}

/// Content-free evidence identifying an account operation and its HTTP stage.
public struct FacetAccountExchangeDiagnostic: Codable, Equatable, Sendable {
    public enum Stage: String, Codable, Sendable { case preflight, post }
    public enum RequestKind: String, Codable, CaseIterable, Sendable {
        case signIn = "sign_in"
        case listVaults = "list_vaults"
        case signOut = "sign_out"
        case vaultAccess = "vault_access"
        case userInfo = "user_info"
    }
    public let requestKind: RequestKind
    public let stage: Stage
    public let statusCode: UInt16?
    public let failureClassification: String?
    public let boundaryCode: String?
    public let requestID: UUID
    public let capturedAt: String
    internal init(
        requestKind: RequestKind, stage: Stage, statusCode: UInt16?, failureClassification: String?,
        boundaryCode: String? = nil, requestID: UUID = UUID()
    ) {
        self.requestKind = requestKind
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
        case requestKind, stage, statusCode, failureClassification, boundaryCode, requestID,
            capturedAt
    }
    public func encode(to encoder: any Encoder) throws {
        var fields = encoder.container(keyedBy: CodingKeys.self)
        try fields.encode(requestKind, forKey: .requestKind)
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
    private struct ExchangeContext {
        let requestKind: FacetAccountExchangeDiagnostic.RequestKind
        let stage: FacetAccountExchangeDiagnostic.Stage
        let requestID: UUID
    }

    static func perform(
        _ request: ObsidianHttpRequest,
        requestKind: FacetAccountExchangeDiagnostic.RequestKind,
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
                preflight,
                context: ExchangeContext(
                    requestKind: requestKind, stage: .preflight, requestID: requestID),
                send: send,
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
            native,
            context: ExchangeContext(requestKind: requestKind, stage: .post, requestID: requestID),
            send: send,
            diagnostic: { if ownsAttempt() { diagnostic($0) } })
        try check(ownsAttempt)
        return response
    }

    private static func exchange(
        _ request: URLRequest,
        context: ExchangeContext,
        send: (URLRequest) async throws -> (UInt16, Data),
        diagnostic: (FacetAccountExchangeDiagnostic) -> Void
    ) async throws -> (UInt16, Data) {
        diagnostic(
            FacetAccountExchangeDiagnostic(
                requestKind: context.requestKind, stage: context.stage, statusCode: nil,
                failureClassification: nil,
                requestID: context.requestID)
        )
        do {
            let response = try await send(request)
            diagnostic(
                FacetAccountExchangeDiagnostic(
                    requestKind: context.requestKind, stage: context.stage, statusCode: response.0,
                    failureClassification: nil, requestID: context.requestID))
            return response
        } catch {
            let failure = FacetFailureDiagnostic(error)
            diagnostic(
                FacetAccountExchangeDiagnostic(
                    requestKind: context.requestKind, stage: context.stage, statusCode: nil,
                    failureClassification: failure.classification,
                    boundaryCode: failure.boundaryCode,
                    requestID: context.requestID))
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
                    requestKind: diagnostic.requestKind, stage: diagnostic.stage,
                    statusCode: response.0,
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
