import Foundation
import Testing

@testable import TaskNotesKit

struct FacetOccurrenceLaunchProofTests {
    @Test func launchProofUsesTheSharedClosedContract() throws {
        let package = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        let schema = try FacetSchema(
            data: Data(
                contentsOf: package.appendingPathComponent(
                    "scripts/apple-acceptance/occurrence-launches.schema.json")))
        let identity: [String: Any] = [
            "uid": 501, "ruid": 501, "startSeconds": 100, "startMicroseconds": 23,
        ]
        let valid: [String: Any] = [
            "schemaVersion": 1, "runID": "d9d94418-b632-4d20-8edf-df9e502dc3df",
            "descriptor": "/owned/acceptance.json", "executable": "/owned/FacetAcceptance",
            "launches": [["pid": 45_001, "identity": identity, "state": "closed"]],
        ]
        try schema.validate(
            data: JSONSerialization.data(withJSONObject: valid), definition: "journal")
        for changed in [
            valid.merging(["foreign": true]) { _, replacement in replacement },
            valid.merging(["runID": "another-run"]) { _, replacement in replacement },
            valid.merging(["launches": [["pid": 45_001, "state": "closed"]]]) { _, replacement in
                replacement
            },
            valid.merging(["launches": [["pid": 45_001, "identity": identity, "state": "unknown"]]])
            { _, replacement in replacement },
        ] {
            #expect(throws: FacetContractError.self) {
                try schema.validate(
                    data: JSONSerialization.data(withJSONObject: changed), definition: "journal")
            }
        }
    }
}
