import Testing

@testable import TaskNotesKit

/// Which of the two copies of a field is the newer one.
///
/// The inspector's free-text fields hold a local buffer and commit it when they
/// lose focus or when the panel closes. The panel follows a *live* selection, so
/// the task under it can be rewritten by a pull, by a queued command draining,
/// or by an edit made in Obsidian while the buffer sits there unchanged — and a
/// commit that only compares the two writes the stale one back over the fresh
/// one. These cases are that distinction and nothing else.
@Suite("An edited text buffer")
struct EditedTextTests {
    @Test("a freshly seeded buffer is not an edit")
    func seededIsClean() {
        let buffer = EditedText(stored: "Renew passport")
        #expect(buffer.text == "Renew passport")
        #expect(!buffer.isEdited)
    }

    @Test("typing into it makes it an edit")
    func typingIsAnEdit() {
        var buffer = EditedText(stored: "Renew passport")
        buffer.text = "Renew passport before June"
        #expect(buffer.isEdited)
    }

    /// The bug this type exists for.
    ///
    /// The task was rewritten under an open panel and the user never touched
    /// the field. Before the baseline existed the buffer still held the title
    /// the panel opened with, so closing the panel dispatched it and undid the
    /// change that had arrived.
    @Test("an untouched field takes what arrived under the panel")
    func untouchedFieldRefreshes() {
        var buffer = EditedText(stored: "Renew passport")
        buffer.refresh(stored: "Renew passport (urgent)")
        #expect(buffer.text == "Renew passport (urgent)")
        #expect(!buffer.isEdited, "and it is still not the user's edit")
    }

    /// The other direction, which is the same loss with the roles swapped:
    /// replacing what somebody is typing, under the caret.
    @Test("a field being typed into keeps what is in it")
    func editedFieldSurvivesARefresh() {
        var buffer = EditedText(stored: "Renew passport")
        buffer.text = "Renew passport before June"
        buffer.refresh(stored: "Renew passport (urgent)")
        #expect(buffer.text == "Renew passport before June")
        #expect(buffer.isEdited, "so the commit still has something to send")
    }

    @Test("a committed buffer stops being an edit and tracks the task again")
    func committingRetiresTheEdit() {
        var buffer = EditedText(stored: "Renew passport")
        buffer.text = "Renew passport before June"
        let offered = buffer.offer()
        #expect(offered == "Renew passport before June")
        buffer.accept("Renew passport before June")
        #expect(!buffer.isEdited)

        // What the core stored is what the field should now show — here the
        // trimmed form of what was sent.
        buffer.refresh(stored: "Renew passport before June")
        #expect(buffer.text == "Renew passport before June")
    }

    /// ⚠️ Recording is asynchronous, so the buffer can move between the text
    /// being offered and the core confirming it. Committing the *offered* text
    /// is what leaves the keystrokes that arrived in between an edit, instead
    /// of adopting them as a baseline nothing ever sent.
    @Test("typing during the round trip stays an edit")
    func keystrokesDuringACommitStayAnEdit() {
        var buffer = EditedText(stored: "Renew passport")
        let offered = "Renew passport before June"
        buffer.text = offered
        #expect(buffer.offer() == offered)
        buffer.text = "Renew passport before June 3rd"
        buffer.accept(offered)
        #expect(buffer.isEdited, "the later keystrokes were never recorded")

        // And a refresh carrying what the core did take must not replace them.
        buffer.refresh(stored: offered)
        #expect(buffer.text == "Renew passport before June 3rd")
    }

    /// A value the core refused stays the user's problem to fix.
    ///
    /// Only a commit that was actually made advances the baseline, so an
    /// emptied title is still an edit — still committable, and still not
    /// something a refresh may quietly replace.
    @Test("a refused value is still an edit, because nothing committed it")
    func aRefusedValueStaysAnEdit() {
        var buffer = EditedText(stored: "Renew passport")
        buffer.text = ""
        #expect(buffer.offer() == "")
        buffer.reject("")
        buffer.refresh(stored: "Renew passport (urgent)")
        #expect(buffer.text.isEmpty)
        #expect(buffer.isEdited)
    }

    @Test("Escape throws the edit away and shows what is stored")
    func revertingDiscardsTheEdit() {
        var buffer = EditedText(stored: "Renew passport")
        buffer.text = ""
        buffer.revert(to: "Renew passport")
        #expect(buffer.text == "Renew passport")
        #expect(!buffer.isEdited)
    }

    @Test("blur and disappearance cannot offer the same edit twice")
    func anInFlightOfferIsDeduplicated() {
        var buffer = EditedText(stored: "Renew passport")
        buffer.text = "Renew passport before June"

        #expect(buffer.offer() == "Renew passport before June")
        #expect(buffer.offer() == nil)

        buffer.accept("Renew passport before June")
        #expect(!buffer.isEdited)
    }

    @Test("an offered value remains independent after its view state changes")
    func anOfferIsACapturedValue() {
        var buffer = EditedText(stored: "Old body")
        buffer.text = "Saved body"
        let offered = buffer.offer()
        buffer.text = "A later view value"

        #expect(offered == "Saved body")
        buffer.accept("Saved body")
        #expect(buffer.isEdited)
    }
}
