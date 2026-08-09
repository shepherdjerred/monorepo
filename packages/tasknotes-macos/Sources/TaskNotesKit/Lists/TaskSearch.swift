public import TaskNotesUniFFI

/// Free-text search over a loaded list.
///
/// # 🔴 This is core logic living in the wrong language, and it is a reported gap
///
/// Everything else a list screen decides — membership, filtering, sorting,
/// bucketing, recurrence — routes through the Rust core, because *"three native
/// targets means the logic gets written three times"* is the entire premise of
/// this project, and 1Password shipping **"different search results in a
/// different order"** is the named failure it exists to avoid. Search is
/// literally that sentence.
///
/// The core exposes `apply_filter`, `filter_matches` and `apply_sort`, but
/// `FilterConfig` has six structured dimensions and **no text query**, and
/// there is no `task_search_matches` anywhere in the FFI surface. So this
/// predicate exists here, and it should not: it needs to move into
/// `domain::filters` as a seventh dimension, or as its own exported predicate,
/// before a second client is written against it.
///
/// What is at stake is not hypothetical. Every decision below is one a second
/// implementation would have to guess:
///
///   * **which fields are searched** — title, projects, contexts, tags; not
///     details, not tag `#` prefixes, not the vault path;
///   * **substring, not prefix and not fuzzy**;
///   * **case folding**, and *whose* case folding — `lowercased()` is Unicode
///     full case folding, Rust's `to_lowercase` agrees on the ASCII a vault is
///     mostly made of and diverges on Turkish dotless ı and on final sigma;
///   * **projects are matched raw**, so typing `Work` finds
///     `[[Areas/Work|Work]]` through the `Work` in either half — deliberately
///     *not* `projectDisplayName`, which would make `Areas/` unsearchable;
///   * **whitespace is trimmed but not tokenised**, so `pay rent` is one
///     phrase and does not match `rent, pay`.
///
/// Every one of those is a product decision, and the React Native app has
/// already made all of them in `SearchScreen.tsx`. This mirrors that file
/// exactly so the two clients agree *today*; it is not a licence for them to
/// keep agreeing by luck.
public enum TaskSearch {
    /// Keep the tasks matching `query`, in input order.
    ///
    /// An empty or whitespace-only query matches everything, which is the
    /// difference between this and the React Native screen: there the search
    /// *is* the screen, so an empty box shows nothing and prompts you to type.
    /// Here search is a field that narrows a list you are already looking at,
    /// so an empty box has to leave that list alone.
    static func narrow(_ tasks: [CoreTask], to query: String) -> [CoreTask] {
        let needle = query.trimmingWhitespace().lowercased()
        guard !needle.isEmpty else { return tasks }
        return tasks.filter { matches($0, needle: needle) }
    }

    /// Whether one task matches an already-folded, already-trimmed needle.
    ///
    /// - Parameters:
    ///   - task: the task to test.
    ///   - needle: lowercased and trimmed by ``narrow(_:to:)``. Folding once
    ///     per query rather than once per task per field is the difference
    ///     between one allocation and four per row on every keystroke.
    /// - Returns: whether the title, a project, a context or a tag contains it.
    public static func matches(_ task: CoreTask, needle: String) -> Bool {
        if task.title.lowercased().contains(needle) { return true }
        if task.projects.contains(where: { $0.lowercased().contains(needle) }) { return true }
        if task.contexts.contains(where: { $0.lowercased().contains(needle) }) { return true }
        return task.tags.contains { $0.lowercased().contains(needle) }
    }
}
