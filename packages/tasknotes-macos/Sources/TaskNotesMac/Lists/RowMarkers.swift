internal import SwiftUI
internal import TaskNotesUniFFI

// The two annotations a task row hangs off its title, and the one decision
// behind both: **each visual channel carries exactly one meaning.**
//
// The row previously spent red twice — overdue date text and high-priority
// checkbox ring — so a normal-priority overdue task was red text with a blue
// ring, a high-priority task due today was a red ring with grey text, and
// scanning could not separate "late" from "flagged". Red is now *late*, and
// nothing else on a row is red. Priority moved off colour-as-rank entirely and
// onto a mark, for reasons below.

/// Priority, as a mark first and a tint second.
///
/// ## Why the old ramp did not read
///
/// It was `red, red, blue, orange, grey, grey` for highest through none: the
/// top two ranks were indistinguishable, `normal` was the most saturated
/// non-red on screen and so out-shouted `medium`, and `low`/`none` shared the
/// tint that also means *completed*, which made an open low-priority task look
/// disabled. Every one of those is the same underlying mistake — **hue has no
/// order**, so asking six hues to express six ranks produces a ranking a reader
/// has to memorise rather than see.
///
/// ## The ramp
///
/// | rank | mark | tint |
/// |---|---|---|
/// | highest | `!!!` | orange |
/// | high | `!!` | orange |
/// | medium | `!` | orange |
/// | normal | — | — |
/// | low | ↓ | tertiary |
/// | none | — | — |
///
/// It reads monotonically because rank maps to **quantity of mark** within a
/// single hue: three strokes, two, one, none. That is an ordering the eye gets
/// without a legend, and it survives the eight percent of men with a red-green
/// deficiency, for whom the old red-vs-orange top of the ramp was two of the
/// same colour.
///
/// ⚠️ **One hue, held constant across the elevated band — deliberately.** A
/// first pass drew `medium` in orange at the `secondary` hierarchy, reasoning
/// that fading it added a second monotonic channel. Rendering it showed the
/// opposite: at caption size the faded mark was barely visible, so `medium`
/// read as *less legible* than `low`, which inverted the very ordering the
/// fade was supposed to reinforce. Rank is carried by stroke count alone;
/// varying two channels at once is what made the old ramp unreadable.
///
/// `normal` and `none` both draw nothing, and that is the honest rendering: an
/// unflagged task should look unflagged, and a mark for "no priority" is ink
/// spent to say nothing. `low` is the one sub-normal thing a user can actually
/// assert, so it gets a de-emphasised down arrow rather than a colour that
/// could be misread as *disabled*.
struct PriorityMarker: View {
    let priority: Priority

    /// Whether the row this sits on is already done.
    ///
    /// A completed task's priority is not actionable — there is nothing left to
    /// prioritise — so a full-strength orange `!!!` on a struck-through title
    /// draws the eye to the one row on the screen with no work left in it. The
    /// mark stays, because "this *was* urgent" is still true and un-completing
    /// is a click away; it just stops shouting.
    var isDimmed: Bool = false

    var body: some View {
        if let mark {
            Image(systemName: mark.symbol)
                .font(.caption2.weight(.bold))
                .foregroundStyle(mark.tint)
                .help(Self.help(priority))
                // Spoken by the row's own label instead, so the row reads as
                // one sentence rather than as a title interrupted by a glyph.
                .accessibilityHidden(true)
        }
    }

    /// What the row's accessibility label says about priority, or `nil` when
    /// there is no mark to describe.
    ///
    /// Keyed off the same `mark` the eye reads, so the spoken row and the drawn
    /// row can never disagree about whether this task is flagged.
    static func spoken(_ priority: Priority) -> String? {
        PriorityMarker(priority: priority).mark == nil ? nil : help(priority)
    }

    private static func help(_ priority: Priority) -> String {
        "\(priorityLabel(priority: priority)) priority"
    }

    /// The mark, and the hue it is drawn in at each of the two strengths.
    ///
    /// The dimmed elevated ranks stay *orange* rather than dropping to grey:
    /// hue is what says "flagged", and turning it grey on completion would make
    /// a done high-priority task indistinguishable from a done low-priority
    /// one. `Color.orange.tertiary` is a hierarchical style over a semantic
    /// colour, so it still tracks appearance and Increase Contrast.
    private var mark: (symbol: String, tint: AnyShapeStyle)? {
        switch priority {
        case .highest: ("exclamationmark.3", elevated)
        case .high: ("exclamationmark.2", elevated)
        case .medium: ("exclamationmark", elevated)
        case .normal, .none: nil
        case .low: ("arrow.down", isDimmed ? AnyShapeStyle(.quaternary) : AnyShapeStyle(.tertiary))
        }
    }

    private var elevated: AnyShapeStyle {
        isDimmed ? AnyShapeStyle(Color.orange.tertiary) : AnyShapeStyle(.orange)
    }
}

/// The repeat mark, and the sentence it stands for.
///
/// A recurring task previously rendered **identically to a plain one** — the
/// state was computed and never read — while the checkbox's accessibility value
/// already announced "occurrence of 2026-07-22". So a VoiceOver user was told
/// something a sighted user was not, which is an accessibility inconsistency
/// before it is a visual gap.
///
/// This is the visual half of that sentence. The other half is the date column,
/// which now prints the occurrence rather than a due date the task usually does
/// not have, and the checkbox's spoken value, which now uses **the same words
/// this row prints** instead of a raw ISO date. All three say one thing: *this
/// repeats, and the checkbox completes this occurrence of it.*
struct RecurrenceMarker: View {
    /// The occurrence the checkbox targets, in the row's own words.
    let occurrence: String?

    /// Whether the occurrence this row is about is already done.
    var isDimmed: Bool = false

    var body: some View {
        Image(systemName: "repeat")
            .font(.caption2.weight(.semibold))
            .foregroundStyle(isDimmed ? AnyShapeStyle(.quaternary) : AnyShapeStyle(.secondary))
            .help(Self.spoken(occurrence))
            .accessibilityHidden(true)
    }

    /// What the row and the checkbox both say about the repetition.
    static func spoken(_ occurrence: String?) -> String {
        guard let occurrence else { return "Repeats" }
        return "Repeats — completes the occurrence of \(occurrence)"
    }
}
