import Testing

@testable import TaskNotesKit
@testable import TaskNotesUniFFI

/// What a commit-on-blur text field is allowed to do.
///
/// Two questions decide every case: *is this different from what is stored*
/// (because a field that dispatched on every tab press would queue a network
/// round trip and a frontmatter rewrite per tab press) and *does empty mean
/// clear or nothing* (because the answer differs per field, and getting it wrong
/// deletes data).
@Suite("Task text edits")
struct TaskTextEditTests {
    // ── Title ──────────────────────────────────────────────────────────────

    /// An emptied title is refused, not cleared.
    ///
    /// The core says `title` cannot be cleared — it is `Optional` only to
    /// express *unchanged* — so dispatching `""` would write an untitled note,
    /// and a vault has no undo. The message names the title that is being kept,
    /// so the banner tells the user what the field will spring back to.
    @Test("an emptied title is refused", arguments: ["", "   ", "\n\t "])
    func emptyTitleRefused(raw: String) throws {
        let task = detailTask(id: "Tasks/A.md", title: "Renew passport")
        let outcome = TaskTextEdit.retitling(raw, of: task)
        guard case .failure(let error) = outcome else {
            Issue.record("an empty title must be refused, got \(outcome)")
            return
        }
        #expect(error.userMessage.contains("Renew passport"))
    }

    @Test("an unchanged title dispatches nothing")
    func unchangedTitle() throws {
        let task = detailTask(id: "Tasks/A.md", title: "Renew passport")
        #expect(try TaskTextEdit.retitling("Renew passport", of: task).get() == nil)
    }

    /// Trailing whitespace is not a change.
    ///
    /// The comparison trims both sides, so tabbing out of a field somebody
    /// accidentally added a space to does not queue an update.
    @Test("whitespace-only difference is not a change")
    func whitespaceOnlyTitle() throws {
        let task = detailTask(id: "Tasks/A.md", title: "Renew passport")
        #expect(try TaskTextEdit.retitling("  Renew passport  ", of: task).get() == nil)
    }

    /// What is *sent* is trimmed, even though the comparison also trimmed.
    ///
    /// Leading whitespace in a title survives into the vault filename, which is
    /// never what anybody meant.
    @Test("a new title is sent trimmed")
    func newTitleTrimmed() throws {
        let task = detailTask(id: "Tasks/A.md", title: "Renew passport")
        let edit = try TaskTextEdit.retitling("  Renew the passport ", of: task).get()
        #expect(edit == .title("Renew the passport"))
    }

    // ── Details ────────────────────────────────────────────────────────────

    /// Emptying the body clears it, matching the React Native form exactly.
    @Test("an emptied body clears the note")
    func emptiedBodyClears() {
        let task = detailTask(id: "Tasks/A.md", title: "A", details: "# Notes")
        #expect(TaskTextEdit.rewriting(details: "   \n ", of: task) == .details(nil))
    }

    /// Clearing an already-absent body is not a change.
    ///
    /// Without this, opening the inspector on a task with no note and tabbing
    /// through it would queue a command that deletes a key which is not there.
    @Test("clearing an absent body dispatches nothing", arguments: [nil, "", "  \n"])
    func clearingAbsentBody(stored: String?) {
        let task = detailTask(id: "Tasks/A.md", title: "A", details: stored)
        #expect(TaskTextEdit.rewriting(details: "", of: task) == nil)
    }

    /// The body is sent **verbatim**, untrimmed.
    ///
    /// This is markdown source: a trailing newline is a paragraph break and
    /// leading spaces are indentation, so trimming would silently rewrite the
    /// user's document. Only the emptiness *test* trims.
    @Test("a written body keeps its own whitespace")
    func bodySentVerbatim() {
        let task = detailTask(id: "Tasks/A.md", title: "A", details: nil)
        let source = "  indented\n\nsecond paragraph\n"
        #expect(TaskTextEdit.rewriting(details: source, of: task) == .details(source))
    }

    @Test("an unchanged body dispatches nothing")
    func unchangedBody() {
        let task = detailTask(id: "Tasks/A.md", title: "A", details: "# Notes\n")
        #expect(TaskTextEdit.rewriting(details: "# Notes\n", of: task) == nil)
    }

    // ── Time estimate ──────────────────────────────────────────────────────

    @Test("an emptied estimate clears it")
    func emptiedEstimateClears() throws {
        let task = detailTask(id: "Tasks/A.md", title: "A", timeEstimate: 90)
        let edit = try TaskTextEdit.estimating("", of: task).get()
        #expect(edit == .timeEstimate(nil))
    }

    @Test("clearing an absent estimate dispatches nothing")
    func clearingAbsentEstimate() throws {
        let task = detailTask(id: "Tasks/A.md", title: "A")
        #expect(try TaskTextEdit.estimating("  ", of: task).get() == nil)
    }

    @Test("whole minutes are stored")
    func wholeMinutesStored() throws {
        let task = detailTask(id: "Tasks/A.md", title: "A")
        let edit = try TaskTextEdit.estimating(" 90 ", of: task).get()
        #expect(edit == .timeEstimate(90))
    }

    /// Anything that is not whole minutes is refused rather than coerced.
    ///
    /// Reading `90m` as `90` would teach a syntax that does not exist, and would
    /// then read `1h` as nothing at all. `UInt32.init(_: String)` is exactly the
    /// right test and needs no parser of our own.
    @Test(
        "a value that is not whole minutes is refused",
        arguments: ["90m", "-5", "2.5", "1 000", "an hour", "1e3"]
    )
    func nonMinutesRefused(raw: String) throws {
        let task = detailTask(id: "Tasks/A.md", title: "A")
        let outcome = TaskTextEdit.estimating(raw, of: task)
        guard case .failure(let error) = outcome else {
            Issue.record("\(raw) must be refused, got \(outcome)")
            return
        }
        #expect(error.userMessage.contains(raw))
    }

    /// Zero is stored rather than treated as a clear.
    ///
    /// It is a strange estimate and it is what was typed. Silently turning one
    /// user instruction into a different one is the failure mode this whole
    /// file is arranged against.
    @Test("zero is a value, not a clear")
    func zeroIsAValue() throws {
        let task = detailTask(id: "Tasks/A.md", title: "A", timeEstimate: 30)
        let edit = try TaskTextEdit.estimating("0", of: task).get()
        #expect(edit == .timeEstimate(0))
    }

    @Test("an unchanged estimate dispatches nothing")
    func unchangedEstimate() throws {
        let task = detailTask(id: "Tasks/A.md", title: "A", timeEstimate: 90)
        #expect(try TaskTextEdit.estimating("90", of: task).get() == nil)
    }

    /// An absent estimate opens an empty field, so the placeholder shows rather
    /// than a `0` the user has to delete first.
    @Test("the field opens empty for an absent estimate")
    func estimateTextEmpty() {
        #expect(TaskTextEdit.estimateText(of: detailTask(id: "Tasks/A.md", title: "A")) == "")
        #expect(
            TaskTextEdit.estimateText(
                of: detailTask(id: "Tasks/A.md", title: "A", timeEstimate: 45)) == "45"
        )
    }
}
