import Foundation
import Testing

@testable import TaskNotesKit

@Suite("Widget rows and counts resolve the same viewer timezone")
struct FacetWidgetTimezoneTests {
    @Test(arguments: ["America/Los_Angeles", "Asia/Tokyo"])
    func realEngineKeepsTimedAndCivilDeadlinesConsistent(zone identifier: String) async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { NativeTestFiles.remove(root) }
        let vault = root.appendingPathComponent("vault")
        let tasks = try writeFixture(vault)
        let engine = try await FacetEngine.open(
            directory: root.appendingPathComponent("engine"), secrets: StageTestKeys())
        do {
            let profile = try await engine.registerLocal(directory: vault, approveStandard: true)
            _ = try await engine.refresh(profileID: profile.id)
            let zone = try #require(TimeZone(identifier: identifier))
            let now = try #require(ISO8601DateFormatter().date(from: "2026-11-01T19:00:00Z"))
            let bytes = try await engine.widgetEnvelope(
                profileID: profile.id, now: now, viewerTimeZone: zone)
            let envelope = try JSONDecoder().decode(FacetWidgetEnvelope.self, from: bytes)
            let losAngeles = identifier == "America/Los_Angeles"
            let day = losAngeles ? "2026-11-01" : "2026-11-02"
            let projection = try #require(envelope.projections[day])
            let titles = Set(projection.todayTasks.map(\.title))
            var expected: Set<String> = ["Timed current", "Civil first", "Timed previous"]
            if !losAngeles { expected.insert("Civil second") }
            #expect(envelope.schemaVersion == 2)
            #expect(envelope.projections.count == 33)
            #expect(titles == expected)
            #expect(projection.stats.today == UInt64(expected.count))
            #expect(projection.stats.overdue == (losAngeles ? 1 : 2))
            #expect(projection.stats.total == 5)
            let current = try #require(projection.todayTasks.first { $0.title == "Timed current" })
            #expect(current.due == day)
            let civil = try #require(projection.todayTasks.first { $0.title == "Civil first" })
            #expect(civil.due == "2026-11-01")
            for (title, due) in deadlines {
                let source = try String(
                    contentsOf: tasks.appendingPathComponent(title + ".md"), encoding: .utf8)
                #expect(source.contains("due: '\(due)'"))
            }
            try await engine.close()
        } catch {
            let failure = error
            try await engine.close()
            throw failure
        }
    }

    private var deadlines: [String: String] {
        [
            "Timed current": "2026-11-02T00:30:00Z", "Civil first": "2026-11-01",
            "Timed previous": "2026-11-01T00:30:00Z", "Civil second": "2026-11-02",
            "Timed future": "2026-11-03T00:30:00Z",
        ]
    }

    private func writeFixture(_ vault: URL) throws -> URL {
        let tasks = vault.appendingPathComponent("Tasks")
        try FileManager.default.createDirectory(at: tasks, withIntermediateDirectories: true)
        try Data(
            "title:\n  storage: frontmatter\ntask_detection:\n  method: tag\n  tag: task\n".utf8
        ).write(to: vault.appendingPathComponent("tasknotes.yaml"))
        for (title, due) in deadlines {
            let source = """
                ---
                title: \(title)
                status: open
                priority: normal
                tags: [task]
                due: '\(due)'
                dateCreated: '2026-10-30T12:00:00Z'
                dateModified: '2026-10-30T12:00:00Z'
                ---
                Untouched widget fixture.

                """
            try Data(source.utf8).write(to: tasks.appendingPathComponent(title + ".md"))
        }
        return tasks
    }
}
