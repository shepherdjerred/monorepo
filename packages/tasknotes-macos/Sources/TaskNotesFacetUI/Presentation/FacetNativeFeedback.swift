import AVFAudio
import Foundation
import Observation
import TaskNotesKit

#if os(iOS)
    import UIKit
#endif

/// A local user preference preserves the retained mobile default without a server.
@Observable @MainActor internal final class FacetNativeFeedback {
    static let shared = FacetNativeFeedback()
    private let defaults: UserDefaults
    private let key = "Facet.feedback.preference"
    private(set) var sounds = true
    #if os(iOS)
        private(set) var haptics = true
        private let success = UINotificationFeedbackGenerator()
        private let impact = UIImpactFeedbackGenerator(style: .light)
    #else
        private(set) var haptics = false
    #endif
    private(set) var error: String?
    @ObservationIgnored private var players: [String: AVAudioPlayer] = [:]
    @ObservationIgnored private var consumed: Set<ReceiptKey> = []
    @ObservationIgnored private var scenes: [UUID: UUID] = [:]
    @ObservationIgnored private let sink: ((FacetFeedbackEvent) -> Void)?
    @ObservationIgnored private var interruption: (any NSObjectProtocol)?
    private var attemptGate = FacetFeedbackAttemptGate()
    private static let palette: FacetFeedbackPolicy.Palette = {
        do {
            guard let url = Bundle.module.url(forResource: "palette", withExtension: "json") else {
                throw FacetContractError.unsupportedResponse
            }
            return try FacetFeedbackPolicy.palette(data: Data(contentsOf: url))
        } catch { preconditionFailure("The feedback palette is invalid: \(error)") }
    }()
    private struct ReceiptKey: Hashable {
        let session: UUID
        let profile: String
        let mutation: String
    }

    init(defaults: UserDefaults = .standard, sink: ((FacetFeedbackEvent) -> Void)? = nil) {
        self.defaults = defaults
        self.sink = sink
        sounds = FacetFeedbackPolicy.shared.defaults.sounds
        #if os(iOS)
            haptics = FacetFeedbackPolicy.shared.defaults.mobileHaptics
        #else
            haptics = FacetFeedbackPolicy.shared.defaults.desktopHaptics
        #endif
        guard defaults.object(forKey: key) != nil else { return }
        do {
            guard let data = defaults.data(forKey: key) else {
                throw FacetContractError.unsupportedResponse
            }
            let preference = try FacetFeedbackPreference.decode(data)
            sounds = preference.sounds
            haptics = preference.haptics
            defaults.set(try JSONEncoder().encode(preference), forKey: key)
        } catch {
            sounds = false
            haptics = false
            self.error =
                "The saved feedback preference is invalid. Reset it in Settings before enabling sounds and haptics."
        }
    }
    func setSounds(_ value: Bool) { save(sounds: value, haptics: haptics) }
    func setHaptics(_ value: Bool) { save(sounds: sounds, haptics: value) }
    func reset() {
        #if os(iOS)
            save(sounds: true, haptics: true)
        #else
            save(sounds: true, haptics: false)
        #endif
    }
    private func save(sounds: Bool, haptics: Bool) {
        do {
            defaults.set(
                try JSONEncoder().encode(FacetFeedbackPreference(sounds: sounds, haptics: haptics)),
                forKey: key)
            self.sounds = sounds
            self.haptics = haptics
            if !sounds { stopAudio() } else if !scenes.isEmpty { preload() }
            error = nil
        } catch {
            self.error = "The feedback preference could not be saved: \(error.localizedDescription)"
        }
    }
    func setScene(_ origin: FacetFeedbackOrigin, active: Bool) {
        if active {
            if scenes[origin.id] == nil { scenes[origin.id] = UUID() }
        } else {
            scenes[origin.id] = nil
        }
        if scenes.isEmpty {
            stopAudio()
            if let interruption { NotificationCenter.default.removeObserver(interruption) }
            interruption = nil
        } else if active, sink == nil {
            preload()
            #if os(iOS)
                if interruption == nil {
                    interruption = NotificationCenter.default.addObserver(
                        forName: AVAudioSession.interruptionNotification, object: nil, queue: .main
                    ) { [weak self] _ in
                        _Concurrency.Task { @MainActor [weak self] in self?.stopAudio() }
                    }
                }
            #endif
        }
    }
    func isActive(_ origin: FacetFeedbackOrigin?) -> Bool {
        guard let origin else { return false }
        return scenes[origin.id] != nil
    }
    func activation(for origin: FacetFeedbackOrigin?) -> UUID? {
        guard let origin else { return nil }
        return scenes[origin.id]
    }
    func prepare() {
        #if os(iOS)
            if haptics {
                success.prepare()
                impact.prepare()
            }
        #endif
    }
    @discardableResult func applied(_ event: FacetFeedbackEvent, ownsPresentation: Bool) -> Bool {
        let receiptKey = ReceiptKey(
            session: event.sessionID, profile: event.profileID, mutation: event.mutationID)
        guard consumed.insert(receiptKey).inserted else { return false }
        guard ownsPresentation, let owner = event.origin, let activationID = event.activationID,
            scenes[owner.id] == activationID, !event.noOp
        else { return false }
        sink?(event)
        if sink == nil { deliver(event.action) }
        return true
    }
    func preview() {
        guard sounds else { return }
        play("complete")
    }
    private func deliver(_ action: FacetFeedbackAction) {
        // Rapid outcomes remain visible individually; overlapping sensory cues are consumed quietly.
        guard !players.values.contains(where: \.isPlaying) else { return }
        guard let effect = FacetFeedbackPolicy.shared.events[action.rawValue] else {
            preconditionFailure("The feedback policy has no event: \(action.rawValue)")
        }
        guard let sound = effect.sound, let cue = Self.palette.cues[sound] else {
            if effect.sound == nil, effect.haptic == "none" { return }
            preconditionFailure("The feedback palette is missing its cue: \(action.rawValue)")
        }
        #if os(iOS)
            let physicalEnabled = sounds || haptics
        #else
            let physicalEnabled = sounds
        #endif
        guard physicalEnabled, attemptGate.claim(duration: .milliseconds(cue.milliseconds)) else {
            return
        }
        #if os(iOS)
            if haptics {
                deliverHaptic(effect.haptic)
            }
        #endif
        if sounds { play(sound) }
    }
    #if os(iOS)
        private func deliverHaptic(_ haptic: String) {
            if haptic == "success" {
                success.notificationOccurred(.success)
            } else if haptic == "light" {
                impact.impactOccurred()
            } else if haptic != "none" {
                preconditionFailure("Unsupported feedback haptic: \(haptic)")
            }
        }
    #endif

    static func soundURL(for sound: String) -> URL {
        guard let url = Bundle.module.url(forResource: sound, withExtension: "wav") else {
            preconditionFailure("The required feedback sound is missing: \(sound)")
        }
        return url
    }

    private func play(_ sound: String) {
        guard !players.values.contains(where: \.isPlaying) else { return }
        do {
            #if os(iOS)
                try AVAudioSession.sharedInstance().setCategory(
                    .ambient, mode: .default, options: [.mixWithOthers])
            #endif
            let player: AVAudioPlayer
            if let existing = players[sound] {
                player = existing
            } else {
                player = try AVAudioPlayer(contentsOf: Self.soundURL(for: sound))
                player.prepareToPlay()
                players[sound] = player
            }
            player.currentTime = 0
            guard player.play() else { throw FacetContractError.unsupportedResponse }
            error = nil
        } catch {
            self.error =
                "The task was saved, but its sound could not play. Check the device audio settings."
        }
    }
    private func preload() {
        guard sounds else { return }
        do {
            for sound in ["create", "complete", "delete", "reverse"] where players[sound] == nil {
                let player = try AVAudioPlayer(contentsOf: Self.soundURL(for: sound))
                player.prepareToPlay()
                players[sound] = player
            }
        } catch { self.error = "Task sounds could not be prepared: \(error.localizedDescription)" }
    }
    private func stopAudio() {
        for player in players.values { player.stop() }
        players.removeAll()
    }
}
