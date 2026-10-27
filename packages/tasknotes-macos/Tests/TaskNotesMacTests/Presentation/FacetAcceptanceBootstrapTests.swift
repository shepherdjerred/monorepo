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

        @Test func ownedColdSelectionSurvivesCancelledCallersWithoutFlushingDrafts() async throws {
            let context = try await Context.open()
            let profile = try await context.selectFixture()
            let query = try #require(context.store.displayedQuery)
            let before = try #require(context.store.snapshot)
            let request = context.store.requestGeneration
            var flushes = 0
            let registration = UUID()
            FacetDraftCoordinator.shared.register(
                registration, owner: context.store, profileID: profile.id,
                flush: {
                    flushes += 1
                    return true
                })
            defer { FacetDraftCoordinator.shared.unregister(registration) }
            context.store.engine = context.engine
            let callers = (0..<8).map { _ in
                _Concurrency.Task { try await context.store.prepareAcceptanceVault(context.vault) }
            }
            callers[0].cancel()
            for caller in callers { try await caller.value }
            #expect(flushes == 0)
            #expect(context.store.requestGeneration == request)
            #expect(context.store.displayedQuery == query)
            let retained = try #require(context.store.snapshot)
            #expect(retained.profileId == before.profileId && retained.version == before.version)
            #expect(retained.tasks.map(\.properties) == before.tasks.map(\.properties))
            #expect(retained.tasks.map(\.body) == before.tasks.map(\.body))
            #expect(retained.configuration == before.configuration)
            #expect(try Data(contentsOf: context.note) == context.originalNote)
            try await context.engine.close()
        }

        @Test(arguments: ["snapshot", "query", "selection"])
        func incompleteOrDifferentSelectionStillPreparesNormally(missing: String) async throws {
            let context = try await Context.open()
            let profile = try await context.selectFixture()
            if missing == "snapshot" { context.store.snapshot = nil }
            if missing == "query" { context.store.displayedQuery = nil }
            if missing == "selection" { _ = try await context.selectOtherVault() }
            let request = context.store.requestGeneration
            var flushes = 0
            let registration = UUID()
            FacetDraftCoordinator.shared.register(
                registration, owner: context.store, profileID: profile.id,
                flush: {
                    flushes += 1
                    return true
                })
            defer { FacetDraftCoordinator.shared.unregister(registration) }
            try await context.store.prepareAcceptanceVault(context.vault)
            #expect(flushes == 1)
            #expect(context.store.requestGeneration > request)
            #expect(context.store.selectedProfileID == profile.id)
            #expect(context.store.snapshot?.profileId == profile.id)
            #expect(context.store.snapshot?.tasks.map(\.title) == ["Preserved fixture"])
            #expect(context.store.displayedQuery != nil)
            try await context.engine.close()
        }

        @Test func rejectedDraftFlushCannotPrepareADifferentProfile() async throws {
            let context = try await Context.open()
            _ = try await context.selectFixture()
            let other = try await context.selectOtherVault()
            let registration = UUID()
            FacetDraftCoordinator.shared.register(
                registration, owner: context.store, profileID: other.id,
                isDirty: { true }, flush: { false })
            defer { FacetDraftCoordinator.shared.unregister(registration) }
            await #expect(throws: FacetAcceptanceError.self) {
                try await context.store.prepareAcceptanceVault(context.vault)
            }
            #expect(context.store.selectedProfileID == other.id)
            #expect(context.store.snapshot?.profileId == other.id)
            try await context.engine.close()
        }

        @Test func replacingEngineClearsFramesAndRejectsSuspendedOldQuery() async throws {
            let context = try await Context.open()
            let profile = try await context.selectFixture()
            let query = try #require(context.store.displayedQuery)
            let other = try await FacetEngine.open(
                directory: context.scratch.url.appendingPathComponent("replacement"),
                secrets: ComponentKeys())
            let pause = Suspension()
            let read = _Concurrency.Task {
                await context.store.loadQuerySnapshot(
                    profileID: profile.id, logicalQuery: query,
                    ownsEngine: { context.store.engine === context.engine },
                    load: {
                        let result = try await context.engine.snapshot(
                            profileID: profile.id, query: query)
                        await pause.pause()
                        return result
                    })
            }
            await pause.waitUntilEntered()
            #expect(context.store.snapshot != nil)
            context.store.engine = other
            #expect(context.store.snapshot == nil)
            #expect(context.store.displayedQuery == nil)
            pause.resume()
            await read.value
            #expect(context.store.snapshot == nil)
            #expect(context.store.displayedQuery == nil)
            #expect(context.store.error == nil)
            try await context.engine.close()
            try await other.close()
        }

        @Test func preparedTaskCannotCrossAnEngineReplacement() async throws {
            let context = try await Context.open()
            try await context.store.prepareAcceptanceVault(context.vault)
            let other = try await FacetEngine.open(
                directory: context.scratch.url.appendingPathComponent("replacement"),
                secrets: ComponentKeys())
            context.store.engine = other
            await #expect(throws: FacetAcceptanceError.self) {
                try await context.store.prepareAcceptanceVault(context.vault)
            }
            #expect(context.store.snapshot == nil)
            #expect(context.store.displayedQuery == nil)
            try await context.engine.close()
            try await other.close()
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

            func selectFixture() async throws -> FacetProfile {
                let profile = try await engine.registerLocal(
                    directory: vault, approveStandard: true)
                store.profiles = try await engine.profiles()
                await store.selectProfile(profile.id)
                return profile
            }

            func selectOtherVault() async throws -> FacetProfile {
                let directory = scratch.url.appendingPathComponent("Other vault")
                try FileManager.default.createDirectory(
                    at: directory, withIntermediateDirectories: true)
                let profile = try await engine.registerLocal(
                    directory: directory, approveStandard: true)
                store.profiles = try await engine.profiles()
                await store.selectProfile(profile.id)
                return profile
            }

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
