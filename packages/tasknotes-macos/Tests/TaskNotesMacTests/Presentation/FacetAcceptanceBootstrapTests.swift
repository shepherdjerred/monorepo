#if DEBUG
    import Foundation
    import Testing

    @testable import TaskNotesFacetUI
    @testable import TaskNotesKit
    @testable import TaskNotesMac

    @Suite("Application-owned acceptance vault", .serialized) @MainActor
    struct FacetAcceptanceBootstrapTests {
        @Test(arguments: [false, true])
        func restoredCallersShareOneProfileWithoutChangingConsent(consent: Bool) async throws {
            let context = try await Context.open()
            context.store.approveStandard = consent
            let callers = (0..<8).map { _ in
                _Concurrency.Task { try await context.store.prepareAcceptanceVault(context.vault) }
            }
            callers[0].cancel()
            for caller in callers { try await caller.value }
            let profile = try #require(context.store.profiles.first)
            #expect(context.store.profiles.count == 1)
            #expect(try await context.engine.profiles().map(\.id) == [profile.id])
            #expect(profile.approveStandard && profile.kind == "local_folder")
            #expect(context.store.approveStandard == consent)
            #expect(!context.store.needsStandardConsent)
            #expect(context.store.error == nil)
            #expect(context.store.selectedProfileID == profile.id)
            #expect(context.store.snapshot?.tasks.map(\.title) == ["Preserved fixture"])
            let generation = context.store.selectionGeneration
            try await context.store.prepareAcceptanceVault(context.vault)
            #expect(context.store.selectionGeneration == generation)
            #expect(try Data(contentsOf: context.note) == context.originalNote)
            #expect(try Data(contentsOf: context.settings) == context.originalSettings)
            try await context.engine.close()
        }

        @Test func applicationPreparesWithoutAViewAndColdLaunchReusesTheProfile() async throws {
            let context = try await Context.open()
            let environment = FacetMacEnvironment(store: context.store) {
                await FacetMacEnvironment.prepareAcceptanceVault(
                    store: context.store, arguments: ["--facet-native-acceptance"])
            }
            await environment.bootstrap.value
            let profile = try #require(context.store.profiles.first)
            #expect(context.store.profiles.count == 1)
            #expect(context.store.snapshot?.tasks.map(\.title) == ["Preserved fixture"])
            try await context.engine.close()

            let restarted = try await FacetEngine.open(
                directory: context.engineDirectory, secrets: ComponentKeys())
            let store = FacetStore()
            store.foreground = false
            store.engine = restarted
            store.preferences = context.store.preferences
            store.acceptanceConfiguration = context.configuration
            try await store.prepareAcceptanceVault(context.vault)
            #expect(try await restarted.profiles().map(\.id) == [profile.id])
            #expect(store.selectedProfileID == profile.id)
            #expect(store.snapshot?.tasks.map(\.title) == ["Preserved fixture"])
            #expect(!store.approveStandard && !store.needsStandardConsent)
            await #expect(throws: FacetAcceptanceError.self) {
                try await store.prepareAcceptanceVault(
                    context.vault.appendingPathComponent("other"))
            }
            #expect(try await restarted.profiles().count == 1)
            try await restarted.close()
        }
    }

    extension FacetAcceptanceBootstrapTests {
        @MainActor private struct Context {
            let scratch: ScratchDirectory
            let engineDirectory: URL
            let configuration: FacetAcceptanceConfiguration
            let engine: FacetEngine
            let store: FacetStore
            let originalNote = Data(
                "---\ntitle: Preserved fixture\nstatus: open\ntags: [task]\n---\nKeep these bytes.\n"
                    .utf8)
            let originalSettings = Data(
                "title:\n  storage: frontmatter\ntask_detection:\n  method: tag\n  tag: task\n".utf8
            )
            var vault: URL {
                configuration.stateDirectory.appendingPathComponent("Native acceptance")
            }
            var note: URL { vault.appendingPathComponent("Existing.md") }
            var settings: URL { vault.appendingPathComponent("tasknotes.yaml") }

            static func open() async throws -> Self {
                let testScratch = try ScratchDirectory()
                let support = testScratch.url.resolvingSymlinksInPath()
                let runID = UUID()
                let state = support.appendingPathComponent("FacetAcceptance")
                    .appendingPathComponent(runID.uuidString.lowercased())
                let descriptor = """
                    {"schemaVersion":1,"runID":"\(runID)","stateDirectory":"\(state.path)"}
                    """
                let testConfiguration = try FacetAcceptanceConfiguration.decode(
                    Data(descriptor.utf8), applicationSupport: support)
                let testEngineDirectory = state.appendingPathComponent("engine")
                let testEngine = try await FacetEngine.open(
                    directory: testEngineDirectory, secrets: ComponentKeys())
                let testStore = FacetStore()
                testStore.engine = testEngine
                testStore.foreground = false
                testStore.acceptanceConfiguration = testConfiguration
                testStore.preferences = try #require(
                    UserDefaults(suiteName: testConfiguration.defaultsSuiteName))
                let context = Self(
                    scratch: testScratch, engineDirectory: testEngineDirectory,
                    configuration: testConfiguration, engine: testEngine, store: testStore)
                try FileManager.default.createDirectory(
                    at: context.vault, withIntermediateDirectories: true)
                try context.originalNote.write(to: context.note)
                try context.originalSettings.write(to: context.settings)
                return context
            }
        }
    }
#endif
