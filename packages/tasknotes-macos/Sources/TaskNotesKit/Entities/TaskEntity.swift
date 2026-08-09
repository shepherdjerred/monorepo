public import TaskNotesUniFFI

/// One of the three things a task is filed under: a project, a context, or a
/// tag.
///
/// ## These are not three screens
///
/// The React Native app has `ProjectDetailScreen`, `ContextDetailScreen` and
/// `TagDetailScreen`, and the three files are the same file: a `FilterSortBar`,
/// a `TaskList`, and one `taskList.filter(…)` differing only in which field it
/// reads. Porting them as three views would have re-created that, on top of a
/// list screen that had just been collapsed from four copies into one.
///
/// So an entity is **data**, not a screen. What it produces is a
/// ``TaskListScope`` — a title, some words for an empty list, and a
/// `FilterConfig` — and the existing list screen renders it. The Kanban board
/// takes the same value, so "the board for this project" costs nothing extra.
///
/// ## The membership rule is the core's, in full
///
/// ``baseFilter`` is a `FilterConfig` with exactly one dimension set, and the
/// predicate that runs it is `taskFilterApply`. Nothing here decides what it
/// means for a task to be *in* a project — which matters more than it looks,
/// because a project is stored as either a bare name or an Obsidian wikilink
/// and `[[Areas/Work|Work]]` and `Work` are the same project. That is
/// `project_matches` in Rust, it is already what the filter runs, and writing
/// `task.projects.contains(name)` here would have been a second, stricter
/// opinion that disagreed with the filter menu sitting next to it.
///
/// Contexts and tags are matched exactly, which is also the core's rule and not
/// one restated here.
public enum TaskEntity: Sendable, Equatable, Hashable, Codable {
    /// A project, held in whichever spelling the vault uses.
    case project(ProjectName)
    /// A context, without the leading `@`.
    case context(ContextName)
    /// A tag, without the leading `#`.
    case tag(TagName)

    /// Which of the three this is, as a value a URL and a menu can name.
    ///
    /// Split out from the case payload so that "the three kinds" can be
    /// enumerated — a sidebar draws one group per kind — without any call site
    /// having to invent a name for a case it cannot construct without a value.
    public enum Kind: String, CaseIterable, Sendable, Hashable, Codable {
        case project
        case context
        case tag

        /// The plural heading a sidebar group carries.
        public var groupTitle: String {
            switch self {
            case .project: "Projects"
            case .context: "Contexts"
            case .tag: "Tags"
            }
        }

        /// The SF Symbol name for a row of this kind.
        ///
        /// A symbol *name* rather than an `Image`, so this target stays free of
        /// SwiftUI. Same rule as ``SidebarSection/systemImage``.
        public var systemImage: String {
            switch self {
            case .project: "folder"
            case .context: "at"
            case .tag: "number"
            }
        }
    }

    public var kind: Kind {
        switch self {
        case .project: .project
        case .context: .context
        case .tag: .tag
        }
    }

    /// The value as the vault stores it.
    ///
    /// For a project that is the *stored spelling* — a wikilink stays a
    /// wikilink — because it is what the filter is run against and what a URL
    /// has to round-trip. ``title`` is the human reading of the same value.
    public var storedValue: String {
        switch self {
        case .project(let name): name
        case .context(let name): name
        case .tag(let name): name
        }
    }

    /// An entity of a given kind, or `nil` when the name is empty.
    ///
    /// Failable rather than defaulting: an empty name arrives from a malformed
    /// deep link, and a screen scoped to "" would silently show the whole
    /// vault under a blank heading — a fallback on bad data, which is banned.
    public init?(kind: Kind, name: String) {
        guard !name.trimmingWhitespace().isEmpty else { return nil }
        switch kind {
        case .project: self = .project(name)
        case .context: self = .context(name)
        case .tag: self = .tag(name)
        }
    }

    /// The screen's title.
    ///
    /// The React Native screens' exact wording: a project reads as its display
    /// name, a context as `@work`, a tag as `#release`. The sigils are how a
    /// reader tells the three apart when the underlying names collide, which
    /// they routinely do — `work` is a plausible project, context *and* tag.
    ///
    /// `projectDisplayName` is the core's, for the same reason the row's
    /// metadata uses it: turning `[[Areas/Work|Work]]` into `Work` is a rule
    /// both clients share.
    public var title: String {
        switch self {
        case .project(let name): projectDisplayName(value: name)
        case .context(let name): "@\(name)"
        case .tag(let name): "#\(name)"
        }
    }

    /// The name without its sigil, for a row that already says which kind it is.
    ///
    /// The sidebar draws `@` and `#` as the row's *icon*, so printing the same
    /// character again in the text gives `@ @work` — the redundancy is
    /// immediately visible once the sidebar is rendered, and it is the reason
    /// this exists rather than ``title`` being reused everywhere.
    ///
    /// ⚠️ The sigil stays in ``title``, which is the **screen heading**, and it
    /// stays in a sidebar row's *spoken* label. Under VoiceOver a row reading
    /// only "work" is genuinely ambiguous — `work` is a plausible project,
    /// context and tag at once — and the group header a sighted reader uses to
    /// disambiguate is not repeated per row.
    public var sidebarTitle: String {
        switch self {
        case .project: title
        case .context(let name): name
        case .tag(let name): name
        }
    }

    /// The filter that admits exactly this entity's tasks.
    ///
    /// Built by mutating ``FilterConfig/unfiltered`` rather than by calling the
    /// generated memberwise initializer. That is deliberate and load-bearing:
    /// `FilterConfig` is a UniFFI record whose field order is the ABI, the core
    /// is actively growing it, and a positional construction here would need
    /// editing every time a dimension is added — while a mutation of one named
    /// field keeps compiling and keeps meaning the same thing.
    public var baseFilter: FilterConfig {
        var filter = FilterConfig.unfiltered
        switch self {
        case .project(let name): filter.projects = [name]
        case .context(let name): filter.contexts = [name]
        case .tag(let name): filter.tags = [name]
        }
        return filter
    }

    /// The entity as something a list screen or a board can render.
    public var scope: TaskListScope {
        TaskListScope(
            title: title,
            systemImage: kind.systemImage,
            baseFilter: baseFilter,
            emptyTitle: emptyTitle,
            emptyDescription: emptyDescription,
            identity: "\(kind.rawValue).\(storedValue)"
        )
    }

    /// What an empty entity screen says.
    ///
    /// Ported from the React Native `emptyTitle` strings, which say the same
    /// three things. Kept per kind rather than shared, because "this project is
    /// finished" and "nothing is tagged this" are different pieces of news —
    /// the same reasoning the four list screens' empty states already follow.
    private var emptyTitle: String {
        switch self {
        case .project: "No tasks in this project"
        case .context: "No tasks in this context"
        case .tag: "No tasks with this tag"
        }
    }

    private var emptyDescription: String {
        switch self {
        case .project: "Tasks filed under \(title) appear here."
        case .context: "Tasks in the \(title) context appear here."
        case .tag: "Tasks tagged \(title) appear here."
        }
    }
}

extension TaskVocabulary {
    /// Every entity of one kind the vault knows about, in the vocabulary's own
    /// first-appearance order.
    ///
    /// The sidebar's three groups are this, called three times. Order is not
    /// sorted here for the reason ``TaskVocabulary`` gives at length: sorting
    /// would mean collation, the plan parks collation deliberately, and a
    /// Swift-side sort would be a third ordering agreeing with neither the
    /// core's `compare_titles` nor `localizedStandardCompare`.
    public func entities(of kind: TaskEntity.Kind) -> [TaskEntity] {
        let names: [String]
        switch kind {
        case .project: names = projects
        case .context: names = contexts
        case .tag: names = tags
        }
        return names.compactMap { TaskEntity(kind: kind, name: $0) }
    }
}
