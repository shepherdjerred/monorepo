#if DEBUG
    import Foundation
    import Testing

    @testable import TaskNotesKit
    @testable import TaskNotesMac

    @Suite("Acceptance workspace restoration isolation")
    struct FacetWorkspaceRestorationTests {
        @Test(arguments: [nil, "red.sjer.tasknotes.mac", "red.sjer.tasknotes.mac.acceptance.other"])
        func productionNeverLoadsAnAcceptanceDescriptor(bundleID: String?) throws {
            var loaded = false
            let policy = try FacetWorkspaceRestorationPolicy.resolve(bundleID: bundleID) {
                loaded = true
                throw FacetAcceptanceError.invalidDescriptor
            }
            #expect(policy == .production)
            #expect(!loaded)
        }

        @Test(arguments: [nil, "synthetic-remote-vault"])
        func validatedLocalAndLiveRunsDisableInheritedWindows(remoteVaultID: String?) throws {
            let support = FileManager.default.temporaryDirectory.resolvingSymlinksInPath()
                .appendingPathComponent(UUID().uuidString)
            let runID = UUID()
            let directory = support.appendingPathComponent("FacetAcceptance")
                .appendingPathComponent(runID.uuidString.lowercased())
            var descriptor: [String: Any] = [
                "schemaVersion": 1, "runID": runID.uuidString,
                "stateDirectory": directory.path,
            ]
            if let remoteVaultID { descriptor["allowedRemoteVaultID"] = remoteVaultID }
            let configuration = try FacetAcceptanceConfiguration.decode(
                JSONSerialization.data(withJSONObject: descriptor), applicationSupport: support)
            let policy = try FacetWorkspaceRestorationPolicy.resolve(
                bundleID: "red.sjer.tasknotes.mac.acceptance", acceptance: { configuration })
            #expect(policy == .isolatedAcceptance)
            #expect(configuration.stateDirectory == directory)
            #expect(configuration.runID == runID)
        }

        @Test func missingOrInvalidAcceptanceDescriptorFailsClosed() {
            #expect(throws: FacetAcceptanceError.self) {
                try FacetWorkspaceRestorationPolicy.resolve(
                    bundleID: "red.sjer.tasknotes.mac.acceptance", acceptance: { nil })
            }
            #expect(throws: FacetAcceptanceError.self) {
                try FacetWorkspaceRestorationPolicy.resolve(
                    bundleID: "red.sjer.tasknotes.mac.acceptance",
                    acceptance: { throw FacetAcceptanceError.invalidDescriptor })
            }
        }
    }
#endif
