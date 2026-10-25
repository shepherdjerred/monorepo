import Foundation
import TaskNotesKit
import XCTest

final class AcceptanceVaultPathTests: XCTestCase {
    func testSimulatorLocalVaultUsesOnlyItsOwnDocumentsDirectory() throws {
        let manager = FileManager.default
        let support = try manager.url(
            for: .applicationSupportDirectory, in: .userDomainMask,
            appropriateFor: nil, create: true)
        let documents = try manager.url(
            for: .documentDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
        let runID = UUID()
        let state = support.appendingPathComponent("FacetAcceptance")
            .appendingPathComponent(runID.uuidString.lowercased())
        let configuration = try FacetAcceptanceConfiguration.decode(
            JSONSerialization.data(withJSONObject: [
                "schemaVersion": 1, "runID": runID.uuidString, "stateDirectory": state.path,
            ]), applicationSupport: support)
        let expected = documents.appendingPathComponent("Native acceptance")
        XCTAssertEqual(try configuration.localVaultDirectory, expected)
        try configuration.requireLocalVault(expected)
        for foreign in [
            state.appendingPathComponent("Native acceptance"),
            documents.appendingPathComponent("Other vault"),
            documents.deletingLastPathComponent().appendingPathComponent("Native acceptance"),
        ] {
            XCTAssertThrowsError(try configuration.requireLocalVault(foreign))
        }
    }
}
