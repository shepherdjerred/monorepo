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
    private var choiceViews: [NSView] = []
    private var stackView: NSStackView?
    private var identityStoreSyncTask: Task<Void, Never>?

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
        Task { await completeUsingStoredRecord(for: credentialRequest.credentialIdentity) }
    }

    override func prepareInterfaceToProvideCredential(for credentialRequest: any ASCredentialRequest) {
        logger.info("event=credential_request mode=interface type=\(credentialRequest.type.rawValue, privacy: .public)")
        guard credentialRequest.type == .oneTimeCode else {
            logger.error("event=credential_request outcome=unsupported_type")
            cancel(code: ProviderErrorCode.failed)
            return
        }
        Task { await completeUsingStoredRecord(for: credentialRequest.credentialIdentity) }
    }

    override func prepareOneTimeCodeCredentialList(for serviceIdentifiers: [ASCredentialServiceIdentifier]) {
        Task {
            guard let validRecords = await loadRecords() else {
                cancel(code: ProviderErrorCode.failed)
                return
            }
            records = validRecords.filter { record in
                serviceIdentifiers.isEmpty || serviceIdentifiers.contains { service in
                    matches(record: record, serviceIdentifier: service.identifier)
                }
            }
            logger.info("event=credential_list outcome=ready requested_service_count=\(serviceIdentifiers.count, privacy: .public) available_record_count=\(validRecords.count, privacy: .public) matching_record_count=\(self.records.count, privacy: .public)")
            renderChoices()
        }
    }

    private func completeUsingStoredRecord(for identity: any ASCredentialIdentity) async {
        guard let record = await recordFor(identity) else { return }
        complete(record)
    }

    private func recordFor(_ identity: any ASCredentialIdentity) async -> OTPRecord? {
        guard let messageID = identity.recordIdentifier else {
            logger.error("event=credential_lookup outcome=missing_record_identifier")
            cancel(code: ProviderErrorCode.credentialIdentityNotFound)
            return nil
        }
        guard let storedRecords = await loadRecords() else {
            cancel(code: ProviderErrorCode.failed)
            return nil
        }
        let record = storedRecords.first { $0.messageID == messageID }
        logger.info("event=credential_lookup outcome=\(record == nil ? "not_found" : "found", privacy: .public) message_id_hash=\(CodeFillObservability.fingerprint(messageID), privacy: .public)")
        // The identity can outlive its record once the code expires or is consumed, and an
        // unresolved extension request would leave AutoFill hanging.
        guard let record else {
            cancel(code: ProviderErrorCode.credentialIdentityNotFound)
            return nil
        }
        return record
    }

    // The controller is @MainActor, but reading the store takes a lock and touches the filesystem.
    // Doing that inline would stall the extension UI and risk an OS request timeout, so the read
    // runs off the main actor and only its result comes back.
    private func loadRecords() async -> [OTPRecord]? {
        let outcome = await Task.detached(priority: .userInitiated) { () -> Result<[OTPRecord], any Error> in
            do {
                let store = try CodeStore(applicationGroupIdentifier: CodeFillConfiguration.applicationGroupIdentifier)
                return .success(try store.read())
            } catch {
                return .failure(error)
            }
        }.value

        switch outcome {
        case let .success(records):
            logger.info("event=provider_store_read outcome=success record_count=\(records.count, privacy: .public)")
            synchronizeIdentityStore(records)
            return records
        case let .failure(error):
            logger.error("event=provider_store_read outcome=error error=\(CodeFillObservability.errorSummary(error), privacy: .public)")
            return nil
        }
    }

    // Every view added here is tracked so a re-render clears the previous state completely; the
    // empty-state label used to survive and duplicate because only the buttons were removed.
    private func renderChoices() {
        guard let stack = stackView else {
            return
        }
        choiceViews.forEach(stack.removeArrangedSubview)
        choiceViews.forEach { $0.removeFromSuperview() }
        choiceViews = records.enumerated().map { index, record -> NSView in
            let title = record.service.map { "\($0) · \(record.code)" } ?? record.code
            let button = NSButton(title: title, target: self, action: #selector(selectChoice(_:)))
            button.tag = index
            button.bezelStyle = .rounded
            stack.addArrangedSubview(button)
            return button
        }
        if records.isEmpty {
            let emptyState = NSTextField(labelWithString: "No unexpired codes are available.")
            stack.addArrangedSubview(emptyState)
            choiceViews.append(emptyState)
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
        guard !record.isExpired(at: Date()) else {
            logger.info("event=credential_completion outcome=expired_before_submission message_id_hash=\(CodeFillObservability.fingerprint(record.messageID), privacy: .public)")
            cancel(code: ProviderErrorCode.credentialIdentityNotFound)
            return
        }
        logger.info("event=credential_completion outcome=attempt \(CodeFillObservability.recordSummary(record), privacy: .public)")
        let credential = ASOneTimeCodeCredential(code: record.code)
        let context = extensionContext
        let providerLogger = logger
        context.completeOneTimeCodeRequest(using: credential) { [weak self, logger = providerLogger] expired in
            guard !expired else {
                logger.info("event=credential_completion outcome=expired_before_use message_id_hash=\(CodeFillObservability.fingerprint(record.messageID), privacy: .public)")
                return
            }
            Task.detached(priority: .userInitiated) { [logger] in
                for attempt in 1...3 {
                    do {
                        let store = try CodeStore(applicationGroupIdentifier: CodeFillConfiguration.applicationGroupIdentifier)
                        let remainingRecords = try store.consumeAndReadRemaining(messageID: record.messageID)
                        logger.info("event=credential_completion outcome=consumed remaining_record_count=\(remainingRecords.count, privacy: .public) message_id_hash=\(CodeFillObservability.fingerprint(record.messageID), privacy: .public) attempt=\(attempt, privacy: .public)")
                        Task { @MainActor [weak self] in
                            self?.synchronizeIdentityStore(remainingRecords)
                        }
                        return
                    } catch {
                        guard attempt < 3 else {
                            logger.error("event=credential_completion outcome=consume_error attempts=\(attempt, privacy: .public) error=\(CodeFillObservability.errorSummary(error), privacy: .public)")
                            return
                        }
                        do {
                            try await Task.sleep(for: .milliseconds(100))
                        } catch {
                            logger.error("event=credential_completion outcome=consume_retry_cancelled attempt=\(attempt, privacy: .public)")
                            return
                        }
                    }
                }
            }
        }
    }

    private func cancel(code: Int) {
        logger.info("event=credential_request outcome=cancelled error_code=\(code, privacy: .public)")
        let error = NSError(domain: ASExtensionErrorDomain, code: code)
        extensionContext.cancelRequest(withError: error)
    }

    private func matches(record: OTPRecord, serviceIdentifier: String) -> Bool {
        // A record with no derived service matches nothing in particular, and offering it to every
        // requesting site would leak codes across services.
        guard let service = record.service else { return false }
        let recordValues = ServiceIdentity.matchingValues(for: service)
        let requestedValues = ServiceIdentity.matchingValues(for: serviceIdentifier)
        return recordValues.contains { recordValue in
            requestedValues.contains { requestedValue in requestedValue == recordValue }
        }
    }

    private func synchronizeIdentityStore(_ records: [OTPRecord]) {
        let previousTask = identityStoreSyncTask
        identityStoreSyncTask = Task { @MainActor [weak self] in
            await previousTask?.value
            guard let self else { return }
            await self.replaceIdentities(records)
        }
    }

    private func replaceIdentities(_ records: [OTPRecord]) async {
        let state = await credentialIdentityStoreState()
        guard state else {
            logger.info("event=identity_store_sync outcome=disabled record_count=\(records.count, privacy: .public)")
            return
        }
        let identities = CredentialIdentityBuilder.identities(for: records)
        logger.info("event=identity_store_sync outcome=attempt identity_count=\(identities.count, privacy: .public)")
        let result = await replaceCredentialIdentities(identities)
        if result {
            logger.info("event=identity_store_sync outcome=success identity_count=\(identities.count, privacy: .public)")
        } else {
            logger.error("event=identity_store_sync outcome=error identity_count=\(identities.count, privacy: .public)")
        }
    }

    private func credentialIdentityStoreState() async -> Bool {
        await withCheckedContinuation { continuation in
            ASCredentialIdentityStore.shared.getState { state in
                continuation.resume(returning: state.isEnabled)
            }
        }
    }

    private func replaceCredentialIdentities(_ identities: [ASCredentialIdentity]) async -> Bool {
        await withCheckedContinuation { continuation in
            ASCredentialIdentityStore.shared.replaceCredentialIdentities(identities) { success, error in
                if let error {
                    self.logger.error("event=identity_store_sync replacement_error detail=\(error.localizedDescription, privacy: .public)")
                }
                continuation.resume(returning: success)
            }
        }
    }
}
