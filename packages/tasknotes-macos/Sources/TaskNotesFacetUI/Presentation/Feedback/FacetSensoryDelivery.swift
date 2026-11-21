/// A busy audio channel can skip a sound without delaying the touch response.
@MainActor internal enum FacetSensoryDelivery {
    static func deliver(
        soundEnabled: Bool, audio: () async -> Bool, current: () -> Bool, haptic: () -> Void
    ) async {
        guard current() else { return }
        haptic()
        if soundEnabled { _ = await audio() }
    }
}
