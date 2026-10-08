import Foundation
import TaskNotesUniFFI

extension FacetObsidianSession {
    internal func beginReading(_ socket: URLSessionWebSocketTask, epoch current: UInt64) async {
        guard current == epoch, await events.send(.opened(current)) else { return }
        let queue = events
        let limits = self.limits
        reader = _Concurrency.Task {
            do {
                while !_Concurrency.Task.isCancelled {
                    switch try await socket.receive() {
                    case .string(let text):
                        try FacetSocketLimits.validate(.string(text), limits: limits)
                        guard await queue.send(.text(current, text)) else { return }
                    case .data(let bytes):
                        try FacetSocketLimits.validate(.data(bytes), limits: limits)
                        guard await queue.send(.binary(current, bytes)) else { return }
                    @unknown default: throw FacetContractError.unsupportedResponse
                    }
                }
            } catch { if !_Concurrency.Task.isCancelled { _ = await queue.send(.lost(current)) } }
        }
    }

    internal static func unsigned(_ value: FacetValue) -> UInt64? {
        switch value {
        case .unsigned(let value): value
        case .integer(let value): UInt64(exactly: value)
        case .null, .bool, .number, .rawNumber, .string, .array, .object: nil
        }
    }
}
