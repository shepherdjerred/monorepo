import AVFAudio
import Foundation
import Synchronization
import TaskNotesKit

/// Revocation is synchronous, even while audio hardware is being prepared.
internal final class FacetAudioPermission: Sendable {
    private struct State: Sendable {
        var generation: UInt64 = 0
        var scenes: [UUID: UUID] = [:]
    }
    struct Owner: Sendable {
        let id: UUID
        let activation: UUID
    }
    private let value = Mutex(State())
    nonisolated var generation: UInt64 { value.withLock { $0.generation } }
    nonisolated func invalidate() { value.withLock { $0.generation += 1 } }
    nonisolated func setScene(_ id: UUID, activation: UUID?) {
        value.withLock { $0.scenes[id] = activation }
    }
    nonisolated func allows(_ generation: UInt64, owner: Owner? = nil) -> Bool {
        value.withLock { state in
            state.generation == generation
                && (owner.map { state.scenes[$0.id] == $0.activation } ?? true)
        }
    }
}

/// Audio hardware activation and player teardown never run on the UI actor.
internal actor FacetNativeAudioPlayer {
    private var players: [String: AVAudioPlayer] = [:]
    private var playerGeneration: UInt64 = 0

    func preload(_ urls: [String: URL], generation: UInt64, permission: FacetAudioPermission)
        throws
    {
        guard permission.allows(generation) else { return }
        try configure()
        for (sound, url) in urls where players[sound] == nil {
            guard permission.allows(generation) else { return }
            let player = try AVAudioPlayer(contentsOf: url)
            player.prepareToPlay()
            players[sound] = player
        }
        playerGeneration = generation
    }

    func play(
        _ sound: String, url: URL, generation: UInt64, permission: FacetAudioPermission,
        owner: FacetAudioPermission.Owner? = nil
    )
        throws -> Bool
    {
        guard permission.allows(generation, owner: owner),
            !players.values.contains(where: \.isPlaying)
        else {
            return false
        }
        try preload([sound: url], generation: generation, permission: permission)
        // Preparation can block on hardware. A scene/preference change during
        // that operation consumes this cue instead of playing it afterwards.
        guard permission.allows(generation, owner: owner), let player = players[sound] else {
            return false
        }
        player.currentTime = 0
        guard player.play() else { throw FacetContractError.unsupportedResponse }
        playerGeneration = generation
        return true
    }

    func stop(before generation: UInt64) {
        guard playerGeneration < generation else { return }
        for player in players.values { player.stop() }
        players.removeAll()
    }

    private func configure() throws {
        #if os(iOS)
            try AVAudioSession.sharedInstance().setCategory(
                .ambient, mode: .default, options: [.mixWithOthers])
        #endif
    }
}
