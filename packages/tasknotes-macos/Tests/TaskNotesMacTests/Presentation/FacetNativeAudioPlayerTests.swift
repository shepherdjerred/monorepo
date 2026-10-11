import Foundation
import Testing

@testable import TaskNotesFacetUI

@Suite("Native audio ownership") @MainActor
struct FacetNativeAudioPlayerTests {
    @Test func combinedCuesHonorAudioAdmissionAndQuietHaptics() async {
        var haptics = 0
        var audioAttempts = 0
        for (soundEnabled, admitted, expected) in [
            (true, false, 0), (true, true, 1), (false, false, 2),
        ] {
            await FacetSensoryDelivery.deliver(
                soundEnabled: soundEnabled,
                audio: {
                    audioAttempts += 1
                    return admitted
                }, current: { true },
                haptic: { haptics += 1 })
            #expect(haptics == expected)
        }
        #expect(audioAttempts == 2)
    }

    @Test func activationLossDuringAudioAdmissionConsumesTheHaptic() async {
        var current = true
        var haptics = 0
        await FacetSensoryDelivery.deliver(
            soundEnabled: true,
            audio: {
                current = false
                return true
            },
            current: { current }, haptic: { haptics += 1 })
        #expect(haptics == 0)
    }

    @Test func inactiveOriginDoesNotRetireAnotherActiveScene() {
        let permission = FacetAudioPermission()
        let first = FacetAudioPermission.Owner(id: UUID(), activation: UUID())
        let second = FacetAudioPermission.Owner(id: UUID(), activation: UUID())
        permission.setScene(first.id, activation: first.activation)
        permission.setScene(second.id, activation: second.activation)
        let generation = permission.generation
        permission.setScene(first.id, activation: nil)
        #expect(!permission.allows(generation, owner: first))
        #expect(permission.allows(generation, owner: second))
    }

    @Test func revokedQueuedCueCannotOpenOrPlayAnAudioResource() async throws {
        let permission = FacetAudioPermission()
        let generation = permission.generation
        permission.invalidate()
        let audio = FacetNativeAudioPlayer()
        let absent = URL(fileURLWithPath: "/facet-unavailable-audio-\(UUID().uuidString).wav")
        try await audio.preload(
            ["complete": absent], generation: generation, permission: permission)
        #expect(
            try await !audio.play(
                "complete", url: absent, generation: generation, permission: permission))
        #expect(!permission.allows(generation))
        #expect(permission.allows(permission.generation))
    }
}
