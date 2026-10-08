import Foundation
import Testing

@testable import TaskNotesKit

struct FacetWidgetSnapshotStoreTests {
    @Test func atomicSnapshotReopenAndSizeFailureRetainThePreviouslyPublishedBytes() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { NativeTestFiles.remove(root) }
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let store = FacetWidgetSnapshotStore(directory: root)
        #expect(try store.read() == nil)
        let first = Data("first bounded envelope".utf8)
        try store.write(first)
        #expect(try FacetWidgetSnapshotStore(directory: root).read() == first)
        let larger = Data(repeating: 23, count: VaultFile.maximumChunk + 9)
        try store.write(larger)
        #expect(try FacetWidgetSnapshotStore(directory: root).read() == larger)
        #expect(throws: FacetContractError.self) {
            try store.write(Data(repeating: 1, count: FacetWidgetSnapshotStore.maximumBytes + 1))
        }
        #expect(try store.read() == larger)
        #expect(try VaultDirectory(url: root).entries() == [FacetWidgetSnapshotStore.filename])
    }
}
