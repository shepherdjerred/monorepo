import Foundation
import SwiftUI
import TaskNotesKit

internal struct FacetTaskInspectorView: View {
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    let task: Task
    let store: FacetStore
    var onClose: (() -> Void)?

    @State private var titleDraft: String
    @State private var descriptionDraft: String
    @State private var editingMarkdownSource = false
    @State private var expandedSubtasks = false
    @FocusState private var titleFocused: Bool
    @FocusState private var editingDescription: Bool
    @State private var showingRecurrenceSheet = false
    @State private var showingLabels = false
    @State private var showingSchedule = false

    init(task: Task, store: FacetStore, onClose: (() -> Void)? = nil) {
        self.task = task
        self.store = store
        self.onClose = onClose
        _titleDraft = State(initialValue: task.title)
        _descriptionDraft = State(initialValue: task.description)
        _expandedSubtasks = State(initialValue: !store.subtasks(of: task.id).isEmpty)
    }

    var body: some View {
        ScrollView {
            #if os(macOS)
                ViewThatFits(in: .horizontal) {
                    HStack(alignment: .top, spacing: 24) {
                        mainContent.frame(minWidth: 335, maxWidth: .infinity)
                        Divider()
                        taskProperties.frame(width: 265)
                    }
                    stackedContent
                }
                .padding(22)
            #else
                stackedContent.padding(20)
            #endif
        }
        .onDisappear {
            guard store.task(for: task.id) != nil else { return }
            commitTitleIfChanged()
            if editingMarkdownSource { commitDescriptionIfChanged() }
        }
        .onChange(of: task.id) { oldID, newID in
            guard store.localStore.resolvedID(oldID) != newID else { return }
            titleDraft = task.title
            descriptionDraft = task.description
            editingMarkdownSource = false
            expandedSubtasks = !store.subtasks(of: task.id).isEmpty
        }
        .onChange(of: task.title) {
            if !titleFocused && titleDraft != task.title {
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
        .sheet(isPresented: $showingLabels) {
            FacetInspectorLabelsSection(task: task, store: store)
                .presentationDetents([.medium, .large])
        }
        .accessibilityIdentifier(AccessibilityIdentifier.Inspector.panel)
    }

    private var stackedContent: some View {
        VStack(alignment: .leading, spacing: 18) {
            mainContent
            Divider()
            taskProperties
        }
    }

    private var mainContent: some View {
        VStack(alignment: .leading, spacing: 16) {
            headerSection
            descriptionSection
            DisclosureGroup(isExpanded: $expandedSubtasks) {
                FacetInspectorSubtasksSection(task: task, store: store)
            } label: {
                let children = store.subtasks(of: task.id)
                Label(
                    children.isEmpty ? "Add subtasks" : "Subtasks (\(children.count))",
                    systemImage: "checklist")
            }
            .font(.subheadline)
        }
    }

    private var taskProperties: some View {
        VStack(alignment: .leading, spacing: 14) {
            dueDateRow
            projectPickerRow
            sectionPickerRow
            priorityPickerRow
            labelsButton
            recurrenceRow
        }
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
            #if os(iOS)
                .frame(minWidth: 44, minHeight: 44)
            #endif
            .accessibilityLabel(task.completed ? "Reopen task" : "Complete task")

            TextField("Task title", text: $titleDraft, axis: .vertical)
                .font(.title2.bold())
                .focused($titleFocused)
                .onChange(of: titleFocused) { if !titleFocused { commitTitleIfChanged() } }
                .textFieldStyle(.plain)
                .onSubmit { commitTitleIfChanged() }
                .accessibilityIdentifier(AccessibilityIdentifier.Inspector.title)

            if titleDraft.trimmingCharacters(in: .whitespacesAndNewlines) != task.title {
                Button("Save") { commitTitleIfChanged() }
                    .controlSize(.small)
                    .buttonStyle(.borderedProminent)
            }
            Menu("More actions", systemImage: "ellipsis") {
                Button("Delete Task", systemImage: "trash", role: .destructive) {
                    store.deleteTask(task)
                    onClose?()
                }
                .accessibilityIdentifier(AccessibilityIdentifier.Inspector.deleteTask)
            }
            .labelStyle(.iconOnly)
            .fixedSize()
        }
    }

    private var descriptionSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            if editingMarkdownSource || !task.description.isEmpty {
                HStack {
                    Text("Description")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(.secondary)
                    Spacer()
                    Button(editingMarkdownSource ? "Done" : "Edit") {
                        if editingMarkdownSource {
                            commitDescriptionIfChanged()
                        }
                        editingMarkdownSource.toggle()
                        editingDescription = editingMarkdownSource
                    }
                    .controlSize(.small)
                    .buttonStyle(.borderless)
                    .accessibilityIdentifier(AccessibilityIdentifier.Inspector.detailsMode)
                }
            }

            if editingMarkdownSource {
                TextEditor(text: $descriptionDraft)
                    .focused($editingDescription)
                    .onAppear { editingDescription = true }
                    .font(.system(.body, design: .monospaced))
                    .frame(minHeight: 110)
                    .padding(6)
                    .background(.quinary, in: .rect(cornerRadius: 8))
                    .accessibilityIdentifier(AccessibilityIdentifier.Inspector.detailsSource)
            } else if task.description.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                Button("Add description", systemImage: "text.alignleft") {
                    editingMarkdownSource = true
                }
                .buttonStyle(.borderless)
                .foregroundStyle(.secondary)
                .accessibilityIdentifier(AccessibilityIdentifier.Inspector.detailsMode)
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
    private var labelsButton: some View {
        let names = task.label_ids.compactMap { store.label(for: $0)?.name }
        return Button {
            showingLabels = true
        } label: {
            Label(names.isEmpty ? "Add label" : names.joined(separator: ", "), systemImage: "tag")
                .multilineTextAlignment(.leading)
        }
        .buttonStyle(.borderless)
        .accessibilityIdentifier(AccessibilityIdentifier.Inspector.labels)
    }
    private var projectPickerRow: some View {
        propertyRow("Project") {
            Picker(
                "Project",
                selection: Binding(
                    get: {
                        task.project_id.isEmpty ? store.inboxProject?.id ?? "" : task.project_id
                    },
                    set: { newProjId in
                        store.patchTask(
                            id: task.id,
                            patch: FacetTaskPatch(projectId: newProjId, sectionId: .clear)
                        )
                    }
                )
            ) {
                if store.inboxProject == nil { Text("Inbox").tag("") }
                ForEach(store.activeProjects) { proj in
                    Text(proj.name).tag(proj.id)
                }
            }
            .labelsHidden()
            .frame(
                maxWidth: dynamicTypeSize.isAccessibilitySize ? .infinity : 180,
                alignment: dynamicTypeSize.isAccessibilitySize ? .leading : .trailing
            )
            .accessibilityIdentifier(AccessibilityIdentifier.Inspector.project)
        }
    }

    @ViewBuilder
    private var sectionPickerRow: some View {
        let availableSections = store.sections(in: task.project_id)
        if !availableSections.isEmpty {
            propertyRow("Section") {
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
                .frame(
                    maxWidth: dynamicTypeSize.isAccessibilitySize ? .infinity : 180,
                    alignment: dynamicTypeSize.isAccessibilitySize ? .leading : .trailing
                )
                .accessibilityIdentifier(AccessibilityIdentifier.Inspector.section)
            }
        }
    }

    private var priorityPickerRow: some View {
        propertyRow("Priority") {
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
                    Text(level == .p4 ? "None" : FacetNativeStyle.priorityFullTitle(level)).tag(
                        level)
                }
            }
            .pickerStyle(.menu)
            .labelsHidden()
            .accessibilityIdentifier(AccessibilityIdentifier.Inspector.priority)
        }
    }

    private var recurrenceRow: some View {
        Button {
            showingRecurrenceSheet = true
        } label: {
            Label(recurrenceSummary, systemImage: "repeat")
                .multilineTextAlignment(.leading)
        }
        .buttonStyle(.borderless)
        .accessibilityIdentifier(AccessibilityIdentifier.Inspector.recurrenceEdit)
    }

    private var dueDateRow: some View {
        propertyRow("Date") {
            Button {
                showingSchedule = true
            } label: {
                Label(scheduleTitle, systemImage: "calendar")
                    .multilineTextAlignment(.leading)
            }
            .buttonStyle(.borderless)
            .accessibilityIdentifier(AccessibilityIdentifier.Inspector.due)
            .popover(isPresented: $showingSchedule) {
                FacetSchedulePopoverView(task: task, store: store) { showingSchedule = false }
            }
        }
    }

    private var scheduleTitle: String {
        let zone = store.calendar.timeZone
        if let timestamp = task.due_datetime, let date = ViewerCalendar.parseISO8601(timestamp) {
            return date.formatted(
                Date.FormatStyle(date: .abbreviated, time: .shortened, timeZone: zone))
        }
        if let civil = task.due_date,
            let date = ViewerCalendar.date(fromCivil: civil, timeZone: zone)
        {
            return date.formatted(
                Date.FormatStyle(date: .abbreviated, time: .omitted, timeZone: zone))
        }
        return "Add date"
    }

    private func propertyRow<Content: View>(_ title: String, @ViewBuilder control: () -> Content)
        -> some View
    {
        let stacked = dynamicTypeSize.isAccessibilitySize
        let layout =
            stacked
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 4)) : AnyLayout(HStackLayout())
        return layout {
            Text(title).font(.subheadline).foregroundStyle(.secondary)
            if !stacked { Spacer() }
            control()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var recurrenceSummary: String {
        guard let rule = task.recurrence_rule, !rule.isEmpty else {
            return "Add repeat"
        }
        return FacetRecurrenceCodec.summary(for: rule)
    }
}
