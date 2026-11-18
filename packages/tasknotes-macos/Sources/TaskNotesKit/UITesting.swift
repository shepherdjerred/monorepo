/// Shared launch-argument and `UserDefaults` keys agreed upon by the app and XCUITest target.
///
/// Both the app and the XCUITest target share the bundle identifier, so UI tests
/// override the server address via the `NSUserDefaults` argument domain and pass
/// ``flagArgument`` to switch token storage from Keychain to an in-memory store.
public enum UITesting {
    /// Passed by a UI test to make the app disown the user's stored credential.
    ///
    /// The server address can be overridden through the `NSUserDefaults`
    /// *argument domain*, which outranks the persisted domain and is never
    /// written to disk. A Keychain entry **cannot** be overridden that way,
    /// because `KeychainTokenStore` reads the system store directly — so this
    /// flag is what makes the app choose an in-memory store instead.
    ///
    /// Deliberately an explicit argument rather than sniffing
    /// `XCTestConfigurationFilePath` or hiding behind `#if DEBUG`: a test process
    /// should have to *say* it wants no credential, and a release build should
    /// honour it if it ever asks.
    public static let flagArgument = "-red.sjer.tasknotes.uiTesting"

    /// Where the server address is persisted, and the key a launch argument
    /// overrides.
    ///
    /// Shared rather than duplicated: the app reads this key and the test writes
    /// `-<key> <value>`, so two spellings would mean a test that appears to
    /// redirect the app and does not — which is precisely the failure this whole
    /// type exists to prevent.
    public static let serverAddressDefaultsKey = "red.sjer.tasknotes.serverAddress"

    /// A per-run bearer token for an isolated UI-test server.
    public static let authTokenDefaultsKey = "red.sjer.tasknotes.uiTesting.authToken"

    /// An isolated Application Support folder supplied by each UI-test launch.
    public static let storageFolderDefaultsKey = "red.sjer.tasknotes.uiTesting.storageFolder"
}
