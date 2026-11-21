import Foundation
import SwiftUI
import TaskNotesKit

internal struct FacetTaskInspectorView: View {
    @Environment(\.dynamicTypeSize) var dynamicTypeSize
    let task: Task
    let store: FacetStore
    var onClose: (() -> Void)?

    @State private var titleDraft: String
    @State private var descriptionDraft: String
    @State private var editingMarkdownSource = false
    @State private var expandedSubtasks = false
    @FocusState private var titleFocused: Bool
    @FocusState private var editingDescription: Bool
    @State var showingRecurrenceSheet = false
    @State var showingLabels = false
    @State var showingSchedule = false
    #if os(iOS)
        private static let previewHeight = PresentationDetent.fraction(0.68)
        @State private var detailHeight = Self.previewHeight
    #endif

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
                VStack(alignment: .leading, spacing: 16) {
                    VStack(alignment: .leading, spacing: 10) {
                        headerSection
                        descriptionSection
                        projectPickerRow
                        sectionPickerRow
                        dueDateRow
                        if dynamicTypeSize.isAccessibilitySize {
                            priorityPickerRow
                            labelsButton
                            recurrenceRow
                            deadlineControl
                        } else {
                            ScrollView(.horizontal, showsIndicators: false) {
                                HStack(spacing: 8) {
                                    priorityChip
                                    labelsButton
                                    recurrenceRow
                                    deadlineControl
                                }
                                .buttonStyle(.bordered)
                                .font(.subheadline)
                            }
                        }
                    }
                    .padding(14)
                    .background(.background, in: .rect(cornerRadius: 14))
                    subtasksSection
                    FacetTaskCommentsView(task: task, store: store)
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
            #endif
        }
        #if os(iOS)
            .background(Color(.systemGroupedBackground))
            .presentationDetents(
                dynamicTypeSize.isAccessibilitySize ? [.large] : [Self.previewHeight, .large],
                selection: $detailHeight
            )
            .presentationDragIndicator(.visible)
            .onChange(of: titleFocused || editingMarkdownSource || expandedSubtasks) {
                if titleFocused || editingMarkdownSource || expandedSubtasks {
                    detailHeight = .large
                }
            }
        #endif
        .tint(FacetNativeStyle.brand)
        .safeAreaInset(edge: .bottom, spacing: 0) {
            FacetCommentComposer(task: task, store: store)
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
                basis: task.recurrence_basis ?? .scheduled,
                onApply: { rule, basis in
                    store.patchTask(
                        id: task.id,
                        patch: FacetTaskPatch(recurrenceBasis: basis, recurrenceRule: .set(rule))
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
            subtasksSection
            FacetTaskCommentsView(task: task, store: store)
        }
    }

    private var subtasksSection: some View {
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

    private var taskProperties: some View {
        VStack(alignment: .leading, spacing: 14) {
            dueDateRow
            projectPickerRow
            sectionPickerRow
            priorityPickerRow
            labelsButton
            recurrenceRow
            deadlineControl
        }
    }
}

extension FacetTaskInspectorView {
    fileprivate var headerSection: some View {
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
                    .tint(FacetNativeStyle.actionFill)
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

    fileprivate var descriptionSection: some View {
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
