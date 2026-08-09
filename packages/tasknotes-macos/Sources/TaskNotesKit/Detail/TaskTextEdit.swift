public import TaskNotesUniFFI

/// Turning what somebody typed into a field change, or into nothing.
///
/// The inspector's free-text fields — title, the time estimate, and the
/// markdown body — hold a local buffer while they are being edited and commit
/// on Return or on losing focus. Two questions have to be answered at that
/// moment, and both of them are correctness rather than polish:
///
///  1. **Is this actually different from what is stored?** If it is not, the
///     answer is `nil` and *nothing is dispatched*. A commit-on-blur field that
///     dispatched unconditionally would queue an update every time the user
///     tabbed through the inspector, and each one is a real network round trip
///     and a real frontmatter rewrite.
///  2. **Does empty mean "clear" or "nothing"?** It depends on the field, and
///     getting it wrong deletes data. See each function.
///
/// Everything here is a pure function of a string and a `CoreTask`, which is
/// what lets the whole rule set be tested without a window.
public enum TaskTextEdit {
    /// A retitle, or the reason it cannot be made.
    ///
    /// **A title cannot be cleared** — `UpdateTaskRequest.title` is
    /// `Optional` only to express *unchanged*, and the core says so explicitly.
    /// So an emptied title field is a user error, not a clear: it is refused,
    /// reported, and the field is put back. Dispatching `""` instead would
    /// write an untitled note, and there is no undo for that in a vault.
    ///
    /// The stored value is compared **trimmed against trimmed**, so adding a
    /// trailing space and tabbing away is not a change. What is *sent* is the
    /// trimmed string, because leading whitespace in a note's title is never
    /// what anybody meant and it survives into the vault filename.
    public static func retitling(
        _ raw: String,
        of task: CoreTask
    ) -> Result<TaskFieldEdit?, CoreError> {
        let trimmed = raw.trimmingWhitespace()
        guard !trimmed.isEmpty else {
            return .failure(
                .Validation(message: "A task needs a title. This one is still “\(task.title)”.")
            )
        }
        guard trimmed != task.title.trimmingWhitespace() else { return .success(nil) }
        return .success(.title(trimmed))
    }

    /// A change to the note body, or `nil` when there is none.
    ///
    /// **Empty clears**, matching the React Native form exactly: a body of only
    /// whitespace is `null`, which deletes the note's content below the
    /// frontmatter. That is the same product making the same promise, and it is
    /// also the only reading that lets a user remove a body they no longer want.
    ///
    /// What is sent when non-empty is the text **verbatim, untrimmed**. This is
    /// markdown source: a trailing newline is a paragraph break and leading
    /// spaces are indentation, so trimming would silently rewrite the document.
    /// Only the emptiness *test* trims.
    public static func rewriting(details raw: String, of task: CoreTask) -> TaskFieldEdit? {
        let stored = task.details
        guard !raw.trimmingWhitespace().isEmpty else {
            // Already absent, or already only whitespace: clearing it again
            // would be a queued command that changes nothing.
            guard let stored, !stored.trimmingWhitespace().isEmpty else { return nil }
            return .details(nil)
        }
        guard raw != stored else { return nil }
        return .details(raw)
    }

    /// A change to the time estimate, or the reason the text is not a duration.
    ///
    /// **Empty clears.** An estimate is genuinely optional and "I no longer know
    /// how long this takes" is a thing a user says, so an emptied field deletes
    /// the frontmatter key rather than storing a zero.
    ///
    /// A non-empty value must be whole minutes and nothing else.
    /// `UInt32.init(_: String)` is exactly that test — it rejects `-5`, `2.5`,
    /// `90m` and `1 000` — and rejecting is the point: quietly reading `90m` as
    /// `90` would teach the user a syntax that does not exist and would read
    /// `1h` as nothing at all.
    ///
    /// `0` is accepted and stored rather than treated as a clear. It is a
    /// strange estimate, but it is what was typed, and silently converting one
    /// user instruction into a different one is the failure mode this whole file
    /// is arranged against.
    public static func estimating(
        _ raw: String,
        of task: CoreTask
    ) -> Result<TaskFieldEdit?, CoreError> {
        let trimmed = raw.trimmingWhitespace()
        guard !trimmed.isEmpty else {
            guard task.timeEstimate != nil else { return .success(nil) }
            return .success(.timeEstimate(nil))
        }
        guard let minutes = UInt32(trimmed) else {
            return .failure(
                .Validation(
                    message: "“\(trimmed)” is not a number of minutes. Enter whole minutes, "
                        + "such as 90."
                )
            )
        }
        guard minutes != task.timeEstimate else { return .success(nil) }
        return .success(.timeEstimate(minutes))
    }

    /// The text a time-estimate field opens with.
    ///
    /// Empty for an absent estimate, so the placeholder shows rather than a `0`
    /// the user would have to delete before typing.
    public static func estimateText(of task: CoreTask) -> String {
        task.timeEstimate.map { "\($0)" } ?? ""
    }
}
