/// Sound admission owns both sensory cues; quiet mode still permits haptics.
@MainActor internal enum FacetSensoryDelivery {
    static func deliver(
        soundEnabled: Bool, audio: () async -> Bool, current: () -> Bool, haptic: () -> Void
    ) async {
        guard current() else { return }
        if soundEnabled, !(await audio()) { return }
        guard current() else { return }
        haptic()
    }
}
