import Testing

@testable import TaskNotesMac

/// Sparkle's configuration gate, which no image can show.
///
/// Nothing here talks to Sparkle, orders a window in, or reaches the network —
/// and the second suite exists to prove that a test process *cannot*, which is
/// the same discipline the offscreen renderer and the quick-add panel's window
/// tests follow.
@Suite("Whether a build has an update channel")
struct UpdaterConfigurationTests {
    /// The full cross product, because the interesting cases are only there.
    ///
    /// Three states per key — absent, empty, present — and the two failures
    /// this gate exists to prevent are both *mixed* rows: a present feed beside
    /// an empty key is what makes Sparkle refuse to start and run a modal alert
    /// a second into launch, and a present key beside an absent feed is what
    /// leaves an enabled menu item over a check that can only error. A suite
    /// that varied one key with the other held absent would pass while missing
    /// both.
    @Test(
        "only a non-empty feed URL and a non-empty public key count as configured",
        arguments: [
            (feed: String?.none, key: String?.none, configured: false),
            (feed: String?.none, key: String?(""), configured: false),
            (feed: String?.none, key: String?("pfIShU4dEXqPd5ObYNfDBiQ="), configured: false),
            (feed: String?(""), key: String?.none, configured: false),
            (feed: String?(""), key: String?(""), configured: false),
            (feed: String?(""), key: String?("pfIShU4dEXqPd5ObYNfDBiQ="), configured: false),
            (
                feed: String?("https://example.com/appcast.xml"), key: String?.none,
                configured: false
            ),
            (feed: String?("https://example.com/appcast.xml"), key: String?(""), configured: false),
            (
                feed: String?("https://example.com/appcast.xml"),
                key: String?("pfIShU4dEXqPd5ObYNfDBiQ="),
                configured: true
            ),
        ]
    )
    func crossProduct(feed: String?, key: String?, configured: Bool) {
        #expect(UpdaterController.isConfigured(feedURL: feed, publicKey: key) == configured)
    }
}

/// What the updater does inside a process that is not the app.
@Suite("The updater in a test process")
@MainActor
struct UpdaterProcessTests {
    /// The test runner's bundle carries neither key, so this asserts two things
    /// at once: the gate holds, and running the suite cannot start a real
    /// updater, hit the network, or schedule a background check on the machine
    /// somebody is using.
    ///
    /// It is also the reason ``AppEnvironment`` builds an updater from *both*
    /// of its initializers where it deliberately installs the global hotkey
    /// from only one — the hotkey has no such gate, and this does.
    @Test("an unconfigured bundle yields a disabled, never absent, menu item")
    func disabledWithoutConfiguration() {
        #expect(!UpdaterController().canCheckForUpdates)
    }
}
