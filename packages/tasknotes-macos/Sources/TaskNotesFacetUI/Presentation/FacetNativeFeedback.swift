import Foundation
import Observation
import TaskNotesKit

#if os(iOS)
    import AVFAudio
    import UIKit
#endif

/// A local user preference preserves the retained mobile default without a server.
@Observable @MainActor internal final class FacetNativeFeedback {
    static let shared = FacetNativeFeedback()
    private let defaults: UserDefaults
    private let key = "Facet.feedback.preference"
    private(set) var enabled = true
    private(set) var error: String?
    #if os(iOS)
        private var players: [String: AVAudioPlayer] = [:]
    #endif

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        guard defaults.object(forKey: key) != nil else { return }
        do {
            guard let data = defaults.data(forKey: key) else {
                throw FacetContractError.unsupportedResponse
            }
            enabled = try FacetFeedbackPreference.decode(data).enabled
        } catch {
            enabled = false
            self.error =
                "The saved feedback preference is invalid. Reset it in Settings before enabling sounds and haptics."
        }
    }
    func setEnabled(_ value: Bool) {
        do {
            defaults.set(
                try JSONEncoder().encode(FacetFeedbackPreference(enabled: value)), forKey: key)
            enabled = value
            error = nil
        } catch {
            self.error = "The feedback preference could not be saved: \(error.localizedDescription)"
        }
    }
    func applied(_ command: [String: FacetValue]) {
        #if os(iOS)
            guard enabled else { return }
            guard let effect = effect(command) else { return }
            UINotificationFeedbackGenerator().notificationOccurred(effect.feedback)
            do {
                // Ambient playback obeys the hardware silent switch and system audio policy.
                try AVAudioSession.sharedInstance().setCategory(
                    .ambient, mode: .default, options: [.mixWithOthers])
                let player = try player(for: effect.sound)
                player.stop()
                player.currentTime = 0
                guard player.play() else { throw FacetContractError.unsupportedResponse }
            } catch {
                self.error =
                    "The task was saved, but native audio feedback could not play. Check the device audio settings."
            }
        #endif
    }

    static func soundURL(for sound: String) -> URL {
        guard let url = Bundle.module.url(forResource: sound, withExtension: "wav") else {
            preconditionFailure("The required retained feedback sound is missing: \(sound)")
        }
        return url
    }

    #if os(iOS)
        private func effect(_ command: [String: FacetValue])
            -> (sound: String, feedback: UINotificationFeedbackGenerator.FeedbackType)?
        {
            switch command["kind"]?.text {
            case "create": return ("create", .success)
            case "delete_checked": return ("delete", .warning)
            case "set_completion":
                if command["completed"] == .bool(true) { return ("complete", .success) }
                UIImpactFeedbackGenerator(style: .light).impactOccurred()
                return nil
            case .some, .none: return nil
            }
        }

        private func player(for sound: String) throws -> AVAudioPlayer {
            if let existing = players[sound] { return existing }
            let loaded = try AVAudioPlayer(contentsOf: Self.soundURL(for: sound))
            players[sound] = loaded
            return loaded
        }
    #endif
}
