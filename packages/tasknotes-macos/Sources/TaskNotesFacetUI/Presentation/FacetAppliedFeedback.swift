import Foundation
import SwiftUI
import TaskNotesKit

internal struct FacetAppliedFeedback: Hashable {
    let profileID: String
    let mutationID: String
    let event: FacetFeedbackEvent?
    init(profileID: String, mutationID: String) {
        self.profileID = profileID
        self.mutationID = mutationID
        event = nil
    }
    init(event: FacetFeedbackEvent) {
        self.event = event
        profileID = event.profileID
        mutationID = event.mutationID
    }
    var message: String { event?.message ?? "Saved" }
}

internal struct FacetAppliedFeedbackView: View {
    let store: FacetStore
    let profileID: String
    @State private var available: FacetAppliedFeedback?
    @State private var isUndoing = false
    @State private var hovering = false
    @State private var lifetime = FacetFeedbackLifetime()
    private enum Focus: Hashable { case undo, dismiss }
    @FocusState private var keyboardFocus: Focus?
    @AccessibilityFocusState private var accessibilityFocus: Focus?
    @Environment(\.facetFeedbackOrigin) private var origin
    @Environment(\.accessibilityReduceMotion) private var reducedMotion
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    private struct TimerIdentity: Hashable {
        let feedback: FacetAppliedFeedback?
        let paused: Bool
    }
    private var paused: Bool {
        hovering || keyboardFocus != nil || accessibilityFocus != nil || isUndoing
    }
    private var current: FacetAppliedFeedback? {
        guard let feedback = store.appliedFeedback, feedback.profileID == profileID,
            feedback.event?.origin == nil || feedback.event?.origin == origin
        else { return nil }
        return feedback
    }
    var body: some View {
        Group {
            if let feedback = current {
                Group {
                    if dynamicTypeSize.isAccessibilitySize {
                        VStack(alignment: .leading, spacing: 12) {
                            Label(feedback.message, systemImage: "checkmark.circle.fill")
                                .fixedSize(horizontal: false, vertical: true)
                            HStack {
                                Spacer()
                                actions(feedback)
                            }
                        }
                    } else {
                        HStack {
                            Label(feedback.message, systemImage: "checkmark.circle.fill")
                            Spacer()
                            actions(feedback)
                        }
                    }
                }.padding().background(.regularMaterial, in: RoundedRectangle(cornerRadius: 14))
                    .padding(.horizontal)
                    .onHover { hovering = $0 }
                    .accessibilityElement(children: .contain)
                    .transition(
                        reducedMotion
                            ? AnyTransition(OpacityTransition())
                            : AnyTransition(
                                MoveTransition(edge: .bottom).combined(with: OpacityTransition())))
            }
        }
        .animation(
            reducedMotion
                ? nil
                : .easeOut(duration: FacetNativeStyle.tokens.motion.milliseconds.toastEnter / 1000),
            value: current
        )
        .task(id: current) {
            available = nil
            guard let feedback = current else { return }
            AccessibilityNotification.Announcement(feedback.message).post()
            guard
                let value = await store.readFeature(
                    ["kind": .string("undo_available")], profileID: profileID)
            else { return }
            do {
                let result = try FacetFeatureProjection.decode(FacetUndoAvailable.self, from: value)
                if result.canUndo, result.receiptId == feedback.mutationID,
                    store.appliedFeedback == feedback
                {
                    available = feedback
                }
            } catch { store.reportNativeFailure(error) }
        }
        .task(id: TimerIdentity(feedback: current, paused: paused)) {
            guard let feedback = current else { return }
            lifetime.select(feedback.mutationID)
            if paused {
                lifetime.pause()
                return
            }
            let duration = lifetime.resume()
            do { try await _Concurrency.Task.sleep(for: duration) } catch { return }
            if current == feedback, !paused { store.clearSavedNotice() }
        }
    }

    @ViewBuilder private func actions(_ feedback: FacetAppliedFeedback) -> some View {
        if available == feedback {
            Button("Undo") { undo(feedback) }.disabled(isUndoing).focused(
                $keyboardFocus, equals: .undo
            )
            .accessibilityFocused($accessibilityFocus, equals: .undo)
        }
        Button("Dismiss", systemImage: "xmark") { store.clearSavedNotice() }
            .labelStyle(.iconOnly)
            .focused($keyboardFocus, equals: .dismiss)
            .accessibilityFocused($accessibilityFocus, equals: .dismiss)
    }

    private func undo(_ feedback: FacetAppliedFeedback) {
        guard !isUndoing, available == feedback, store.appliedFeedback == feedback else { return }
        isUndoing = true
        let intent = store.feedbackIntent(origin: origin)
        _Concurrency.Task {
            _ = await FacetFeedbackContext.$intent.withValue(intent) {
                await store.perform(
                    ["kind": .string("undo"), "receiptId": .string(feedback.mutationID)],
                    profileID: profileID)
            }
            isUndoing = false
        }
    }
}
