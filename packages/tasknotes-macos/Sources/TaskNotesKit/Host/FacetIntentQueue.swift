public import Foundation

/// Minimal nonsecret App Group capture envelope queued by Siri / App Intents.
public struct FacetIntentCapture: Codable, Sendable, Equatable, Identifiable {
    public let schemaVersion: UInt32
    public let id: String
    public let title: String
    public let at: String
    public let today: String
    public let timezone: String

    public init(
        schemaVersion: UInt32 = 2,
        id: String,
        title: String,
        at: String,
        today: String,
        timezone: String
    ) {
        self.schemaVersion = schemaVersion
        self.id = id
        self.title = title
        self.at = at
        self.today = today
        self.timezone = timezone
    }
}

public enum FacetIntentError: Error, LocalizedError, Sendable, Equatable {
    case invalidTitle
    case unavailableGroup
    case invalidCaptureRecord

    public var errorDescription: String? {
        switch self {
        case .invalidTitle:
            "Enter a non-empty task title of at most 8,192 UTF-8 bytes."
        case .unavailableGroup:
            "Facet cannot access its shared quick-add storage."
        case .invalidCaptureRecord:
            "A queued quick-add record could not be validated."
        }
    }
}

/// Durable file-backed queue for App Intents quick-capture actions.
public struct FacetIntentQueue: Sendable {
    private let capturesDirectory: URL

    public init(directory: URL) throws {
        capturesDirectory = directory.appendingPathComponent("captures", isDirectory: true)
        try FileManager.default.createDirectory(
            at: capturesDirectory,
            withIntermediateDirectories: true
        )
    }

    public func enqueue(
        title: String,
        at: Date = .now,
        timeZone: TimeZone = .current
    ) throws -> FacetIntentCapture {
        let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, trimmed.utf8.count <= 8_192 else {
            throw FacetIntentError.invalidTitle
        }
        let formatter = ISO8601DateFormatter()
        let capture = FacetIntentCapture(
            id: UUID().uuidString.lowercased(),
            title: trimmed,
            at: formatter.string(from: at),
            today: ViewerCalendar.civilDateString(for: at, timeZone: timeZone),
            timezone: timeZone.identifier
        )
        try validate(capture)
        let destination = capturesDirectory.appendingPathComponent("\(capture.id).json")
        let encoded = try JSONEncoder().encode(capture)
        try encoded.write(to: destination, options: .atomic)
        return capture
    }

    public func pending(limit: Int = 128) throws -> [FacetIntentCapture] {
        guard (1...128).contains(limit) else { throw FacetIntentError.invalidCaptureRecord }
        let entries = try FileManager.default.contentsOfDirectory(
            at: capturesDirectory,
            includingPropertiesForKeys: nil,
            options: [.skipsHiddenFiles]
        )
        let jsonFiles =
            entries
            .filter { $0.pathExtension == "json" }
            .sorted { $0.lastPathComponent < $1.lastPathComponent }

        var results: [FacetIntentCapture] = []
        for fileURL in jsonFiles.prefix(limit) {
            let bytes = try Data(contentsOf: fileURL)
            guard bytes.count <= 65_536 else { throw FacetIntentError.invalidCaptureRecord }
            let decoded = try JSONDecoder().decode(FacetIntentCapture.self, from: bytes)
            try validate(decoded)
            results.append(decoded)
        }
        return results.sorted {
            if $0.at != $1.at { return $0.at < $1.at }
            return $0.id < $1.id
        }
    }

    public func acknowledge(id: String) throws {
        guard UUID(uuidString: id) != nil else { throw FacetIntentError.invalidCaptureRecord }
        let fileURL = capturesDirectory.appendingPathComponent("\(id.lowercased()).json")
        if FileManager.default.fileExists(atPath: fileURL.path) {
            try FileManager.default.removeItem(at: fileURL)
        }
    }

    private func validate(_ capture: FacetIntentCapture) throws {
        guard capture.schemaVersion == 1 || capture.schemaVersion == 2,
            UUID(uuidString: capture.id) != nil,
            !capture.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
            capture.title.utf8.count <= 8_192,
            TimeZone(identifier: capture.timezone) != nil,
            ViewerCalendar.parseISO8601(capture.at) != nil,
            capture.today.count == 10
        else {
            throw FacetIntentError.invalidCaptureRecord
        }
    }
}
