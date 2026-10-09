import Foundation
import Testing

@testable import TaskNotesFacetUI
@testable import TaskNotesKit

@Suite("Receipt-owned native delight") @MainActor
struct FacetDelightTests {
    private func receipt(id: String = "action", paths: [String] = ["Tasks/a.md"]) throws
        -> FacetMutationReceipt
    {
        let pathsJSON = try #require(String(bytes: JSONEncoder().encode(paths), encoding: .utf8))
        return try FacetMutationReceipt.read(
            json: """
                {"schemaVersion":1,"mutationId":"\(id)","applied":true,"taskPath":null,
                "cleanupPending":false,"paths":\(pathsJSON),"pendingCount":0,"diagnostics":[]}
                """, expectedMutationID: id, schema: FacetSchema.bundled())
    }
    private struct FeedbackFixture {
        let feedback: FacetNativeFeedback
        let defaults: UserDefaults
        let suite: String
    }
    private func feedback(_ sink: @escaping (FacetFeedbackEvent) -> Void) throws -> FeedbackFixture
    {
        let suite = "FacetDelight-\(UUID().uuidString)"
        let defaults = try #require(UserDefaults(suiteName: suite))
        return FeedbackFixture(
            feedback: FacetNativeFeedback(defaults: defaults, sink: sink), defaults: defaults,
            suite: suite)
    }

    @Test func receiptIdentitySuppressesDuplicatesNoOpsAndLostActivationWithoutReplay() throws {
        var delivered: [FacetFeedbackEvent] = []
        let fixture = try feedback { delivered.append($0) }
        let feedback = fixture.feedback
        defer { fixture.defaults.removePersistentDomain(forName: fixture.suite) }
        let origin = FacetFeedbackOrigin()
        feedback.setScene(origin, active: true)
        let activation = try #require(feedback.activation(for: origin))
        let session = UUID()
        func event(id: String, paths: [String] = ["Tasks/a.md"], activationID: UUID? = activation)
            throws -> FacetFeedbackEvent
        {
            FacetFeedbackEvent(
                sessionID: session, profileID: "A", receipt: try receipt(id: id, paths: paths),
                command: [
                    "kind": .string("set_completion"), "path": .string("Tasks/a.md"),
                    "completed": .bool(true), "occurrenceDate": .string("2026-10-09"),
                ],
                origin: origin, activationID: activationID)
        }
        let first = try event(id: "first")
        #expect(feedback.applied(first, ownsPresentation: true))
        #expect(!feedback.applied(first, ownsPresentation: true))
        #expect(!feedback.applied(try event(id: "noop", paths: []), ownsPresentation: true))
        feedback.setScene(origin, active: false)
        feedback.setScene(origin, active: true)
        #expect(!feedback.applied(try event(id: "lost"), ownsPresentation: true))
        #expect(
            !feedback.applied(
                try event(id: "lost", activationID: feedback.activation(for: origin)),
                ownsPresentation: true))
        #expect(
            feedback.applied(
                try event(id: "new", activationID: feedback.activation(for: origin)),
                ownsPresentation: true))
        #expect(delivered.map(\.mutationID) == ["first", "new"])
        #expect(delivered.first?.occurrenceDate == "2026-10-09")
    }

    @Test func batchMessageCountsReviewedTasksNotAuxiliaryWrites() throws {
        let command: [String: FacetValue] = [
            "kind": .string("batch"),
            "commands": .array([
                .object(["kind": .string("delete_checked"), "path": .string("Tasks/a.md")]),
                .object(["kind": .string("delete_checked"), "path": .string("Tasks/b.md")]),
            ]),
        ]
        let event = FacetFeedbackEvent(
            sessionID: UUID(), profileID: "A",
            receipt: try receipt(paths: ["Tasks/a.md", "Tasks/b.md", "Notes/backlink.md"]),
            command: command, origin: nil)
        #expect(event.count == 2 && event.action == .deleted)
        #expect(event.message == "2 tasks deleted")
    }

    @Test func verifiedCuePrecedesMaintenanceAndSurvivesUnrelatedReadGeneration() async throws {
        let context = try await StoreContext.open()
        let origin = FacetFeedbackOrigin()
        let fixture = try feedback { _ in }
        let feedback = fixture.feedback
        defer { fixture.defaults.removePersistentDomain(forName: fixture.suite) }
        feedback.setScene(origin, active: true)
        var verified = false
        let saved = await context.store.runSavedAction(
            action: ("action", "A"),
            ownsEngine: { context.store.engine === context.first },
            apply: {
                context.store.requestGeneration += 1
                return try receipt()
            },
            cleanup: {
                #expect(verified)
                throw CocoaError(.fileWriteOutOfSpace)
            }, reload: {},
            verified: { receipt, ownsAction in
                verified = feedback.applied(
                    FacetFeedbackEvent(
                        sessionID: UUID(), profileID: "A",
                        receipt: receipt, command: ["kind": .string("create")], origin: origin,
                        activationID: feedback.activation(for: origin)),
                    ownsPresentation: ownsAction)
            })
        #expect(saved && verified)
        try await context.close()
    }

    @Test func queuedCaptureCannotRegainItsOldSceneLease() async throws {
        let context = try await StoreContext.open()
        let vault = context.directory.appendingPathComponent("delight-vault")
        try FileManager.default.createDirectory(at: vault, withIntermediateDirectories: true)
        let profile = try await context.first.registerLocal(directory: vault, approveStandard: true)
        _ = try await context.first.refresh(profileID: profile.id)
        context.store.selectedProfileID = profile.id
        var effects = 0
        let fixture = try feedback { _ in effects += 1 }
        let feedback = fixture.feedback
        defer { fixture.defaults.removePersistentDomain(forName: fixture.suite) }
        context.store.feedback = feedback
        let origin = FacetFeedbackOrigin()
        context.store.setFeedbackScene(origin, active: true)
        let suspension = Suspension()
        let blocker = _Concurrency.Task {
            await context.store.actionCoordinator.submit {
                await suspension.pause()
                return true
            }
        }
        await suspension.waitUntilEntered()
        let capture = FacetCaptureDraft()
        capture.input = "Queued local task"
        #expect(capture.begin(store: context.store, profileID: profile.id, origin: origin))
        let queued = _Concurrency.Task { await capture.submit(store: context.store) }
        context.store.setFeedbackScene(origin, active: false)
        context.store.setFeedbackScene(origin, active: true)
        suspension.resume()
        #expect(await blocker.value)
        #expect(await queued.value)
        #expect(effects == 0)
        #expect(capture.input.isEmpty)
        try await context.close()
    }

    @Test func physicalCueGateAndUndoLifetimeUseMonotonicActiveTime() {
        let now = ContinuousClock.now
        var gate = FacetFeedbackAttemptGate()
        let first = gate.claim(duration: .milliseconds(176), now: now)
        let overlap = gate.claim(
            duration: .milliseconds(88), now: now.advanced(by: .milliseconds(100)))
        let next = gate.claim(
            duration: .milliseconds(88), now: now.advanced(by: .milliseconds(176)))
        #expect(first && !overlap && next)
        var lifetime = FacetFeedbackLifetime()
        lifetime.select("first")
        #expect(lifetime.resume(now: now) == .seconds(6))
        lifetime.pause(now: now.advanced(by: .seconds(2)))
        #expect(lifetime.resume(now: now.advanced(by: .seconds(90))) == .seconds(4))
        lifetime.select("second")
        #expect(lifetime.resume(now: now.advanced(by: .seconds(91))) == .seconds(6))
    }

    @Test func notesAndStructuredOnlyCaptureAreDirtyEvenWithEmptyTitle() {
        let draft = FacetCaptureDraft()
        #expect(!draft.hasChanges(body: "", properties: [:]))
        #expect(draft.hasChanges(body: "Important notes", properties: [:]))
        #expect(draft.hasChanges(body: "", properties: ["due": .string("2026-10-09")]))
        #expect(draft.hasChanges(body: "", properties: ["tags": .array([])]))
    }
}

@Suite("Read-only compact capture projection") @MainActor
struct FacetCapturePreviewTests {
    @Test func staleInputCannotReplaceNewerPreviewAndExplicitRemovalWins() async {
        let preview = FacetCapturePreview()
        let suspension = Suspension()
        let old = _Concurrency.Task {
            await preview.load(
                input: "Old tomorrow", overrides: [:], delay: .zero,
                ownsOwner: { true },
                read: {
                    await suspension.pause()
                    return .object([
                        "body": .string("Old notes"),
                        "properties": .object([
                            "title": .string("Old"), "due": .string("2026-10-10"),
                        ]),
                    ])
                })
        }
        await suspension.waitUntilEntered()
        await preview.load(
            input: "New tomorrow p:Home", overrides: ["due": .null], delay: .zero,
            ownsOwner: { true },
            read: {
                .object([
                    "body": .string("New notes"),
                    "properties": .object([
                        "title": .string("New"), "due": .string("2026-10-10"),
                        "projects": .array([.string("Home")]),
                    ]),
                ])
            })
        suspension.resume()
        await old.value
        #expect(preview.properties["title"] == .string("New"))
        #expect(preview.properties["due"] == .null)
        #expect(preview.properties["projects"] == .array([.string("Home")]))
        #expect(preview.body == "New notes")
        #expect(preview.canSubmit("New tomorrow p:Home"))
        #expect(!preview.canSubmit("Newer input awaiting preview"))
        #expect(!preview.isLoading && preview.error == nil)
    }

    @Test func canonicalMetadataWithoutTitleCannotEnableAdd() async {
        let preview = FacetCapturePreview()
        await preview.load(
            input: "tomorrow p:Work", overrides: [:], delay: .zero,
            ownsOwner: { true },
            read: {
                .object([
                    "body": .string(""),
                    "properties": .object([
                        "title": .string(""), "due": .string("2026-10-10"),
                        "projects": .array([.string("Work")]),
                    ]),
                ])
            })
        #expect(!preview.canSubmit("tomorrow p:Work"))
        #expect(preview.needsTitle("tomorrow p:Work"))
        #expect(preview.properties["projects"] == .array([.string("Work")]))
    }

    @Test func lostOwnerAndCancelledDebounceNeverPublishOrExecuteAWrite() async {
        let preview = FacetCapturePreview()
        var reads = 0
        await preview.load(
            input: "Different vault", overrides: [:], delay: .zero,
            ownsOwner: { false },
            read: {
                reads += 1
                return .null
            })
        #expect(reads == 0 && preview.properties.isEmpty)
        let cancelled = _Concurrency.Task {
            await preview.load(
                input: "Cancelled", overrides: [:], delay: .seconds(10),
                ownsOwner: { true },
                read: {
                    reads += 1
                    return .null
                })
        }
        cancelled.cancel()
        await cancelled.value
        #expect(reads == 0 && !preview.isLoading)
    }
}
