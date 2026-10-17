import Foundation
import TaskNotesUniFFI

enum FacetSocketLimits {
    static func configure(
        _ socket: URLSessionWebSocketTask, limits: ObsidianTransportLimits
    ) throws {
        guard let text = Int(exactly: limits.textMessageBytes),
            let binary = Int(exactly: limits.binaryMessageBytes)
        else { throw FacetContractError.unsupportedResponse }
        socket.maximumMessageSize = max(text, binary)
    }

    static func validate(
        _ message: URLSessionWebSocketTask.Message, limits: ObsidianTransportLimits
    ) throws {
        switch message {
        case .string(let text):
            guard UInt64(text.utf8.count) <= limits.textMessageBytes else {
                throw FacetSyncError.responseTooLarge
            }
        case .data(let bytes):
            guard UInt64(bytes.count) <= limits.binaryMessageBytes else {
                throw FacetSyncError.responseTooLarge
            }
        @unknown default: throw FacetContractError.unsupportedResponse
        }
    }
}
