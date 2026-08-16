import AppKit
import AuthenticationServices
import Foundation

@MainActor
final class CredentialProviderViewController: ASCredentialProviderViewController {
    private enum ProviderErrorCode {
        static let failed = 0
        static let credentialIdentityNotFound = 101
    }

    private let logger = CodeFillObservability.providerLogger
    private var records: [OTPRecord] = []
    private var choiceButtons: [NSButton] = []
    private var stackView: NSStackView?

    override func loadView() {
        logger.debug("event=provider_view_loaded")
        let stack = NSStackView()
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 12
        stack.edgeInsets = NSEdgeInsets(top: 20, left: 20, bottom: 20, right: 20)
        let title = NSTextField(labelWithString: "MailMate CodeFill")
        title.font = .boldSystemFont(ofSize: 16)
        stack.addArrangedSubview(title)
        let description = NSTextField(wrappingLabelWithString: "Choose a recent verification code to fill.")
        stack.addArrangedSubview(description)
        stackView = stack
        view = stack
    }

    override func provideCredentialWithoutUserInteraction(for credentialRequest: any ASCredentialRequest) {
        logger.info("event=credential_request mode=without_user_interaction type=\(credentialRequest.type.rawValue, privacy: .public)")
        guard credentialRequest.type == .oneTimeCode else {
            logger.error("event=credential_request outcome=unsupported_type")
            cancel(code: ProviderErrorCode.failed)
            return
        }
        guard let record = recordFor(credentialRequest.credentialIdentity) else { return }
        complete(record)
    }

    override func prepareInterfaceToProvideCredential(for credentialRequest: any ASCredentialRequest) {
        logger.info("event=credential_request mode=interface type=\(credentialRequest.type.rawValue, privacy: .public)")
        guard credentialRequest.type == .oneTimeCode else {
            logger.error("event=credential_request outcome=unsupported_type")
            cancel(code: ProviderErrorCode.failed)
            return
        }
        guard let record = recordFor(credentialRequest.credentialIdentity) else { return }
        complete(record)
    }

    override func prepareOneTimeCodeCredentialList(for serviceIdentifiers: [ASCredentialServiceIdentifier]) {
        let validRecords = loadRecords()
        records = validRecords.filter { record in
            serviceIdentifiers.isEmpty || serviceIdentifiers.contains { service in
                matches(record: record, serviceIdentifier: service.identifier)
            }
        }
        logger.info("event=credential_list outcome=ready requested_service_count=\(serviceIdentifiers.count, privacy: .public) available_record_count=\(validRecords.count, privacy: .public) matching_record_count=\(self.records.count, privacy: .public)")
        renderChoices()
    }

    private func recordFor(_ identity: any ASCredentialIdentity) -> OTPRecord? {
        guard let messageID = identity.recordIdentifier else {
            logger.error("event=credential_lookup outcome=missing_record_identifier")
            cancel(code: ProviderErrorCode.credentialIdentityNotFound)
            return nil
        }
        let record = loadRecords().first { $0.messageID == messageID }
        logger.info("event=credential_lookup outcome=\(record == nil ? "not_found" : "found", privacy: .public) message_id_hash=\(CodeFillObservability.fingerprint(messageID), privacy: .public)")
        return record
    }

    private func loadRecords() -> [OTPRecord] {
        do {
            let store = try CodeStore(applicationGroupIdentifier: CodeFillConfiguration.applicationGroupIdentifier)
            let records = try store.read()
            logger.info("event=provider_store_read outcome=success record_count=\(records.count, privacy: .public)")
            synchronizeIdentityStore(records)
            return records
        } catch {
            logger.error("event=provider_store_read outcome=error error=\(CodeFillObservability.errorSummary(error), privacy: .public)")
            cancel(code: ProviderErrorCode.failed)
            return []
        }
    }

    private func renderChoices() {
        guard let stack = stackView else {
            return
        }
        choiceButtons.forEach(stack.removeArrangedSubview)
        choiceButtons.forEach { $0.removeFromSuperview() }
        choiceButtons = records.enumerated().map { index, record in
            let title = record.service.map { "\($0) · \(record.code)" } ?? record.code
            let button = NSButton(title: title, target: self, action: #selector(selectChoice(_:)))
            button.tag = index
            button.bezelStyle = .rounded
            stack.addArrangedSubview(button)
            return button
        }
        if records.isEmpty {
            stack.addArrangedSubview(NSTextField(labelWithString: "No unexpired codes are available."))
        }
    }

    @objc private func selectChoice(_ sender: NSButton) {
        guard records.indices.contains(sender.tag) else {
            cancel(code: ProviderErrorCode.failed)
            return
        }
        complete(records[sender.tag])
    }

    private func complete(_ record: OTPRecord?) {
        guard let record else {
            logger.error("event=credential_completion outcome=missing_record")
            cancel(code: ProviderErrorCode.credentialIdentityNotFound)
            return
        }
        logger.info("event=credential_completion outcome=attempt \(CodeFillObservability.recordSummary(record), privacy: .public)")
        let credential = ASOneTimeCodeCredential(code: record.code)
        extensionContext.completeOneTimeCodeRequest(using: credential) { [logger] expired in
            guard !expired else {
                logger.info("event=credential_completion outcome=expired_before_use message_id_hash=\(CodeFillObservability.fingerprint(record.messageID), privacy: .public)")
                return
            }
            do {
                let store = try CodeStore(applicationGroupIdentifier: CodeFillConfiguration.applicationGroupIdentifier)
                try store.consume(messageID: record.messageID)
                let remainingRecords = try store.read()
                logger.info("event=credential_completion outcome=consumed remaining_record_count=\(remainingRecords.count, privacy: .public) message_id_hash=\(CodeFillObservability.fingerprint(record.messageID), privacy: .public)")
                Task { @MainActor [self] in
                    synchronizeIdentityStore(remainingRecords)
                }
            } catch {
                logger.error("event=credential_completion outcome=consume_error error=\(CodeFillObservability.errorSummary(error), privacy: .public)")
            }
        }
    }

    private func cancel(code: Int) {
        logger.info("event=credential_request outcome=cancelled error_code=\(code, privacy: .public)")
        let error = NSError(domain: ASExtensionErrorDomain, code: code)
        extensionContext.cancelRequest(withError: error)
    }

    private func matches(record: OTPRecord, serviceIdentifier: String) -> Bool {
        guard let service = record.service else { return true }
        let normalizedService = service.lowercased()
        let requestedValues = [serviceIdentifier.lowercased()] + (URL(string: serviceIdentifier)?.host.map { [$0.lowercased()] } ?? [])
        return requestedValues.contains { requested in
            requested == normalizedService ||
                requested.hasSuffix(".\(normalizedService)") ||
                normalizedService.hasSuffix(".\(requested)")
        }
    }

    private func synchronizeIdentityStore(_ records: [OTPRecord]) {
        ASCredentialIdentityStore.shared.getState { [logger] state in
            guard state.isEnabled else {
                logger.info("event=identity_store_sync outcome=disabled record_count=\(records.count, privacy: .public)")
                return
            }
            let identities = CredentialIdentityBuilder.identities(for: records)
            logger.info("event=identity_store_sync outcome=attempt identity_count=\(identities.count, privacy: .public)")
            ASCredentialIdentityStore.shared.replaceCredentialIdentities(identities) { success, error in
                if success {
                    logger.info("event=identity_store_sync outcome=success identity_count=\(identities.count, privacy: .public)")
                    return
                }
                let detail = error.map { ": \($0.localizedDescription)" } ?? "."
                logger.error("event=identity_store_sync outcome=error identity_count=\(identities.count, privacy: .public) detail=\(detail, privacy: .public)")
            }
        }
    }
}
