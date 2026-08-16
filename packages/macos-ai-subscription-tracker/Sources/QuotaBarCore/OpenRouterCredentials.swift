import Foundation
import Security

public actor OpenRouterCredentialStore {
  public static let service = "com.sjerred.QuotaBar.api-platform"
  public static let account = "openrouter-management"

  private let keychain: any KeychainClient

  public init(keychain: any KeychainClient = SystemKeychainClient()) {
    self.keychain = keychain
  }

  public func token() throws -> String? {
    do {
      guard let data = try keychain.read(service: Self.service, account: Self.account) else {
        return nil
      }
      guard let token = String(data: data, encoding: .utf8) else {
        throw APIPlatformError.keychain(status: errSecDecode)
      }
      let normalized = token.trimmingCharacters(in: .whitespacesAndNewlines)
      guard !normalized.isEmpty else { throw APIPlatformError.credentialEmpty }
      return normalized
    } catch let error as APIPlatformError {
      throw error
    } catch let error as QuotaError {
      if case let .keychain(status) = error {
        throw APIPlatformError.keychain(status: status)
      }
      throw error
    }
  }

  public func save(_ token: String) throws {
    let normalized = token.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !normalized.isEmpty else { throw APIPlatformError.credentialEmpty }
    do {
      try keychain.write(
        Data(normalized.utf8), service: Self.service, account: Self.account)
    } catch let error as QuotaError {
      if case let .keychain(status) = error {
        throw APIPlatformError.keychain(status: status)
      }
      throw error
    }
  }

  public func remove() throws {
    do {
      try keychain.delete(service: Self.service, account: Self.account)
    } catch let error as QuotaError {
      if case let .keychain(status) = error {
        throw APIPlatformError.keychain(status: status)
      }
      throw error
    }
  }
}
