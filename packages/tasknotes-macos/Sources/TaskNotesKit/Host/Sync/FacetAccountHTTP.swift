import Foundation
import TaskNotesUniFFI

/// Every suspension in an account exchange must preserve the original intent.
/// The injected sender is also the production URLSession boundary.
internal enum FacetAccountHTTP {
    static func perform(
        _ request: ObsidianHttpRequest,
        ownsAttempt: () -> Bool,
        send: (URLRequest) async throws -> (UInt16, Data)
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
            _ = try await send(preflight)
            try check(ownsAttempt)
        }
        var native = URLRequest(url: url)
        native.httpMethod = "POST"
        native.httpBody = Data(request.body.utf8)
        for header in request.headers {
            native.setValue(header.value, forHTTPHeaderField: header.name)
        }
        try check(ownsAttempt)
        let response = try await send(native)
        try check(ownsAttempt)
        return response
    }

    private static func check(_ ownsAttempt: () -> Bool) throws {
        try _Concurrency.Task.checkCancellation()
        guard ownsAttempt() else { throw FacetSyncError.cancelled }
    }
}
