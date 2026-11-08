import Testing

@testable import TaskNotesKit

struct FacetReminderPlanTests {
    @Test func allPagesAreFencedAndOnlyTheNativeBudgetIsRetained() async throws {
        let source = ReminderFixturePages([
            page(profile: "vault", version: 7, indices: Array(0..<128), total: 129, more: true),
            page(profile: "vault", version: 7, indices: [128], total: 129, more: false),
        ])
        let plan = try await FacetReminderPlanReader.read(
            profileID: "vault", window: window, maximumRows: 64,
            fetch: { await source.fetch($0) })
        #expect(plan.totalCount == 129)
        #expect(plan.rows.count == 64)
        let requests = await source.requests
        #expect(requests.count == 2)
        #expect(requests[1].object?.fields["expectedVersion"] == .unsigned(7))
        #expect(requests[0].object?.fields["at"] == requests[1].object?.fields["at"])
        #expect(requests[0].object?.fields["schemaVersion"] == .integer(1))
    }

    @Test func ownerOrVersionMismatchDoesNotProduceAReplacementPlan() async {
        for second in [
            page(profile: "another-vault", version: 7, indices: [1], total: 2, more: false),
            page(profile: "vault", version: 8, indices: [1], total: 2, more: false),
        ] {
            let source = ReminderFixturePages([
                page(profile: "vault", version: 7, indices: [0], total: 2, more: true), second,
            ])
            await #expect(throws: FacetContractError.self) {
                try await FacetReminderPlanReader.read(
                    profileID: "vault", window: window, maximumRows: 64,
                    fetch: { await source.fetch($0) })
            }
        }
    }

    @Test func aFailedLaterPageDoesNotReturnTheEarlierRows() async {
        let source = ReminderFixturePages([
            page(profile: "vault", version: 7, indices: [0], total: 2, more: true)
        ])
        await #expect(throws: FacetContractError.self) {
            try await FacetReminderPlanReader.read(
                profileID: "vault", window: window, maximumRows: 64,
                fetch: { request in
                    if request.object?.fields["after"] != nil {
                        throw FacetContractError.unsupportedResponse
                    }
                    return await source.fetch(request)
                })
        }
    }

    private var window: FacetReminderWindow {
        FacetReminderWindow(
            at: "2026-10-04T08:00:00Z", timezone: "America/Los_Angeles",
            from: "2026-10-04T08:00:00Z", to: "2026-11-03T08:00:00Z")
    }

    private func page(profile: String, version: UInt64, indices: [Int], total: Int, more: Bool)
        -> FacetValue
    {
        let rows = indices.map { index in
            FacetValue.object([
                "notificationId": .string("facet:\(String(index).leftPadded(to: 64))"),
                "taskPath": .string("task-\(index).md"), "title": .string("Task \(index)"),
                "taskRevision": .string(String(repeating: "a", count: 64)),
                "reminderId": .string("r-\(index)"), "fireAt": .string("2026-10-04T09:00:00Z"),
                "occurrenceDate": .null, "description": .null,
            ])
        }
        let cursor: FacetValue
        if more, let last = rows.last?.object?.fields {
            cursor = .object([
                "fireAt": last["fireAt"] ?? .null, "reminderId": last["reminderId"] ?? .null,
                "taskPath": last["taskPath"] ?? .null,
            ])
        } else {
            cursor = .null
        }
        return .object([
            "schemaVersion": .integer(1), "profileId": .string(profile),
            "version": .unsigned(version),
            "totalCount": .integer(Int64(total)), "rows": .array(rows), "nextCursor": cursor,
            "problemCount": .integer(0), "problems": .array([]),
        ])
    }
}

private actor ReminderFixturePages {
    private var pages: [FacetValue]
    private(set) var requests: [FacetValue] = []
    init(_ pages: [FacetValue]) { self.pages = pages }
    func fetch(_ request: FacetValue) -> FacetValue {
        requests.append(request)
        return pages.removeFirst()
    }
}

extension String {
    fileprivate func leftPadded(to count: Int) -> String {
        String(repeating: "0", count: count - self.count) + self
    }
}
