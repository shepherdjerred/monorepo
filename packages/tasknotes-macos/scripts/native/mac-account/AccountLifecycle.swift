import CryptoKit
import Foundation

struct LifecycleFence {
    let round: Int
    let profileID: String
    let pendingCount: Int
    let outboxSHA256: String
    let checkpointSHA256: String

    init(_ input: [String: Any]) throws {
        guard
            Set(input.keys) == [
                "round", "profileID", "pendingCount", "outboxSHA256", "checkpointSHA256",
            ],
            let selectedRound = input["round"] as? Int, (1...3).contains(selectedRound),
            let profile = input["profileID"] as? String, UUID(uuidString: profile) != nil,
            let pending = input["pendingCount"] as? Int, pending > 0,
            let outboxHash = input["outboxSHA256"] as? String, Self.isHash(outboxHash),
            let checkpointHash = input["checkpointSHA256"] as? String, Self.isHash(checkpointHash)
        else { throw Failure.input }
        round = selectedRound
        profileID = profile
        pendingCount = pending
        outboxSHA256 = outboxHash
        checkpointSHA256 = checkpointHash
    }

    static func isHash(_ value: String) -> Bool {
        value.utf8.count == 64
            && value.utf8.allSatisfy { (48...57).contains($0) || (97...102).contains($0) }
    }

    func validate(_ status: [String: Any]) throws {
        try validateCheckpoint()
        guard let profiles = status["profiles"] as? [[String: Any]], profiles.count == 1,
            let profile = profiles.first, profile["profileID"] as? String == profileID,
            profile["profileKind"] as? String == "obsidian_sync",
            profile["remoteVaultID"] as? String == remoteID,
            profile["phase"] as? String == "reconnectRequired",
            profile["transport"] as? String == "reconnectRequired",
            profile["hostWorkPending"] as? Bool == false,
            let durable = profile["durable"] as? [String: Any],
            durable["schemaVersion"] as? Int == 1,
            durable["profileId"] as? String == profileID,
            durable["profileKind"] as? String == "obsidian_sync",
            durable["initialSyncComplete"] as? Bool == true,
            durable["pendingUploadCount"] as? Int == pendingCount,
            durable["pendingRemoteCount"] as? Int == 0,
            durable["pendingMutationCount"] as? Int == 0,
            durable["conflictCount"] as? Int == 0
        else { throw Failure.run }
    }

    func validateCheckpoint() throws {
        let filename = directory + "/lifecycle-macos-checkpoint.json"
        let checkpoint = try json(filename)
        let bytes = try Data(contentsOf: URL(fileURLWithPath: filename))
        let digest = SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined()
        guard bytes.count <= 65536, digest == checkpointSHA256,
            checkpoint["schemaVersion"] as? Int == 1,
            checkpoint["runID"] as? String == runID, checkpoint["round"] as? Int == round,
            checkpoint["profileID"] as? String == profileID,
            checkpoint["pendingCount"] as? Int == pendingCount,
            let outbox = checkpoint["outbox"] as? [String: Any],
            outbox["count"] as? Int == pendingCount, outbox["sha256"] as? String == outboxSHA256
        else { throw Failure.run }
        let interruption = try json(state + "/control/interruption.json")
        guard Set(interruption.keys) == ["schemaVersion", "runID", "profileIDs"],
            interruption["schemaVersion"] as? Int == 1,
            (interruption["runID"] as? String).flatMap(UUID.init(uuidString:))
                == UUID(uuidString: runID),
            interruption["profileIDs"] as? [String] == [profileID]
        else { throw Failure.run }
    }
}
