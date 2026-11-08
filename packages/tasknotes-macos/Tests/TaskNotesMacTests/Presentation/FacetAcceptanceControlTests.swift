#if DEBUG
    import Foundation
    import Testing

    @testable import TaskNotesFacetUI
    @testable import TaskNotesKit

    @Suite @MainActor struct FacetAcceptanceControlTests {
        private struct Context {
            let root: URL
            let configuration: FacetAcceptanceConfiguration
            let store: FacetStore
            let control: FacetAcceptanceControl
            var directory: URL { configuration.stateDirectory.appendingPathComponent("control") }

            static func open() throws -> Context {
                let testRoot = FileManager.default.temporaryDirectory.resolvingSymlinksInPath()
                    .appendingPathComponent("facet-control-\(UUID())")
                let support = testRoot.appendingPathComponent("support")
                try FileManager.default.createDirectory(
                    at: support, withIntermediateDirectories: true)
                let runID = UUID()
                let state = support.appendingPathComponent("FacetAcceptance")
                    .appendingPathComponent(runID.uuidString.lowercased())
                let descriptor = """
                    {"schemaVersion":1,"runID":"\(runID)","stateDirectory":"\(state.path)",
                    "allowedRemoteVaultID":"owned-test-vault"}
                    """
                let testConfiguration = try FacetAcceptanceConfiguration.decode(
                    Data(descriptor.utf8), applicationSupport: support)
                let testStore = FacetStore()
                return Context(
                    root: testRoot, configuration: testConfiguration, store: testStore,
                    control: try FacetAcceptanceControl(
                        store: testStore, configuration: testConfiguration))
            }

            func command(
                id: UUID, runID: UUID? = nil, kind: String = "refresh", profileID: String? = nil
            ) throws {
                var fields: [String: FacetValue] = [
                    "schemaVersion": .integer(1),
                    "runID": .string((runID ?? configuration.runID).uuidString),
                    "commandID": .string(id.uuidString), "kind": .string(kind),
                ]
                if let profileID { fields["profileID"] = .string(profileID) }
                try Data(FacetJSON.encode(.object(fields)).utf8).write(
                    to: directory.appendingPathComponent("command.json"), options: .atomic)
            }

            func result() throws -> FacetAcceptanceMessages.Result {
                try JSONDecoder().decode(
                    FacetAcceptanceMessages.Result.self,
                    from: Data(contentsOf: directory.appendingPathComponent("result.json")))
            }

            func close() throws {
                control.stop()
                try FileManager.default.removeItem(at: root)
            }
        }

        @Test func commandIdentityIsConsumedAcrossNewerCommandsAndControllerRestart() async throws {
            let context = try Context.open()
            defer { context.control.stop() }
            let first = UUID()
            let second = UUID()
            try context.command(id: first)
            try await context.control.poll()
            #expect(try context.result().commandID == first)
            #expect(try context.result().outcome == "applied")
            try context.command(id: second)
            try await context.control.poll()
            #expect(try context.result().commandID == second)
            try context.command(id: first)
            let restarted = try FacetAcceptanceControl(
                store: context.store, configuration: context.configuration)
            try await restarted.poll()
            #expect(try context.result().commandID == second)
            try context.close()
        }

        @Test func wrongRunAndUnownedProfileAreRejectedBeforeInterruptionIntent() async throws {
            let context = try Context.open()
            try context.command(id: UUID(), runID: UUID())
            try await context.control.poll()
            #expect(try context.result().outcome == "rejected")
            try context.command(id: UUID(), kind: "interrupt", profileID: "unowned-profile")
            try await context.control.poll()
            #expect(try context.result().outcome == "rejected")
            #expect(
                !FileManager.default.fileExists(
                    atPath: context.directory.appendingPathComponent("interruption.json").path))
            try context.close()
        }

        @Test func persistedInterruptionIsRestoredAndWrongOwnerIsRefused() throws {
            let context = try Context.open()
            let file = context.directory.appendingPathComponent("interruption.json")
            let state = FacetAcceptanceMessages.InterruptionState(
                schemaVersion: 1, runID: context.configuration.runID, profileIDs: ["owned-profile"])
            try JSONEncoder().encode(state).write(to: file, options: .atomic)
            let restored = try FacetAcceptanceControl(
                store: context.store, configuration: context.configuration)
            #expect(restored.isInterrupted(profileID: "owned-profile"))
            let wrong = FacetAcceptanceMessages.InterruptionState(
                schemaVersion: 1, runID: UUID(), profileIDs: ["owned-profile"])
            try JSONEncoder().encode(wrong).write(to: file, options: .atomic)
            #expect(throws: FacetContractError.self) {
                try FacetAcceptanceControl(
                    store: context.store, configuration: context.configuration)
            }
            try context.close()
        }

        @Test func unknownCommandFieldsFailTheSharedBoundary() async throws {
            let context = try Context.open()
            let command = """
                {"schemaVersion":1,"runID":"\(context.configuration.runID)","commandID":"\(UUID())",
                "kind":"refresh","unexpected":true}
                """
            try Data(command.utf8).write(
                to: context.directory.appendingPathComponent("command.json"))
            await #expect(throws: FacetContractError.self) { try await context.control.poll() }
            #expect(
                !FileManager.default.fileExists(
                    atPath: context.directory.appendingPathComponent("result.json").path))
            try context.close()
        }
    }
#endif
