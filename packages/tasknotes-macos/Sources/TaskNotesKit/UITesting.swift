/// The two strings a UI test and the app have to agree on exactly.
///
/// They live in `TaskNotesKit` for the same reason `AccessibilityIdentifier`
/// does: both the app and the XCUITest target import this module, so a rename is
/// a compile error rather than a launch argument that silently stops matching.
///
/// ## Why any of this exists
///
/// ⚠️ **A UI test once ran against a real production vault.** The XCUITest
/// target and the app share the bundle identifier `red.sjer.tasknotes.mac`, so
/// an app launched by a test reads the *same* `UserDefaults` and the *same*
/// Keychain as the copy in `/Applications`. Every flow called a bare
/// `app.launch()`, so with a real server address and token configured, each run
/// pointed a client at the live server and pulled the whole vault.
///
/// Nothing in the suite wrote to it, which was luck rather than design: the
/// flows happened to click sidebar rows and press `⌘F`, and the next flow on the
/// roadmap was "create a task and assert the vault's markdown bytes".
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
}
