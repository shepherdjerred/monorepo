public import Foundation

public struct FacetTrackingStop: Codable, Sendable, Identifiable {
    public let schemaVersion: UInt32
    public let id: String
    public let profileID: String
    public let engineIdentity: String
    public let sessionID: String
    public let taskPath: String
    public let taskRevision: String
    public let at: String
    public let today: String
    public let timezone: String

    public var command: FacetValue {
        .object([
            "kind": .string("stop_time"), "path": .string(taskPath),
            "expectedRevision": .string(taskRevision),
        ])
    }

    public func requireCurrent(_ plan: FacetTrackingPlan, engineIdentity: String) throws {
        guard self.engineIdentity == engineIdentity, plan.profileID == profileID,
            plan.rows.contains(where: {
                $0.taskPath == taskPath && $0.sessionId == sessionID
                    && $0.taskRevision == taskRevision && $0.state == "running"
            })
        else { throw FacetTrackingStopError.staleActivity }
    }
}

public enum FacetTrackingStopError: Error, LocalizedError {
    case staleActivity
    public var errorDescription: String? {
        "Tracking changed since this activity was shown. Open the task to review its current session."
    }
}

extension FacetIntentQueue {
    public func enqueueTrackingStop(
        profileID: String, engineIdentity: String, sessionID: String, taskPath: String,
        taskRevision: String,
        at: Date = .now
    ) throws -> FacetTrackingStop {
        let stop = FacetTrackingStop(
            schemaVersion: 1, id: UUID().uuidString, profileID: profileID,
            engineIdentity: engineIdentity,
            sessionID: sessionID, taskPath: taskPath, taskRevision: taskRevision,
            at: at.ISO8601Format(), today: SystemClock(instant: { at }).viewerCalendar().today,
            timezone: TimeZone.current.identifier)
        try validate(stop)
        try stops().writeNewAtomic(stop.id + ".json", bytes: JSONEncoder().encode(stop))
        return stop
    }

    public func pendingTrackingStops(afterID: String? = nil, limit: Int = 128) throws
        -> [FacetTrackingStop]
    {
        guard (1...128).contains(limit),
            afterID == nil || afterID.flatMap(UUID.init(uuidString:)) != nil
        else { throw FacetContractError.unsupportedResponse }
        let files = try stops()
        var result: [FacetTrackingStop] = []
        for name in try files.entries() {
            if try isTemporary(name) { continue }
            let id = String(name.dropLast(5))
            guard UUID(uuidString: id) != nil, name == id + ".json" else {
                throw FacetContractError.unsupportedResponse
            }
            if let afterID, id <= afterID { continue }
            guard let file = try files.openFile(name) else {
                throw FacetContractError.unsupportedResponse
            }
            let size = try file.size()
            guard size <= 16_384 else { throw FacetContractError.unsupportedResponse }
            let data = try file.read(offset: 0, length: Int(size))
            guard let fields = try FacetJSON.parse(data).object?.fields,
                Set(fields.keys) == [
                    "schemaVersion", "id", "profileID", "engineIdentity", "sessionID", "taskPath",
                    "taskRevision",
                    "at", "today", "timezone",
                ], fields["schemaVersion"] == .integer(1)
            else { throw FacetContractError.unsupportedResponse }
            let stop = try JSONDecoder().decode(FacetTrackingStop.self, from: data)
            try validate(stop)
            guard stop.id == id else { throw FacetContractError.unsupportedResponse }
            result.append(stop)
            if result.count == limit { break }
        }
        return result
    }

    public func acknowledgeTrackingStop(id: String) throws {
        guard UUID(uuidString: id) != nil else { throw FacetContractError.unsupportedResponse }
        let files = try stops()
        try files.remove(id + ".json")
        try files.synchronize()
    }

    private func stops() throws -> VaultDirectory {
        try VaultDirectory(url: directory).directory("tracking-stops", create: true)
    }

    private func isTemporary(_ name: String) throws -> Bool {
        guard name.hasSuffix(".temporary") else { return false }
        guard UUID(uuidString: String(name.dropLast(10))) != nil else {
            throw FacetContractError.unsupportedResponse
        }
        return true
    }

    private func validate(_ stop: FacetTrackingStop) throws {
        guard stop.schemaVersion == 1, UUID(uuidString: stop.id) != nil,
            !stop.profileID.isEmpty, stop.profileID.utf8.count <= 256,
            VaultRelativePath.isRevision(stop.engineIdentity),
            stop.sessionID.hasPrefix("facet-tracking:"),
            VaultRelativePath.isRevision(String(stop.sessionID.dropFirst(15))),
            VaultRelativePath.isRevision(stop.taskRevision),
            ISO8601DateFormatter().date(from: stop.at) != nil,
            TimeZone(identifier: stop.timezone) != nil, stop.today.count == 10
        else { throw FacetContractError.unsupportedResponse }
        try VaultRelativePath.validate(stop.taskPath)
    }
}
