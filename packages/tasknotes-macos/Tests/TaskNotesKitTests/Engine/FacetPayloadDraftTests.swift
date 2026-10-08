import Foundation
import Testing

@testable import TaskNotesKit

struct FacetPayloadDraftTests {
    @Test func binaryReplacementSurvivesRestartAndChangedPayloadIsRejected() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { NativeTestFiles.remove(root) }
        let id = UUID().uuidString
        let bytes = Data([0, 255, 17, 42])
        try FacetPayloadDrafts(directory: root).prepare(id: id, bytes: bytes)
        let restarted = FacetPayloadDrafts(directory: root)
        #expect(try restarted.read(id: id, maximumSize: 4) == bytes)
        #expect(throws: FacetDraftError.self) { try restarted.prepare(id: id, bytes: Data([1])) }
        #expect(throws: FacetContractError.self) { try restarted.read(id: id, maximumSize: 3) }
        let deletedID = UUID().uuidString
        try restarted.prepare(id: deletedID, bytes: nil)
        #expect(try restarted.read(id: deletedID, maximumSize: 4) == nil)
    }
}
