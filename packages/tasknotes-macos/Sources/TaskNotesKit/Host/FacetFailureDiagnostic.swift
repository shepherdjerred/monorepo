import Foundation
import TaskNotesUniFFI

/// Closed diagnostic codes deliberately exclude response bodies, paths, titles
/// and arbitrary LocalizedError descriptions. Underlying causes stay bounded.
public struct FacetFailureDiagnostic: Sendable, Equatable {
    public let classification: String
    public let chain: String
    public var action: String {
        let actions = [
            "network": "Check your connection and retry Sync.",
            "storage": "Check available storage before retrying your saved action.",
            "provider": "Restore folder access before retrying your saved action.",
            "configuration": "Review this vault's TaskNotes configuration before retrying.",
            "account": "Unlock this device and reconnect your Obsidian account.",
            "cancelled": "This background attempt was cancelled.",
            "internal_contract": "Install a matching app build before retrying your saved action.",
            "host_contract":
                "Retained vault bytes have been preserved. Contact support before retrying this action.",
            "busy":
                "Another vault operation is finishing. Your original action is retained; retry shortly.",
        ]
        return actions[classification]
            ?? "Open Facet to review this vault and retry the retained action."
    }

    public init(_ failure: any Error) {
        classification = Self.classify(failure)
        var pending: [(String, any Error)] = [("first", failure)]
        var visited = Set<ObjectIdentifier>()
        var entries: [String] = []
        while !pending.isEmpty, entries.count < 16 {
            let (relationship, error) = pending.removeFirst()
            let native = error as NSError
            guard visited.insert(ObjectIdentifier(native)).inserted else { continue }
            entries.append("\(relationship):\(Self.classify(error))")
            if let cause = native.userInfo[NSUnderlyingErrorKey] as? any Error {
                pending.append(("cause", cause))
            }
            if let causes = native.userInfo[NSMultipleUnderlyingErrorsKey] as? [any Error] {
                pending += causes.prefix(16).map { ("underlying", $0) }
            }
        }
        if !pending.isEmpty { entries.append("truncated") }
        chain = entries.joined(separator: ",")
    }

    private static func classify(_ failure: any Error) -> String {
        if let consumption = failure as? FacetPayloadConsumptionFailure {
            return classify(consumption.primary)
        }
        return directClassification(failure)
    }

    private static func directClassification(_ failure: any Error) -> String {
        if let engine = failure as? FacetEngineError { return engineClassification(engine) }
        if let host = failure as? FacetHostError { return hostClassification(host) }
        if let sync = failure as? FacetSyncError { return syncClassification(sync) }
        if failure is FacetContractError || failure is DecodingError { return "internal_contract" }
        if failure is AppleVaultError { return "provider" }
        if failure is CancellationError { return "cancelled" }
        if failure is FacetDraftError { return "retained_action" }
        if let sync = failure as? ObsidianBoundaryError { return boundaryClassification(sync) }
        let native = failure as NSError
        if native.domain == NSURLErrorDomain { return "network" }
        if native.domain == NSPOSIXErrorDomain || native.domain == NSCocoaErrorDomain {
            return "storage"
        }
        return "unexpected"
    }

    private static func engineClassification(_ error: FacetEngineError) -> String {
        switch error {
        case .Storage: "storage"
        case .Host: "provider"
        case .HostContract: "host_contract"
        case .Validation: "validation"
        case .Configuration: "configuration"
        case .Conflict: "conflict"
        case .NotFound: "missing_profile_or_note"
        case .Closed: "closed_engine"
        case .Busy: "busy"
        }
    }

    private static func boundaryClassification(_ error: ObsidianBoundaryError) -> String {
        switch error {
        case .Busy: "busy"
        case .Lock, .Request: "internal_contract"
        case .Boundary: "sync_boundary"
        }
    }

    private static func hostClassification(_ error: FacetHostError) -> String {
        switch error {
        case .Unavailable, .PermissionDenied: "provider"
        case .Io: "storage"
        case .Contract: "host_contract"
        }
    }

    private static func syncClassification(_ error: FacetSyncError) -> String {
        switch error {
        case .transport: "network"
        case .secureStorage, .signedOut: "account"
        case .cancelled: "cancelled"
        case .responseTooLarge: "sync_boundary"
        case .missingTimestamp: "retained_action"
        }
    }
}
