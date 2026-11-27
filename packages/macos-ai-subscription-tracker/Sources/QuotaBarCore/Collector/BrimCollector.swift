public import Foundation

enum BrimCollectionStatus: String, Codable, Sendable {
  case current
  case signInRequired = "sign_in_required"
  case unavailable
  case disabled
}

struct BrimQuotaObservation: Codable, Sendable {
  let provider: ProviderID
  let status: BrimCollectionStatus
  let snapshot: UsageSnapshot?
}

struct BrimBillingObservation: Codable, Sendable {
  let platform: APIPlatformID
  let status: BrimCollectionStatus
  let snapshot: APIPlatformSnapshot?
}

struct BrimCollection: Sendable {
  let collectedAt: Date
  let quotas: [BrimQuotaObservation]
  let billing: [BrimBillingObservation]
}

public enum BrimCollector {
  typealias BillingFetcher =
    @Sendable (APIPlatformID) async throws(APIPlatformError)
    -> APIPlatformSnapshot

  /// Refresh live usage inputs and publish one collection to the shared service.
  @MainActor public static func run(baseURL: String, token: String) async throws {
    let publisher = try BrimCollectorPublisher(baseURL: baseURL, token: token)
    let legacyHistory = JSONUsageHistoryStore()
    let history = BrimCollectorHistory(
      legacy: legacyHistory,
      stateURL: legacyHistory.url.deletingLastPathComponent()
        .appending(path: "Collector/pending-history.json"))
    let lock = try history.lock()
    defer { try? lock.close() }
    guard let defaults = UserDefaults(suiteName: "com.sjerred.QuotaBar") else {
      throw QuotaError.settingsCorrupt
    }
    let settings = AppSettings(store: UserDefaultsSettingsStore(defaults: defaults))
    guard settings.validationErrorMessage == nil else { throw QuotaError.settingsCorrupt }
    let credentials = CompositeCredentialStore(
      manual: ManualCredentialStore(), local: LocalCredentialStore())
    let providers = try Providers.live(
      credentials: credentials, providerIDs: settings.visibleProviderIDs)
    let billingCredentials = APIPlatformCredentialStore()
    let openAI = OpenAIAPIClient()
    let anthropic = AnthropicAPIClient()
    let fetchBilling: BillingFetcher = { platform in
      try await APIPlatformModel.readSnapshot(
        platform: platform, openAI: openAI, anthropic: anthropic,
        credentials: billingCredentials, timeout: .seconds(25))
    }
    let collection = await collect(
      providers: providers, enabled: settings.enabledProviders, fetchBilling: fetchBilling)
    try await send(collection, history: history, publish: publisher.publish)
  }

  static func collect(
    providers: [any UsageProvider], enabled: Set<ProviderID>,
    fetchBilling: @escaping BillingFetcher
  ) async -> BrimCollection {
    async let quotas = quotaObservations(providers: providers, enabled: enabled)
    async let billing = billingObservations(fetch: fetchBilling)
    let (quotaResults, billingResults) = await (quotas, billing)
    return BrimCollection(collectedAt: .now, quotas: quotaResults, billing: billingResults)
  }

  static func send(
    _ collection: BrimCollection,
    history: BrimCollectorHistory,
    publish: (BrimCollection, [UsageHistorySample]) async throws -> Void
  ) async throws {
    let samples = try history.stage(collection)
    if samples.isEmpty {
      try await publish(collection, [])
    } else {
      let batchSize = 4_000
      for start in stride(from: 0, to: samples.count, by: batchSize) {
        let end = min(start + batchSize, samples.count)
        try await publish(collection, Array(samples[start..<end]))
      }
    }
    try history.acknowledge()
  }

  private static func quotaObservations(
    providers: [any UsageProvider], enabled: Set<ProviderID>
  ) async -> [BrimQuotaObservation] {
    await withTaskGroup(of: BrimQuotaObservation.self) { group in
      for provider in providers {
        if enabled.contains(provider.id) {
          group.addTask { await readQuota(provider) }
        } else {
          group.addTask {
            BrimQuotaObservation(provider: provider.id, status: .disabled, snapshot: nil)
          }
        }
      }
      var observations: [BrimQuotaObservation] = []
      for await observation in group { observations.append(observation) }
      return observations.sorted { $0.provider.rawValue < $1.provider.rawValue }
    }
  }

  private static func readQuota(_ provider: any UsageProvider) async -> BrimQuotaObservation {
    switch await QuotaBarModel.fetch(provider: provider, timeout: .seconds(25)) {
    case let .success(id, snapshot):
      if snapshot.freshness == .current {
        return BrimQuotaObservation(provider: id, status: .current, snapshot: snapshot)
      }
      return BrimQuotaObservation(provider: id, status: .unavailable, snapshot: nil)
    case let .failure(id, error):
      return BrimQuotaObservation(
        provider: id, status: error.isAuthenticationError ? .signInRequired : .unavailable,
        snapshot: nil)
    }
  }

  private static func billingObservations(
    fetch: @escaping BillingFetcher
  ) async -> [BrimBillingObservation] {
    await withTaskGroup(of: BrimBillingObservation.self) { group in
      for platform in APIPlatformID.allCases {
        group.addTask {
          do throws(APIPlatformError) {
            let snapshot = try await fetch(platform)
            return BrimBillingObservation(platform: platform, status: .current, snapshot: snapshot)
          } catch {
            return BrimBillingObservation(
              platform: platform,
              status: error.isAuthenticationError ? .signInRequired : .unavailable,
              snapshot: nil)
          }
        }
      }
      var observations: [BrimBillingObservation] = []
      for await observation in group { observations.append(observation) }
      return observations.sorted { $0.platform.rawValue < $1.platform.rawValue }
    }
  }
}
