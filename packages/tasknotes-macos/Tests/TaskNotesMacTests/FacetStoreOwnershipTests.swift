import Foundation
import SwiftUI
import Testing

@testable import TaskNotesFacetUI
@testable import TaskNotesKit

@MainActor
internal final class Suspension {
    private var entered = false
    private var started: CheckedContinuation<Void, Never>?
    private var completion: CheckedContinuation<Void, Never>?

    func waitUntilEntered() async {
        if entered { return }
        await withCheckedContinuation { started = $0 }
    }
    func pause() async {
        entered = true
        started?.resume()
        started = nil
        await withCheckedContinuation { completion = $0 }
    }
    func resume() {
        completion?.resume()
        completion = nil
    }
}

extension FacetStoreOwnershipTests {
    private var fixedAt: String { "2026-10-07T12:00:00Z" }

    private func trackingPage(
        history: Bool, second: Bool = false, profileID: String = "A", version: UInt64 = 7
    ) throws -> FacetValue {
        let revision = String(repeating: "a", count: 64)
        let row: String
        let cursor: String
        let additional: String
        if history {
            row = """
                {"entryIndex":\(second ? 1 : 0),"startedAt":"2026-10-07T11:00:00Z",
                "endedAt":null,"elapsedSeconds":3600,"state":"running"}
                """
            cursor = second ? "null" : #"{"entryIndex":0,"at":"2026-10-07T12:00:00Z"}"#
            additional = #""taskPath":"a.md","taskRevision":""# + revision + #"""#
        } else {
            let path = second ? "b.md" : "a.md"
            let identity = String(repeating: second ? "b" : "a", count: 64)
            row = """
                {"sessionId":"facet-tracking:\(identity)","taskPath":"\(path)","title":"Task \(path)",
                "taskRevision":"\(revision)","startedAt":"2026-10-07T11:00:00Z",
                "elapsedSeconds":3600,"state":"running","projectLabels":["Work"]}
                """
            cursor = second ? "null" : #"{"taskPath":"a.md","at":"2026-10-07T12:00:00Z"}"#
            additional = ""
        }
        return try FacetFeatureProjection.parseJSON(
            """
            {"schemaVersion":1,"profileId":"\(profileID)","version":\(version),"at":"\(fixedAt)",
            "totalCount":2,"rows":[\(row)],"nextCursor":\(cursor),
            "problemCount":0,"problems":[]\(additional.isEmpty ? "" : "," + additional)}
            """)
    }

    @Test func actualTrackingContinuationRequestsRetainVersionClockAndCursor() async throws {
        for history in [false, true] {
            let context = try await StoreContext.open()
            var requests: [[String: FacetValue]] = []
            let read: (String, [String: FacetValue]) async throws -> FacetValue = {
                profile, request in
                #expect(profile == "A")
                requests.append(request)
                return try trackingPage(history: history, second: requests.count == 2)
            }
            await context.store.readTracking(
                profileID: "A", path: history ? "a.md" : nil, at: fixedAt,
                ownsEngine: { context.store.engine === context.first }, read: read)
            await context.store.readTracking(
                profileID: "A", path: history ? "a.md" : nil, at: fixedAt, continuing: true,
                ownsEngine: { context.store.engine === context.first }, read: read)
            #expect(requests.count == 2)
            #expect(requests[0]["after"] == nil)
            #expect(requests[1]["at"] == .string(fixedAt))
            #expect(requests[1]["expectedVersion"] == .unsigned(7))
            #expect(
                requests[1]["after"]
                    == .object(
                        history
                            ? ["entryIndex": .unsigned(0), "at": .string(fixedAt)]
                            : ["taskPath": .string("a.md"), "at": .string(fixedAt)]))
            #expect(context.store.trackingContinuation == nil)
            #expect(
                history
                    ? context.store.trackingHistory?.rows.count == 1
                    : context.store.trackingSessions?.rows.count == 1)
            #expect(context.store.error == nil)
            try await context.close()
        }
    }

    @Test func staleTrackingContinuationNeverReachesReadOperation() async throws {
        for history in [false, true] {
            for change in OwnerChange.allCases {
                let context = try await StoreContext.open()
                var reads = 0
                let read: (String, [String: FacetValue]) async throws -> FacetValue = { _, _ in
                    reads += 1
                    return try trackingPage(history: history)
                }
                await context.store.readTracking(
                    profileID: "A", path: history ? "a.md" : nil, at: fixedAt,
                    ownsEngine: { context.store.engine === context.first }, read: read)
                #expect(reads == 1)
                await context.changeOwner(change)
                let currentEngine = try #require(context.store.engine)
                await context.store.readTracking(
                    profileID: "A", path: history ? "a.md" : nil, at: fixedAt, continuing: true,
                    ownsEngine: { context.store.engine === currentEngine }, read: read)
                #expect(reads == 1, "\(history) \(change)")
                #expect(context.store.trackingContinuation == nil)
                #expect(context.store.trackingSessions == nil)
                #expect(context.store.trackingHistory == nil)
                try await context.close()
            }
        }
    }

    @Test func delayedTrackingPageAndErrorAreSuppressedAfterOwnerChange() async throws {
        for fails in [false, true] {
            for change in OwnerChange.allCases {
                let context = try await StoreContext.open()
                let suspension = Suspension()
                let load = _Concurrency.Task {
                    await context.store.readTracking(
                        profileID: "A", path: nil, at: fixedAt,
                        ownsEngine: { context.store.engine === context.first },
                        read: { _, _ in
                            await suspension.pause()
                            if fails { throw FacetContractError.unsupportedResponse }
                            return try trackingPage(history: false)
                        })
                }
                await suspension.waitUntilEntered()
                await context.changeOwner(change)
                suspension.resume()
                await load.value
                #expect(context.store.trackingContinuation == nil)
                #expect(context.store.trackingSessions == nil)
                #expect(context.store.error == nil, "\(fails) \(change)")
                try await context.close()
            }
        }
    }

    @Test func changedVersionOrForeignProfileDoesNotAppendToTrackingPage() async throws {
        for foreign in [false, true] {
            let context = try await StoreContext.open()
            await context.store.readTracking(
                profileID: "A", path: nil, at: fixedAt,
                ownsEngine: { context.store.engine === context.first },
                read: { _, _ in try trackingPage(history: false) })
            await context.store.readTracking(
                profileID: "A", path: nil, at: fixedAt, continuing: true,
                ownsEngine: { context.store.engine === context.first },
                read: { _, _ in
                    try trackingPage(
                        history: false, second: true, profileID: foreign ? "B" : "A",
                        version: foreign ? 7 : 8)
                })
            #expect(context.store.trackingSessions?.rows.count == 1)
            #expect(context.store.trackingContinuation == nil)
            #expect(context.store.error != nil)
            try await context.close()
        }
    }
}

@MainActor
internal struct StoreContext {
    let store = FacetStore()
    let first: FacetEngine
    let second: FacetEngine
    let directory: URL

    static func open() async throws -> Self {
        let testDirectory = FileManager.default.temporaryDirectory
            .appendingPathComponent("facet-owner-component-\(UUID().uuidString)")
        let firstEngine = try await FacetEngine.open(
            directory: testDirectory.appendingPathComponent("first"), secrets: ComponentKeys())
        let secondEngine = try await FacetEngine.open(
            directory: testDirectory.appendingPathComponent("second"), secrets: ComponentKeys())
        let context = Self(first: firstEngine, second: secondEngine, directory: testDirectory)
        context.store.engine = firstEngine
        context.store.selectProfilePresentation("A")
        return context
    }

    func close() async throws {
        try await first.close()
        try await second.close()
        try FileManager.default.removeItem(at: directory)
    }

    func changeOwner(_ change: OwnerChange) async {
        switch change {
        case .selection:
            store.selectProfilePresentation("B")
            store.selectProfilePresentation("A")
        case .request: store.requestGeneration += 1
        case .engine: store.engine = second
        case .lifecycle: await store.pauseSync()
        case .removal:
            await store.removeProfileWithOperations(
                profileID: "A",
                operations: FacetProfileRemovalOperations(
                    stop: {}, removeDomain: { nil }, detach: {}, retire: {},
                    reload: { [] }, ownsEngine: { true }, reconcile: {}))
        }
    }
}

@Suite @MainActor struct FacetStoreOwnershipTests {
    internal func receipt(applied: Bool = true) throws -> FacetMutationReceipt {
        let json = """
            {"schemaVersion":1,"mutationId":"action","applied":\(applied),"taskPath":null,
            "cleanupPending":false,"paths":[],"pendingCount":0,
            "diagnostics":\(applied ? #"[{"code":"template_missing"}]"# : "[]")}
            """
        return try FacetMutationReceipt.read(
            json: json, expectedMutationID: "action", schema: FacetSchema.bundled())
    }

    @Test func appliedReceiptKeepsSavedWhenCleanupFails() async throws {
        let context = try await StoreContext.open()
        var reloads = 0
        let saved = await context.store.runSavedAction(
            action: (mutationID: "action", profileID: "A"),
            ownsEngine: { context.store.engine === context.first },
            apply: { try receipt() }, cleanup: { throw CocoaError(.fileWriteOutOfSpace) },
            reload: { reloads += 1 })
        #expect(saved)
        #expect(
            context.store.savedNotice
                == [
                    "The task was saved without the configured template.",
                    "The task was saved, but cleanup could not finish. Check available storage.",
                ].joined(separator: "\n")
        )
        #expect(context.store.error == nil)
        #expect(reloads == 1)
        try await context.close()
    }

    @Test func lateAppliedReceiptDoesNotPresentForAnotherOwner() async throws {
        for change in OwnerChange.allCases {
            let context = try await StoreContext.open()
            let suspension = Suspension()
            var reloads = 0
            let action = _Concurrency.Task {
                await context.store.runSavedAction(
                    action: (mutationID: "action", profileID: "A"),
                    ownsEngine: { context.store.engine === context.first },
                    apply: {
                        await suspension.pause()
                        return try receipt()
                    },
                    cleanup: { throw FacetContractError.unsupportedResponse },
                    reload: { reloads += 1 })
            }
            await suspension.waitUntilEntered()
            await context.changeOwner(change)
            suspension.resume()
            #expect(await action.value, "\(change)")
            #expect(context.store.savedNotice == nil, "\(change)")
            #expect(context.store.error == nil, "\(change)")
            #expect(reloads == 0, "\(change)")
            try await context.close()
        }
    }

    @Test func lateFailureDoesNotPresentForAnotherOwner() async throws {
        for change in OwnerChange.allCases {
            let context = try await StoreContext.open()
            let suspension = Suspension()
            let action = _Concurrency.Task {
                await context.store.runSavedAction(
                    action: (mutationID: "action", profileID: "A"),
                    ownsEngine: { context.store.engine === context.first },
                    apply: {
                        await suspension.pause()
                        throw FacetContractError.unsupportedResponse
                    }, cleanup: {}, reload: {})
            }
            await suspension.waitUntilEntered()
            await context.changeOwner(change)
            suspension.resume()
            #expect(await !action.value, "\(change)")
            #expect(context.store.savedNotice == nil, "\(change)")
            #expect(context.store.error == nil, "\(change)")
            try await context.close()
        }
    }

    @Test func reservedActionRejectsOverlapBeforeApplyingIt() async throws {
        let context = try await StoreContext.open()
        let suspension = Suspension()
        let first = _Concurrency.Task {
            await context.store.runSavedAction(
                action: (mutationID: "action", profileID: "A"),
                ownsEngine: { context.store.engine === context.first },
                apply: {
                    await suspension.pause()
                    return try receipt()
                }, cleanup: {}, reload: {})
        }
        await suspension.waitUntilEntered()
        var secondApplied = false
        let second = await context.store.runSavedAction(
            action: (mutationID: "other", profileID: "A"), ownsEngine: { true },
            apply: {
                secondApplied = true
                return try receipt()
            }, cleanup: {}, reload: {})
        #expect(!second)
        #expect(!secondApplied)
        #expect(context.store.activeMutationID == "action")
        suspension.resume()
        #expect(await first.value)
        #expect(context.store.activeMutationID == nil)
        #expect(!context.store.isSaving)
        try await context.close()
    }
}

extension FacetStoreOwnershipTests {
    @Test func unappliedReceiptNeverCleansUpOrPublishesSaved() async throws {
        let context = try await StoreContext.open()
        var cleaned = false
        let saved = await context.store.runSavedAction(
            action: (mutationID: "action", profileID: "A"),
            ownsEngine: { context.store.engine === context.first },
            apply: { try receipt(applied: false) }, cleanup: { cleaned = true }, reload: {})
        #expect(!saved)
        #expect(!cleaned)
        #expect(context.store.savedNotice == nil)
        #expect(context.store.error != nil)
        try await context.close()
    }

    @Test func malformedTrackingCursorAndTerminalCountFailBeforePresentation() async throws {
        for history in [false, true] {
            for cursor in [false, true] {
                let context = try await StoreContext.open()
                var fields = try #require(trackingPage(history: history).object?.fields)
                fields["nextCursor"] =
                    cursor
                    ? .object(
                        history
                            ? ["entryIndex": .integer(99), "at": .string(fixedAt)]
                            : ["taskPath": .string("foreign.md"), "at": .string(fixedAt)])
                    : .null
                await context.store.readTracking(
                    profileID: "A", path: history ? "a.md" : nil, at: fixedAt,
                    ownsEngine: { context.store.engine === context.first },
                    read: { _, _ in .object(fields) })
                #expect(context.store.trackingHistory == nil)
                #expect(context.store.trackingSessions == nil)
                #expect(context.store.trackingContinuation == nil)
                #expect(context.store.error != nil)
                try await context.close()
            }
        }
    }

    @Test func boundedTrackingSurfacesRenderOffscreen() async throws {
        let instant = try Date.ISO8601FormatStyle().parse(fixedAt)
        let zone = try #require(TimeZone(secondsFromGMT: 0))
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = zone
        calendar.locale = Locale(identifier: "en_US")
        for history in [false, true] {
            let store = FacetStore(clock: SystemClock(timeZone: zone, instant: { instant }))
            store.selectProfilePresentation("A")
            await store.readTracking(
                profileID: "A", path: history ? "a.md" : nil, at: fixedAt,
                ownsEngine: { true }, read: { _, _ in try trackingPage(history: history) })
            let task: FacetTask? =
                history
                ? try FacetFeatureProjection.decode(
                    FacetTask.self,
                    from: FacetFeatureProjection.parseJSON(
                        """
                        {"id":"a.md","path":"a.md","title":"Task a.md",
                        "revision":"\(String(repeating: "a", count: 64))",
                        "status":"open","priority":"normal","completed":false,"isRecurring":false,
                        "properties":{},"body":"","isBlocked":false,"isBlocking":false,
                        "hasActiveTimeSession":true,"totalTrackedMinutes":60,"isPending":false}
                        """)) : nil
            for appearance in SnapshotAppearance.allCases {
                for width in [360.0, 800.0] {
                    let result = try OffscreenSnapshot.write(
                        NavigationStack {
                            FacetTimingView(store: store, profileID: "A", task: task, now: instant)
                        }
                        .environment(\.locale, Locale(identifier: "en_US"))
                        .environment(\.timeZone, zone)
                        .environment(\.calendar, calendar),
                        named: "tracking-\(history ? "history" : "overview")-\(Int(width))",
                        size: CGSize(width: width, height: 820), appearance: appearance)
                    #expect(result.distinctColors > 8)
                    #expect(result.byteCount > 1000)
                }
            }
        }
    }
}

internal enum OwnerChange: CaseIterable {
    case selection, request, removal, engine, lifecycle
}
