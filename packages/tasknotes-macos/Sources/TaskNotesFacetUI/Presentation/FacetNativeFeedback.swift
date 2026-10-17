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
    @ObservationIgnored private let audio = FacetNativeAudioPlayer()
    @ObservationIgnored private let audioPermission = FacetAudioPermission()
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
        audioPermission.setScene(origin.id, activation: scenes[origin.id])
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
        if sink == nil { deliver(event) }
        return true
    }
    func preview() {
        guard sounds else { return }
        let generation = audioPermission.generation
        _Concurrency.Task {
            guard sounds, audioPermission.allows(generation) else { return }
            _ = await play("complete")
        }
    }
    private func deliver(_ event: FacetFeedbackEvent) {
        // Rapid outcomes remain visible individually; overlapping sensory cues are consumed quietly.
        guard let effect = FacetFeedbackPolicy.shared.events[event.action.rawValue] else {
            preconditionFailure("The feedback policy has no event: \(event.action.rawValue)")
        }
        guard let sound = effect.sound, let cue = Self.palette.cues[sound] else {
            if effect.sound == nil, effect.haptic == "none" { return }
            preconditionFailure("The feedback palette is missing its cue: \(event.action.rawValue)")
        }
        #if os(iOS)
            let physicalEnabled = sounds || haptics
        #else
            let physicalEnabled = sounds
        #endif
        guard physicalEnabled, attemptGate.claim(duration: .milliseconds(cue.milliseconds)) else {
            return
        }
        guard let origin = event.origin, let activation = event.activationID else { return }
        let owner = FacetAudioPermission.Owner(id: origin.id, activation: activation)
        let generation = audioPermission.generation
        let soundEnabled = sounds
        let hapticEnabled = haptics
        _Concurrency.Task {
            await FacetSensoryDelivery.deliver(
                soundEnabled: soundEnabled,
                audio: { await self.play(sound, owner: owner) },
                current: { self.audioPermission.allows(generation, owner: owner) },
                haptic: {
                    #if os(iOS)
                        if hapticEnabled { self.deliverHaptic(effect.haptic) }
                    #else
                        _ = hapticEnabled
                    #endif
                })
        }
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
}

extension FacetNativeFeedback {
    static func soundURL(for sound: String) -> URL {
        guard let url = Bundle.module.url(forResource: sound, withExtension: "wav") else {
            preconditionFailure("The required feedback sound is missing: \(sound)")
        }
        return url
    }

    private func play(_ sound: String, owner: FacetAudioPermission.Owner? = nil) async -> Bool {
        let generation = audioPermission.generation
        let url = Self.soundURL(for: sound)
        do {
            let played = try await audio.play(
                sound, url: url, generation: generation, permission: audioPermission, owner: owner)
            if played, audioPermission.allows(generation, owner: owner) { error = nil }
            return played
        } catch {
            guard audioPermission.allows(generation, owner: owner) else { return false }
            self.error =
                "The task was saved, but its sound could not play. Check the device audio settings."
            return false
        }
    }
    private func preload() {
        guard sounds else { return }
        let generation = audioPermission.generation
        let urls = Dictionary(
            uniqueKeysWithValues: ["create", "complete", "delete", "reverse"].map {
                ($0, Self.soundURL(for: $0))
            })
        _Concurrency.Task {
            do {
                try await audio.preload(urls, generation: generation, permission: audioPermission)
            } catch {
                guard audioPermission.allows(generation) else { return }
                self.error = "Task sounds could not be prepared. Check the device audio settings."
            }
        }
    }
    private func stopAudio() {
        audioPermission.invalidate()
        let generation = audioPermission.generation
        _Concurrency.Task { await audio.stop(before: generation) }
    }
}
