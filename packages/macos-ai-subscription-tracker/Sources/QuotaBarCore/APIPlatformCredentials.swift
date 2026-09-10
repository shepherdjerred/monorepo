import Foundation
import Security

public actor APIPlatformCredentialStore {
  public static let service = "com.sjerred.QuotaBar.api-platform"

  private let keychain: any KeychainClient

  public init(keychain: any KeychainClient = SystemKeychainClient()) {
    self.keychain = keychain
  }

  public func token(for platform: APIPlatformID) throws -> String? {
    do {
      guard
        let data = try keychain.read(service: Self.service, account: platform.credentialAccount)
      else {
        return nil
      }
      guard let token = String(data: data, encoding: .utf8) else {
        throw APIPlatformError.keychain(platform, status: errSecDecode)
      }
      let normalized = token.trimmingCharacters(in: .whitespacesAndNewlines)
      guard !normalized.isEmpty else { throw APIPlatformError.credentialEmpty(platform) }
      return normalized
    } catch let error as APIPlatformError {
      throw error
    } catch let error as QuotaError {
      if case let .keychain(status) = error {
        throw APIPlatformError.keychain(platform, status: status)
      }
      throw error
    }
  }

  public func save(_ token: String, for platform: APIPlatformID) throws {
    let normalized = token.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !normalized.isEmpty else { throw APIPlatformError.credentialEmpty(platform) }
    do {
      try keychain.write(
        Data(normalized.utf8), service: Self.service, account: platform.credentialAccount)
    } catch let error as QuotaError {
      if case let .keychain(status) = error {
        throw APIPlatformError.keychain(platform, status: status)
      }
      throw error
    }
  }

  public func remove(for platform: APIPlatformID) throws {
    do {
      try keychain.delete(service: Self.service, account: platform.credentialAccount)
    } catch let error as QuotaError {
      if case let .keychain(status) = error {
        throw APIPlatformError.keychain(platform, status: status)
      }
      throw error
    }
  }
}
