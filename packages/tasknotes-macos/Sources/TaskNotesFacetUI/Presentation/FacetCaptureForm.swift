import Foundation
public import SwiftUI
import TaskNotesKit

/// Todoist-style Quick Add view shared across the macOS floating panel and capture sheets.
public struct FacetCaptureForm: View {
    private let store: FacetStore
    private let focusRequest: Int
    private let retainedPanel: Bool
    private let close: () -> Void
    private let expandedChanged: ((Bool) -> Void)?

    @State private var rawInput = ""
    @State private var descriptionText = ""
    @State private var showDetails = false
    @State private var selectedProjectOverride: String = ""
    @State private var selectedPriorityOverride: String = ""
    @FocusState private var titleFocused: Bool

    public init(
        store: FacetStore,
        focusRequest: Int = 0,
        retainedPanel: Bool = false,
        close: @escaping () -> Void,
        expandedChanged: ((Bool) -> Void)? = nil
    ) {
        self.store = store
        self.focusRequest = focusRequest
        self.retainedPanel = retainedPanel
        self.close = close
        self.expandedChanged = expandedChanged
    }

    private var parsedPreview: FacetParsedCapture {
        FacetQuickCaptureParser.parse(
            rawInput,
            projects: store.activeProjects,
            sections: store.activeSections,
            labels: store.activeLabels,
            defaultProjectId: selectedProjectOverride.isEmpty
                ? store.defaultProjectIdForCurrentDestination() : selectedProjectOverride,
            calendar: store.calendar
        )
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 10) {
                Image(systemName: "plus.circle.fill")
                    .font(.title2)
                    .foregroundStyle(FacetNativeStyle.brand)

                TextField(
                    "Task name — e.g. Pay rent tomorrow 9am #Personal @finance p1 every month",
                    text: $rawInput
                )
                .textFieldStyle(.plain)
                .font(.title3)
                .focused($titleFocused)
                .onSubmit { submitTask() }
                .accessibilityIdentifier(AccessibilityIdentifier.QuickAdd.field)
            }

            if !parsedPreview.chips.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        ForEach(parsedPreview.chips) { chip in
                            HStack(spacing: 4) {
                                Image(systemName: iconName(for: chip.kind))
                                Text(chip.text)
                            }
                            .font(.caption.weight(.medium))
                            .padding(.horizontal, 8)
                            .padding(.vertical, 4)
                            .background(.quaternary, in: .capsule)
                            .accessibilityIdentifier(
                                AccessibilityIdentifier.QuickAdd.mark(chip.text))
                        }
                    }
                }
                .accessibilityIdentifier(AccessibilityIdentifier.QuickAdd.preview)
            }

            if showDetails {
                TextField(
                    "Description (Markdown supported)", text: $descriptionText, axis: .vertical
                )
                .lineLimit(2...5)
                .textFieldStyle(.roundedBorder)

                HStack(spacing: 12) {
                    Picker("Project", selection: $selectedProjectOverride) {
                        Text("Auto (from input or view)").tag("")
                        ForEach(store.activeProjects) { project in
                            Text(project.name).tag(project.id)
                        }
                    }
                    .frame(maxWidth: 220)

                    Picker("Priority", selection: $selectedPriorityOverride) {
                        Text("Auto").tag("")
                        ForEach(Priority.allCases, id: \.self) { level in
                            Text(FacetNativeStyle.priorityTitle(level)).tag(level.rawValue)
                        }
                    }
                    .frame(maxWidth: 140)
                }
            }

            Divider()

            HStack {
                Button(showDetails ? "Hide Options" : "Options…") {
                    showDetails.toggle()
                    expandedChanged?(showDetails)
                }
                .buttonStyle(.borderless)
                .font(.caption)

                Text("Use #Project, @label, today/tomorrow, p1–p4, every week")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .accessibilityIdentifier(AccessibilityIdentifier.QuickAdd.hint)

                Spacer()

                Button("Cancel") {
                    resetIfRetained()
                    close()
                }
                .keyboardShortcut(.cancelAction)

                Button("Add Task") {
                    submitTask()
                }
                .buttonStyle(.borderedProminent)
                .disabled(parsedPreview.isEmpty)
                .keyboardShortcut(.defaultAction)
            }
        }
        .padding(16)
        .onAppear {
            titleFocused = true
        }
        .onChange(of: focusRequest) {
            titleFocused = true
        }
    }

    private func submitTask() {
        guard !parsedPreview.isEmpty else { return }
        let overrideProject = selectedProjectOverride.isEmpty ? nil : selectedProjectOverride
        let overridePriority = Priority(rawValue: selectedPriorityOverride)
        let created = store.createQuickTask(
            rawInput: rawInput,
            description: descriptionText,
            overrideProjectId: overrideProject,
            overridePriority: overridePriority
        )
        guard created != nil else { return }
        resetIfRetained()
        close()
    }

    private func resetIfRetained() {
        if retainedPanel {
            rawInput = ""
            descriptionText = ""
            selectedProjectOverride = ""
            selectedPriorityOverride = ""
            if showDetails {
                showDetails = false
                expandedChanged?(false)
            }
        }
    }

    private func iconName(for kind: FacetCaptureChip.Kind) -> String {
        switch kind {
        case .date: "calendar"
        case .recurrence: "repeat"
        case .priority: "flag.fill"
        case .project: "number"
        case .label: "at"
        }
    }
}
