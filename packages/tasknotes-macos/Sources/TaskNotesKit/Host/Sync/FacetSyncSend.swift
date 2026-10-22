import Foundation

internal enum FacetSyncSendFailure: Error { case disconnected }

/// Only expected connectivity failures permit a new transport on foregrounding.
/// Authentication, cancellation and contract failures keep their own meaning.
internal enum FacetSyncSend {
    static func perform(_ send: () async throws -> Void) async throws {
        do { try await send() } catch let error as URLError {
            let connectivity: Set<URLError.Code> = [
                .networkConnectionLost, .notConnectedToInternet, .timedOut,
                .cannotConnectToHost, .cannotFindHost, .dnsLookupFailed,
            ]
            guard connectivity.contains(error.code) else { throw error }
            throw FacetSyncSendFailure.disconnected
        }
    }
}
