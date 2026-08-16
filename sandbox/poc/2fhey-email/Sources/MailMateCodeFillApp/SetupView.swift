import AppKit
import AuthenticationServices
import SwiftUI

struct SetupView: View {
    @Environment(\.scenePhase) private var scenePhase
    @State private var identityStatus = "AutoFill identities have not been refreshed yet."
    @State private var integrationStatus = "Checking the MailMate bundle installation…"
    @State private var diagnosticsStatus = ""

    private let mailMateBundlesURL = FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent("Library/Application Support/MailMate/Bundles", isDirectory: true)

    var body: some View {
        Form {
            Section {
                Label("Native one-time-code AutoFill for MailMate", systemImage: "number.square")
                    .font(.title3.weight(.semibold))
                Text("MailMate CodeFill receives matching messages through a MailMate rule and makes only the short-lived code available to macOS AutoFill.")
                    .foregroundStyle(.secondary)
                Label("No email body is saved", systemImage: "checkmark.shield")
                    .font(.callout.weight(.medium))
                    .foregroundStyle(.green)
            }

            Section("Enable the provider") {
                Text("Open System Settings → General → AutoFill & Passwords → Extensions, then enable MailMate CodeFill under Credential Providers.")
                Button("Open verification-code settings") {
                    CodeFillObservability.appLogger.info("event=settings_opened destination=verification_code_provider")
                    ASSettingsHelper.openVerificationCodeAppSettings()
                }
                Text("The provider keeps codes for three minutes, removes them after use, and never stores the email body.")
                    .foregroundStyle(.secondary)
            }

            Section("Connect MailMate") {
                Text("Install the MailMate integration, reload bundles, and add an Inbox rule with the action Run Command → MailMate CodeFill → Copy Verification Code.")
                Text("The integration does not read MailMate’s database and does not change your rules automatically.")
                    .foregroundStyle(.secondary)
                HStack {
                    Button("Install / update bundle") {
                        installBundle()
                    }
                    Button("Show installed bundle") {
                        revealInstalledBundle()
                    }
                }
                Text(integrationStatus)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Section("Test") {
                Text("Send yourself a verification email, wait for the MailMate rule to run, then focus an OTP field in Safari, Chrome, or a native macOS text field and choose MailMate CodeFill from AutoFill.")
                    .foregroundStyle(.secondary)
                Text("Safari’s inline field control may belong entirely to 1Password. For this test, right-click or Control-click the field and choose AutoFill, or temporarily turn off 1Password’s inline Safari suggestions.")
                    .foregroundStyle(.secondary)
                Text(identityStatus)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Button("Refresh AutoFill identities") {
                    refreshCredentialIdentities()
                }
            }

            Section("Diagnostics") {
                Text("Events are recorded in macOS Unified Logging under the MailMate CodeFill subsystem. Sensitive message content and OTP values are excluded; identifiers are hashed for correlation.")
                    .foregroundStyle(.secondary)
                HStack {
                    Button("Open Console logs") {
                        openConsole()
                    }
                    Button("Copy diagnostics") {
                        copyDiagnostics()
                    }
                }
                Text("Filter Console with: subsystem:\(CodeFillObservability.subsystem)")
                    .font(.caption.monospaced())
                    .foregroundStyle(.secondary)
                if !diagnosticsStatus.isEmpty {
                    Text(diagnosticsStatus)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .formStyle(.grouped)
        .padding()
        .task {
            refreshIntegrationStatus()
            refreshCredentialIdentities()
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active {
                refreshIntegrationStatus()
                refreshCredentialIdentities()
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: .codeFillRecordsDidChange)) { _ in
            refreshCredentialIdentities()
        }
    }

    private func installBundle() {
        CodeFillObservability.appLogger.info("event=bundle_install outcome=started")
        do {
            guard let sourceURL = Bundle.main.url(forResource: "MailMateCodeFill", withExtension: "mmBundle") else {
                throw BundleInstallationError.embeddedBundleMissing
            }
            try FileManager.default.createDirectory(at: mailMateBundlesURL, withIntermediateDirectories: true)
            let destinationURL = mailMateBundlesURL.appendingPathComponent(sourceURL.lastPathComponent, isDirectory: true)
            let temporaryURL = mailMateBundlesURL.appendingPathComponent(".\(sourceURL.lastPathComponent).\(UUID().uuidString).tmp", isDirectory: true)
            try FileManager.default.copyItem(at: sourceURL, to: temporaryURL)
            if FileManager.default.fileExists(atPath: destinationURL.path) {
                _ = try FileManager.default.replaceItemAt(destinationURL, withItemAt: temporaryURL)
            } else {
                try FileManager.default.moveItem(at: temporaryURL, to: destinationURL)
            }
            refreshIntegrationStatus()
            integrationStatus = "Installed. Reload MailMate bundles, then add or run the CodeFill command."
            CodeFillObservability.appLogger.info("event=bundle_install outcome=success")
        } catch {
            integrationStatus = "Could not install the MailMate bundle: \(error.localizedDescription)"
            CodeFillObservability.appLogger.error("event=bundle_install outcome=error error=\(CodeFillObservability.errorSummary(error), privacy: .public)")
        }
    }

    private func refreshIntegrationStatus() {
        let installedURL = mailMateBundlesURL.appendingPathComponent("MailMateCodeFill.mmBundle", isDirectory: true)
        integrationStatus = FileManager.default.fileExists(atPath: installedURL.path)
            ? "Installed. Reload MailMate bundles to load updates."
            : "Not installed yet. Use Install / update bundle."
    }

    private func revealInstalledBundle() {
        CodeFillObservability.appLogger.info("event=bundle_reveal outcome=attempt")
        let installedURL = mailMateBundlesURL.appendingPathComponent("MailMateCodeFill.mmBundle", isDirectory: true)
        if FileManager.default.fileExists(atPath: installedURL.path) {
            _ = NSWorkspace.shared.selectFile(installedURL.path, inFileViewerRootedAtPath: mailMateBundlesURL.path)
            return
        }
        integrationStatus = "The bundle is not installed yet. Use Install / update bundle first."
        openBundlesFolder()
    }

    private func openBundlesFolder() {
        CodeFillObservability.appLogger.info("event=bundle_folder_open outcome=attempt")
        let finderURL = URL(fileURLWithPath: "/System/Library/CoreServices/Finder.app")
        NSWorkspace.shared.open(
            [mailMateBundlesURL],
            withApplicationAt: finderURL,
            configuration: NSWorkspace.OpenConfiguration(),
            completionHandler: nil
        )
    }

    private func refreshCredentialIdentities() {
        let startedAt = Date()
        CodeFillObservability.appLogger.info("event=identity_refresh outcome=started")
        do {
            let store = try CodeStore(applicationGroupIdentifier: CodeFillConfiguration.applicationGroupIdentifier)
            let records = try store.read()
            let identities = CredentialIdentityBuilder.identities(for: records)
            CodeFillObservability.appLogger.info("event=identity_refresh outcome=records_loaded record_count=\(records.count, privacy: .public) identity_count=\(identities.count, privacy: .public)")

            ASCredentialIdentityStore.shared.getState { state in
                guard state.isEnabled else {
                    CodeFillObservability.appLogger.info("event=identity_refresh outcome=disabled duration_ms=\(elapsedMilliseconds(since: startedAt), privacy: .public)")
                    Task { @MainActor in
                        identityStatus = "AutoFill identity store is disabled. Enable MailMate CodeFill in System Settings first."
                    }
                    return
                }
                ASCredentialIdentityStore.shared.replaceCredentialIdentities(identities) { success, error in
                    Task { @MainActor in
                        if success {
                            CodeFillObservability.appLogger.info("event=identity_refresh outcome=success identity_count=\(identities.count, privacy: .public) duration_ms=\(elapsedMilliseconds(since: startedAt), privacy: .public)")
                            identityStatus = identities.isEmpty
                                ? "No unexpired MailMate codes are available yet."
                                : "Registered \(identities.count) native AutoFill identity entries."
                        } else {
                            let detail = error.map { ": \($0.localizedDescription)" } ?? "."
                            CodeFillObservability.appLogger.error("event=identity_refresh outcome=error identity_count=\(identities.count, privacy: .public) detail=\(detail, privacy: .public) duration_ms=\(elapsedMilliseconds(since: startedAt), privacy: .public)")
                            identityStatus = "Could not register AutoFill identities\(detail)"
                        }
                    }
                }
            }
        } catch {
            identityStatus = "Could not read pending MailMate codes: \(error.localizedDescription)"
            CodeFillObservability.appLogger.error("event=identity_refresh outcome=store_error error=\(CodeFillObservability.errorSummary(error), privacy: .public) duration_ms=\(elapsedMilliseconds(since: startedAt), privacy: .public)")
        }
    }

    private func openConsole() {
        CodeFillObservability.appLogger.info("event=diagnostics_open_console")
        NSWorkspace.shared.open(URL(fileURLWithPath: "/System/Applications/Utilities/Console.app"))
    }

    private func copyDiagnostics() {
        let version = String(describing: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") ?? "unknown")
        let build = String(describing: Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") ?? "unknown")
        let installedURL = mailMateBundlesURL.appendingPathComponent("MailMateCodeFill.mmBundle", isDirectory: true)
        let diagnostics = [
            "MailMate CodeFill diagnostics",
            "version=\(version) build=\(build)",
            "os=\(ProcessInfo.processInfo.operatingSystemVersionString)",
            "bundle_installed=\(FileManager.default.fileExists(atPath: installedURL.path))",
            "identity_status=\(identityStatus)",
            "logging_subsystem=\(CodeFillObservability.subsystem)",
            "privacy=message bodies, OTP values, sender addresses, subjects, and raw message IDs are excluded"
        ].joined(separator: "\n")
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(diagnostics, forType: .string)
        diagnosticsStatus = "Copied safe diagnostics to the clipboard."
        CodeFillObservability.appLogger.info("event=diagnostics_copied")
    }

    private enum BundleInstallationError: LocalizedError {
        case embeddedBundleMissing

        var errorDescription: String? {
            switch self {
            case .embeddedBundleMissing:
                return "The app does not contain MailMateCodeFill.mmBundle."
            }
        }
    }
}

private func elapsedMilliseconds(since start: Date) -> Int {
    Int(Date().timeIntervalSince(start) * 1_000)
}
