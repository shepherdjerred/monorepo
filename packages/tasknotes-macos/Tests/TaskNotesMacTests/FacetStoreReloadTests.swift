import Testing

@testable import TaskNotesFacetUI
@testable import TaskNotesKit

extension FacetStoreOwnershipTests {
    internal func emptySnapshot(profileID: String = "A", version: UInt64 = 7, totalCount: Int = 0)
        throws -> FacetSnapshot
    {
        try FacetFeatureProjection.decode(
            FacetSnapshot.self,
            from: FacetFeatureProjection.parseJSON(
                """
                {"schemaVersion":1,"profileId":"\(profileID)","version":\(version),"tasks":[],
                "totalCount":\(totalCount),
                "pendingCount":0,"pendingTaskIds":[],"conflictCount":0,"configuration":{},
                "problems":[],"views":[],"groups":[]}
                """))
    }

    @Test func delayedQuerySnapshotAndErrorCannotOutliveItsOwner() async throws {
        for fails in [false, true] {
            for change in OwnerChange.allCases {
                let context = try await StoreContext.open()
                let suspension = Suspension()
                let reload = _Concurrency.Task {
                    await context.store.loadQuerySnapshot(
                        profileID: "A", logicalQuery: .object(["scope": .string("all")]),
                        ownsEngine: { context.store.engine === context.first },
                        load: {
                            await suspension.pause()
                            if fails { throw FacetContractError.unsupportedResponse }
                            return try emptySnapshot()
                        })
                }
                await suspension.waitUntilEntered()
                await context.changeOwner(change)
                suspension.resume()
                await reload.value
                #expect(context.store.snapshot == nil, "\(fails) \(change)")
                #expect(context.store.displayedQuery == nil, "\(fails) \(change)")
                #expect(context.store.error == nil, "\(fails) \(change)")
                try await context.close()
            }
        }
    }

    @Test func ownedReloadPublishesItsQueryAndRejectsForeignSnapshot() async throws {
        let context = try await StoreContext.open()
        let query = FacetValue.object(["scope": .string("agenda")])
        await context.store.loadQuerySnapshot(
            profileID: "A", logicalQuery: query,
            ownsEngine: { context.store.engine === context.first }, load: { try emptySnapshot() })
        #expect(context.store.snapshot?.profileId == "A")
        #expect(context.store.displayedQuery == query)
        await context.store.loadQuerySnapshot(
            profileID: "A", logicalQuery: .object(["scope": .string("all")]),
            ownsEngine: { context.store.engine === context.first },
            load: { try emptySnapshot(profileID: "B") })
        #expect(context.store.snapshot?.profileId == "A")
        #expect(context.store.displayedQuery == nil)
        #expect(context.store.error != nil)
        try await context.close()
    }
}
