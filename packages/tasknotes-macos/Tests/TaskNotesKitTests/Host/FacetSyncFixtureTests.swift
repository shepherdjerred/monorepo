import Darwin
import Foundation
import TaskNotesTestSupport
import Testing

@testable import TaskNotesKit

@Suite("Account-free native Sync protocol", .serialized)
struct FacetSyncFixtureTests {
    @Test func retryableFailureRetainsItsAcceptedUploadOwnership() async throws {
        let control = try await FacetFixtureRetryControl.open()
        do {
            try await control.verify()
            try await control.close()
        } catch {
            try await control.close()
            throw error
        }
    }

    @Test func fixtureCleanupForceStopsOnlyItsOwnedStubbornChild() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(
            UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: false)
        defer { NativeTestFiles.remove(directory) }
        let marker = directory.appendingPathComponent("ready")
        let child = Process()
        let termination = FacetFixtureChildTermination(process: child)
        child.executableURL = URL(fileURLWithPath: "/usr/bin/env")
        child.arguments = [
            "bun", "--no-env-file", "-e",
            "process.on('SIGTERM', () => {}); await Bun.write(Bun.argv[1], 'ready'); setInterval(() => {}, 1000);",
            marker.path,
        ]
        child.environment = ProcessInfo.processInfo.environment.filter {
            ["PATH", "HOME", "TMPDIR", "LANG"].contains($0.key)
        }
        child.standardOutput = FileHandle.nullDevice
        child.standardError = FileHandle.nullDevice
        try child.run()
        do {
            try termination.bindStartedChild()
            let readyDeadline = Date().addingTimeInterval(5)
            while !FileManager.default.fileExists(atPath: marker.path), Date() < readyDeadline,
                child.isRunning
            {
                Thread.sleep(forTimeInterval: 0.01)
            }
            #expect(try Data(contentsOf: marker) == Data("ready".utf8))
            let beganAt = Date()
            #expect(try termination.stop())
            #expect(Date().timeIntervalSince(beganAt) < 10)
            #expect(!child.isRunning)
            #expect(child.terminationReason == .uncaughtSignal)
            #expect(child.terminationStatus == SIGKILL)
        } catch {
            try termination.stop()
            throw error
        }
    }

    @Test func twoRealReplicasPreserveOfflineWritesAndRecoverLostAcknowledgments() async throws {
        let temporaryPath = try #require(
            FileManager.default.temporaryDirectory.resourceValues(forKeys: [.canonicalPathKey])
                .canonicalPath)
        let root = URL(fileURLWithPath: temporaryPath).appendingPathComponent(
            "facet-protocol-\(UUID())")
        try FileManager.default.createDirectory(
            at: root, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
        var completed = false
        defer { if completed { NativeTestFiles.remove(root) } }
        let serverDirectory = root.appendingPathComponent("server")
        try FileManager.default.createDirectory(
            at: serverDirectory, withIntermediateDirectories: false,
            attributes: [.posixPermissions: 0o700])
        let server = try FacetSyncFixtureProcess(directory: serverDirectory, runID: UUID())
        let http = FacetFixtureHTTP(ready: server.ready)
        var replicas: [FacetFixtureReplica] = []
        do {
            let first = try await FacetFixtureReplica.create(
                directory: root.appendingPathComponent("first"), http: http, approveStandard: false)
            replicas.append(first)
            let second = try await FacetFixtureReplica.create(
                directory: root.appendingPathComponent("second"), http: http)
            replicas.append(second)
            try await initial(first, second, http: http)
            try await offline(first, second, http: http)
            try await faults(first, second, http: http)
            for replica in replicas { try await replica.close() }
            try server.stop()
            try ciphertextWitness(serverDirectory)
            completed = true
        } catch {
            Issue.record("Synthetic Sync fixture retained at \(root.path)")
            for replica in replicas { try await replica.close() }
            try server.stop()
            throw error
        }
    }

    private func initial(
        _ first: FacetFixtureReplica, _ second: FacetFixtureReplica, http: FacetFixtureHTTP
    ) async throws {
        try await first.start(http: http)
        try await second.start(http: http)
        try await settled(first, second, title: nil)
        // Neither a YAML file nor consent to defaults is a Sync prerequisite.
        // Initial download must settle before the app asks for configuration.
        let discovery = try await first.engine.features(
            profileID: first.profileID, request: .object(["kind": .string("discovery")]))
        #expect(discovery.object?.fields["initialSyncComplete"] == .bool(true))
        #expect(discovery.object?.fields["configurationAvailable"] == .bool(false))
        #expect(try await first.snapshot().configuration == .null)
        let profile = try #require(await first.engine.profiles().first)
        #expect(!profile.approveStandard)
        try await first.engine.approveStandard(profile: profile)
        _ = try await first.engine.refresh(profileID: first.profileID)
        try await first.engine.execute(
            profileID: first.profileID,
            command: .object([
                "kind": .string("create"),
                "properties": .object(["title": .string("Account-free native task")]),
                "body": .string("Initial real encrypted upload\n"),
            ]))
        try await settled(first, second, title: "Account-free native task")
        try await update(second, body: "Edited by the second native replica\n")
        try await settled(
            first, second, title: "Account-free native task",
            body: "Edited by the second native replica\n")
    }

    private func offline(
        _ first: FacetFixtureReplica, _ second: FacetFixtureReplica, http: FacetFixtureHTTP
    ) async throws {
        await second.stopTransport()
        try await update(second, body: "Offline write survives a cold runtime reopen\n")
        let pending = try await second.engine.uploads(profileID: second.profileID)
        #expect(!pending.isEmpty)
        let taskBefore = try #require(await second.snapshot().tasks.first)
        let bytesBefore = try second.markdown(taskBefore)
        try await second.reopenOffline(http: http)
        #expect(try await second.engine.uploads(profileID: second.profileID) == pending)
        let taskAfter = try #require(await second.snapshot().tasks.first)
        #expect(try second.markdown(taskAfter) == bytesBefore)
        #expect(
            try await first.snapshot().tasks.first?.body == "Edited by the second native replica\n")
        guard case .vaults(let restored) = try await second.account.restoreSession(),
            restored.map(\.id) == [http.ready.vaultID]
        else { throw FacetContractError.unsupportedResponse }
        try await second.start(http: http)
        try await settled(
            first, second, title: "Account-free native task",
            body: "Offline write survives a cold runtime reopen\n")
    }

    private func faults(
        _ first: FacetFixtureReplica, _ second: FacetFixtureReplica, http: FacetFixtureHTTP
    ) async throws {
        for fault in ["fail-next-push-before-commit", "fail-next-push-after-commit"] {
            try await http.control(fault)
            let body = "Recovered \(fault) through the native socket host\n"
            try await update(second, body: body)
            try await settled(first, second, title: "Account-free native task", body: body)
        }
        let state = try #require(await http.state().object?.fields)
        #expect(state["scope"] == .string("protocol-fixture-only"))
        let counters = try #require(state["counters"]?.object?.fields)
        #expect(counters["beforeCommitDisconnects"] == .integer(1))
        #expect(counters["afterCommitDisconnects"] == .integer(1))
        #expect(counters["protocolErrors"] == .integer(0))
        #expect(counters["committedUploads"] == .integer(5))
        let history = try #require(state["files"]?.array?.elements)
        #expect(history.count == 5)
        #expect(
            history.allSatisfy {
                $0.object?.fields["path"]?.text?.contains("Account-free native task") == false
            })
    }

    @Test func fixtureEndpointCannotRedirectOrdinarySyncOrReachNonLoopbackDestinations() throws {
        let canonical = "wss://sync-fixture.obsidian.md"
        let valid = try #require(URL(string: "ws://127.0.0.1:12345/sync"))
        #expect(
            try FacetSyncSocketEndpoint.official.resolve(
                canonical, expectedHost: "sync-fixture.obsidian.md"
            ).absoluteString == canonical)
        #expect(
            try FacetSyncSocketEndpoint.loopbackFixture(valid).resolve(
                canonical, expectedHost: "sync-fixture.obsidian.md") == valid)
        for address in [
            "ws://localhost:12345/sync", "ws://example.com:12345/sync", "ws://127.0.0.1/sync",
            "ws://user@127.0.0.1:12345/sync", "ws://127.0.0.1:12345/sync?query=1",
            "ws://127.0.0.1:12345/sync#fragment", "wss://127.0.0.1:12345/sync",
            "ws://127.0.0.1:12345/unowned",
        ] {
            let invalid = try #require(URL(string: address))
            #expect(throws: FacetSyncError.self) {
                try FacetSyncSocketEndpoint.loopbackFixture(invalid).resolve(
                    canonical, expectedHost: "sync-fixture.obsidian.md")
            }
        }
        #expect(throws: FacetSyncError.self) {
            try FacetSyncSocketEndpoint.loopbackFixture(valid).resolve(
                "wss://sync-other.obsidian.md", expectedHost: "sync-other.obsidian.md")
        }
        for address in [
            "ws://sync-fixture.obsidian.md", "wss://wrong.obsidian.md",
            "wss://sync-fixture.obsidian.md?query=1", "wss://user@sync-fixture.obsidian.md",
        ] {
            #expect(throws: FacetSyncError.self) {
                try FacetSyncSocketEndpoint.loopbackFixture(valid).resolve(
                    address, expectedHost: "sync-fixture.obsidian.md")
            }
        }
    }

    private func update(_ replica: FacetFixtureReplica, body: String) async throws {
        let task = try #require(await replica.snapshot().tasks.first)
        try await replica.engine.execute(
            profileID: replica.profileID,
            command: .object([
                "kind": .string("update"), "path": .string(task.path),
                "expectedRevision": .string(task.revision),
                "body": .string(body), "properties": .object([:]),
            ]))
    }

    private func settled(
        _ first: FacetFixtureReplica, _ second: FacetFixtureReplica, title: String?,
        body: String? = nil
    ) async throws {
        let deadline = Date().addingTimeInterval(30)
        while Date() < deadline {
            guard let left = first.session, let right = second.session else {
                throw FacetSyncError.transport
            }
            let leftState = try await left.currentStatus()
            let rightState = try await right.currentStatus()
            for status in [leftState, rightState]
            where [.failed, .reconnectRequired, .conflict].contains(status.phase) {
                throw FixtureConvergenceFailure(reason: "Native Sync entered \(status.phase)")
            }
            let leftSnapshot = try await first.snapshot()
            let rightSnapshot = try await second.snapshot()
            let leftTask = leftSnapshot.tasks.first
            let rightTask = rightSnapshot.tasks.first
            let expectedCount = title == nil ? 0 : 1
            if leftState.phase == .synced, rightState.phase == .synced,
                leftSnapshot.tasks.count == expectedCount,
                rightSnapshot.tasks.count == expectedCount,
                leftTask?.title == title, rightTask?.title == title,
                body == nil || (leftTask?.body == body && rightTask?.body == body)
            {
                if let leftTask, let rightTask {
                    #expect(try first.markdown(leftTask) == second.markdown(rightTask))
                }
                #expect(try await first.engine.uploads(profileID: first.profileID).isEmpty)
                #expect(try await second.engine.uploads(profileID: second.profileID).isEmpty)
                return
            }
            try await _Concurrency.Task.sleep(for: .milliseconds(20))
        }
        throw FixtureConvergenceFailure(
            reason: "Native replicas did not converge before the 30-second deadline")
    }
}

private struct FixtureConvergenceFailure: Error { let reason: String }

private func ciphertextWitness(_ directory: URL) throws {
    let url = directory.appendingPathComponent("fixture.sqlite")
    let values = try url.resourceValues(forKeys: [
        .fileSizeKey, .isRegularFileKey, .isSymbolicLinkKey,
    ])
    let size = try #require(values.fileSize)
    try #require(
        values.isRegularFile == true && values.isSymbolicLink == false && size < 16 * 1_024 * 1_024)
    let database = try Data(contentsOf: url)
    for sentinel in [
        "Account-free native task", "Initial real encrypted upload",
        "Edited by the second native replica", "Offline write survives a cold runtime reopen",
        "Recovered fail-next-push",
    ] {
        #expect(database.range(of: Data(sentinel.utf8)) == nil)
    }
}
