import TaskNotesKit
import XCTest

/// Isolated XCUITest launcher redirecting server address, token storage, and SQLite folder away from user state.
@MainActor
enum TestApp {
    /// Reserved port 1 refuses connections immediately so UI tests never hit a live server by accident.
    static let unreachableServer = "http://127.0.0.1:1"

    static func launch(
        serverAddress: String = unreachableServer,
        authToken: String = "",
        storageFolder: String = "TaskNotes-UITests-\(UUID().uuidString)",
        file: StaticString = #filePath,
        line: UInt = #line,
        teardown: (@escaping @Sendable () async -> Void) -> Void
    ) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = [
            "-\(UITesting.serverAddressDefaultsKey)", serverAddress,
            "-\(UITesting.authTokenDefaultsKey)", authToken,
            "-\(UITesting.storageFolderDefaultsKey)", storageFolder,
            UITesting.flagArgument,
        ]
        app.launch()
        XCTAssertTrue(
            app.wait(for: .runningForeground, timeout: 20),
            "the app never reached the foreground",
            file: file,
            line: line
        )
        teardown { @MainActor in app.terminate() }
        return app
    }
}
