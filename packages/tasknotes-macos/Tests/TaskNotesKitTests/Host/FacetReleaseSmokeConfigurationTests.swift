#if os(macOS)
    import Foundation
    import Testing

    @testable import TaskNotesKit

    @Suite("Release smoke isolation")
    struct FacetReleaseSmokeConfigurationTests {
        @Test func uuidOnlyBootstrapUsesPrivateNamespacesAndRoot() throws {
            let support = FileManager.default.temporaryDirectory.appendingPathComponent(
                UUID().uuidString)
            let runID = UUID()
            let smoke = try #require(
                try FacetReleaseSmokeConfiguration.launch(
                    arguments: ["Facet", "--facet-release-smoke", runID.uuidString],
                    bundleID: "red.sjer.tasknotes.mac", applicationSupport: support))
            #expect(smoke.runID == runID)
            #expect(
                smoke.stateDirectory.path
                    == support.appendingPathComponent("FacetReleaseSmoke")
                    .appendingPathComponent(runID.uuidString.lowercased()).path)
            #expect(smoke.accountKeychainService != "red.sjer.facet.obsidian")
            #expect(smoke.stagingKeychainService != "red.sjer.facet.vault-stages")
            #expect(smoke.defaultsSuiteName == smoke.namespace)
            #expect(
                try FacetReleaseSmokeConfiguration.launch(
                    arguments: ["Facet"], bundleID: "red.sjer.tasknotes.mac") == nil)
        }

        @Test func invalidFlagsNeverFallThroughToNormalStartup() throws {
            let run = UUID().uuidString
            for arguments in [
                ["Facet", "--facet-release-smoke"],
                ["Facet", "--facet-release-smoke", "/tmp/arbitrary"],
                ["Facet", "--facet-release-smoke", run, "--facet-release-smoke", run],
                ["Facet", "--facet-release-smoke", run, "--facet-native-acceptance"],
            ] {
                #expect(throws: FacetAcceptanceError.self) {
                    try FacetReleaseSmokeConfiguration.launch(
                        arguments: arguments, bundleID: "red.sjer.tasknotes.mac")
                }
            }
            #expect(throws: FacetAcceptanceError.self) {
                try FacetReleaseSmokeConfiguration.launch(
                    arguments: ["Facet", "--facet-release-smoke", run],
                    bundleID: "red.sjer.tasknotes.mac.acceptance")
            }
        }

        @Test func privateRootRejectsSymlinksAndMarkerNamesExactProcess() throws {
            let support = FileManager.default.temporaryDirectory.appendingPathComponent(
                UUID().uuidString)
            defer { NativeTestFiles.remove(support) }
            try FileManager.default.createDirectory(at: support, withIntermediateDirectories: true)
            let root = support.appendingPathComponent("FacetReleaseSmoke")
            try FileManager.default.createSymbolicLink(at: root, withDestinationURL: support)
            #expect(throws: FacetAcceptanceError.self) {
                try FacetReleaseSmokeConfiguration.launch(
                    arguments: ["Facet", "--facet-release-smoke", UUID().uuidString],
                    bundleID: "red.sjer.tasknotes.mac", applicationSupport: support)
            }
            try FileManager.default.removeItem(at: root)
            let run = UUID()
            let smoke = try #require(
                try FacetReleaseSmokeConfiguration.launch(
                    arguments: ["Facet", "--facet-release-smoke", run.uuidString],
                    bundleID: "red.sjer.tasknotes.mac", applicationSupport: support))
            try FileManager.default.createDirectory(
                at: smoke.stateDirectory, withIntermediateDirectories: true)
            try smoke.recordStartup(processID: 123)
            #expect(
                try String(
                    contentsOf: smoke.stateDirectory.appendingPathComponent("started.123"),
                    encoding: .utf8) == run.uuidString.lowercased() + "\n")
            #expect(throws: FacetAcceptanceError.self) { try smoke.recordStartup(processID: 0) }
        }
    }
#endif
