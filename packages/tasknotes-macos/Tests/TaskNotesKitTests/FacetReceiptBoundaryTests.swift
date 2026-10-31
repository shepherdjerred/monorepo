import Foundation
import Testing

@testable import TaskNotesKit

@Suite struct FacetReceiptBoundaryTests {
    @Test func commonRawReceiptsValidateBeforeDiagnosticExtraction() throws {
        let schema = try FacetSchema.bundled()
        let url = try #require(
            Bundle.module.url(forResource: "warning-cases", withExtension: "json"))
        let root = try FacetFeatureProjection.parseJSON(String(contentsOf: url, encoding: .utf8))
        let cases = try #require(root.object?.fields["cases"]?.array?.elements)
        #expect(cases.count == 23)
        for test in cases {
            let fields = try #require(test.object?.fields)
            let id = try #require(fields["id"]?.text)
            let raw = try FacetFeatureProjection.json(try #require(fields["value"]))
            if fields["valid"] == .bool(true) {
                let receipt = try FacetMutationReceipt.read(
                    json: raw, expectedMutationID: "original", schema: schema)
                #expect((receipt.savedMessage != nil) == (fields["notice"] == .bool(true)), "\(id)")
                if id == "all-codes" {
                    #expect(
                        receipt.savedMessage
                            == [
                                "The task was saved without the configured template.",
                                "The configured template could not be used.",
                                "Facet shortened the filename and kept the full title.",
                            ].joined(separator: "\n")
                    )
                }
            } else {
                #expect(throws: (any Error).self) {
                    try FacetMutationReceipt.read(
                        json: raw, expectedMutationID: "original", schema: schema)
                }
            }
        }
        for raw in invalidRawReceipts {
            #expect(throws: FacetContractError.self) {
                try FacetMutationReceipt.read(
                    json: raw, expectedMutationID: "original", schema: schema)
            }
        }
    }

    private var invalidRawReceipts: [String] {
        [
            #"""
            {"schemaVersion":1,"mutationId":"original","applied":true,"taskPath":null,
            "cleanupPending":false,"paths":[],"pendingCount":0,"diagnostics":[],"diagnostics":[]}
            """#,
            #"""
            {"schemaVersion":1,"mutationId":"original","applied":true,"taskPath":null,
            "cleanupPending":false,"paths":[],"pendingCount":0,
            "diagnostics":[{"code":"template_missing","co\u0064e":"template_missing"}]}
            """#,
            #"""
            {"schemaVersion":1,"mutationId":"wrong","applied":true,"taskPath":null,
            "cleanupPending":false,"paths":[],"pendingCount":0,"diagnostics":[]}
            """#,
        ]
    }
}
