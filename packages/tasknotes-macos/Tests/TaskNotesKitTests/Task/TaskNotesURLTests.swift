import Foundation
internal import TaskNotesKit
import Testing

@Suite("tasknotes:// routing")
struct TaskNotesURLTests {
    /// Every destination must round-trip. Driving this off `allCases` rather
    /// than a literal list is what makes adding a destination without a working
    /// deep link impossible.
    @Test("every sidebar section round-trips through its URL", arguments: SidebarSection.allCases)
    func roundTrip(section: SidebarSection) throws {
        let link = TaskNotesURL.section(section)
        #expect(TaskNotesURL(link.url) == link)
    }

    @Test(
        "unhandled URLs are rejected rather than defaulted",
        arguments: [
            "https://sjer.red/today",  // wrong scheme
            "tasknotes://nowhere",  // unknown host
            "tasknotes:///today",  // path, not host
            "tasknotes:today",  // opaque
            "tasknotes://",  // no host at all
        ]
    )
    func rejectsUnknown(raw: String) throws {
        let url = try #require(URL(string: raw))
        #expect(TaskNotesURL(url) == nil)
    }

    /// macOS does not promise the case it hands over, so the parser lowercases.
    @Test("host matching is case-insensitive")
    func caseInsensitiveHost() throws {
        let url = try #require(URL(string: "TASKNOTES://Upcoming"))
        #expect(TaskNotesURL(url) == .section(.upcoming))
    }

    /// The identifiers are what a UI test looks elements up by, so a collision
    /// would silently make two assertions target the same element.
    @Test("accessibility identifiers are unique per section")
    func identifiersAreUnique() throws {
        let identifiers = SidebarSection.allCases.flatMap {
            [AccessibilityIdentifier.sidebarItem($0), AccessibilityIdentifier.detail($0)]
        }
        #expect(Set(identifiers).count == identifiers.count)
    }

    // ── The routes the phone already publishes ─────────────────────────────
    //
    // `project/:name`, `context/:name`, `tag/:name`, `view/:id` and `kanban`
    // are `linking.ts`'s vocabulary. Keeping them byte-identical is what lets a
    // bookmark, a Shortcuts action or a link inside a note work on both
    // clients, which is the only reason the entity routes exist at all now that
    // the Mac reaches those screens from a sidebar.

    @Test(
        "entity links round-trip, whatever the name contains",
        arguments: [
            "Website",
            "[[Areas/Work|Work]]",
            "a name with spaces",
            "emoji 🎯 and — punctuation",
            "100% done?",
        ]
    )
    func entityRoundTrip(name: String) throws {
        for kind in TaskEntity.Kind.allCases {
            let entity = try #require(TaskEntity(kind: kind, name: name))
            let link = TaskNotesURL.entity(entity)
            #expect(TaskNotesURL(link.url) == link)
        }
    }

    /// ⚠️ A slash inside a name must not become a path separator.
    ///
    /// `CharacterSet.urlPathAllowed` **permits `/`**, so the obvious encoding
    /// emits `tasknotes://project/Areas/Work` — two components, which parses
    /// back as something else or as nothing. The plan records this exact trap
    /// costing a test to find on the wire layer; this is the same trap one
    /// layer up, and this is that test.
    @Test("a slash inside a name is encoded, not turned into a path separator")
    func slashesAreEncoded() throws {
        let entity = try #require(TaskEntity(kind: .project, name: "[[Areas/Work]]"))
        let link = TaskNotesURL.entity(entity)
        #expect(!link.url.absoluteString.hasSuffix("Areas/Work]]"))
        #expect(TaskNotesURL(link.url) == link)
    }

    /// The route a link inside a note carries. A task id is a vault-relative
    /// path, so the separator inside it is percent-encoded and the link is one
    /// component — which is also what React Navigation's `task/:taskId` matches.
    @Test(
        "task links round-trip, whatever the id contains",
        arguments: [
            "Tasks/plan.md",
            "Areas/Work/Reply to the landlord.md",
            "plan.md",
            "tmp-1-1",
        ]
    )
    func taskRoundTrip(id: String) throws {
        let link = TaskNotesURL.task(id: id)
        #expect(TaskNotesURL(link.url) == link)
        #expect(TaskNotesURL(link.url)?.target == .destination(.task(id: id)))
    }

    /// The exact spelling the phone publishes, parsed as one id rather than as
    /// two path components.
    @Test("an existing cross-platform task link opens that task")
    func taskLinkFromTheOtherClient() throws {
        let url = try #require(URL(string: "tasknotes://task/Tasks%2Fplan.md"))
        #expect(TaskNotesURL(url)?.target == .destination(.task(id: "Tasks/plan.md")))
    }

    /// ⚠️ The id is the **core's** parse, not a non-empty check.
    ///
    /// Anything on the machine can send this URL, and the id is joined onto the
    /// vault root downstream by code that does not re-check — so `..`, a
    /// leading slash and a backslash have to be refused here, at the only place
    /// that sees the link.
    @Test(
        "a task link carrying something that is not a task id is rejected",
        arguments: [
            "tasknotes://task",  // no id at all
            "tasknotes://task/",  // an empty id
            "tasknotes://task/Tasks/plan.md",  // two components is not one id
            "tasknotes://task/..%2Fsecrets.md",  // escapes the vault
            "tasknotes://task/%2FTasks%2Fplan.md",  // not vault-relative
            "tasknotes://task/Tasks%5Cplan.md",  // a backslash is a separator elsewhere
            "tasknotes://task/plan",  // not a markdown note
            "tasknotes://task/tmp-",  // a bare temp prefix
        ]
    )
    func rejectsMalformedTaskLinks(raw: String) throws {
        let url = try #require(URL(string: raw))
        #expect(TaskNotesURL(url) == nil)
    }

    @Test("the board and a saved view round-trip")
    func boardAndSavedViewRoundTrip() throws {
        #expect(TaskNotesURL(TaskNotesURL.board.url) == .board)
        #expect(TaskNotesURL.board.url.absoluteString == "tasknotes://kanban")

        let view = TaskNotesURL.savedView(id: "job-search")
        #expect(TaskNotesURL(view.url) == view)
        #expect(view.url.absoluteString == "tasknotes://view/job-search")
    }

    /// A name is not lowercased on the way through, even though the host is.
    ///
    /// Folding a project's case would send `tasknotes://project/Website` to a
    /// project called `website`, which may not exist — and the vault, not this
    /// parser, decides what things are called.
    @Test("a name keeps its case while the host does not")
    func namesKeepTheirCase() throws {
        let url = try #require(URL(string: "TASKNOTES://Project/Website"))
        #expect(TaskNotesURL(url)?.target == .destination(.entity(.project("Website"))))
    }

    @Test(
        "malformed entity and view links are rejected rather than defaulted",
        arguments: [
            "tasknotes://project",  // a kind with no name
            "tasknotes://project/",  // an empty name
            "tasknotes://project/a/b",  // two components is not one name
            "tasknotes://view",  // a view with no id
            "tasknotes://kanban/extra",  // the board takes no argument
            "tasknotes://today/extra",  // nor does a section
            "tasknotes://projects/Website",  // a kind that does not exist
        ]
    )
    func rejectsMalformed(raw: String) throws {
        let url = try #require(URL(string: raw))
        #expect(TaskNotesURL(url) == nil)
    }

    // ── The command routes ─────────────────────────────────────────────────
    //
    // `quick-add`, `search`, `settings`, `pomodoro` and `time-report` are the
    // rest of `linking.ts`'s published vocabulary. They were parsed as unknown
    // hosts here until this suite grew the cases below — so a bookmark or a
    // Shortcuts action carrying one opened a window that then did nothing.

    /// Driven off `allCases`, which is what makes a sixth action with no
    /// working link impossible rather than merely unlikely.
    @Test("every action round-trips through its URL", arguments: TaskNotesAction.allCases)
    func actionRoundTrip(action: TaskNotesAction) throws {
        let link = TaskNotesURL.action(action)
        #expect(TaskNotesURL(link.url) == link)
        #expect(TaskNotesURL(link.url)?.target == .action(action))
    }

    /// The exact spellings `packages/tasks-for-obsidian/src/navigation/linking.ts`
    /// registers, asserted literally.
    ///
    /// The round-trip above proves the parser and the writer agree with each
    /// other; only a literal proves they agree with the *other client*, which is
    /// the whole point of sharing the vocabulary.
    @Test(
        "the phone's command routes resolve here",
        arguments: [
            ("tasknotes://quick-add", TaskNotesAction.quickAdd),
            ("tasknotes://search", .search),
            ("tasknotes://settings", .settings),
            ("tasknotes://pomodoro", .pomodoro),
            ("tasknotes://time-report", .timeReport),
        ]
    )
    func crossPlatformActionSpelling(raw: String, action: TaskNotesAction) throws {
        let url = try #require(URL(string: raw))
        #expect(TaskNotesURL(url)?.target == .action(action))
    }

    /// A command host takes no argument, so one handed an argument is a link
    /// somebody built wrong — answered with nothing, the same as
    /// `tasknotes://today/extra`.
    @Test("a command host handed an argument resolves to nothing")
    func actionsTakeNoArgument() throws {
        for action in TaskNotesAction.allCases {
            let url = try #require(URL(string: "tasknotes://\(action.rawValue)/extra"))
            #expect(TaskNotesURL(url) == nil)
        }
    }

    /// ⚠️ A command host that also parsed as a section, an entity kind or the
    /// board would make one link mean two things, and which one wins would be
    /// the order of the `if`s in `unargumented(host:)`.
    @Test("no command host collides with a destination host")
    func actionHostsAreDistinct() throws {
        for action in TaskNotesAction.allCases {
            #expect(SidebarSection(urlHost: action.rawValue) == nil)
            #expect(TaskEntity.Kind(rawValue: action.rawValue) == nil)
            #expect(TaskNotesURL(TaskNotesURL.action(action).url)?.target == .action(action))
        }
    }

    /// The two `detail`/`sidebarItem` overloads must agree on the four
    /// sections, or an existing UI test would quietly stop finding its element
    /// while still passing.
    @Test(
        "the destination overloads produce the section identifiers unchanged",
        arguments: SidebarSection.allCases
    )
    func destinationIdentifiersMatchSectionIdentifiers(section: SidebarSection) {
        let destination = TaskNotesDestination.section(section)
        #expect(
            AccessibilityIdentifier.detail(destination) == AccessibilityIdentifier.detail(section))
        #expect(
            AccessibilityIdentifier.sidebarItem(destination)
                == AccessibilityIdentifier.sidebarItem(section))
    }

    /// Every destination a window can hold has its own identity.
    @Test("destination identities are unique across kinds")
    func destinationIdentitiesAreUnique() throws {
        var destinations: [TaskNotesDestination] = SidebarSection.allCases.map { .section($0) }
        destinations.append(.board)
        destinations.append(.savedView(id: "job-search"))
        destinations.append(.task(id: "Tasks/plan.md"))
        for kind in TaskEntity.Kind.allCases {
            destinations.append(.entity(try #require(TaskEntity(kind: kind, name: "work"))))
        }

        let identities = destinations.map(\.identity)
        #expect(Set(identities).count == identities.count)
    }
}
