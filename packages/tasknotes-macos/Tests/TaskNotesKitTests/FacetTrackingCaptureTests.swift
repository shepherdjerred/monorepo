import Foundation
import Testing

@testable import TaskNotesKit

private actor CapturedTrackingPages {
    let pages: [FacetValue]
    private(set) var requests: [FacetValue] = []

    init(pages: [FacetValue]) { self.pages = pages }

    func next(_ request: FacetValue) throws -> FacetValue {
        guard requests.count < pages.count else { throw FacetContractError.unsupportedResponse }
        let page = pages[requests.count]
        requests.append(request)
        return page
    }
}

@Suite struct FacetTrackingCaptureTests {
    @Test func actualSQLiteCapturesPreserveNanoSecondsAndExactUnicodePaths() throws {
        let schema = try FacetSchema.bundled()
        for name in [
            "tracking-sqlite-capture", "tracking-unicode-capture", "tracking-native64-capture",
        ] {
            let url = try #require(Bundle.module.url(forResource: name, withExtension: "json"))
            let document = try FacetFeatureProjection.parseJSON(
                String(contentsOf: url, encoding: .utf8))
            let capture = try #require(document.object?.fields)
            let at = try #require(capture["at"]?.text)
            #expect(at == "2026-10-07T12:00:00.250000001Z")
            for test in try #require(capture["cases"]?.array?.elements) {
                let fields = try #require(test.object?.fields)
                let path = try #require(fields["path"]?.text)
                for raw in try #require(fields["historyPagesRaw"]?.array?.elements) {
                    let value = try FacetFeatureProjection.parseJSON(try #require(raw.text))
                    try schema.validate(value, definition: "trackingHistory")
                    let page = try FacetFeatureProjection.decode(
                        FacetTrackingHistory.self, from: value)
                    try page.validatePage()
                    #expect(FacetTrackingPath.same(page.taskPath, path))
                    #expect(page.at == at)
                    if fields["id"]?.text == "nano-end-below-round" {
                        #expect(page.rows.first?.elapsedSeconds == 29)
                        #expect(page.rows.first?.endedAt == "2026-10-07T10:00:29.999999999Z")
                    }
                    if fields["id"]?.text == "nano-start-below-round" {
                        #expect(page.rows.first?.elapsedSeconds == 29)
                    }
                }
            }
            var paths: [String] = []
            var identifiers: [String] = []
            for raw in try #require(capture["sessionsPagesRaw"]?.array?.elements) {
                let value = try FacetFeatureProjection.parseJSON(try #require(raw.text))
                try schema.validate(value, definition: "trackingSessions")
                let page = try FacetFeatureProjection.decode(
                    FacetTrackingSessions.self, from: value)
                try page.validatePage()
                #expect(page.at == at)
                #expect(page.nextCursor == nil || page.nextCursor?.at == at)
                paths += page.rows.map(\.taskPath)
                identifiers += page.rows.map(\.sessionId)
            }
            if name == "tracking-unicode-capture" {
                expectUnicode(paths: paths, identifiers: identifiers)
            }
        }
    }

    private func expectUnicode(paths: [String], identifiers: [String]) {
        #expect(
            paths.map { Array($0.utf8) }
                == [
                    "Tasks/A.md", "Tasks/e\u{301}.md", "Tasks/\u{e9}.md",
                    "Tasks/\u{e000}.md", "Tasks/\u{10000}.md",
                ].map { Array($0.utf8) })
        #expect(identifiers.count == 5 && Set(identifiers).count == 5)
        #expect("Tasks/e\u{301}.md" == "Tasks/\u{e9}.md")
        #expect(!FacetTrackingPath.same("Tasks/e\u{301}.md", "Tasks/\u{e9}.md"))
    }

    @Test func metadataReaderAcceptsActualUnicodePagesWhileKeepingItsRowBudget() async throws {
        let url = try #require(
            Bundle.module.url(forResource: "tracking-unicode-capture", withExtension: "json"))
        let document = try FacetFeatureProjection.parseJSON(
            String(contentsOf: url, encoding: .utf8))
        let fields = try #require(document.object?.fields)
        let values = try #require(fields["sessionsPagesRaw"]?.array?.elements).map {
            try FacetFeatureProjection.parseJSON(try #require($0.text))
        }
        let pages = CapturedTrackingPages(pages: values)
        let plan = try await FacetTrackingPlanReader.read(
            profileID: try #require(fields["profileId"]?.text),
            at: try #require(fields["at"]?.text),
            maximumRows: 3, fetch: { try await pages.next($0) })
        #expect(plan.totalCount == 5)
        #expect(plan.rows.count == 3)
        #expect(
            plan.rows.map { Array($0.taskPath.utf8) }
                == [
                    "Tasks/A.md", "Tasks/e\u{301}.md", "Tasks/\u{e9}.md",
                ].map { Array($0.utf8) })
        let requests = await pages.requests
        #expect(requests.count == 3)
        let after = try #require(
            requests[1].object?.fields["after"]?.object?.fields["taskPath"]?.text)
        #expect(after.utf8.elementsEqual("Tasks/e\u{301}.md".utf8))
        #expect(plan.at == "2026-10-07T12:00:00.250000001Z")
    }

    @Test func metadataReaderRejectsAliasedCursorAndChangedSameCountProblemLists() async throws {
        let url = try #require(
            Bundle.module.url(forResource: "tracking-unicode-capture", withExtension: "json"))
        let capture = try #require(
            FacetFeatureProjection.parseJSON(String(contentsOf: url, encoding: .utf8)).object?
                .fields)
        let raw = try #require(capture["sessionsPagesRaw"]?.array?.elements)
        let firstRaw = try #require(raw[0].text)
        let secondRaw = try #require(raw[1].text)
        for fault in ["cursor", "problem-path", "problem-code"] {
            var first = try #require(
                FacetFeatureProjection.parseJSON(firstRaw).object?.fields)
            var second = try #require(
                FacetFeatureProjection.parseJSON(secondRaw).object?.fields)
            if fault == "cursor" {
                var cursor = try #require(first["nextCursor"]?.object?.fields)
                cursor["taskPath"] = .string("Tasks/\u{e9}.md")
                first["nextCursor"] = .object(cursor)
            } else {
                first["problemCount"] = .unsigned(1)
                second["problemCount"] = .unsigned(1)
                first["problems"] = .array([
                    .object([
                        "taskPath": .string("Tasks/e\u{301}.md"),
                        "code": .string("invalid_time_entries"),
                    ])
                ])
                second["problems"] = .array([
                    .object([
                        "taskPath": .string(
                            fault == "problem-path" ? "Tasks/\u{e9}.md" : "Tasks/e\u{301}.md"),
                        "code": .string(
                            fault == "problem-code" ? "invalid_projects" : "invalid_time_entries"),
                    ])
                ])
            }
            let pages = CapturedTrackingPages(pages: [.object(first), .object(second)])
            await #expect(throws: FacetContractError.self) {
                try await FacetTrackingPlanReader.read(
                    profileID: try #require(capture["profileId"]?.text),
                    at: try #require(capture["at"]?.text), maximumRows: 3,
                    fetch: { try await pages.next($0) })
            }
            #expect(await pages.requests.count == (fault == "cursor" ? 1 : 2))
        }
    }

    @Test func exactPathOrderIncludesCombiningBoundariesAndCursorIdentity() throws {
        #expect(FacetTrackingPath.precedes("e\u{301}.md", "f.md"))
        #expect(FacetTrackingPath.precedes("\u{e000}.md", "\u{10000}.md"))
        let raw = """
            {"schemaVersion":1,"profileId":"A","version":1,"at":"2026-10-07T12:00:00Z",
            "totalCount":2,"rows":[{"sessionId":"facet-tracking:\(String(repeating: "a", count: 64))",
            "taskPath":"e\\u0301.md","title":"Task","taskRevision":"\(String(repeating: "a", count: 64))",
            "startedAt":"2026-10-07T11:00:00Z","elapsedSeconds":3600,"state":"running","projectLabels":[]}],
            "nextCursor":{"taskPath":"\\u00e9.md","at":"2026-10-07T12:00:00Z"},
            "problemCount":0,"problems":[]}
            """
        let value = try FacetFeatureProjection.parseJSON(raw)
        try FacetSchema.bundled().validate(value, definition: "trackingSessions")
        let page = try FacetFeatureProjection.decode(FacetTrackingSessions.self, from: value)
        #expect(throws: FacetContractError.self) { try page.validatePage() }
    }
}
