import Foundation
import Testing

@testable import TaskNotesKit

#if os(macOS)
    struct FacetAcceptanceLocalVaultTests {
        @Test func nativeMacVaultRequiresTheExactRunStatePath() throws {
            let runID = UUID()
            let support = FileManager.default.temporaryDirectory.appendingPathComponent(
                UUID().uuidString)
            let configuration = try configuration(runID: runID, support: support)
            let expected = configuration.stateDirectory.appendingPathComponent("Native acceptance")
            #expect(try configuration.localVaultDirectory == expected)
            try configuration.requireLocalVault(expected)
            for foreign in [
                configuration.stateDirectory.appendingPathComponent("Other vault"),
                support.appendingPathComponent("Native acceptance"),
                support.appendingPathComponent("FacetAcceptance")
                    .appendingPathComponent(UUID().uuidString.lowercased())
                    .appendingPathComponent("Native acceptance"),
            ] {
                #expect(throws: FacetAcceptanceError.self) {
                    try configuration.requireLocalVault(foreign)
                }
            }
        }

        @Test func redirectedExpectedVaultNeverGrantsAnExternalDirectory() throws {
            let support = FileManager.default.temporaryDirectory.appendingPathComponent(
                UUID().uuidString)
            defer { NativeTestFiles.remove(support) }
            let configuration = try configuration(runID: UUID(), support: support)
            let expected = try configuration.localVaultDirectory
            let external = support.appendingPathComponent("outside")
            try FileManager.default.createDirectory(at: external, withIntermediateDirectories: true)
            try FileManager.default.createDirectory(
                at: expected.deletingLastPathComponent(), withIntermediateDirectories: true)
            try FileManager.default.createSymbolicLink(at: expected, withDestinationURL: external)
            #expect(throws: FacetAcceptanceError.self) {
                try configuration.requireLocalVault(expected)
            }
        }

        private func configuration(runID: UUID, support: URL) throws
            -> FacetAcceptanceConfiguration
        {
            let directory = support.appendingPathComponent("FacetAcceptance")
                .appendingPathComponent(runID.uuidString.lowercased())
            return try FacetAcceptanceConfiguration.decode(
                JSONSerialization.data(withJSONObject: [
                    "schemaVersion": 1, "runID": runID.uuidString,
                    "stateDirectory": directory.path,
                ]), applicationSupport: support)
        }
    }
#endif
