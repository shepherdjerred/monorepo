#if DEBUG
    import Foundation
    import TaskNotesKit

    internal enum FacetAcceptanceMessages {
        typealias Command = FacetAcceptanceCommand
        typealias Result = FacetAcceptanceResult
        typealias InterruptionState = FacetAcceptanceInterruptionState
        typealias Ledger = FacetAcceptanceLedger
        typealias Profile = FacetAcceptanceProfile
        typealias Snapshot = FacetAcceptanceSnapshot
    }
    internal struct FacetAcceptanceCommand: Decodable {
        let schemaVersion: UInt32
        let runID: UUID
        let commandID: UUID
        let kind: Kind
        let profileID: String?
        enum Kind: String, Decodable { case refresh, interrupt, resume }
    }
    internal struct FacetAcceptanceResult: Codable {
        let schemaVersion: UInt32
        let runID: UUID
        let commandID: UUID
        let outcome: String
        let classification: String?
        enum CodingKeys: String, CodingKey {
            case schemaVersion, runID, commandID, outcome, classification
        }
        func encode(to encoder: any Encoder) throws {
            var fields = encoder.container(keyedBy: CodingKeys.self)
            try fields.encode(schemaVersion, forKey: .schemaVersion)
            try fields.encode(runID, forKey: .runID)
            try fields.encode(commandID, forKey: .commandID)
            try fields.encode(outcome, forKey: .outcome)
            try fields.encode(classification, forKey: .classification)
        }
    }
    internal struct FacetAcceptanceInterruptionState: Codable {
        let schemaVersion: UInt32
        let runID: UUID
        var profileIDs: Set<String>
    }
    internal struct FacetAcceptanceLedger: Codable {
        let schemaVersion: UInt32
        let runID: UUID
        let commandIDs: Set<UUID>
    }
    internal struct FacetAcceptanceProfile: Encodable {
        let profileID: String
        let profileKind: String
        let remoteVaultID: String?
        let phase: String
        let transport: String
        let durable: FacetDurableSyncStatus?
        let hostWorkPending: Bool
        enum CodingKeys: String, CodingKey {
            case profileID, profileKind, remoteVaultID, phase, transport, durable,
                hostWorkPending
        }
        func encode(to encoder: any Encoder) throws {
            var fields = encoder.container(keyedBy: CodingKeys.self)
            try fields.encode(profileID, forKey: .profileID)
            try fields.encode(profileKind, forKey: .profileKind)
            try fields.encode(remoteVaultID, forKey: .remoteVaultID)
            try fields.encode(phase, forKey: .phase)
            try fields.encode(transport, forKey: .transport)
            try fields.encode(durable, forKey: .durable)
            try fields.encode(hostWorkPending, forKey: .hostWorkPending)
        }
    }
    internal struct FacetAcceptanceSnapshot: Encodable {
        let schemaVersion = 1
        let runID: UUID
        let capturedAt: String
        let profiles: [FacetAcceptanceProfile]
        let accountStage: String
        let accountBusy: Bool
        let accountExchange: FacetAccountExchangeDiagnostic?
        enum CodingKeys: String, CodingKey {
            case schemaVersion, runID, capturedAt, profiles, accountStage, accountBusy,
                accountExchange
        }
        func encode(to encoder: any Encoder) throws {
            var fields = encoder.container(keyedBy: CodingKeys.self)
            try fields.encode(schemaVersion, forKey: .schemaVersion)
            try fields.encode(runID, forKey: .runID)
            try fields.encode(capturedAt, forKey: .capturedAt)
            try fields.encode(profiles, forKey: .profiles)
            try fields.encode(accountStage, forKey: .accountStage)
            try fields.encode(accountBusy, forKey: .accountBusy)
            try fields.encode(accountExchange, forKey: .accountExchange)
        }
    }
#endif
