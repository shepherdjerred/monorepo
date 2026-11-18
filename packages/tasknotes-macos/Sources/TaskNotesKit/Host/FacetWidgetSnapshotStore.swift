public import Foundation

/// Bounded atomic storage for `FacetWidgetSnapshot.json` in the iOS App Group container.
public struct FacetWidgetSnapshotStore: Sendable {
    public static let filename = "FacetWidgetSnapshot.json"
    public static let maximumBytes = 4 * 1_024 * 1_024

    private let directory: URL

    public init(directory: URL) {
        self.directory = directory
    }

    public func write(_ bytes: Data) throws {
        guard bytes.count <= Self.maximumBytes else {
            throw FacetContractError.unsupportedResponse
        }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let target = directory.appendingPathComponent(Self.filename)
        try bytes.write(to: target, options: .atomic)
    }

    public func read() throws -> Data? {
        let target = directory.appendingPathComponent(Self.filename)
        guard FileManager.default.fileExists(atPath: target.path) else {
            return nil
        }
        let attributes = try FileManager.default.attributesOfItem(atPath: target.path)
        if let size = attributes[.size] as? NSNumber, size.intValue > Self.maximumBytes {
            throw FacetContractError.unsupportedResponse
        }
        let bytes = try Data(contentsOf: target)
        guard bytes.count <= Self.maximumBytes else {
            throw FacetContractError.unsupportedResponse
        }
        return bytes
    }
}
