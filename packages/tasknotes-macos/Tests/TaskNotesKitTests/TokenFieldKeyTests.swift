import Testing

@testable import TaskNotesKit

/// What each key does to a token field, which is the whole of its keyboard map.
///
/// A separate suite from the matching tests because it is a separate question:
/// those ask "which names are offered", these ask "what happens when you press
/// a key against them". Both are pure functions of their inputs, which is why
/// neither needs a rendered field or a Mac to run on.
@Suite("The token field's keyboard map")
struct TokenFieldKeyTests {
    // ── Moving through the list ────────────────────────────────────────────

    @Test("down from nothing highlights the first suggestion")
    func downEntersTheList() {
        #expect(
            TokenField.effect(
                of: .moveDown, entry: .idle, suggestions: TokenFieldFixtures.contexts,
                hasValues: false)
                == .entry(TokenFieldEntry(text: "", highlighted: 0, isDismissed: false))
        )
    }

    @Test("down at the end of the list stays there")
    func downStopsAtTheEnd() {
        let entry = TokenFieldEntry(text: "", highlighted: 2, isDismissed: false)
        #expect(
            TokenField.effect(
                of: .moveDown, entry: entry, suggestions: TokenFieldFixtures.contexts,
                hasValues: false)
                == .entry(entry)
        )
    }

    /// ↓ reopens a list Escape closed, which is the only way back to it without
    /// retyping the query.
    @Test("down reopens a dismissed list at the top")
    func downReopensADismissedList() {
        let entry = TokenFieldEntry(text: "ho", highlighted: nil, isDismissed: true)
        #expect(
            TokenField.effect(
                of: .moveDown, entry: entry, suggestions: TokenFieldFixtures.contexts,
                hasValues: false)
                == .entry(TokenFieldEntry(text: "ho", highlighted: 0, isDismissed: false))
        )
    }

    @Test("down with nothing to offer is not ours")
    func downWithNoSuggestions() {
        #expect(
            TokenField.effect(of: .moveDown, entry: .idle, suggestions: [], hasValues: false)
                == .ignored
        )
    }

    /// ↑ off the top returns to the typed text rather than wrapping.
    ///
    /// `nil` is a real position, not an absence: it is the one Return uses to
    /// accept a name the vault has never seen, so a user must be able to get back
    /// to it after arrowing into the list by mistake.
    @Test("up off the top of the list returns to the typed text")
    func upLeavesTheList() {
        let entry = TokenFieldEntry(text: "ho", highlighted: 0, isDismissed: false)
        #expect(
            TokenField.effect(
                of: .moveUp, entry: entry, suggestions: TokenFieldFixtures.contexts,
                hasValues: false)
                == .entry(TokenFieldEntry(text: "ho", highlighted: nil, isDismissed: false))
        )
    }

    /// With nothing highlighted, ↑ belongs to the text editor — it moves the
    /// insertion point to the start of the line, which is also how a user reaches
    /// the position where ← and Backspace start talking about tokens.
    @Test("up with nothing highlighted is left to the field editor")
    func upWithoutHighlightIsNotOurs() {
        #expect(
            TokenField.effect(
                of: .moveUp, entry: .idle, suggestions: TokenFieldFixtures.contexts,
                hasValues: false)
                == .ignored
        )
    }

    // ── Committing ─────────────────────────────────────────────────────────

    /// ⚠️ The **stored** spelling is committed, never the displayed one.
    ///
    /// Accepting `the flat` for `[[Projects/Flat|the flat]]` would rewrite the
    /// wikilink into a bare name in the user's vault — invisible in the app,
    /// plainly visible in `git diff`, and vaults are commonly in git.
    @Test("Return on a highlighted suggestion commits its stored spelling")
    func commitUsesTheStoredSpelling() {
        let entry = TokenFieldEntry(text: "flat", highlighted: 0, isDismissed: false)
        #expect(
            TokenField.effect(
                of: .commit, entry: entry, suggestions: TokenFieldFixtures.projects,
                hasValues: false)
                == .add("[[Projects/Flat|the flat]]")
        )
    }

    /// The whole reason these are not a picker: a name nobody has used before is
    /// created by typing it.
    @Test("Return with nothing highlighted commits the typed name")
    func commitAcceptsAFreeFormName() {
        let entry = TokenFieldEntry(text: "  brand new  ", highlighted: nil, isDismissed: false)
        #expect(
            TokenField.effect(
                of: .commit, entry: entry, suggestions: TokenFieldFixtures.contexts,
                hasValues: false)
                == .add("brand new")
        )
    }

    @Test("Return in an empty field commits nothing")
    func commitOnNothing() {
        #expect(
            TokenField.effect(
                of: .commit, entry: .idle, suggestions: TokenFieldFixtures.contexts,
                hasValues: false)
                == .ignored
        )
    }

    /// A dismissed list is not offering anything, so its highlight must not be
    /// what Return takes.
    @Test("Return after Escape commits the typed name, not the old highlight")
    func commitIgnoresADismissedHighlight() {
        let entry = TokenFieldEntry(text: "hom", highlighted: 0, isDismissed: true)
        #expect(
            TokenField.effect(
                of: .commit, entry: entry, suggestions: TokenFieldFixtures.contexts,
                hasValues: false)
                == .add("hom")
        )
    }

    /// The list shrinks whenever a token is added, so a stale index is reachable
    /// between one render and the next. It falls back to the typed text rather
    /// than trapping.
    @Test("a highlight past the end of the list falls back to the typed name")
    func commitSurvivesAStaleHighlight() {
        let entry = TokenFieldEntry(text: "hom", highlighted: 9, isDismissed: false)
        #expect(
            TokenField.effect(
                of: .commit, entry: entry, suggestions: TokenFieldFixtures.contexts,
                hasValues: false)
                == .add("hom")
        )
    }

    // ── Escape ─────────────────────────────────────────────────────────────

    /// Escape is two-stage, and the first stage keeps the text.
    ///
    /// Collapsing them would make dismissing an unwanted list also throw away the
    /// name the user was halfway through typing.
    @Test("Escape closes the list and keeps what was typed")
    func escapeClosesTheList() {
        let entry = TokenFieldEntry(text: "ho", highlighted: 1, isDismissed: false)
        #expect(
            TokenField.effect(
                of: .cancel, entry: entry, suggestions: TokenFieldFixtures.contexts,
                hasValues: false)
                == .entry(TokenFieldEntry(text: "ho", highlighted: nil, isDismissed: true))
        )
    }

    @Test("Escape again clears the text")
    func escapeClearsTheText() {
        let entry = TokenFieldEntry(text: "ho", highlighted: nil, isDismissed: true)
        #expect(
            TokenField.effect(
                of: .cancel, entry: entry, suggestions: TokenFieldFixtures.contexts,
                hasValues: false)
                == .entry(.idle)
        )
    }

    /// The third Escape is somebody dismissing the panel. Swallowing it would
    /// make the key look broken everywhere the field happens to have focus.
    @Test("Escape in an empty, listless field is left alone")
    func escapeWithNothingToDo() {
        #expect(
            TokenField.effect(of: .cancel, entry: .idle, suggestions: [], hasValues: true)
                == .ignored
        )
    }

    // ── The two keys that need the insertion point ─────────────────────────

    @Test("Backspace at the start removes the preceding token")
    func backspaceRemovesTheLastToken() {
        #expect(
            TokenField.effect(
                of: .deleteBackwardAtStart, entry: .idle, suggestions: [], hasValues: true)
                == .removeLast
        )
    }

    @Test("Backspace at the start of a field with no tokens does nothing")
    func backspaceWithNoTokens() {
        #expect(
            TokenField.effect(
                of: .deleteBackwardAtStart, entry: .idle, suggestions: [], hasValues: false)
                == .ignored
        )
    }

    @Test("left at the start moves keyboard focus onto the last token")
    func leftFocusesTheLastToken() {
        #expect(
            TokenField.effect(
                of: .moveLeftAtStart, entry: .idle, suggestions: [], hasValues: true)
                == .focusLastToken
        )
    }

    @Test("left at the start of a field with no tokens is left to the editor")
    func leftWithNoTokens() {
        #expect(
            TokenField.effect(
                of: .moveLeftAtStart, entry: .idle, suggestions: [], hasValues: false)
                == .ignored
        )
    }

    /// Every key does something in the state where it should.
    ///
    /// A totality check rather than a sixth restatement: a key added to
    /// ``TokenFieldKey`` and then never wired up would silently be swallowed by
    /// the text editor, which looks exactly like the key not existing.
    @Test(
        "every key is claimed when the field is in full flight", arguments: TokenFieldKey.allCases)
    func everyKeyIsClaimed(key: TokenFieldKey) {
        let entry = TokenFieldEntry(text: "ho", highlighted: 1, isDismissed: false)
        #expect(
            TokenField.effect(
                of: key, entry: entry, suggestions: TokenFieldFixtures.contexts, hasValues: true)
                != .ignored
        )
    }
}
