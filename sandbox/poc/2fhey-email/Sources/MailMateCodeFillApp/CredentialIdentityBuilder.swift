import AuthenticationServices

enum CredentialIdentityBuilder {
    static func identities(for records: [OTPRecord]) -> [ASOneTimeCodeCredentialIdentity] {
        records.flatMap { record in
            serviceIdentifiers(for: record).map { serviceIdentifier in
                ASOneTimeCodeCredentialIdentity(
                    serviceIdentifier: serviceIdentifier,
                    label: record.sender.isEmpty ? "MailMate CodeFill" : record.sender,
                    recordIdentifier: record.messageID
                )
            }
        }
    }

    private static func serviceIdentifiers(for record: OTPRecord) -> [ASCredentialServiceIdentifier] {
        guard let service = record.service?.trimmingCharacters(in: .whitespacesAndNewlines), !service.isEmpty else {
            return []
        }

        if service == "127.0.0.1" || service == "localhost" {
            return [
                ASCredentialServiceIdentifier(identifier: "http://127.0.0.1:8788", type: .URL),
            ]
        }
        // A subject-derived service is not a domain, and the identity store rejects or never
        // matches such an identifier, so no identity is better than a bogus one.
        guard ServiceIdentity.isDomain(service) else {
            return []
        }
        return [ASCredentialServiceIdentifier(identifier: service, type: .domain)]
    }
}
