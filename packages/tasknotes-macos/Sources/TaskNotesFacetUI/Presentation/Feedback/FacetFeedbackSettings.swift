public import SwiftUI

public struct FacetFeedbackSettings: View {
    private let feedback: FacetNativeFeedback
    public init() { feedback = .shared }
    internal init(feedback: FacetNativeFeedback) { self.feedback = feedback }
    public var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Toggle(
                "Task sounds",
                isOn: Binding(
                    get: { feedback.sounds },
                    set: { feedback.setSounds($0) }))
            #if os(iOS)
                Toggle(
                    "Haptics",
                    isOn: Binding(
                        get: { feedback.haptics },
                        set: { feedback.setHaptics($0) }))
            #endif
            Button("Preview task sound", systemImage: "speaker.wave.2") {
                feedback.preview()
            }.disabled(!feedback.sounds)
            Text(
                "Short sounds confirm task actions. Device mute and volume still apply; reminder sounds are separate."
            )
            .font(.caption).foregroundStyle(.secondary)
            if let error = feedback.error {
                Label(error, systemImage: "exclamationmark.triangle")
                Button("Reset feedback preference") { feedback.reset() }
            }
        }
    }
}
