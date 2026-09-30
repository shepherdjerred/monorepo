public actor CompositeCredentialStore: CredentialStore {
  private let manual: ManualCredentialStore
  private let local: any CredentialStore
  private var rejectedManualTokens: [ProviderID: Set<String>] = [:]

  public init(manual: ManualCredentialStore, local: any CredentialStore) {
    self.manual = manual
    self.local = local
  }

  public func credential(
    for provider: ProviderID,
    rejecting rejectedCredential: ProviderCredential?
  ) async throws -> ProviderCredential {
    guard provider.supportsManualCredentialOverride else {
      return try await local.credential(for: provider, rejecting: rejectedCredential)
    }
    // Remember every manual token rejected during the current replacement sequence, not just
    // the one passed to this call — a caller (e.g. GrokProvider/CodexProvider) that restarts a
    // whole fetch across several 401s only ever excludes its most recent credential, so without
    // this history an already-rejected manual token would be handed out again once a later
    // local token is rejected, oscillating between the two forever instead of exhausting.
    //
    // `rejecting: nil` only happens at the start of a fresh top-level fetch (never mid-restart,
    // which always excludes the credential that just failed), so it marks a new replacement
    // sequence and resets the history. Without this, one rejected manual token would suppress
    // the saved override for the app's entire lifetime, surviving a transient failure or even
    // the user removing and re-saving the same credential.
    var rejected = rejectedCredential == nil ? [] : (rejectedManualTokens[provider] ?? [])
    if let rejectedCredential {
      rejected.insert(rejectedCredential.accessToken)
    }
    rejectedManualTokens[provider] = rejected
    if let manualCredential = try await manual.credentialIfPresent(for: provider),
      !rejected.contains(manualCredential.accessToken)
    {
      return manualCredential
    }
    return try await local.credential(for: provider, rejecting: rejectedCredential)
  }
}
