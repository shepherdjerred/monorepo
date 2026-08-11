import Testing

@testable import TaskNotesKit

/// The vocabularies the token-field suites share.
///
/// Module-visible rather than private to one suite: the matching tests and the
/// key-handling tests are two halves of one control, and giving each its own
/// copy of "the vault's contexts" is how the two halves quietly stop describing
/// the same vault.
enum TokenFieldFixtures {
    /// The vault's contexts, displayed with the `@` the frontmatter does not
    /// store.
    static let contexts = [
        TokenChoice(stored: "home", display: "@home"),
        TokenChoice(stored: "errands", display: "@errands"),
        TokenChoice(stored: "work", display: "@work"),
    ]

    /// Projects, where the stored spelling and the shown one genuinely differ.
    static let projects = [
        TokenChoice(stored: "[[Projects/Flat|the flat]]", display: "the flat"),
        TokenChoice(stored: "Admin", display: "Admin"),
        TokenChoice(stored: "Café", display: "Café"),
    ]
}

/// The token field's type-ahead, which is entirely a pure function.
///
/// This exists because the alternative is asserting on a rendered `NSTextField`
/// behind a Mac-GUI-only gate. Every behaviour a user would describe — "↓ picks
/// the first one", "↑ gets me back to what I typed", "Return takes a name that
/// is not in the list", "Escape closes the list without eating my text" — is
/// `(entry, suggestions) -> effect`, so it belongs here where it runs on every
/// PR rather than on a Mac somebody remembered to use.
@Suite("The token field's completion")
struct TokenFieldTests {
    // ── Matching ───────────────────────────────────────────────────────────

    /// An empty query offers the whole vocabulary.
    ///
    /// This is what makes the field a replacement for the ▾ menu of vault names
    /// that stood in for completion, rather than only a filter over it: focus
    /// and press ↓ and the names you have used before are all there.
    @Test("an empty query offers everything, in vocabulary order")
    func emptyQueryOffersEverything() {
        #expect(
            TokenField.matches(query: "", in: TokenFieldFixtures.contexts)
                == TokenFieldFixtures.contexts)
        #expect(
            TokenField.matches(query: "   ", in: TokenFieldFixtures.contexts)
                == TokenFieldFixtures.contexts)
    }

    @Test("matching ignores case")
    func matchingIgnoresCase() {
        #expect(
            TokenField.matches(query: "ADM", in: TokenFieldFixtures.projects).map(\.stored) == [
                "Admin"
            ])
    }

    /// Accents fold, and the folding is locale-independent.
    ///
    /// Matching that read the machine's locale would offer different completions
    /// in Istanbul than in London over the same vault — the same class of
    /// divergence the core's `compareTitles` note warns about.
    @Test("matching ignores accents")
    func matchingIgnoresAccents() {
        #expect(
            TokenField.matches(query: "cafe", in: TokenFieldFixtures.projects).map(\.stored) == [
                "Café"
            ])
        #expect(
            TokenField.matches(query: "Café", in: TokenFieldFixtures.projects).map(\.stored) == [
                "Café"
            ])
    }

    /// The stored spelling is matched as well as the shown one.
    ///
    /// A context displays as `@home` and is stored as `home`. Testing only the
    /// display string would push every context out of the prefix tier the moment
    /// the sigil was in front of it, so typing `home` would rank `@home` below
    /// any unrelated name that merely contained the letters.
    @Test("a sigil in the display name does not demote a prefix match")
    func sigilDoesNotDemote() {
        let matched = TokenField.matches(query: "home", in: TokenFieldFixtures.contexts)
        #expect(matched.map(\.stored) == ["home"])
    }

    /// Prefix matches come before names that merely contain the query.
    @Test("prefixes rank above substrings, and both keep vocabulary order")
    func prefixesRankFirst() {
        let choices = [
            TokenChoice(stored: "rework", display: "rework"),
            TokenChoice(stored: "work", display: "work"),
            TokenChoice(stored: "workshop", display: "workshop"),
        ]
        #expect(
            TokenField.matches(query: "work", in: choices).map(\.stored)
                == ["work", "workshop", "rework"]
        )
    }

    /// A wikilink is reachable by the words a human sees.
    @Test("a project matches on its display name as well as its stored one")
    func projectMatchesOnDisplayName() {
        #expect(
            TokenField.matches(query: "flat", in: TokenFieldFixtures.projects).map(\.stored)
                == ["[[Projects/Flat|the flat]]"]
        )
        #expect(
            TokenField.matches(query: "Projects/", in: TokenFieldFixtures.projects).map(\.stored)
                == ["[[Projects/Flat|the flat]]"]
        )
    }

    @Test("a query nothing matches offers nothing")
    func noMatches() {
        #expect(TokenField.matches(query: "zzz", in: TokenFieldFixtures.contexts).isEmpty)
    }

    // ── What is offered ────────────────────────────────────────────────────

    /// Names already on the task are not offered again.
    @Test("the vocabulary is offered minus what the task already carries")
    func offeringExcludesPresent() {
        let present = ["work"]
        let offered = TokenChoice.offering(
            vocabulary: ["home", "errands", "work"],
            display: { "@\($0)" },
            isPresent: { present.contains($0) }
        )
        #expect(offered.map(\.stored) == ["home", "errands"])
        #expect(offered.map(\.display) == ["@home", "@errands"])
    }

    /// The caller decides what "already present" means, and for a project only
    /// the core can answer it. This is the shape that lets a wikilink cover its
    /// own display name.
    @Test("a project already attached under another spelling is not offered")
    func offeringHonoursCallerEquality() {
        let offered = TokenChoice.offering(
            vocabulary: ["[[Projects/Flat|the flat]]", "Admin"],
            display: { $0 == "[[Projects/Flat|the flat]]" ? "the flat" : $0 },
            // Stands in for the core's `projectMatches`: the task carries the
            // bare name, the vocabulary carries the wikilink, and they are one
            // project.
            isPresent: { $0.contains("Flat") }
        )
        #expect(offered.map(\.stored) == ["Admin"])
    }

    // ── Typing ─────────────────────────────────────────────────────────────

    @Test("text with no comma is all still being typed")
    func typingWithoutASeparator() {
        #expect(
            TokenField.tokenising("home")
                == TokenFieldTyping(completed: [], remainder: "home")
        )
    }

    /// Comma tokenises because it is what everybody tries first, and because it
    /// is the only thing that turns a pasted `home, errands, admin` into three
    /// names rather than one preposterous one.
    @Test("a comma finishes a name")
    func typingASeparator() {
        #expect(
            TokenField.tokenising("home, errands, adm")
                == TokenFieldTyping(completed: ["home", "errands"], remainder: "adm")
        )
    }

    @Test("a trailing comma finishes the name and empties the field")
    func typingATrailingSeparator() {
        #expect(
            TokenField.tokenising("home,")
                == TokenFieldTyping(completed: ["home"], remainder: "")
        )
    }

    @Test("empty names between commas are dropped rather than added")
    func typingEmptyNames() {
        #expect(
            TokenField.tokenising(" , ,x")
                == TokenFieldTyping(completed: [], remainder: "x")
        )
    }

    // ── The entry value ────────────────────────────────────────────────────

    /// A new query invalidates both the highlight and the dismissal.
    ///
    /// The highlight indexes a match list the new text no longer produces, and a
    /// list dismissed for `urg` should reopen for `urge` — otherwise typing one
    /// more character after Escape leaves the user with no completions and no way
    /// to tell why.
    @Test("typing resets the highlight and reopens a dismissed list")
    func typingResetsTheEntry() {
        let entry = TokenFieldEntry(text: "urg", highlighted: 2, isDismissed: true)
        #expect(
            entry.typing("urge")
                == TokenFieldEntry(text: "urge", highlighted: nil, isDismissed: false)
        )
    }
}
