import Foundation
import XCTest

/// Input actions and settled outcomes are separate; only explicit finish ends the session.
@MainActor
final class AccountInputUITests: XCTestCase {
    private enum Phase {
        case credentials, credentialsFilled, credentialsSubmitted, verification
        case verificationFilled, verificationSubmitted, vaults, vaultPasswordFilled
        case connectSubmitted, connected, rejected
    }
    private struct State {
        var phase: Phase
        var submitted = 0
    }
    private enum CredentialAction { case fill, submit, fillVerification, submitVerification }
    private var allowedRemoteVaultID: String?
    private var expectedProfileID: String?
    private var submissionPossible = false
    private var explicitlyFinished = false

    func testPrivateAccountInput() {
        continueAfterFailure = false
        do { try session() } catch let failure as AccountInputFailure {
            XCTFail("Private account input rejected: \(failure.rawValue)")
        } catch { XCTFail("Private account input rejected: input") }
    }

    private func session() throws {
        let environment = ProcessInfo.processInfo.environment
        let identity = try AccountInputIdentity(environment: environment)
        let boundary = try AccountInputProtocol(identity: identity, bundle: Bundle(for: Self.self))
        let app = try launch(identity: identity, environment: environment)
        defer {
            if !submissionPossible || explicitlyFinished { app.terminate() }
        }
        let form = AccountInputForm(
            app: app, remoteVaultID: allowedRemoteVaultID, profileID: expectedProfileID,
            willSubmit: { self.submissionPossible = true })
        let stage = try form.open()
        if stage == .credentials { try form.prepareEmptyKeyboard() }
        let socket = try AccountInputSocket(sessionID: identity.sessionID)
        defer { socket.close() }
        try socket.acceptPeer()
        var initial = AccountInputReply(identity, kind: .ready)
        initial.runnerPID = ProcessInfo.processInfo.processIdentifier
        initial.stage = stage.rawValue
        initial.signInEnabled = try form.signInEnabled()
        if stage == .vaults { initial.connectEnabled = try form.connectEnabled() }
        try socket.send(boundary.reply(initial))
        let phase: Phase
        switch stage {
        case .credentials: phase = .credentials
        case .verification: phase = .verification
        case .vaults: phase = .vaults
        case .connected, .rejected: throw AccountInputFailure.form
        }
        try exchange(form: form, state: State(phase: phase), boundary: boundary, socket: socket)
    }

    private func exchange(
        form: AccountInputForm, state: State, boundary: AccountInputProtocol,
        socket: AccountInputSocket
    ) throws {
        var current = state
        var seen: Set<String> = []
        for _ in 0..<12 {
            var requestID: String?
            do {
                let command = try boundary.command(socket.receive())
                requestID = command.requestID
                guard seen.insert(command.requestID).inserted else {
                    throw AccountInputFailure.input
                }
                let reply = try perform(
                    command, form: form, state: &current, identity: boundary.identity)
                try socket.send(boundary.reply(reply))
                if command.kind == .finish {
                    explicitlyFinished = true
                    return
                }
            } catch let failure as AccountInputFailure {
                var rejection = AccountInputReply(
                    boundary.identity, kind: .rejected, requestID: requestID)
                rejection.reason = failure.rawValue
                try socket.send(boundary.reply(rejection))
                throw failure
            }
        }
        throw AccountInputFailure.input
    }

    private func perform(
        _ command: AccountInputCommand, form: AccountInputForm, state: inout State,
        identity: AccountInputIdentity
    ) throws -> AccountInputReply {
        let kind: AccountInputReply.Kind
        switch command.kind {
        case .fill:
            kind = try credentialAction(.fill, command: command, form: form, state: &state)
        case .submit:
            kind = try credentialAction(.submit, command: command, form: form, state: &state)
        case .fillVerification:
            kind = try credentialAction(
                .fillVerification, command: command, form: form, state: &state)
        case .submitVerification:
            kind = try credentialAction(
                .submitVerification, command: command, form: form, state: &state)
        case .fillVaultPassword:
            guard state.phase == .vaults else { throw AccountInputFailure.input }
            try form.fillVaultPassword(command)
            state.phase = .vaultPasswordFilled
            kind = .vaultPasswordFilled
        case .connect:
            kind = try connect(command, form: form, state: &state)
        case .observe:
            return try observe(command, form: form, state: &state, identity: identity)
        case .finish: kind = .finished
        }
        return actionReply(identity, kind: kind, command: command, state: state)
    }

    private func connect(
        _ command: AccountInputCommand, form: AccountInputForm, state: inout State
    ) throws -> AccountInputReply.Kind {
        guard state.phase == .vaults || state.phase == .vaultPasswordFilled else {
            throw AccountInputFailure.input
        }
        try form.connect(command)
        state.phase = .connectSubmitted
        state.submitted += 1
        return .connectSubmitted
    }

    private func actionReply(
        _ identity: AccountInputIdentity, kind: AccountInputReply.Kind,
        command: AccountInputCommand, state: State
    ) -> AccountInputReply {
        var reply = AccountInputReply(identity, kind: kind, requestID: command.requestID)
        reply.submitActionCount =
            command.kind == .finish ? state.submitted : actionCount(command.kind)
        if command.kind == .fill {
            reply.disabledCheckpoints = 2
            reply.signInEnabled = true
        }
        if command.kind == .fillVerification { reply.signInEnabled = true }
        if command.kind == .fillVaultPassword {
            reply.disabledCheckpoints = 1
            reply.connectEnabled = true
        }
        return reply
    }

    private func credentialAction(
        _ action: CredentialAction, command: AccountInputCommand, form: AccountInputForm,
        state: inout State
    ) throws -> AccountInputReply.Kind {
        switch action {
        case .fill:
            guard state.phase == .credentials else { throw AccountInputFailure.input }
            try form.fillCredentials(command)
            state.phase = .credentialsFilled
            return .filled
        case .submit:
            guard state.phase == .credentialsFilled else { throw AccountInputFailure.input }
            try form.submitCredentials()
            state.phase = .credentialsSubmitted
            state.submitted += 1
            return .submitted
        case .fillVerification:
            guard state.phase == .verification else { throw AccountInputFailure.input }
            try form.fillVerification(command)
            state.phase = .verificationFilled
            return .verificationFilled
        case .submitVerification:
            guard state.phase == .verificationFilled else { throw AccountInputFailure.input }
            try form.submitVerification()
            state.phase = .verificationSubmitted
            state.submitted += 1
            return .verificationSubmitted
        }
    }

    private func actionCount(_ kind: AccountInputCommand.Kind) -> Int {
        switch kind {
        case .submit, .submitVerification, .connect: 1
        case .fill, .fillVerification, .fillVaultPassword, .observe, .finish: 0
        }
    }

    private func observe(
        _ command: AccountInputCommand, form: AccountInputForm, state: inout State,
        identity: AccountInputIdentity
    ) throws -> AccountInputReply {
        guard
            state.phase == .credentialsSubmitted || state.phase == .verificationSubmitted
                || state.phase == .connectSubmitted
        else { throw AccountInputFailure.input }
        let connecting = state.phase == .connectSubmitted
        let mayRequestVerification = state.phase == .credentialsSubmitted
        let stage = try form.observe(
            connecting: connecting, mayRequestVerification: mayRequestVerification)
        switch stage {
        case .verification:
            guard mayRequestVerification else { throw AccountInputFailure.form }
            state.phase = .verification
        case .vaults: state.phase = .vaults
        case .connected:
            guard connecting else { throw AccountInputFailure.form }
            state.phase = .connected
        case .rejected: state.phase = .rejected
        case .credentials: throw AccountInputFailure.form
        }
        var reply = AccountInputReply(identity, kind: .observed, requestID: command.requestID)
        reply.stage = stage.rawValue
        if stage == .vaults { reply.connectEnabled = try form.connectEnabled() }
        return reply
    }

    private func launch(identity: AccountInputIdentity, environment: [String: String]) throws
        -> XCUIApplication
    {
        let app = XCUIApplication()
        app.launchEnvironment["FACET_E2E_SIMULATOR"] = environment["SIMULATOR_UDID"]
        if let rawProfile = environment["FACET_E2E_ACCOUNT_PROFILE_ID"] {
            guard UUID(uuidString: rawProfile) != nil else {
                throw AccountInputFailure.ownership
            }
            expectedProfileID = rawProfile
        }
        if let descriptor = environment["FACET_E2E_DESCRIPTOR"] {
            struct Descriptor: Decodable {
                let schemaVersion: Int
                let runID: UUID
                let allowedRemoteVaultID: String?
            }
            guard descriptor == "@documents/acceptance.json",
                let raw = environment["FACET_E2E_DESCRIPTOR_JSON"]
            else { throw AccountInputFailure.ownership }
            let parsed: Descriptor
            do { parsed = try JSONDecoder().decode(Descriptor.self, from: Data(raw.utf8)) } catch {
                throw AccountInputFailure.ownership
            }
            guard parsed.schemaVersion == 1, parsed.runID.uuidString.lowercased() == identity.runID,
                parsed.allowedRemoteVaultID != ""
            else { throw AccountInputFailure.ownership }
            allowedRemoteVaultID = parsed.allowedRemoteVaultID
            app.launchArguments = ["--facet-acceptance-descriptor", descriptor]
        } else {
            app.launchArguments = ["--facet-native-acceptance"]
        }
        app.launch()
        return app
    }
}
