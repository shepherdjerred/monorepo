import Foundation
import SwiftUI
import TaskNotesKit

internal struct FacetTaskInspectorView: View {
    let task: Task
    let store: FacetStore
    var onClose: (() -> Void)?

    @State private var titleDraft: String
    @State private var descriptionDraft: String
    @State private var editingMarkdownSource = false
    @State private var showingRecurrenceSheet = false

    init(task: Task, store: FacetStore, onClose: (() -> Void)? = nil) {
        self.task = task
        self.store = store
        self.onClose = onClose
        _titleDraft = State(initialValue: task.title)
        _descriptionDraft = State(initialValue: task.description)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                headerSection
                Divider()
                descriptionSection
                Divider()
                propertiesSection
                Divider()
                FacetInspectorLabelsSection(task: task, store: store)
                Divider()
                FacetInspectorSubtasksSection(task: task, store: store)
                Divider()
                FacetInspectorRemindersSection(task: task, store: store)
                Divider()
                Button(role: .destructive) {
                    store.deleteTask(task)
                    onClose?()
                } label: {
                    Label("Delete Task", systemImage: "trash")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .accessibilityIdentifier(AccessibilityIdentifier.Inspector.deleteTask)
            }
            .padding(16)
        }
        .onChange(of: task.id) {
            titleDraft = task.title
            descriptionDraft = task.description
            editingMarkdownSource = false
        }
        .onChange(of: task.title) {
            if titleDraft != task.title {
                titleDraft = task.title
            }
        }
        .onChange(of: task.description) {
            if !editingMarkdownSource && descriptionDraft != task.description {
                descriptionDraft = task.description
            }
        }
        .sheet(isPresented: $showingRecurrenceSheet) {
            FacetRecurrenceEditorSheet(
                currentRule: task.recurrence_rule,
                calendar: store.calendar,
                onApply: { rule in
                    store.patchTask(
                        id: task.id,
                        patch: FacetTaskPatch(recurrenceRule: .set(rule))
                    )
                },
                onClear: {
                    store.patchTask(
                        id: task.id,
                        patch: FacetTaskPatch(recurrenceRule: .clear)
                    )
                }
            )
        }
        .accessibilityIdentifier(AccessibilityIdentifier.Inspector.panel)
    }

    private var headerSection: some View {
        HStack(alignment: .top, spacing: 10) {
            Button {
                store.toggleTaskCompletion(task)
            } label: {
                Image(systemName: task.completed ? "checkmark.circle.fill" : "circle")
                    .font(.title2)
                    .foregroundStyle(
                        task.completed ? .green : FacetNativeStyle.priorityColor(task.priority)
                    )
            }
            .buttonStyle(.plain)

            TextField("Task title", text: $titleDraft, axis: .vertical)
                .font(.headline)
                .textFieldStyle(.plain)
                .onSubmit { commitTitleIfChanged() }
                .accessibilityIdentifier(AccessibilityIdentifier.Inspector.title)

            if titleDraft.trimmingCharacters(in: .whitespacesAndNewlines) != task.title {
                Button("Save") { commitTitleIfChanged() }
                    .controlSize(.small)
                    .buttonStyle(.borderedProminent)
            }
        }
    }

    private var descriptionSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Description")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.secondary)
                Spacer()
                Button(editingMarkdownSource ? "Done" : "Edit Markdown") {
                    if editingMarkdownSource {
                        commitDescriptionIfChanged()
                    }
                    editingMarkdownSource.toggle()
                }
                .controlSize(.small)
                .buttonStyle(.borderless)
                .accessibilityIdentifier(AccessibilityIdentifier.Inspector.detailsMode)
            }

            if editingMarkdownSource {
                TextEditor(text: $descriptionDraft)
                    .font(.system(.body, design: .monospaced))
                    .frame(minHeight: 110)
                    .padding(6)
                    .background(.quinary, in: .rect(cornerRadius: 8))
                    .accessibilityIdentifier(AccessibilityIdentifier.Inspector.detailsSource)
            } else if task.description.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                Button {
                    editingMarkdownSource = true
                } label: {
                    Text("Add notes or Markdown checklist…")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(8)
                        .background(.quinary, in: .rect(cornerRadius: 8))
                }
                .buttonStyle(.plain)
            } else {
                renderedMarkdownView
                    .padding(8)
                    .background(.quinary, in: .rect(cornerRadius: 8))
                    .accessibilityIdentifier(AccessibilityIdentifier.Inspector.details)
            }
        }
    }

    @ViewBuilder
    private var renderedMarkdownView: some View {
        switch Result(catching: { try MarkdownBody.of(source: task.description) }) {
        case .success(let markdown):
            FacetMarkdownBodyView(markdown)
        case .failure:
            Text(task.description)
                .font(.body)
        }
    }

    private func commitTitleIfChanged() {
        let trimmed = titleDraft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, trimmed != task.title else { return }
        store.patchTask(id: task.id, patch: FacetTaskPatch(title: trimmed))
    }

    private func commitDescriptionIfChanged() {
        guard descriptionDraft != task.description else { return }
        store.patchTask(id: task.id, patch: FacetTaskPatch(description: descriptionDraft))
    }
}

extension FacetTaskInspectorView {
    fileprivate var propertiesSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            projectPickerRow
            sectionPickerRow
            priorityPickerRow
            dueDateRow
            recurrenceRow
        }
    }

    private var projectPickerRow: some View {
        HStack {
            Text("Project")
                .font(.subheadline)
                .foregroundStyle(.secondary)
            Spacer()
            Picker(
                "Project",
                selection: Binding(
                    get: { task.project_id },
                    set: { newProjId in
                        store.patchTask(
                            id: task.id,
                            patch: FacetTaskPatch(projectId: newProjId, sectionId: .clear)
                        )
                    }
                )
            ) {
                ForEach(store.activeProjects) { proj in
                    Text(proj.name).tag(proj.id)
                }
            }
            .labelsHidden()
            .frame(maxWidth: 180)
            .accessibilityIdentifier(AccessibilityIdentifier.Inspector.project)
        }
    }

    @ViewBuilder
    private var sectionPickerRow: some View {
        let availableSections = store.sections(in: task.project_id)
        if !availableSections.isEmpty {
            HStack {
                Text("Section")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                Spacer()
                Picker(
                    "Section",
                    selection: Binding(
                        get: { task.section_id ?? "" },
                        set: { newSecId in
                            store.patchTask(
                                id: task.id,
                                patch: FacetTaskPatch(
                                    sectionId: newSecId.isEmpty ? .clear : .set(newSecId)
                                )
                            )
                        }
                    )
                ) {
                    Text("No section").tag("")
                    ForEach(availableSections) { sec in
                        Text(sec.name).tag(sec.id)
                    }
                }
                .labelsHidden()
                .frame(maxWidth: 180)
                .accessibilityIdentifier(AccessibilityIdentifier.Inspector.section)
            }
        }
    }

    private var priorityPickerRow: some View {
        HStack {
            Text("Priority")
                .font(.subheadline)
                .foregroundStyle(.secondary)
            Spacer()
            Picker(
                "Priority",
                selection: Binding(
                    get: { task.priority },
                    set: { newPriority in
                        store.patchTask(
                            id: task.id,
                            patch: FacetTaskPatch(priority: newPriority)
                        )
                    }
                )
            ) {
                ForEach(Priority.allCases, id: \.self) { level in
                    Text(FacetNativeStyle.priorityTitle(level)).tag(level)
                }
            }
            .pickerStyle(.segmented)
            .frame(maxWidth: 190)
            .accessibilityIdentifier(AccessibilityIdentifier.Inspector.priority)
        }
    }

    private var recurrenceRow: some View {
        HStack {
            Text("Repeat")
                .font(.subheadline)
                .foregroundStyle(.secondary)
            Spacer()
            Button {
                showingRecurrenceSheet = true
            } label: {
                HStack(spacing: 4) {
                    Image(systemName: "repeat")
                    Text(recurrenceSummary)
                        .lineLimit(1)
                }
            }
            .buttonStyle(.bordered)
            .controlSize(.small)
            .accessibilityIdentifier(AccessibilityIdentifier.Inspector.recurrenceEdit)
        }
        .accessibilityIdentifier(AccessibilityIdentifier.Inspector.recurrence)
    }

    private var dueDateRow: some View {
        let currentCivil = store.calendar.effectiveCivilDay(
            dueDate: task.due_date,
            dueDatetime: task.due_datetime
        )
        return HStack {
            Text("Due Date")
                .font(.subheadline)
                .foregroundStyle(.secondary)
            Spacer()
            if let currentCivil {
                DatePicker(
                    "Due",
                    selection: Binding(
                        get: {
                            ViewerCalendar.date(
                                fromCivil: currentCivil,
                                timeZone: store.calendar.timeZone
                            ) ?? store.calendar.instant
                        },
                        set: { selected in
                            let civil = ViewerCalendar.civilDateString(
                                for: selected,
                                timeZone: store.calendar.timeZone
                            )
                            store.patchTask(
                                id: task.id,
                                patch: FacetTaskPatch(dueDate: .set(civil))
                            )
                        }
                    ),
                    displayedComponents: [.date]
                )
                .environment(\.timeZone, store.calendar.timeZone)
                .labelsHidden()

                Button {
                    store.patchTask(
                        id: task.id,
                        patch: FacetTaskPatch(dueDate: .clear, dueDatetime: .clear)
                    )
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundStyle(.secondary)
                }
                .buttonStyle(.plain)
                .help("Clear due date")
            } else {
                HStack(spacing: 6) {
                    Button("Today") {
                        store.patchTask(
                            id: task.id,
                            patch: FacetTaskPatch(dueDate: .set(store.calendar.today))
                        )
                    }
                    Button("Tomorrow") {
                        store.patchTask(
                            id: task.id,
                            patch: FacetTaskPatch(dueDate: .set(store.calendar.addingDays(1)))
                        )
                    }
                }
                .controlSize(.small)
                .buttonStyle(.bordered)
            }
        }
        .accessibilityIdentifier(AccessibilityIdentifier.Inspector.due)
    }

    private var recurrenceSummary: String {
        guard let rule = task.recurrence_rule, !rule.isEmpty else {
            return "Does not repeat"
        }
        return FacetRecurrenceCodec.summary(for: rule)
    }
}
