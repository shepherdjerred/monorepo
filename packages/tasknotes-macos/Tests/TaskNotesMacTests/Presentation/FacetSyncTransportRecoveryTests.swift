import Foundation
import TaskNotesUniFFI
import Testing

@testable import TaskNotesFacetUI
@testable import TaskNotesKit

@Suite @MainActor struct FacetSyncTransportRecoveryTests {
    private struct Context {
        let root: URL
        let store: FacetStore
        let engine: FacetEngine
        let account: FacetObsidianAccount
        let profile: FacetProfile
        let session: FacetObsidianSession

        static func open(failure: any Error = URLError(.networkConnectionLost)) async throws
            -> Context
        {
            let testRoot = FileManager.default.temporaryDirectory.appendingPathComponent(
                UUID().uuidString)
            let keys = ComponentKeys()
            let testEngine = try await FacetEngine.open(
                directory: testRoot.appendingPathComponent("engine"), secrets: keys)
            let testProfile = try await testEngine.registerReplica(
                id: UUID().uuidString, name: "Synthetic")
            try await testEngine.approveStandard(profile: testProfile)
            _ = try await testEngine.refresh(profileID: testProfile.id)
            let queue = try FacetIntentQueue(directory: testRoot.appendingPathComponent("captures"))
            try queue.selectProfile(testProfile.id)
            try await testEngine.applyIntentCapture(
                queue.enqueue(title: "Retained across send failure"))
            let directory = testRoot.appendingPathComponent("account")
            try FileManager.default.createDirectory(
                at: directory, withIntermediateDirectories: true)
            let vault = FacetValue.object([
                "id": .string("synthetic-vault"), "name": .string("Synthetic"),
                "host": .string("sync-test.obsidian.md"), "region": .string("test"),
                "salt": .string("synthetic-salt"), "encryptionVersion": .integer(3),
                "managed": .bool(true), "shared": .bool(false),
            ])
            let metadata = FacetValue.object([
                "schemaVersion": .integer(1), "activeOwner": .string("synthetic-owner"),
                "identities": .object([
                    testProfile.id: .object(["owner": .string("synthetic-owner"), "vault": vault])
                ]),
            ])
            try Data(FacetJSON.encode(metadata).utf8).write(
                to: directory.appendingPathComponent("sync-identities.json"))
            try keys.write("account.synthetic-owner.token", bytes: Data("synthetic-token".utf8))
            try keys.write("vault.\(testProfile.id).key", bytes: Data(repeating: 7, count: 32))
            let testAccount = try FacetObsidianAccount(directory: directory, secrets: keys)
            let testSession = try await makeSession(
                engine: testEngine, account: testAccount, profileID: testProfile.id,
                failure: failure)
            try await testEngine.bindOwnedSession(testSession.core, profileID: testProfile.id)
            let testStore = FacetStore()
            testStore.engine = testEngine
            testStore.account = testAccount
            testStore.profiles = [testProfile]
            testStore.sessions[testProfile.id] = testSession
            testStore.syncSessionGenerations[testProfile.id] = testStore.syncGeneration
            return Context(
                root: testRoot, store: testStore, engine: testEngine, account: testAccount,
                profile: testProfile, session: testSession)
        }

        static func makeSession(
            engine: FacetEngine, account: FacetObsidianAccount, profileID: String,
            failure: any Error = URLError(.networkConnectionLost)
        ) async throws -> FacetObsidianSession {
            try await FacetObsidianSession(
                engine: engine, account: account, profileID: profileID,
                access: account.access(profileID: profileID),
                checkpoint: engine.checkpoint(profileID: profileID), changed: {}, status: { _ in },
                sendMessage: { _, _ in throw failure })
        }

        func close() async throws {
            await store.stopSessions()
            try await engine.close()
            try FileManager.default.removeItem(at: root)
        }
    }

    @Test func outboundConnectivityFailureRetiresBeforeForegroundReplacementAndPreservesOutbox()
        async throws
    {
        let context = try await Context.open()
        let before = try await context.engine.uploads(profileID: context.profile.id)
        #expect(before.count == 1)
        let oldGeneration = context.store.syncGeneration
        await context.session.exerciseOutboundFailure()
        #expect(await context.session.closed)
        let retiredCore = await context.session.core
        let mutationID = try #require(before.first?.object?.fields["mutationId"]?.text)
        #expect(throws: ObsidianBoundaryError.Request) {
            _ = try retiredCore.queueDurableUpload(
                operationId: mutationID, nonce: Data(repeating: 1, count: 12), nowMs: 1)
        }
        #expect(await context.session.requiresForegroundTransportRestart())
        #expect(try await context.session.currentStatus().phase == .offline)
        // A closed worker cannot claim success; its last transport remains offline.
        #expect(await context.session.transportPhase == .offline)
        await context.store.resumeSync(isForeground: false) { _, _ in
            Issue.record("A background poll must not restart the failed transport")
        }
        var replacements = 0
        await context.store.resumeSync(isForeground: true) { profileID, generation in
            replacements += 1
            #expect(profileID == context.profile.id)
            #expect(context.store.sessions[profileID] == nil)
            #expect(
                !context.store.ownsSyncCallback(profileID: profileID, generation: oldGeneration))
            do {
                let replacement = try await Context.makeSession(
                    engine: context.engine, account: context.account, profileID: profileID)
                // Bind the new owner to the real runtime after old retirement.
                try await context.engine.bindOwnedSession(replacement.core, profileID: profileID)
                context.store.sessions[profileID] = replacement
                context.store.syncSessionGenerations[profileID] = generation
            } catch { Issue.record(error) }
        }
        #expect(replacements == 1)
        context.store.updateSyncState(
            profileID: context.profile.id, state: FacetSyncStatus(transport: .connected),
            generation: oldGeneration)
        #expect(context.store.syncStatuses[context.profile.id] == nil)
        #expect(try await context.engine.uploads(profileID: context.profile.id) == before)
        #expect(
            try await context.engine.syncStatus(profileID: context.profile.id).pendingUploadCount
                == 1)
        let snapshot = try await context.engine.snapshot(
            profileID: context.profile.id, query: .object([:]))
        #expect(snapshot.tasks.map(\.title) == ["Retained across send failure"])
        try await context.close()
    }

    @Test func contractFailureIsNotEligibleForNetworkRecovery() async throws {
        let context = try await Context.open(failure: FacetContractError.unsupportedResponse)
        await context.session.exerciseOutboundFailure()
        #expect(await context.session.transportPhase == .failed)
        #expect(await !context.session.requiresForegroundTransportRestart())
        await context.store.resumeSync(isForeground: true) { _, _ in
            Issue.record("Contract failure must not be retried as an outage")
        }
        try await context.close()
    }

    @Test func suspendedRetirementCannotRebindAndAuthorizationFenceStillWins() async throws {
        for revoke in [false, true] {
            let context = try await Context.open()
            let gate = Suspension()
            let retirement = _Concurrency.Task {
                await context.session.exerciseOutboundFailure(beforeRetirement: {
                    await gate.pause()
                })
            }
            await gate.waitUntilEntered()
            #expect(await context.session.closed)
            #expect(await !context.session.retirementCompleted)
            #expect(await !context.session.requiresForegroundTransportRestart())
            await context.store.resumeSync(isForeground: true) { _, _ in
                Issue.record("A closing worker must finish unbinding before replacement admission")
            }
            if revoke { context.account.fenceSessionAccess() }
            gate.resume()
            await retirement.value
            #expect(await context.session.retirementCompleted)
            var replacements = 0
            await context.store.resumeSync(isForeground: true) { _, _ in replacements += 1 }
            #expect(replacements == (revoke ? 0 : 1))
            #expect(
                try await context.engine.syncStatus(profileID: context.profile.id)
                    .pendingUploadCount == 1)
            try await context.close()
        }
    }

    @Test func revokedAuthorizationAndExplicitStopCannotRestartAnOldTransport() async throws {
        for stop in [false, true] {
            let context = try await Context.open()
            await context.session.exerciseOutboundFailure()
            if stop {
                await context.session.stop()
            } else {
                context.account.fenceSessionAccess()
            }
            #expect(await !context.session.requiresForegroundTransportRestart())
            await context.store.resumeSync(isForeground: true) { _, _ in
                Issue.record("An explicitly stopped or unauthorized owner must not restart")
            }
            try await context.close()
        }
    }

    @Test func cancellationCertificateAndUnknownFailuresKeepTheirOwnMeaning() async {
        for code: URLError.Code in [.cancelled, .serverCertificateUntrusted, .badServerResponse] {
            await #expect(throws: URLError(code)) {
                try await FacetSyncSend.perform { throw URLError(code) }
            }
        }
    }
}

extension FacetObsidianSession {
    fileprivate func exerciseOutboundFailure(
        beforeRetirement: (@Sendable () async -> Void)? = nil
    ) async {
        // The socket is never resumed: only the injectable native send operation
        // fails. Core binding, effect dispatch, retirement and outbox are real.
        let url = URL(string: "wss://\(access.identity.vault.host)")!
        socket = transport.webSocketTask(with: url)
        do {
            _ = try await executeEffect(.sendText(text: "synthetic send"), nowMs: Self.now())
            Issue.record("The injected native send should fail")
        } catch { recordWorkerFailure(error) }
        await close(beforeRetirement: beforeRetirement)
    }
}
