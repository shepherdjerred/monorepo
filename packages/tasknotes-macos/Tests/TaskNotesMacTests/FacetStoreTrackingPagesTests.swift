import Foundation
import Testing

@testable import TaskNotesFacetUI
@testable import TaskNotesKit

extension FacetStoreOwnershipTests {
    private func trackingCapture(_ name: String) throws -> [String: FacetValue] {
        let url = try #require(Bundle.module.url(forResource: name, withExtension: "json"))
        return try #require(
            FacetFeatureProjection.parseJSON(String(contentsOf: url, encoding: .utf8)).object?
                .fields)
    }

    @Test func actualNanoSQLiteHistoryPagesKeepCoreElapsedValuesAndCurrentPageOnly() async throws {
        let capture = try trackingCapture("tracking-sqlite-capture")
        let profile = try #require(capture["profileId"]?.text)
        let at = try #require(capture["at"]?.text)
        let cases = try #require(capture["cases"]?.array?.elements)
        for id in ["nano-end-below-round", "nano-start-below-round", "combined"] {
            let test = try #require(cases.first(where: { $0.object?.fields["id"]?.text == id }))
            let fields = try #require(test.object?.fields)
            let path = try #require(fields["path"]?.text)
            let pages = try #require(fields["historyPagesRaw"]?.array?.elements)
            let context = try await StoreContext.open()
            context.store.selectProfilePresentation(profile)
            for (index, raw) in pages.enumerated() {
                let value = try FacetFeatureProjection.parseJSON(try #require(raw.text))
                await context.store.readTracking(
                    profileID: profile, path: path, at: at, continuing: index != 0,
                    ownsEngine: { context.store.engine === context.first }, read: { _, _ in value })
                let shown = try #require(context.store.trackingHistory)
                #expect(shown.at == at)
                #expect(shown.rows.count == (id == "combined" ? 2 : 1))
                if id != "combined" { #expect(shown.rows.first?.elapsedSeconds == 29) }
                #expect(context.store.error == nil)
            }
            #expect(context.store.trackingContinuation == nil)
            try await context.close()
        }
    }

    @Test func actualNative64SQLiteHistoryReplacesPagesWithoutRetainingEarlierRows() async throws {
        let capture = try trackingCapture("tracking-native64-capture")
        let profile = try #require(capture["profileId"]?.text)
        let at = try #require(capture["at"]?.text)
        let cases = try #require(capture["cases"]?.array?.elements)
        let test = try #require(
            cases.first(where: { $0.object?.fields["id"]?.text == "history-130" }))
        let fields = try #require(test.object?.fields)
        let path = try #require(fields["path"]?.text)
        let pages = try #require(fields["historyPagesRaw"]?.array?.elements)
        #expect(pages.count == 3)
        let context = try await StoreContext.open()
        context.store.selectProfilePresentation(profile)
        for (index, raw) in pages.enumerated() {
            let value = try FacetFeatureProjection.parseJSON(try #require(raw.text))
            await context.store.readTracking(
                profileID: profile, path: path, at: at, continuing: index != 0,
                ownsEngine: { context.store.engine === context.first },
                read: { _, request in
                    #expect(request["limit"] == .integer(64))
                    #expect(request["at"] == .string(at))
                    return value
                })
            let shown = try #require(context.store.trackingHistory)
            #expect(shown.rows.count == (index == 2 ? 2 : 64))
            #expect(shown.rows.first?.entryIndex == UInt64(index * 64))
            #expect(shown.totalCount == 130)
            #expect(
                context.store.trackingContinuation?.seenCount
                    == (index == 2 ? nil : UInt64((index + 1) * 64)))
            #expect(context.store.error == nil)
        }
        #expect(context.store.trackingContinuation == nil)
        try await context.close()
    }

    @Test func actualUnicodeSQLitePagesReplaceRowsAndPreserveQualifiedContinuation() async throws {
        let capture = try trackingCapture("tracking-unicode-capture")
        let pages = try #require(capture["sessionsPagesRaw"]?.array?.elements)
        let profile = try #require(capture["profileId"]?.text)
        let at = try #require(capture["at"]?.text)
        let context = try await StoreContext.open()
        context.store.selectProfilePresentation(profile)
        var expectedAfter: FacetValue?
        for (index, raw) in pages.enumerated() {
            let value = try FacetFeatureProjection.parseJSON(try #require(raw.text))
            await context.store.readTracking(
                profileID: profile, path: nil, at: at, continuing: index != 0,
                ownsEngine: { context.store.engine === context.first },
                read: { owner, request in
                    #expect(owner == profile)
                    #expect(request["at"] == .string(at))
                    #expect(request["after"] == expectedAfter)
                    return value
                })
            let shown = try #require(context.store.trackingSessions)
            #expect(shown.rows.count == (index == 2 ? 1 : 2))
            #expect(context.store.error == nil)
            #expect(
                context.store.trackingContinuation?.seenCount
                    == (index == 2 ? nil : UInt64((index + 1) * 2)))
            expectedAfter = shown.nextCursor?.value
        }
        #expect(
            context.store.trackingSessions?.rows.first?.taskPath.utf8.elementsEqual(
                "Tasks/\u{10000}.md".utf8) == true)
        #expect(context.store.trackingContinuation == nil)
        let cases = try #require(capture["cases"]?.array?.elements)
        let composed = try #require(
            cases.first(where: { $0.object?.fields["id"]?.text == "composed" }))
        let history = try #require(
            composed.object?.fields["historyPagesRaw"]?.array?.elements.first?.text)
        await context.store.readTracking(
            profileID: profile, path: "Tasks/e\u{301}.md", at: at,
            ownsEngine: { context.store.engine === context.first },
            read: { _, _ in try FacetFeatureProjection.parseJSON(history) })
        #expect(context.store.trackingHistory == nil)
        #expect(context.store.error != nil)
        try await context.close()
    }

    private func boundedPage(history: Bool, start: Int, count: Int, terminal: Bool) -> FacetValue {
        let revision = String(repeating: "a", count: 64)
        let at = "2026-10-07T12:00:00Z"
        let rows = (start..<(start + count)).map { index -> FacetValue in
            if history {
                return .object([
                    "entryIndex": .integer(Int64(index)), "startedAt": .string(at),
                    "endedAt": .null,
                    "elapsedSeconds": .unsigned(0), "state": .string("running"),
                ])
            }
            return .object([
                "sessionId": .string("facet-tracking:" + padded(index + 1, radix: 16, width: 64)),
                "taskPath": .string(padded(index, radix: 10, width: 3) + ".md"),
                "title": .string("Task"),
                "taskRevision": .string(revision), "startedAt": .string(at),
                "elapsedSeconds": .unsigned(0), "state": .string("running"),
                "projectLabels": .array([]),
            ])
        }
        let cursor: FacetValue =
            terminal
            ? .null
            : .object([
                history ? "entryIndex" : "taskPath": history
                    ? .integer(Int64(start + count - 1))
                    : .string(padded(start + count - 1, radix: 10, width: 3) + ".md"),
                "at": .string(at),
            ])
        var fields: [String: FacetValue] = [
            "schemaVersion": .integer(1), "profileId": .string("A"), "version": .unsigned(7),
            "at": .string(at), "totalCount": .unsigned(130), "rows": .array(rows),
            "nextCursor": cursor,
            "problemCount": .unsigned(0), "problems": .array([]),
        ]
        if history {
            fields["taskPath"] = .string("a.md")
            fields["taskRevision"] = .string(revision)
        }
        return .object(fields)
    }

    private func padded(_ value: Int, radix: Int, width: Int) -> String {
        let text = String(value, radix: radix)
        return String(repeating: "0", count: max(0, width - text.count)) + text
    }

    @Test func multipleFullPagesRetainOnlyCurrentRowsAndValidateCumulativeTerminalCount()
        async throws
    {
        for history in [false, true] {
            let context = try await StoreContext.open()
            for index in 0..<3 {
                let start = index * 64
                let count = index == 2 ? 2 : 64
                await context.store.readTracking(
                    profileID: "A", path: history ? "a.md" : nil, at: "2026-10-07T12:00:00Z",
                    continuing: index != 0, ownsEngine: { context.store.engine === context.first },
                    read: { _, _ in
                        boundedPage(
                            history: history, start: start, count: count, terminal: index == 2)
                    })
                #expect(
                    (history
                        ? context.store.trackingHistory?.rows.count
                        : context.store.trackingSessions?.rows.count) == count)
                #expect(context.store.error == nil)
                #expect(
                    context.store.trackingContinuation?.seenCount
                        == (index == 2 ? nil : UInt64(start + count)))
            }
            #expect(context.store.trackingContinuation == nil)
            await context.store.readTracking(
                profileID: "A", path: history ? "a.md" : nil, at: "2026-10-07T12:00:00Z",
                ownsEngine: { context.store.engine === context.first },
                read: { _, request in
                    #expect(request["after"] == nil)
                    return boundedPage(history: history, start: 0, count: 64, terminal: false)
                })
            #expect(context.store.trackingContinuation?.seenCount == 64)
            try await context.close()
        }
    }

    @Test func noProgressChangedLineageAndPrematureTerminalPagesFailBeforeReplacingCurrentRows()
        async throws
    {
        for history in [false, true] {
            for failure in [
                "empty", "terminal", "total", "problems", "version", "revision", "replay",
                "oversize", "problem-path", "problem-code",
            ] + (history ? ["gap"] : []) {
                let context = try await StoreContext.open()
                let at = "2026-10-07T12:00:00Z"
                let firstPage = try lineagePage(history: history, failure: failure, first: true)
                await context.store.readTracking(
                    profileID: "A", path: history ? "a.md" : nil, at: at,
                    ownsEngine: { context.store.engine === context.first },
                    read: { _, _ in firstPage })
                let page = try lineagePage(history: history, failure: failure, first: false)
                await context.store.readTracking(
                    profileID: "A", path: history ? "a.md" : nil, at: at, continuing: true,
                    ownsEngine: { context.store.engine === context.first }, read: { _, _ in page })
                #expect(context.store.error != nil, "\(history) \(failure)")
                #expect(
                    (history
                        ? context.store.trackingHistory?.rows.count
                        : context.store.trackingSessions?.rows.count) == 64)
                #expect(context.store.trackingContinuation == nil)
                try await context.close()
            }
        }
    }

    private func lineagePage(history: Bool, failure: String, first: Bool) throws -> FacetValue {
        var fields = try #require(
            boundedPage(
                history: history,
                start: first || failure == "replay" ? 0 : failure == "gap" ? 65 : 64,
                count: first ? 64 : failure == "empty" ? 0 : failure == "oversize" ? 65 : 64,
                terminal: !first && (failure == "terminal" || failure == "empty")
            ).object?.fields)
        if !first {
            if failure == "total" { fields["totalCount"] = .unsigned(131) }
            if failure == "problems" { fields["problemCount"] = .unsigned(1) }
            if failure == "version" { fields["version"] = .unsigned(8) }
            if failure == "revision" {
                if history {
                    fields["taskRevision"] = .string(String(repeating: "b", count: 64))
                } else {
                    fields["at"] = .string("2026-10-07T12:00:01Z")
                }
            }
        }
        if failure.hasPrefix("problem-") {
            fields["problemCount"] = .unsigned(1)
            fields["problems"] = .array([
                .object([
                    "taskPath": .string(
                        !first && failure == "problem-path" ? "\u{e9}.md" : "e\u{301}.md"),
                    "code": .string(
                        !first && failure == "problem-code"
                            ? "invalid_projects" : "invalid_time_entries"),
                ])
            ])
        }
        return .object(fields)
    }
}
