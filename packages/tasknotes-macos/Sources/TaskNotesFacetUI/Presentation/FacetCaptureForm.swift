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

    @State private var draft = CaptureDraft()
    @State private var keyboardRequest = 0
    @State private var contentHeight: CGFloat = 210
    @State private var pendingSave: PendingCapture?
    @State private var saving = false
    @State private var saveError: String?
    @State private var lastCaptureReceipt: String?
    @Environment(\.dynamicTypeSize) private var textSize

    private var stackControls: Bool {
        #if os(iOS)
            textSize.isAccessibilitySize
        #else
            false
        #endif
    }

    private var controlsLayout: AnyLayout {
        stackControls
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 10))
            : AnyLayout(HStackLayout(spacing: 12))
    }

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
            draft.rawInput,
            projects: store.activeProjects,
            sections: store.activeSections,
            labels: store.activeLabels,
            defaultProjectId: draft.selectedProjectOverride.isEmpty
                ? store.defaultProjectIdForCurrentDestination(store.captureDestination)
                : draft.selectedProjectOverride,
            calendar: store.calendar,
            defaultDueDate: store.defaultDueDateForCurrentDestination(store.captureDestination),
            literalTokens: draft.literalTokens
        )
    }

    public var body: some View {
        #if os(iOS)
            ScrollView {
                formContent.onGeometryChange(for: CGFloat.self) {
                    ceil($0.size.height)
                } action: { height in
                    if height > 0 { contentHeight = height }
                }
            }
            .scrollDismissesKeyboard(.interactively)
            .presentationDetents([.height(contentHeight + 8)])
        #else
            formContent
        #endif
    }

    private var formContent: some View {
        let preview = parsedPreview
        return VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Quick Add").font(.headline)
                Spacer()
                Button("Done") {
                    resetDraft()
                    close()
                }
                .disabled(saving)
                .accessibilityIdentifier("facet.quickAdd.close")
                .keyboardShortcut(.cancelAction)
            }
            FacetCaptureTitleField(
                text: $draft.rawInput, tokens: preview.tokens, focusRequest: keyboardRequest,
                makeLiteral: { draft.literalTokens.insert($0) }, submit: submitTask
            )
            #if os(iOS)
                .fixedSize(horizontal: false, vertical: true)
                .frame(minHeight: 46)
            #else
                .frame(height: 30)
            #endif
            .disabled(saveError != nil)

            if !preview.chips.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        ForEach(Array(preview.chips.enumerated()), id: \.offset) { _, chip in
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

            if !preview.tokens.isEmpty || !draft.literalTokens.isEmpty {
                Menu("Edit recognized words") {
                    ForEach(preview.tokens, id: \.self) { token in
                        Button("Keep “\(token.text)” in title") {
                            draft.literalTokens.insert(token)
                        }
                    }
                    ForEach(
                        draft.literalTokens.sorted { $0.range.location < $1.range.location },
                        id: \.self
                    ) { token in
                        Button("Recognize “\(token.text)”") { draft.literalTokens.remove(token) }
                    }
                }
                .font(.caption)
                .accessibilityIdentifier("facet.quickAdd.editTokens")
            }

            if draft.showDetails {
                TextField(
                    "Description (Markdown supported)", text: $draft.descriptionText,
                    axis: .vertical
                )
                .lineLimit(2...5)
                .textFieldStyle(.roundedBorder)

                controlsLayout {
                    Picker("Project", selection: $draft.selectedProjectOverride) {
                        Text("Auto (from input or view)").tag("")
                        ForEach(store.activeProjects) { project in
                            Text(project.name).tag(project.id)
                        }
                    }
                    .frame(maxWidth: stackControls ? .infinity : 220, alignment: .leading)

                    Picker("Priority", selection: $draft.selectedPriorityOverride) {
                        Text("Auto").tag("")
                        ForEach(Priority.allCases, id: \.self) { level in
                            Text(FacetNativeStyle.priorityTitle(level)).tag(level.rawValue)
                        }
                    }
                    .frame(maxWidth: stackControls ? .infinity : 140, alignment: .leading)
                }
            }

            Divider()

            controlsLayout {
                Button(draft.showDetails ? "Hide Options" : "Options…") {
                    draft.showDetails.toggle()
                    expandedChanged?(draft.showDetails)
                }
                .buttonStyle(.borderless)
                .font(.caption)

                if !stackControls { Spacer() }

                Button(action: submitTask) {
                    Text(saveError == nil ? "Add Task" : "Retry save")
                        .frame(maxWidth: stackControls ? .infinity : nil)
                }
                .buttonStyle(.borderedProminent)
                .disabled((pendingSave == nil && preview.isEmpty) || saving)
                .keyboardShortcut(.defaultAction)
            }
            if let saveError { Text(saveError).font(.caption).foregroundStyle(.red) }
            #if os(iOS)
                if let lastCaptureReceipt, lastCaptureReceipt == store.toastReceiptID {
                    FacetUndoNotice(store: store)
                }
            #endif
        }
        .padding(20)
        #if os(iOS)
            .frame(maxWidth: .infinity, alignment: .topLeading)
            .tint(FacetNativeStyle.brand)
        #endif
        .onDisappear {
            if !retainedPanel {
                store.captureSectionId = nil
                store.captureDestination = nil
            }
        }
        .onChange(of: draft.rawInput) { old, new in
            draft.literalTokens = FacetCaptureToken.reposition(
                draft.literalTokens, afterEditing: old, to: new)
        }
        .onChange(of: focusRequest) {
            keyboardRequest += 1
        }
    }

    private func submitTask() {
        guard !saving else { return }
        if pendingSave == nil {
            let parsed = parsedPreview
            guard !parsed.isEmpty,
                store.createQuickTask(
                    rawInput: draft.rawInput,
                    description: draft.descriptionText,
                    overrideProjectId: draft.selectedProjectOverride.isEmpty
                        ? nil : draft.selectedProjectOverride,
                    overrideSectionId: store.captureSectionId,
                    overridePriority: Priority(rawValue: draft.selectedPriorityOverride),
                    prepared: parsed
                ) != nil
            else { return }
            pendingSave = PendingCapture(draft: draft, receipt: store.toastReceiptID)
        }
        guard let submission = pendingSave else { return }
        saving = true
        _Concurrency.Task { @MainActor in
            defer { saving = false }
            do {
                try await store.localStore.flushPersistence()
                pendingSave = nil
                saveError = nil
                lastCaptureReceipt = submission.receipt
                guard draft == submission.draft else { return }
                resetDraft()
                #if os(iOS)
                    keyboardRequest += 1
                #else
                    close()
                #endif
            } catch {
                saveError = error.localizedDescription
            }
        }
    }

    private func resetDraft() {
        if draft.showDetails { expandedChanged?(false) }
        draft = CaptureDraft()
        pendingSave = nil
        saveError = nil
    }
}

private struct CaptureDraft: Equatable {
    var rawInput = ""
    var descriptionText = ""
    var showDetails = false
    var selectedProjectOverride = ""
    var selectedPriorityOverride = ""
    var literalTokens = Set<FacetCaptureToken>()
}

private struct PendingCapture {
    let draft: CaptureDraft
    let receipt: String?
}

extension FacetCaptureForm {
    fileprivate func iconName(for kind: FacetCaptureChip.Kind) -> String {
        switch kind {
        case .date: "calendar"
        case .deadline: "calendar.badge.exclamationmark"
        case .recurrence: "repeat"
        case .priority: "flag.fill"
        case .project: "number"
        case .label: "at"
        }
    }
}
