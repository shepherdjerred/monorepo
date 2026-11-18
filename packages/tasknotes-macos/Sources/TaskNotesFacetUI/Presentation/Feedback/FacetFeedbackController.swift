public import Foundation
import OSLog
public import Observation
import SwiftUI
import TaskNotesKit

#if os(macOS)
    import AppKit
#else
    import UIKit
#endif

public enum FacetFeedbackEvent: String, Sendable {
    case created
    case completed
    case deleted
    case reopened
    case undone
    case saved
}

@Observable
@MainActor
public final class FacetFeedbackController {
    private static let preferenceKey = "Facet.feedback.preference"
    private static let logger = Logger(subsystem: "red.sjer.facet", category: "Feedback")

    public private(set) var soundsEnabled: Bool
    public private(set) var hapticsEnabled: Bool
    public private(set) var preferenceError: String?

    private let defaults: UserDefaults
    private let policy = FacetFeedbackPolicy.shared
    private let permission = FacetAudioPermission()
    private let audioPlayer = FacetNativeAudioPlayer()
    private let soundURLs: [String: URL]
    private let enabledForLaunch: Bool

    public init(defaults: UserDefaults = .standard, enabledForLaunch: Bool = true) {
        self.defaults = defaults
        self.enabledForLaunch = enabledForLaunch

        #if os(macOS)
            let defaultHaptics = policy.defaults.desktopHaptics
        #else
            let defaultHaptics = policy.defaults.mobileHaptics
        #endif
        let defaultSounds = policy.defaults.sounds

        if let rawData = defaults.data(forKey: Self.preferenceKey) {
            do {
                let decoded = try FacetFeedbackPreference.decode(rawData)
                soundsEnabled = decoded.sounds
                hapticsEnabled = decoded.haptics
                preferenceError = nil
            } catch {
                soundsEnabled = false
                hapticsEnabled = false
                preferenceError =
                    "The saved feedback preference is invalid. Toggle a setting to replace it."
            }
        } else {
            soundsEnabled = defaultSounds
            hapticsEnabled = defaultHaptics
            preferenceError = nil
        }

        soundURLs = Self.loadBundledSoundURLs()
    }

    public func setSoundsEnabled(_ value: Bool) {
        soundsEnabled = value
        if !value {
            permission.invalidate()
            let generation = permission.generation
            _Concurrency.Task {
                await audioPlayer.stop(before: generation)
            }
        }
        persistPreference()
    }

    public func setHapticsEnabled(_ value: Bool) {
        hapticsEnabled = value
        persistPreference()
    }

    public func trigger(_ event: FacetFeedbackEvent) {
        guard enabledForLaunch else { return }
        guard let effect = policy.events[event.rawValue] else { return }
        let generation = permission.generation
        let soundName = effect.sound
        let soundURL = soundName.flatMap { soundURLs[$0] }
        let shouldPlaySound = soundsEnabled && soundURL != nil
        let shouldPlayHaptic = hapticsEnabled && effect.haptic != "none"
        guard shouldPlaySound || shouldPlayHaptic else { return }

        let permissionRef = permission
        let playerRef = audioPlayer
        let hapticStyle = effect.haptic

        _Concurrency.Task { @MainActor in
            await FacetSensoryDelivery.deliver(
                soundEnabled: shouldPlaySound,
                audio: {
                    guard let soundName, let soundURL else { return true }
                    do {
                        return try await playerRef.play(
                            soundName,
                            url: soundURL,
                            generation: generation,
                            permission: permissionRef
                        )
                    } catch {
                        Self.logger.error(
                            "Audio playback failed: \(error.localizedDescription, privacy: .public)"
                        )
                        return false
                    }
                },
                current: { permissionRef.allows(generation) },
                haptic: {
                    guard shouldPlayHaptic else { return }
                    Self.fireHaptic(hapticStyle)
                }
            )
        }
    }

    private func persistPreference() {
        let preference = FacetFeedbackPreference(sounds: soundsEnabled, haptics: hapticsEnabled)
        do {
            let encoded = try JSONEncoder().encode(preference)
            defaults.set(encoded, forKey: Self.preferenceKey)
            preferenceError = nil
        } catch {
            Self.logger.error(
                "Could not save feedback preference: \(error.localizedDescription, privacy: .public)"
            )
        }
    }

    private static func loadBundledSoundURLs() -> [String: URL] {
        guard let paletteURL = Bundle.module.url(forResource: "palette", withExtension: "json")
        else {
            return [:]
        }
        do {
            let data = try Data(contentsOf: paletteURL)
            let palette = try FacetFeedbackPolicy.palette(data: data)
            var resolved: [String: URL] = [:]
            for (name, cue) in palette.cues {
                let nsFile = cue.file as NSString
                let base = nsFile.deletingPathExtension
                let ext = nsFile.pathExtension
                if let url = Bundle.module.url(forResource: base, withExtension: ext) {
                    resolved[name] = url
                }
            }
            return resolved
        } catch {
            logger.error(
                "Bundled sound palette validation failed: \(error.localizedDescription, privacy: .public)"
            )
            return [:]
        }
    }

    private static func fireHaptic(_ kind: String) {
        #if os(iOS)
            if kind == "success" {
                let generator = UINotificationFeedbackGenerator()
                generator.notificationOccurred(.success)
            } else if kind == "error" {
                let generator = UINotificationFeedbackGenerator()
                generator.notificationOccurred(.error)
            } else if kind == "selection" {
                let generator = UISelectionFeedbackGenerator()
                generator.selectionChanged()
            } else if kind == "light" {
                let generator = UIImpactFeedbackGenerator(style: .light)
                generator.impactOccurred()
            }
        #else
            if kind == "success" || kind == "light" {
                NSHapticFeedbackManager.defaultPerformer.perform(
                    .alignment,
                    performanceTime: .default
                )
            }
        #endif
    }
}
