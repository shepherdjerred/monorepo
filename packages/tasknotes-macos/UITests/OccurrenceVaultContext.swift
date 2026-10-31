import Foundation
import TaskNotesKit
import XCTest

@MainActor
struct OccurrenceVaultContext {
    let app: XCUIApplication
    let vault: URL
    let day: String
    let nextDay: String
    let parent: URL
    let child: URL
    private let ownership: OccurrenceLaunchOwnership

    init(test: XCTestCase) throws {
        let environment = ProcessInfo.processInfo.environment
        let descriptor = try XCTUnwrap(environment["FACET_E2E_DESCRIPTOR"])
        let runID = try XCTUnwrap(environment["FACET_E2E_RUN_ID"].flatMap(UUID.init(uuidString:)))
        day = try XCTUnwrap(environment["FACET_OCCURRENCE_DAY"])
        guard SystemClock().viewerCalendar().today == day else { throw FixtureError.ownership }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.dateFormat = "yyyy-MM-dd"
        let date = try XCTUnwrap(formatter.date(from: day))
        guard formatter.string(from: date) == day else { throw FixtureError.ownership }
        nextDay = formatter.string(from: date.addingTimeInterval(86_400))
        let fields = try JSONDecoder().decode(
            Descriptor.self, from: Data(contentsOf: URL(fileURLWithPath: descriptor)))
        guard fields.schemaVersion == 1, fields.runID == runID,
            fields.allowedRemoteVaultID == nil
        else { throw FixtureError.ownership }
        let state = try MacAcceptanceOwnership.validate(
            descriptor: descriptor, stateDirectory: fields.stateDirectory, runID: runID)
        vault = state.appendingPathComponent("Native acceptance")
        parent = vault.appendingPathComponent("Tasks/Repair.md")
        child = vault.appendingPathComponent("Tasks/Repair-child.md")
        ownership = try OccurrenceLaunchOwnership(
            runID: runID, descriptor: descriptor, state: state)
        app = XCUIApplication(url: ownership.appURL)
        app.launchArguments = [
            "--facet-acceptance-descriptor", descriptor, "--facet-native-acceptance",
        ]
        let owned = ownership
        test.addTeardownBlock { @MainActor in try owned.terminate() }
    }

    func launch() throws -> XCUIElement {
        guard SystemClock().viewerCalendar().today == day else { throw FixtureError.ownership }
        try ownership.launch(app)
        let window = try MacAcceptanceWorkspace.initial(app: app)
        let all = window.buttons["All tasks"]
        XCTAssertTrue(all.waitForExistence(timeout: 10))
        all.click()
        return window
    }

    func terminate() throws {
        guard SystemClock().viewerCalendar().today == day else { throw FixtureError.ownership }
        try ownership.terminate()
        XCTAssertEqual(app.state, .notRunning)
    }

    func note(_ file: URL) throws -> FacetMarkdownDocument {
        guard file.path.hasPrefix(vault.path + "/"),
            file.resolvingSymlinksInPath() == file
        else { throw FixtureError.ownership }
        return try FacetMarkdownDocument(
            path: String(file.path.dropFirst(vault.path.count + 1)),
            bytes: Data(contentsOf: file))
    }

    func children(parentPath: String) throws -> [URL: Data] {
        let enumerator = try XCTUnwrap(
            FileManager.default.enumerator(
                at: vault, includingPropertiesForKeys: [.isRegularFileKey, .isSymbolicLinkKey]))
        var children: [URL: Data] = [:]
        for case let file as URL in enumerator where file.pathExtension == "md" {
            let metadata = try file.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey])
            guard metadata.isRegularFile == true, metadata.isSymbolicLink == false else {
                throw FixtureError.ownership
            }
            let document = try note(file)
            if document.properties["recurrence_parent"] == .string("[[/\(parentPath)]]") {
                children[file] = try Data(contentsOf: file)
            }
        }
        return children
    }

    func future() throws -> URL? {
        let candidates = try children(parentPath: "Tasks/Repair.md").keys.filter { $0 != child }
        guard candidates.count <= 1 else { throw FixtureError.duplicateChild }
        return candidates.first
    }

    func wait(_ name: String, condition: () throws -> Bool) throws {
        let deadline = Date().addingTimeInterval(15)
        repeat {
            if try condition() { return }
            RunLoop.current.run(until: Date().addingTimeInterval(0.05))
        } while Date() < deadline
        XCTFail("Persisted recurrence evidence did not converge: \(name)")
        throw FixtureError.convergence
    }

    func restoreOwnedTemplate() throws {
        let template = vault.appendingPathComponent("Templates/missing.md")
        guard app.state == .notRunning, template.resolvingSymlinksInPath() == template,
            !FileManager.default.fileExists(atPath: template.path)
        else { throw FixtureError.ownership }
        try FileManager.default.createDirectory(
            at: template.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data("---\nstatus: open\n---\nRestored occurrence template body.\n".utf8).write(
            to: template, options: .withoutOverwriting)
    }

    func retainPrimary(parent: Data, child: Data) throws {
        let state = vault.deletingLastPathComponent()
        let proof = try JSONSerialization.data(withJSONObject: [
            "schemaVersion": 1, "runID": state.lastPathComponent, "day": day,
            "parent": parent.base64EncodedString(), "child": child.base64EncodedString(),
        ])
        try proof.write(
            to: state.appendingPathComponent("occurrence-primary.json"),
            options: .withoutOverwriting)
    }

    private struct Descriptor: Decodable {
        let schemaVersion: Int
        let runID: UUID
        let stateDirectory: String
        let allowedRemoteVaultID: String?
    }
    private enum FixtureError: Error { case ownership, duplicateChild, convergence }
}
