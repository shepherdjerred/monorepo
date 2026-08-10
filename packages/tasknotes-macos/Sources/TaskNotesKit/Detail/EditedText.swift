/// A free-text field's buffer, and whether what is in it is the user's.
///
/// The inspector's three free-text fields cannot dispatch per keystroke, so each
/// holds a local copy of the stored value and commits it on Return, on losing
/// focus, and on the panel disappearing. That copy has to answer one question
/// the string alone cannot: **did somebody type this, or is it just what the
/// task said when the field was built?**
///
/// ⚠️ The two are not the same, and treating them as the same loses work. The
/// inspector follows a *live* selection: a pull, a queued command draining, or
/// an edit made in Obsidian can rewrite the very task on screen while the panel
/// is open, and the panel's identity only changes when the *task* changes. So a
/// buffer seeded at build time goes stale — and a commit that compares a stale
/// buffer against the refreshed task sees a difference, dispatches it, and
/// writes the old value back over an edit the user never touched. Every field
/// in the panel commits on close, so closing it silently reverted whatever had
/// arrived since it opened.
///
/// The baseline is what makes the distinction cheap: it is the stored value the
/// buffer was last seeded from or last committed against, so ``isEdited`` is
/// exactly "the user has typed something not yet given to the core", and an
/// untouched field can take a new stored value without argument.
public struct EditedText: Equatable, Sendable {
    /// What is in the field. Bound straight to the text control.
    public var text: String

    /// The stored value ``text`` was last seeded from or committed against.
    private var baseline: String

    /// A buffer showing what is stored, with nothing typed into it yet.
    public init(stored: String) {
        text = stored
        baseline = stored
    }

    /// Whether the field holds an edit the core has not been offered.
    public var isEdited: Bool { text != baseline }

    /// Take a new stored value, **unless** an edit is in progress.
    ///
    /// An edit in progress wins: the user is looking at what they typed, and
    /// replacing it under the caret would be the same loss in the other
    /// direction. What arrives while they type is theirs to overwrite when they
    /// commit.
    public mutating func refresh(stored: String) {
        guard !isEdited else { return }
        text = stored
        baseline = stored
    }

    /// Throw the edit away and show what is stored — Escape's meaning.
    public mutating func revert(to stored: String) {
        text = stored
        baseline = stored
    }

    /// Record that `dispatched` reached the core.
    ///
    /// Called only when a mutation was actually recorded, so a value the core
    /// *refused* — an emptied title, an estimate that is not a number, an
    /// enqueue that failed — stays an edit and stays committable, rather than
    /// being adopted as the baseline and then quietly dropped.
    ///
    /// ⚠️ The **offered** text, not ``text``. Recording is asynchronous, and the
    /// user can type during that round trip; taking the buffer's current
    /// contents as the baseline would adopt keystrokes the core never saw.
    public mutating func commit(_ dispatched: String) {
        baseline = dispatched
    }
}
