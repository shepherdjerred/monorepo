import Darwin
public import Foundation

/// Minimal nonsecret extension actions. The application owns the engine and
/// turns each capture into a durable mutation before acknowledging this queue.
public struct FacetIntentCapture: Codable, Sendable, Identifiable {
    public let schemaVersion: UInt32
    public let id: String
    public let profileID: String
    public let title: String
    public let at: String
    public let today: String
    public let timezone: String
}

public struct FacetIntentQueue: Sendable {
    internal let directory: URL

    public init(directory: URL) throws {
        self.directory = directory
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let root = try VaultDirectory(url: directory)
        _ = try root.directory("captures", create: true)
        try root.synchronize()
    }

    public func selectProfile(_ profileID: String?) throws {
        if let profileID {
            guard !profileID.isEmpty, profileID.utf8.count <= 256,
                !profileID.unicodeScalars.contains(where: CharacterSet.controlCharacters.contains)
            else { throw FacetContractError.unsupportedResponse }
        }
        let root = try VaultDirectory(url: directory)
        let value = FacetValue.object([
            "schemaVersion": .integer(1), "profileID": profileID.map(FacetValue.string) ?? .null,
        ])
        try root.replaceMetadata("profile.json", bytes: Data(FacetJSON.encode(value).utf8))
    }

    public func enqueue(title: String, at: Date = .now) throws -> FacetIntentCapture {
        let profileID = try selectedProfile()
        let capture = FacetIntentCapture(
            schemaVersion: 1, id: UUID().uuidString, profileID: profileID, title: title,
            at: at.ISO8601Format(), today: SystemClock(instant: { at }).viewerCalendar().today,
            timezone: TimeZone.current.identifier)
        try validate(capture)
        let files = try VaultDirectory(url: directory).directory("captures")
        let temporary = capture.id + ".temporary"
        try files.writeNew(temporary, bytes: JSONEncoder().encode(capture))
        try files.rename(
            temporary, to: files, name: capture.id + ".json", flags: UInt32(RENAME_EXCL))
        try files.synchronize()
        return capture
    }

    public func pending(afterID: String? = nil, limit: Int = 128) throws -> [FacetIntentCapture] {
        guard (1...128).contains(limit) else { throw FacetContractError.unsupportedResponse }
        let files = try VaultDirectory(url: directory).directory("captures")
        var result: [FacetIntentCapture] = []
        for name in try files.entries() {
            let id = String(name.prefix(while: { $0 != "." }))
            guard UUID(uuidString: id) != nil else { throw FacetContractError.unsupportedResponse }
            if name == id + ".temporary" { continue }
            guard name == id + ".json" else { throw FacetContractError.unsupportedResponse }
            if let afterID, id <= afterID { continue }
            guard let bytes = try boundedRead(files, name: name) else {
                throw FacetContractError.unsupportedResponse
            }
            try validateKeys(bytes)
            let capture = try JSONDecoder().decode(FacetIntentCapture.self, from: bytes)
            try validate(capture)
            guard capture.id == id else { throw FacetContractError.unsupportedResponse }
            result.append(capture)
            if result.count == limit { break }
        }
        return result
    }

    public func acknowledge(id: String) throws {
        guard UUID(uuidString: id) != nil else { throw FacetContractError.unsupportedResponse }
        let files = try VaultDirectory(url: directory).directory("captures")
        try files.remove(id + ".json")
        try files.synchronize()
    }

    private func selectedProfile() throws -> String {
        let root = try VaultDirectory(url: directory)
        guard let data = try boundedRead(root, name: "profile.json"),
            let fields = try FacetJSON.parse(data).object?.fields,
            Set(fields.keys) == ["schemaVersion", "profileID"],
            fields["schemaVersion"] == .integer(1),
            let id = fields["profileID"]?.text, !id.isEmpty
        else { throw FacetIntentError.chooseVault }
        return id
    }

    private func boundedRead(_ directory: VaultDirectory, name: String) throws -> Data? {
        guard let file = try directory.openFile(name) else { return nil }
        let size = try file.size()
        // An 8192-byte title can need six JSON bytes per escaped character.
        guard size <= 65_536 else { throw FacetContractError.unsupportedResponse }
        let bytes = try file.read(offset: 0, length: Int(size))
        guard bytes.count == Int(size) else { throw FacetContractError.unsupportedResponse }
        return bytes
    }

    private func validateKeys(_ bytes: Data) throws {
        guard let fields = try FacetJSON.parse(bytes).object?.fields,
            Set(fields.keys) == [
                "schemaVersion", "id", "profileID", "title", "at", "today", "timezone",
            ],
            fields["schemaVersion"] == .integer(1)
        else { throw FacetContractError.unsupportedResponse }
    }

    private func validate(_ capture: FacetIntentCapture) throws {
        guard capture.schemaVersion == 1, UUID(uuidString: capture.id) != nil,
            !capture.profileID.isEmpty, capture.profileID.utf8.count <= 256,
            !capture.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
            capture.title.utf8.count <= 8192, TimeZone(identifier: capture.timezone) != nil,
            ISO8601DateFormatter().date(from: capture.at) != nil,
            capture.today.count == 10
        else { throw FacetIntentError.invalidTitle }
    }
}

public enum FacetIntentError: Error, LocalizedError {
    case chooseVault, invalidTitle, unavailableGroup
    public var errorDescription: String? {
        switch self {
        case .chooseVault: "Open Facet and select the vault for quick-add before using this action."
        case .invalidTitle: "Enter a task title of at most 8192 UTF-8 bytes."
        case .unavailableGroup:
            "Facet cannot access its shared quick-add storage. Check the app installation."
        }
    }
}
