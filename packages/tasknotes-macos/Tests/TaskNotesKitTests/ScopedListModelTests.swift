import Foundation
import Testing

@testable import TaskNotesKit
@testable import TaskNotesUniFFI

/// A scope and a reader's own query, applied together.
///
/// ⚠️ **The sixth instance of one pattern.** Every scoped fixture in this suite
/// had a scope and no query; every query fixture had a query and no scope. A
/// pipeline that dropped the scope the moment a filter arrived — or dropped the
/// filter the moment a scope was present — passes both sets completely. The two
/// inputs vary independently and nothing made them disagree.
///
/// The general defence, which is what this file is really testing: *for every
/// pair of inputs that can vary independently, does some fixture make them
/// disagree?* This codebase keeps composing two facts that coincide in the
/// common case — `isCompleted`/`isTerminal` for a plain task, a one-link chain
/// and a bare filter, a scope and a query when either is empty — and fixtures
/// get written from the common case, so the collapse is inherited by the tests.
///
/// ## The counts are chosen to be three-way distinguishable
///
/// | applied | admits |
/// |---|---|
/// | scope alone | 2 |
/// | query alone | 3 |
/// | **both** | **1** |
/// | a union, if the two were ever OR-ed | 4 |
///
/// No two of those are equal, so dropping either input, or conjoining them
/// wrongly, changes the answer visibly rather than by luck.
@Suite("Scoped lists under a reader's query")
struct ScopedListModelTests {
    /// Five tasks over two projects and two contexts, so project and context
    /// cut across each other rather than nesting.
    private static let corpus: [CoreTask] = [
        coreTask(id: "w-work.md", projects: ["[[Website]]"], contexts: ["work"]),
        coreTask(id: "w-home.md", projects: ["[[Website]]"], contexts: ["home"]),
        coreTask(id: "a-work.md", projects: ["[[Admin]]"], contexts: ["work"]),
        coreTask(id: "a-home.md", projects: ["[[Admin]]"], contexts: ["home"]),
        coreTask(id: "none-work.md", contexts: ["work"]),
    ]

    private static var websiteScope: TaskListScope {
        // Force-unwrapped deliberately, and legal only here: `Tests/.swiftlint.yml`
        // relaxes `force_unwrapping` because in a test a trap *is* the
        // assertion. The name is a non-empty literal, so `nil` means the
        // initializer's contract moved and the suite should stop loudly.
        TaskEntity(kind: .project, name: "[[Website]]")!.scope
    }

    private static var byWorkContext: TaskListQuery {
        var query = TaskListQuery()
        query.filter.toggleContext("work")
        return query
    }

    private func model(
        query: TaskListQuery = TaskListQuery(),
        scope: TaskListScope? = nil
    ) throws -> TaskListModel {
        try TaskListModel.build(
            section: .browse,
            tasks: Self.corpus,
            pendingTaskIds: [],
            calendar: fixedCalendar(),
            query: query,
            text: fixedText(),
            scope: scope
        )
    }

    @Test("each input alone narrows to a different set")
    func theTwoInputsAreIndividuallyVisible() throws {
        // The baseline the intersection is measured against. If either of these
        // ever equals the other, the case below stops being able to tell them
        // apart and this file needs new counts.
        #expect(try model().rows.count == 5)
        #expect(try model(scope: Self.websiteScope).rows.map(\.id) == ["w-work.md", "w-home.md"])
        #expect(
            try model(query: Self.byWorkContext).rows.map(\.id)
                == ["w-work.md", "a-work.md", "none-work.md"])
    }

    @Test("a scoped list narrows again under the reader's query")
    func scopeAndQueryIntersect() throws {
        // 2 ∩ 3 = 1, and a union would be 4. Dropping the scope gives 3,
        // dropping the query gives 2; every wrong composition has its own
        // wrong answer.
        let both = try model(query: Self.byWorkContext, scope: Self.websiteScope)
        #expect(both.rows.map(\.id) == ["w-work.md"])
    }

    @Test("the count beside the heading describes the slice, not the vault")
    func admittedCountIsScoped() throws {
        // The ordering invariant in the pipeline: the scope is applied at step
        // zero, *above* membership and facets, so `admittedCount` counts within
        // it. Getting this wrong reads as "1 of 5" on a project screen that
        // holds two tasks — the header quietly describing a different list from
        // the one under it.
        let both = try model(query: Self.byWorkContext, scope: Self.websiteScope)
        #expect(both.admittedCount == 2)
        #expect(both.isNarrowed, "the reader's query is what hid the second one")
    }

    @Test("the filter menu offers only what the scope contains")
    func facetsAreScopedToo() throws {
        // Same reason facets are taken before the reader's filter rather than
        // after: a menu that offered Admin on the Website screen would offer a
        // choice whose only possible outcome is an empty list.
        let scoped = try model(scope: Self.websiteScope)
        #expect(scoped.facets.projects == ["Website"])
        #expect(scoped.facets.contexts == ["home", "work"])

        // And the unscoped screen still offers both, so the assertion above is
        // about the scope rather than about the corpus.
        #expect(try model().facets.projects == ["Admin", "Website"])
    }
}
