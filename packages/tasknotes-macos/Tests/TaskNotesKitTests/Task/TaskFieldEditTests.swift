import Testing

@testable import TaskNotesKit
@testable import TaskNotesUniFFI

/// The three-state payload, which is the part of the inspector that can destroy
/// data if it is wrong.
///
/// `unchanged` leaves a frontmatter key alone, `clear` **deletes** it, and `set`
/// writes it. Confusing the first two is silent data loss in the user's vault —
/// invisible in the app, plainly visible in `git diff` — so the property worth
/// pinning is not "the field I set is right" but "**every other field is
/// untouched**". That is what ``changedFields(of:)`` measures.
@Suite("Task field edits")
struct TaskFieldEditTests {
    /// Every edit touches exactly one field.
    ///
    /// The load-bearing test in this file. A staged form would have to spell all
    /// thirteen fields on every save, and one `clear` where an `unchanged`
    /// belonged deletes a key the user never opened; per-field commit removes
    /// the possibility, and this is the assertion that says so for every case
    /// the enum has.
    @Test("an edit changes one field and leaves the other twelve alone", arguments: everyEdit)
    func touchesOneField(sample: EditSample) {
        #expect(changedFields(of: sample.edit.payload) == [sample.field])
    }

    @Test("an untouched request changes nothing")
    func untouchedChangesNothing() {
        #expect(changedFields(of: UpdateTaskRequest.untouched).isEmpty)
    }

    // ── clear versus absent ────────────────────────────────────────────────

    /// `nil` on a clearable field is `clear`, never `unchanged`.
    ///
    /// These four exist at the point where the user *did* say something about
    /// the field — they emptied it — and "the user cleared it" is exactly what
    /// `clear` is for. Answering `unchanged` here would make "remove the due
    /// date" a silent no-op.
    @Test("clearing a date sends clear, not unchanged")
    func clearingDateSendsClear() {
        #expect(TaskFieldEdit.due(nil).payload.due == .clear)
        #expect(TaskFieldEdit.scheduled(nil).payload.scheduled == .clear)
        #expect(TaskFieldEdit.recurrence(nil).payload.recurrence == .clear)
        #expect(TaskFieldEdit.details(nil).payload.details == .clear)
        #expect(TaskFieldEdit.timeEstimate(nil).payload.timeEstimate == .clear)
        #expect(TaskFieldEdit.recurrenceAnchor(nil).payload.recurrenceAnchor == .clear)
    }

    @Test("setting a date sends the value")
    func settingDateSendsValue() {
        #expect(TaskFieldEdit.due("2026-07-22").payload.due == .set(value: "2026-07-22"))
        #expect(TaskFieldEdit.timeEstimate(90).payload.timeEstimate == .set(value: 90))
        #expect(
            TaskFieldEdit.recurrenceAnchor(.completion).payload.recurrenceAnchor
                == .set(value: .completion)
        )
    }

    /// ⚠️ The list fields are inverted, and this is the trap the type documents.
    ///
    /// `projects`/`contexts`/`tags` are plain optional arrays: `nil` means
    /// *unchanged* and `[]` means *the empty list*, which is a real value. So
    /// emptying a token field has to send `[]` — the exact opposite of the
    /// clearable fields above, where `nil` is what clears.
    @Test("emptying a list sends an empty list, not nil")
    func emptyingListSendsEmptyList() {
        #expect(TaskFieldEdit.projects([]).payload.projects == [])
        #expect(TaskFieldEdit.contexts([]).payload.contexts == [])
        #expect(TaskFieldEdit.tags([]).payload.tags == [])
        // And the base really does mean "unchanged" for the same three.
        #expect(UpdateTaskRequest.untouched.projects == nil)
        #expect(UpdateTaskRequest.untouched.contexts == nil)
        #expect(UpdateTaskRequest.untouched.tags == nil)
    }

    @Test("a list edit replaces the whole list")
    func listEditReplaces() {
        #expect(
            TaskFieldEdit.projects(["[[Admin]]", "Website"]).payload.projects == [
                "[[Admin]]", "Website",
            ])
    }

    // ── The command ────────────────────────────────────────────────────────

    /// The id is passed through unresolved on purpose.
    ///
    /// The core follows its own alias map when the command is enqueued, so an
    /// inspector left open across the acknowledgement of the create that made
    /// the task keeps writing to the right note. Resolving here would freeze a
    /// temp id that is about to stop existing.
    @Test("an edit becomes an update command against the given id")
    func becomesUpdateCommand() throws {
        let command = TaskFieldEdit.priority(.high).command(for: "temp-42")
        guard case .update(let taskId, let payload) = command else {
            Issue.record("expected an update command, got \(command)")
            return
        }
        #expect(taskId == "temp-42")
        #expect(payload.priority == .high)
        #expect(changedFields(of: payload) == ["priority"])
    }

    @Test("a recurrence configuration touches only its rule, anchor, and required start")
    func recurrenceConfigurationIsScoped() throws {
        let draft = CommonRecurrenceDraft(
            interval: 2,
            pattern: .weekly(weekdays: [.monday, .wednesday]),
            ending: .afterOccurrences(8)
        )
        let edit = try TaskRecurrenceEdit.build(
            draft: draft,
            start: "2026-08-31",
            anchor: .completion,
            writesScheduled: true
        ).get()

        #expect(edit.rule == "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;COUNT=8")
        #expect(changedFields(of: edit.payload) == ["scheduled", "recurrence", "recurrenceAnchor"])
        #expect(edit.payload.scheduled == .set(value: "2026-08-31"))
        #expect(edit.payload.recurrenceAnchor == .set(value: .completion))
    }

    @Test("editing recurrence preserves an existing raw Scheduled value unless changed")
    func recurrencePreservesStoredSchedule() throws {
        let edit = try TaskRecurrenceEdit.build(
            draft: CommonRecurrenceDraft(interval: 1, pattern: .daily, ending: .never),
            start: "2026-08-31",
            anchor: .scheduled,
            writesScheduled: false
        ).get()

        #expect(changedFields(of: edit.payload) == ["recurrence", "recurrenceAnchor"])
        #expect(edit.payload.scheduled == .unchanged)
    }
}

/// One edit and the single field it is allowed to touch.
struct EditSample: Sendable, CustomTestStringConvertible {
    let edit: TaskFieldEdit
    let field: String

    var testDescription: String { field }
}

/// Every case the enum has, each paired with its one field.
///
/// Listed by hand rather than derived, deliberately: `TaskFieldEdit` is not
/// `CaseIterable` and cannot be, since its cases carry values. The compiler
/// still catches an omission the other way round — `payload`'s switch is
/// exhaustive and `default:` is banned — so a new case makes the *source* fail
/// to build, and this list is what makes it fail here too once it compiles.
private let everyEdit: [EditSample] = [
    EditSample(edit: .title("Renamed"), field: "title"),
    EditSample(edit: .status(.inProgress), field: "status"),
    EditSample(edit: .priority(.high), field: "priority"),
    EditSample(edit: .due("2026-07-22"), field: "due"),
    EditSample(edit: .due(nil), field: "due"),
    EditSample(edit: .scheduled("2026-07-22"), field: "scheduled"),
    EditSample(edit: .scheduled(nil), field: "scheduled"),
    EditSample(edit: .projects(["Website"]), field: "projects"),
    EditSample(edit: .projects([]), field: "projects"),
    EditSample(edit: .contexts(["work"]), field: "contexts"),
    EditSample(edit: .tags(["urgent"]), field: "tags"),
    EditSample(edit: .recurrence("FREQ=DAILY"), field: "recurrence"),
    EditSample(edit: .recurrence(nil), field: "recurrence"),
    EditSample(edit: .recurrenceAnchor(.completion), field: "recurrenceAnchor"),
    EditSample(edit: .recurrenceAnchor(nil), field: "recurrenceAnchor"),
    EditSample(edit: .timeEstimate(90), field: "timeEstimate"),
    EditSample(edit: .timeEstimate(nil), field: "timeEstimate"),
    EditSample(edit: .details("body"), field: "details"),
    EditSample(edit: .details(nil), field: "details"),
]

/// Which fields of a request are not in their "leave it alone" state.
///
/// Written out field by field rather than by diffing against `untouched`,
/// because the *names* are what makes a failure readable: "changed
/// [due, recurrence]" says what went wrong, and "payloads differ" does not.
///
/// Split in two along the line that matters: the fields where **`nil` means
/// unchanged**, and the fields where **`.unchanged` does** and `nil` is not even
/// spellable. Confusing those two groups is the whole hazard this file exists to
/// guard, so having them in separate functions is worth more than having them in
/// one list.
private func changedFields(of request: UpdateTaskRequest) -> [String] {
    optionalFields(of: request) + clearableFields(of: request)
}

/// The fields typed `T?`, where `nil` is *unchanged* and there is no `clear`.
///
/// ⚠️ `projects`, `contexts` and `tags` live here rather than with the
/// clearables, and that is the trap: for them `[]` is a real value meaning "the
/// empty list", so clearing one is a `set` to `[]` and never a `nil`.
private func optionalFields(of request: UpdateTaskRequest) -> [String] {
    var changed: [String] = []
    if request.title != nil { changed.append("title") }
    if request.status != nil { changed.append("status") }
    if request.priority != nil { changed.append("priority") }
    if request.projects != nil { changed.append("projects") }
    if request.contexts != nil { changed.append("contexts") }
    if request.tags != nil { changed.append("tags") }
    if request.extraFields != nil { changed.append("extraFields") }
    return changed
}

/// The three-state fields, where `clear` deletes the frontmatter key.
private func clearableFields(of request: UpdateTaskRequest) -> [String] {
    var changed: [String] = []
    if request.due != .unchanged { changed.append("due") }
    if request.scheduled != .unchanged { changed.append("scheduled") }
    if request.recurrence != .unchanged { changed.append("recurrence") }
    if request.recurrenceAnchor != .unchanged { changed.append("recurrenceAnchor") }
    if request.timeEstimate != .unchanged { changed.append("timeEstimate") }
    if request.details != .unchanged { changed.append("details") }
    return changed
}
