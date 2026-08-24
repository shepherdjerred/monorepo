import TaskNotesKit
import XCTest

/// The only way a UI test is allowed to launch the app.
///
/// ## Why this exists
///
/// ⚠️ **A UI test once ran against a real production vault.** The XCUITest
/// target and the app share the bundle identifier `red.sjer.tasknotes.mac`, so
/// an app launched by a test reads the *same* `UserDefaults` and the *same*
/// Keychain as the copy in `/Applications`. Every flow called a bare
/// `app.launch()`, so with a real server address and token configured, each run
/// pointed a client at the user's live server — and because launch now fetches,
/// pulled the whole vault down.
///
/// Nothing in the suite wrote to it, which was luck rather than design: the
/// flows happened to click sidebar rows and press `⌘F`, and the very next flow
/// on the roadmap was "create a task and assert the vault's markdown bytes".
///
/// ## How this prevents it
///
/// Two independent overrides, because either alone leaves a hole:
///
///   * **The address** goes through the `NSUserDefaults` *argument domain*,
///     which outranks the persisted domain and is never written to disk. The
///     default is a port that is always refused, so a test that does not ask
///     for a server cannot reach one.
///   * **The token** cannot be overridden that way — `KeychainTokenStore` reads
///     the system Keychain directly — so the launch also passes
///     ``UITesting/flagArgument``, which makes the app choose an
///     in-memory store instead. Without it a test would read, and could
///     overwrite, the user's real credential.
///
/// A test that calls `XCUIApplication().launch()` directly bypasses both. That
/// is why every flow goes through here, and why this is a function rather than
/// a documented convention.
@MainActor
enum TestApp {
    /// An address nothing can be listening on.
    ///
    /// Port 1 is reserved and refused immediately, so an accidental request
    /// fails fast and loudly rather than hanging or — the case that matters —
    /// silently succeeding against something real.
    static let unreachableServer = "http://127.0.0.1:1"

    /// Launch the app pointed somewhere harmless, and tear it down with the test.
    ///
    /// - Parameters:
    ///   - serverAddress: where to point it. Defaults to ``unreachableServer``;
    ///     pass a spawned test server's URL for a flow that genuinely needs
    ///     one. ⚠️ Never pass a real address.
    ///   - file: the caller, so a launch failure blames the flow.
    ///   - line: the caller's line, for the same reason.
    ///   - teardown: receives a closure that terminates the app; pass
    ///     `addTeardownBlock`.
    /// - Returns: the launched application, already in the foreground.
    static func launch(
        serverAddress: String = unreachableServer,
        file: StaticString = #filePath,
        line: UInt = #line,
        teardown: (@escaping @Sendable () -> Void) -> Void
    ) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = [
            // The argument domain. `UserDefaults.string(forKey:)` reads this in
            // preference to the persisted value, and nothing writes it back.
            "-\(UITesting.serverAddressDefaultsKey)", serverAddress,
            UITesting.flagArgument,
        ]
        app.launch()
        XCTAssertTrue(
            app.wait(for: .runningForeground, timeout: 20),
            "the app never reached the foreground",
            file: file,
            line: line
        )
        teardown { app.terminate() }
        return app
    }
}
