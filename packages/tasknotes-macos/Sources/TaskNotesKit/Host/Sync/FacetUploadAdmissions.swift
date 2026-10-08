import Foundation
import TaskNotesUniFFI

/// A rejected admission retains the exact nonce and original monotonic clock.
/// Accepted ownership belongs to Rust; this ledger never processes its effects.
internal struct FacetUploadAdmissions {
    struct Request: Equatable {
        let nonce: Data
        let nowMs: UInt64
    }
    enum Outcome {
        case waiting
        case accepted([ObsidianSessionEffect])
    }
    private var retained: [String: Request] = [:]

    mutating func attempt(
        id: String, at: UInt64, random: () -> Data,
        queue: (Request) throws -> [ObsidianSessionEffect]
    ) throws -> Outcome {
        let request = retained[id] ?? Request(nonce: random(), nowMs: at)
        guard request.nonce.count == 12 else { throw FacetContractError.unsupportedResponse }
        retained[id] = request
        do {
            let effects = try queue(request)
            retained.removeValue(forKey: id)
            return .accepted(effects)
        } catch ObsidianBoundaryError.Busy {
            return .waiting
        } catch let error as ObsidianBoundaryError {
            if case .Boundary(let code, _) = error, code == "queue_full" { return .waiting }
            retained.removeValue(forKey: id)
            throw error
        } catch {
            retained.removeValue(forKey: id)
            throw error
        }
    }
}
