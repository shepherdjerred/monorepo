import Foundation

// The half of a token field that is not drawing: what has been typed, which
// completion is highlighted, and what a key press means.
//
// `TaskNotesKit` imports no UI framework, which puts everything in this file
// inside the headless test target. That matters more than usual for a type-ahead
// control: "↓ from nothing highlights the first suggestion", "↑ off the top
// returns to the typed text", "Return with nothing highlighted accepts a name
// the vault has never seen", and "Escape closes the list before it clears the
// text" are the whole behaviour, and every one of them is a pure function of
// (entry, suggestions). Asserting them through a rendered `NSTextField` would
// mean a Mac-GUI-only gate for logic that needs none.
//
// The view is left with exactly two jobs the model cannot do: knowing where the
// insertion point is, and moving focus.

/// One name a token field can offer, in both spellings it needs.
///
/// A project is stored as either a wikilink (`[[Projects/Website|the site]]`) or
/// a bare name, and the two are the *same* project. The list has to show the
/// readable one and hand back the stored one — offering the display name as the
/// value would rewrite every wikilink in the vault into a bare name the first
/// time somebody accepted a completion, which is invisible in the app and plainly
/// visible in `git diff`.
public struct TokenChoice: Hashable, Sendable {
    /// The value written to the vault.
    public let stored: String

    /// The value shown to the reader.
    public let display: String
}

extension TokenChoice {
    /// The vault's names, minus the ones this task already carries.
    ///
    /// `isPresent` rather than `contains`, because for projects only the core can
    /// answer it: `[[Projects/Website|the site]]` and `Website` are one project,
    /// and a list that offered the second while the first was already attached
    /// would produce two spellings of one thing — the exact failure a completion
    /// list exists to prevent.
    ///
    /// Order is the vocabulary's, which is first-appearance order in the user's
    /// own vault. Nothing here sorts; see ``TaskVocabulary`` for why collation is
    /// deliberately parked.
    public static func offering(
        vocabulary: [String],
        display: (String) -> String,
        isPresent: (String) -> Bool
    ) -> [TokenChoice] {
        vocabulary
            .filter { !isPresent($0) }
            .map { TokenChoice(stored: $0, display: display($0)) }
    }
}

/// What is being typed into a token field, and where the highlight sits.
///
/// A value type rather than a set of `@State` booleans, so the transitions
/// between its three fields are testable as one thing. The invalid state this
/// shape removes is "highlighted index into a suggestion list the current query
/// no longer produces": every route that changes ``text`` also clears
/// ``highlighted``.
public struct TokenFieldEntry: Equatable, Sendable {
    /// The half-typed name.
    public var text: String

    /// Which suggestion is highlighted, as an index into the current matches.
    ///
    /// `nil` is a real and reachable state rather than an absence: it means the
    /// **typed text stands**, which is what Return accepts when the name is not
    /// in the vocabulary yet. ↑ off the top of the list returns here rather than
    /// wrapping to the bottom, so a user can always arrow back to what they
    /// actually typed.
    public var highlighted: Int?

    /// Whether Escape has closed the list for this query.
    ///
    /// Escape is two-stage — close the list, then clear the text — which is what
    /// every macOS completion surface does. Without this flag the first Escape
    /// would have to clear the text, so a user dismissing an unwanted suggestion
    /// list would lose the name they were halfway through typing.
    public var isDismissed: Bool

    /// Nothing typed, nothing highlighted, nothing dismissed.
    public static let idle = TokenFieldEntry(text: "", highlighted: nil, isDismissed: false)

    /// The entry after the text changed.
    ///
    /// Both other fields reset, and neither is optional: a new query produces a
    /// new match list, so the old index points at a name that may no longer be
    /// offered — and a list dismissed for `urg` should reopen for `urge`.
    public func typing(_ value: String) -> Self {
        Self(text: value, highlighted: nil, isDismissed: false)
    }

    /// The entry with a different suggestion highlighted, and the list open.
    ///
    /// Highlighting something is only meaningful against a list that is being
    /// offered, so this also lifts a dismissal rather than producing the
    /// contradiction of a highlighted row inside a closed list.
    public func highlighting(_ index: Int?) -> Self {
        Self(text: text, highlighted: index, isDismissed: false)
    }
}

/// A key press a token field claims from its text editor.
///
/// Named for what the field *observed*, not for what should happen — the two
/// `AtStart` cases carry the one fact the model cannot see for itself, which is
/// where the insertion point was. Everything else about the outcome is decided
/// by ``TokenField/effect(of:entry:suggestions:hasValues:)``.
public enum TokenFieldKey: Equatable, Sendable, CaseIterable {
    /// ↑.
    case moveUp

    /// ↓.
    case moveDown

    /// Return.
    case commit

    /// Escape, or ⌘. — the field editor sends one selector for both.
    case cancel

    /// Backspace, with the insertion point at the very start and nothing
    /// selected, so there is no character in front of it to delete.
    case deleteBackwardAtStart

    /// ←, with the insertion point at the start of an **empty** field.
    ///
    /// Empty is required rather than incidental: leaving the field commits what
    /// is typed, and `urg` becoming a tag because somebody pressed ← would be a
    /// write nobody asked for.
    case moveLeftAtStart
}

/// What a claimed key press means.
public enum TokenFieldEffect: Equatable, Sendable {
    /// Not ours. The text editor should do whatever it normally does.
    case ignored

    /// The typing state changed, and nothing was written.
    case entry(TokenFieldEntry)

    /// Add this name, in its **stored** spelling, and reset the entry.
    case add(String)

    /// Remove the last token.
    case removeLast

    /// Move keyboard focus onto the last token.
    case focusLastToken
}

/// A token field's text split at its separators.
public struct TokenFieldTyping: Equatable, Sendable {
    /// Names the user finished by typing a comma, in order.
    public let completed: [String]

    /// What is left in the field afterwards.
    public let remainder: String
}

/// The pure half of the token field.
public enum TokenField {
    /// The vault's names that match what has been typed, best first.
    ///
    /// Two tiers, both in vocabulary order: names that *start* with the query,
    /// then names that merely contain it. Anything more clever would be ranking,
    /// and ranking a list a user reads means collation — which the core and the
    /// TypeScript client already disagree about, and which this package parks
    /// rather than adds a third opinion to.
    ///
    /// Both spellings are matched. A context displays as `@home` but is stored as
    /// `home`, so testing only the display string would demote every context out
    /// of the prefix tier the moment the sigil was in front of it.
    ///
    /// An empty query answers **everything**, which is what makes the field a
    /// replacement for the vault-names menu rather than only a filter: focus it,
    /// press ↓, and the list of names you have used before is right there.
    public static func matches(query: String, in choices: [TokenChoice]) -> [TokenChoice] {
        let needle = folded(query.trimmingCharacters(in: .whitespacesAndNewlines))
        guard !needle.isEmpty else { return choices }

        var prefixed: [TokenChoice] = []
        var contained: [TokenChoice] = []
        for choice in choices {
            let shown = folded(choice.display)
            let raw = folded(choice.stored)
            if shown.hasPrefix(needle) || raw.hasPrefix(needle) {
                prefixed.append(choice)
            } else if shown.contains(needle) || raw.contains(needle) {
                contained.append(choice)
            }
        }
        return prefixed + contained
    }

    /// What a claimed key press does.
    ///
    /// - Parameters:
    ///   - key: what the field observed.
    ///   - entry: what is currently typed.
    ///   - suggestions: the matches for that text, as the list is drawing them.
    ///   - hasValues: whether the task carries any tokens at all.
    /// - Returns: what to do, including ``TokenFieldEffect/ignored`` when the key
    ///   belongs to the text editor rather than to the token field.
    public static func effect(
        of key: TokenFieldKey,
        entry: TokenFieldEntry,
        suggestions: [TokenChoice],
        hasValues: Bool
    ) -> TokenFieldEffect {
        switch key {
        case .moveDown: return movingDown(entry: entry, suggestions: suggestions)
        case .moveUp: return movingUp(entry: entry, suggestions: suggestions)
        case .commit: return committing(entry: entry, suggestions: suggestions)
        case .cancel: return cancelling(entry: entry, suggestions: suggestions)
        case .deleteBackwardAtStart: return hasValues ? .removeLast : .ignored
        case .moveLeftAtStart: return hasValues ? .focusLastToken : .ignored
        }
    }

    /// ↓ — into the list, or down it.
    ///
    /// A dismissed list **reopens** here rather than staying shut. That is the
    /// only way back to the suggestions without retyping the query, and it is
    /// what an address bar or a Spotlight field does with the same key.
    private static func movingDown(
        entry: TokenFieldEntry,
        suggestions: [TokenChoice]
    ) -> TokenFieldEffect {
        guard !suggestions.isEmpty else { return .ignored }
        guard !entry.isDismissed else {
            return .entry(TokenFieldEntry(text: entry.text, highlighted: 0, isDismissed: false))
        }
        let next = entry.highlighted.map { min($0 + 1, suggestions.count - 1) } ?? 0
        return .entry(TokenFieldEntry(text: entry.text, highlighted: next, isDismissed: false))
    }

    /// ↑ — up the list, and off the top back to the typed text.
    ///
    /// With nothing highlighted this is **not** ours: the field editor moves the
    /// insertion point to the start of the line, which is the standard reading of
    /// ↑ in a text field and is also how a user reaches the position where ← and
    /// Backspace start talking about tokens.
    private static func movingUp(
        entry: TokenFieldEntry,
        suggestions: [TokenChoice]
    ) -> TokenFieldEffect {
        guard !suggestions.isEmpty, !entry.isDismissed, let current = entry.highlighted else {
            return .ignored
        }
        return .entry(
            TokenFieldEntry(
                text: entry.text,
                highlighted: current == 0 ? nil : current - 1,
                isDismissed: false
            )
        )
    }

    /// Return — the highlighted suggestion, or the typed name, or nothing.
    ///
    /// The middle branch is the one that matters: **a name the vault has never
    /// seen is accepted as typed.** These are free-form user tags, and a field
    /// that could only offer back what already existed would make the first use
    /// of any name impossible.
    private static func committing(
        entry: TokenFieldEntry,
        suggestions: [TokenChoice]
    ) -> TokenFieldEffect {
        if !entry.isDismissed, let index = entry.highlighted, suggestions.indices.contains(index) {
            return .add(suggestions[index].stored)
        }
        let typed = entry.text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !typed.isEmpty else { return .ignored }
        return .add(typed)
    }

    /// Escape — close the list, then clear the text, then stop claiming the key.
    ///
    /// The third stage is deliberate. An Escape in an empty, listless field is
    /// somebody dismissing the *panel*, and swallowing it would make the key look
    /// broken everywhere the field happens to have focus.
    private static func cancelling(
        entry: TokenFieldEntry,
        suggestions: [TokenChoice]
    ) -> TokenFieldEffect {
        if !entry.isDismissed, !suggestions.isEmpty {
            return .entry(
                TokenFieldEntry(text: entry.text, highlighted: nil, isDismissed: true))
        }
        guard !entry.text.isEmpty else { return .ignored }
        return .entry(.idle)
    }

    /// The field's text split at its commas.
    ///
    /// Comma tokenises because it is what everybody tries first — `NSTokenField`
    /// has done it since 10.4 — and because it is the only thing that makes
    /// pasting `home, errands, admin` produce three tokens instead of one
    /// preposterous name.
    ///
    /// The text after the last comma is *not* finished, so it stays in the field:
    /// typing `home,err` leaves `err` under the caret with its own live
    /// completion list.
    public static func tokenising(_ text: String) -> TokenFieldTyping {
        guard text.contains(",") else {
            return TokenFieldTyping(completed: [], remainder: text)
        }
        var parts = text.components(separatedBy: ",")
        let tail = parts.removeLast()
        return TokenFieldTyping(
            completed: parts.map(trimmed).filter { !$0.isEmpty },
            remainder: trimmed(tail)
        )
    }

    private static func trimmed(_ value: String) -> String {
        value.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// Case- and accent-insensitive, and locale-**independent**.
    ///
    /// `locale: nil` is the deliberate part. Matching that read the machine's
    /// locale would offer different completions in Istanbul than in London for
    /// the same vault, which is the same class of divergence the core's
    /// `compareTitles` note warns about. Folding only widens what matches; it
    /// never reorders, so first-appearance order survives it intact.
    private static func folded(_ value: String) -> String {
        value.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: nil)
    }
}
