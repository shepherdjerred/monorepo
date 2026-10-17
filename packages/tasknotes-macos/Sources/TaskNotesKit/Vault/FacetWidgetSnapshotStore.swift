public import Foundation

/// App Group display bytes only. The envelope producer owns the widget schema;
/// this store owns bounded metadata I/O and durable atomic publication.
public struct FacetWidgetSnapshotStore: Sendable {
    public static let filename = "FacetWidgetSnapshot.json"
    public static let maximumBytes = 4 * 1_024 * 1_024
    private let directory: URL

    public init(directory: URL) { self.directory = directory }

    public func write(_ bytes: Data) throws {
        guard bytes.count <= Self.maximumBytes else { throw FacetContractError.unsupportedResponse }
        try VaultDirectory(url: directory).replaceMetadata(Self.filename, bytes: bytes)
    }

    public func read() throws -> Data? {
        guard let file = try VaultDirectory(url: directory).openFile(Self.filename) else {
            return nil
        }
        let size = try file.size()
        guard size <= Self.maximumBytes else { throw FacetContractError.unsupportedResponse }
        var bytes = Data()
        var offset: UInt64 = 0
        while offset < size {
            let length = Int(min(UInt64(VaultFile.maximumChunk), size - offset))
            bytes.append(try file.read(offset: offset, length: length))
            offset += UInt64(length)
        }
        return bytes
    }
}
