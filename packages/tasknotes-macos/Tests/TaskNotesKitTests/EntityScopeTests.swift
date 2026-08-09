import Foundation
internal import TaskNotesKit
internal import TaskNotesUniFFI
import Testing

/// The project, context and tag screens — which are not screens.
///
/// Every assertion below is really the same one: *a scoped list is the list, over
/// a corpus the core narrowed.* If any of these start failing because membership
/// drifted, the fix is in Rust, not here.
@Suite("Entity scopes")
struct EntityScopeTests {
    /// A project is matched the way the **filter** matches it, not by string
    /// equality.
    ///
    /// This is the one that would silently be wrong if the scope re-implemented
    /// membership in Swift: `[[Areas/Work|Work]]` and `Work` are the same
    /// project, `project_matches` knows that, and `task.projects.contains(name)`
    /// does not. A `TaskEntity` built from either spelling must admit both
    /// tasks.
    @Test(
        "a project scope admits every spelling of the project",
        arguments: ["Work", "[[Areas/Work|Work]]", "[[Areas/Work]]"]
    )
    func projectSpellings(spelling: String) throws {
        let entity = try #require(TaskEntity(kind: .project, name: spelling))
        let admitted = entity.scope.narrow(Self.vault).map(\.title)
        #expect(admitted == ["Wikilinked", "Bare", "Aliased"])
    }

    @Test("a context scope admits exactly its context")
    func contextScope() throws {
        let entity = try #require(TaskEntity(kind: .context, name: "home"))
        #expect(entity.scope.narrow(Self.vault).map(\.title) == ["At home"])
    }

    @Test("a tag scope admits exactly its tag")
    func tagScope() throws {
        let entity = try #require(TaskEntity(kind: .tag, name: "release"))
        #expect(entity.scope.narrow(Self.vault).map(\.title) == ["Tagged"])
    }

    /// An entity that matches nothing narrows to nothing rather than to
    /// everything.
    ///
    /// The failure mode worth pinning: a scope whose filter was accidentally
    /// left inactive would fall through `taskFilterIsActive` and pass the whole
    /// vault, so a deleted project's screen would look exactly like Browse.
    @Test("an entity nothing matches admits nothing")
    func unmatchedScope() throws {
        let entity = try #require(TaskEntity(kind: .tag, name: "nonexistent"))
        #expect(entity.scope.narrow(Self.vault).isEmpty)
    }

    @Test("an empty name is refused rather than matching everything")
    func emptyName() {
        #expect(TaskEntity(kind: .project, name: "") == nil)
        #expect(TaskEntity(kind: .context, name: "   ") == nil)
    }

    /// The titles the React Native screens set, verbatim.
    @Test("titles carry the sigil that tells the three kinds apart")
    func titles() throws {
        #expect(
            try #require(TaskEntity(kind: .project, name: "[[Areas/Work|Work]]")).title == "Work")
        #expect(try #require(TaskEntity(kind: .context, name: "home")).title == "@home")
        #expect(try #require(TaskEntity(kind: .tag, name: "release")).title == "#release")
    }

    /// Two projects whose display names collide must not share a screen
    /// identity.
    ///
    /// `.id(destination.identity)` is what stops one project screen carrying
    /// the previous one's search and selection, so an identity keyed on the
    /// *title* would make `[[A/Work]]` and `[[B/Work]]` one screen that never
    /// appeared to update.
    @Test("scope identity distinguishes projects that read the same")
    func identityIsNotTheTitle() throws {
        let first = try #require(TaskEntity(kind: .project, name: "[[A/Work|Work]]"))
        let second = try #require(TaskEntity(kind: .project, name: "[[B/Work|Work]]"))
        #expect(first.title == second.title)
        #expect(first.scope.identity != second.scope.identity)
    }

    /// A scoped list is the list, narrowed — counted, faceted and headed within
    /// the slice.
    ///
    /// `admittedCount` counting the *vault* rather than the project would make
    /// the header read "3 of 9" on a project holding three tasks, and the
    /// filter menu would offer contexts that empty the list.
    @Test("a scoped model counts, facets and heads within the scope")
    func scopedModel() throws {
        let entity = try #require(TaskEntity(kind: .project, name: "Work"))
        let model = try TaskListModel.build(
            section: .browse,
            tasks: Self.vault,
            pendingTaskIds: [],
            calendar: Self.calendar,
            scope: entity.scope
        )

        #expect(model.heading == "Work")
        #expect(model.admittedCount == 3)
        #expect(model.rows.count == 3)
        #expect(model.facets.contexts == ["work"])
        #expect(model.facets.tags.isEmpty)
        #expect(model.scope?.identity == entity.scope.identity)
    }

    /// The reader's filter composes **on top of** the scope, and does not
    /// replace it.
    ///
    /// The trap this pins: `FilterConfig`'s semantics are "every dimension must
    /// pass, any value within a dimension", so merging the scope's `projects`
    /// into the reader's would have turned an *and* into an *or* — narrowing
    /// the Work project to the Admin project would have shown both. Applying
    /// the scope to the corpus first is what makes it an intersection.
    @Test("the reader's filter narrows within the scope rather than replacing it")
    func filterComposesWithScope() throws {
        let entity = try #require(TaskEntity(kind: .project, name: "Work"))
        var query = TaskListQuery()
        query.filter.toggleContext("work")

        let model = try TaskListModel.build(
            section: .browse,
            tasks: Self.vault,
            pendingTaskIds: [],
            calendar: Self.calendar,
            query: query,
            scope: entity.scope
        )

        #expect(model.rows.map(\.task.title) == ["Wikilinked"])
        #expect(model.admittedCount == 3)
    }

    /// A second project chosen inside a project screen is an intersection, and
    /// an empty one.
    @Test("a second project inside a project screen intersects, never unions")
    func secondProjectDoesNotUnion() throws {
        let entity = try #require(TaskEntity(kind: .project, name: "Work"))
        var query = TaskListQuery()
        query.filter.toggleProject("Website")

        let model = try TaskListModel.build(
            section: .browse,
            tasks: Self.vault,
            pendingTaskIds: [],
            calendar: Self.calendar,
            query: query,
            scope: entity.scope
        )

        #expect(model.isEmpty)
        // …and the screen can say so honestly, because the scope's own count
        // survived the narrowing.
        #expect(model.admittedCount == 3)
        #expect(model.isNarrowed)
    }

    /// A scoped screen shows finished work, because the entity screens do.
    ///
    /// `.browse` is the section behind them for exactly this reason: on any
    /// other, "no tasks in this project" would mean "none that are unfinished",
    /// which is a different and much less useful sentence.
    @Test("a project screen includes completed tasks")
    func includesCompleted() throws {
        let entity = try #require(TaskEntity(kind: .project, name: "Work"))
        let model = try TaskListModel.build(
            section: .browse,
            tasks: Self.vault,
            pendingTaskIds: [],
            calendar: Self.calendar,
            scope: entity.scope
        )
        #expect(model.rows.contains { $0.task.status == .done })
    }

    /// The vocabulary the sidebar's three groups are built from.
    @Test("the vault's entities come back per kind, in first-appearance order")
    func vocabularyEntities() {
        let vocabulary = TaskVocabulary.of(tasks: Self.vault)
        #expect(
            vocabulary.entities(of: .context).map(\.title) == ["@work", "@home"])
        #expect(vocabulary.entities(of: .tag).map(\.title) == ["#release"])
        // Projects dedupe on `project_matches`, so the three spellings of Work
        // are one entry.
        #expect(vocabulary.entities(of: .project).count == 2)
    }

    private static let calendar = fixedCalendar()

    /// Seven tasks, three of them the same project under three spellings.
    private static let vault: [CoreTask] = [
        coreTask(
            id: "Tasks/Wikilinked.md", title: "Wikilinked",
            projects: ["[[Areas/Work]]"], contexts: ["work"]),
        coreTask(id: "Tasks/Bare.md", title: "Bare", projects: ["Work"]),
        coreTask(
            id: "Tasks/Aliased.md", title: "Aliased", status: .done,
            projects: ["[[Areas/Work|Work]]"]),
        coreTask(id: "Tasks/Elsewhere.md", title: "Elsewhere", projects: ["Website"]),
        coreTask(id: "Tasks/At home.md", title: "At home", contexts: ["home"]),
        coreTask(id: "Tasks/Tagged.md", title: "Tagged", tags: ["release"]),
        coreTask(id: "Tasks/Bare naked.md", title: "Bare naked"),
    ]
}
