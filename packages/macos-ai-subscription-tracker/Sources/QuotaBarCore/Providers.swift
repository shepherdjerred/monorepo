public enum Providers {
  public static func live(
    credentials: any CredentialStore,
    transport: any HTTPTransport = URLSessionTransport(),
    endpoints: ProviderEndpoints? = nil
  ) throws -> [any UsageProvider] {
    let endpoints = try endpoints ?? ProviderEndpoints.live()
    let client = ProviderHTTPClient(transport: transport, credentials: credentials)
    return [
      ClaudeCodeProvider(client: client, endpoint: endpoints.claudeUsage),
      CodexProvider(
        client: client,
        usageEndpoint: endpoints.codexUsage,
        resetEndpoint: endpoints.codexResets
      ),
      KimiProvider(client: client, endpoint: endpoints.kimiUsage),
      GrokProvider(
        client: client,
        userEndpoint: endpoints.grokUser,
        billingEndpoint: endpoints.grokBilling,
        creditsEndpoint: endpoints.grokCredits
      ),
    ]
  }
}
