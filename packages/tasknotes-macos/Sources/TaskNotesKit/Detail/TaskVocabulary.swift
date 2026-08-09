public import TaskNotesUniFFI

/// Every project, context and tag already in use in the vault.
///
/// The React Native edit form takes `availableProjects`, `availableContexts` and
/// `availableTags` and shows them as a multi-select. On macOS the same
/// capability is a token field with completion: you type, the vault's existing
/// names appear, and a name that is not there yet is created by typing it. Same
/// answer to the same question — "what have I called things before" — without a
/// list of every project in the vault permanently occupying the panel.
///
/// ## Order is first-appearance, and never sorted
///
/// Two reasons, and the second is the load-bearing one:
///
///   * The core carries task order in an `IndexMap` and it crosses the FFI as an
///     ordered `Vec`. That order is the user's, and walking it produces a
///     vocabulary in the order the user's own vault introduces the names.
///   * Sorting would mean collation, and the plan parks collation deliberately:
///     the core's `compareTitles` approximates `localeCompare` and diverges on
///     accents and punctuation. A Swift-side sort here would be a third
///     ordering, agreeing with neither, on a list a user reads.
///
/// Completion narrows by prefix anyway, so alphabetical buys nothing a token
/// field does not already do.
public struct TaskVocabulary: Sendable, Equatable {
    /// Project names, in first-appearance order, as stored.
    ///
    /// Stored spellings, not display names: a project is held as either a
    /// wikilink (`[[Projects/Website]]`) or a bare name, and the token field
    /// shows `projectDisplayName` while keeping the stored spelling to write
    /// back. Offering the display name as the value would silently rewrite every
    /// wikilink in the vault into a bare name the first time somebody opened the
    /// inspector.
    public let projects: [ProjectName]

    /// Context names, in first-appearance order, without the `@`.
    public let contexts: [ContextName]

    /// Tag names, in first-appearance order, without the `#`.
    public let tags: [TagName]

    /// A vault nobody has read yet.
    ///
    /// The resting value a view holds before its first `.task` runs. Not a
    /// fallback for a failed read — building a vocabulary cannot fail — just the
    /// honest "no completions yet", which a token field renders as no menu.
    public static let empty = TaskVocabulary(projects: [], contexts: [], tags: [])

    /// Read the vocabulary out of a snapshot.
    ///
    /// Archived tasks are included on purpose. Archiving a task does not retire
    /// the project it belonged to, and a vocabulary that forgot it would offer
    /// to "create" a project that already exists — producing two spellings of
    /// one thing, which is the exact failure a completion list is meant to
    /// prevent.
    public static func of(tasks: [CoreTask]) -> TaskVocabulary {
        var seenProjects = FirstSeen()
        var seenContexts = FirstSeen()
        var seenTags = FirstSeen()
        for task in tasks {
            // Projects dedupe on the core's `projectMatches`, not on string
            // equality: `[[Projects/Website|the site]]` and `Website` are the
            // same project, and the core is the only thing that knows that.
            //
            // Spelled as a closure rather than passed as a function value:
            // argument labels do not disambiguate a function *value*, so a
            // same-typed local helper and the core's own `projectMatches` would
            // be ambiguous at the point of reference.
            seenProjects.insert(
                contentsOf: task.projects,
                matching: { projectMatches(left: $0, right: $1) }
            )
            seenContexts.insert(contentsOf: task.contexts, matching: ==)
            seenTags.insert(contentsOf: task.tags, matching: ==)
        }
        return TaskVocabulary(
            projects: seenProjects.values, contexts: seenContexts.values,
            tags: seenTags.values)
    }
}

/// A list that keeps the first spelling of anything it has already seen.
private struct FirstSeen {
    private(set) var values: [String] = []

    mutating func insert(contentsOf incoming: [String], matching: (String, String) -> Bool) {
        for value in incoming where !values.contains(where: { matching($0, value) }) {
            values.append(value)
        }
    }
}

extension TaskVocabulary {
    /// Add a project to a task's list, unless the core says it is already there.
    ///
    /// Ports `handleProjectToggle` from the React Native form, and the reason it
    /// is not `contains` is the same there: a selected wikilink spelling covers
    /// its own display name, so a plain equality check would let one project be
    /// added twice under two spellings.
    public static func adding(project: ProjectName, to current: [ProjectName]) -> [ProjectName] {
        guard !current.contains(where: { projectMatches(left: $0, right: project) }) else {
            return current
        }
        return current + [project]
    }
}
