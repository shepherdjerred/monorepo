public import Foundation

public enum Providers {
  public static func live(
    credentials: any CredentialStore,
    transport: any HTTPTransport = URLSessionTransport(),
    endpoints: ProviderEndpoints? = nil,
    commandRunner: any CommandRunning = FoundationCommandRunner(),
    antigravityExecutableURL: URL? = nil,
    providerIDs: Set<ProviderID> = ProviderID.standard
  ) throws -> [any UsageProvider] {
    let endpoints = try endpoints ?? ProviderEndpoints.live()
    let client = ProviderHTTPClient(transport: transport, credentials: credentials)
    return ProviderID.allCases.compactMap { provider in
      guard providerIDs.contains(provider) else { return nil }
      switch provider {
      case .claudeCode:
        return ClaudeCodeProvider(client: client, endpoint: endpoints.claudeUsage)
      case .codex:
        return CodexProvider(
          client: client,
          usageEndpoint: endpoints.codexUsage,
          resetEndpoint: endpoints.codexResets
        )
      case .antigravity:
        return AntigravityProvider(
          commandRunner: commandRunner,
          executableURL: antigravityExecutableURL
        )
      case .cursor:
        return CursorProvider(client: client, endpoint: endpoints.cursorUsage)
      case .kimi:
        return KimiProvider(client: client, endpoint: endpoints.kimiUsage)
      case .grok:
        return GrokProvider(
          client: client,
          userEndpoint: endpoints.grokUser,
          billingEndpoint: endpoints.grokBilling,
          creditsEndpoint: endpoints.grokCredits
        )
      }
    }
  }
}
