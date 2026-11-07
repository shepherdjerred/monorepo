public import Foundation

/// Reads Antigravity's Google AI plan, which only Google's Code Assist API reports.
public protocol AntigravityPlanFetching: Sendable {
  /// The raw `loadCodeAssist` answer for the signed-in agy account.
  func codeAssistData() async throws -> Data
}

/// Asks Google which plan the signed-in agy account has.
///
/// agy keeps a refresh token in `~/.gemini/antigravity-cli/antigravity-oauth-token` and renews
/// its short-lived access token in memory each run, never writing it back. This source does the
/// same: it renews with the OAuth client built into the installed agy binary, keeps the access
/// token in memory only, and never writes agy's files. Google does not rotate the refresh token
/// on renewal, so agy's own session is unaffected. The client is read from the binary at run time
/// (and cached until the binary changes), so no client secret lives in this repository.
public actor AntigravityPlanSource: AntigravityPlanFetching {
  public typealias Send = @Sendable (URLRequest) async throws -> (status: Int, body: Data)

  struct OAuthClient: Equatable, Sendable {
    let id: String
    let secret: String
  }

  private struct BinaryIdentity: Equatable {
    let path: String
    let size: Int
    let modified: Date
  }

  private let tokenFile: URL
  private let executable: @Sendable () throws -> URL
  private let tokenEndpoint: URL
  private let codeAssistEndpoint: URL
  private let send: Send
  private let now: @Sendable () -> Date

  private var clients: (binary: BinaryIdentity, clients: [OAuthClient])?
  private var workingClient: OAuthClient?
  private var access: AccessToken?

  private struct AccessToken {
    let refreshToken: String
    let token: String
    let expiresAt: Date
  }

  public init(
    tokenFile: URL,
    executable: @escaping @Sendable () throws -> URL,
    tokenEndpoint: URL,
    codeAssistEndpoint: URL,
    send: @escaping Send = AntigravityPlanSource.urlSession,
    now: @escaping @Sendable () -> Date = { Date() }
  ) {
    self.tokenFile = tokenFile
    self.executable = executable
    self.tokenEndpoint = tokenEndpoint
    self.codeAssistEndpoint = codeAssistEndpoint
    self.send = send
    self.now = now
  }

  public static func defaultTokenFile(
    homeDirectory: URL = FileManager.default.homeDirectoryForCurrentUser
  ) -> URL {
    homeDirectory.appendingPathComponent(".gemini/antigravity-cli/antigravity-oauth-token")
  }

  public static let urlSession: Send = { request in
    let session = URLSession(configuration: .ephemeral)
    let (data, response) = try await session.data(for: request)
    guard let http = response as? HTTPURLResponse else { throw QuotaError.network(.antigravity) }
    return (http.statusCode, data)
  }

  public func codeAssistData() async throws -> Data {
    let token = try await accessToken()
    var request = URLRequest(url: codeAssistEndpoint, timeoutInterval: 20)
    request.httpMethod = "POST"
    request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    // Without agy's user agent, Google answers as generic Gemini Code Assist (no paid tier).
    request.setValue("antigravity", forHTTPHeaderField: "User-Agent")
    request.httpBody = Data(
      #"{"metadata":{"ideType":"ANTIGRAVITY","platform":"PLATFORM_UNSPECIFIED","pluginType":"GEMINI"}}"#
        .utf8)
    let (status, body) = try await perform(request)
    if status == 401 {
      access = nil
      throw QuotaError.unauthorized(.antigravity)
    }
    guard status == 200 else { throw QuotaError.unsupportedResponse(.antigravity) }
    return body
  }

  private func accessToken() async throws -> String {
    let refreshToken = try readRefreshToken()
    if let access, access.refreshToken == refreshToken, access.expiresAt > now() {
      return access.token
    }
    let candidates = try oauthClients()
    let ordered = (workingClient.map { [$0] } ?? []) + candidates.filter { $0 != workingClient }
    for client in ordered {
      switch try await renew(refreshToken: refreshToken, client: client) {
      case let .renewed(token, expiresIn):
        workingClient = client
        // Renew a minute early so a request never carries a token that expires in flight.
        access = AccessToken(
          refreshToken: refreshToken, token: token,
          expiresAt: now().addingTimeInterval(max(0, expiresIn - 60)))
        return token
      case .wrongClient:
        continue
      case .rejected:
        throw QuotaError.unauthorized(.antigravity)
      }
    }
    throw QuotaError.unsupportedResponse(.antigravity)
  }

  private enum Renewal {
    case renewed(token: String, expiresIn: TimeInterval)
    /// This client did not issue the refresh token; another embedded client may have.
    case wrongClient
    /// The refresh token itself was refused (signed out or revoked).
    case rejected
  }

  private func renew(refreshToken: String, client: OAuthClient) async throws -> Renewal {
    var form = URLComponents()
    form.queryItems = [
      URLQueryItem(name: "grant_type", value: "refresh_token"),
      URLQueryItem(name: "refresh_token", value: refreshToken),
      URLQueryItem(name: "client_id", value: client.id),
      URLQueryItem(name: "client_secret", value: client.secret),
    ]
    var request = URLRequest(url: tokenEndpoint, timeoutInterval: 20)
    request.httpMethod = "POST"
    request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
    request.httpBody = Data((form.percentEncodedQuery ?? "").utf8)
    let (status, body) = try await perform(request)
    guard let answer = try? JSONDecoder().decode(GoogleTokenAnswer.self, from: body) else {
      throw QuotaError.malformedResponse(.antigravity)
    }
    if status == 200, let token = answer.accessToken, !token.isEmpty,
      let expiresIn = answer.expiresIn
    {
      return .renewed(token: token, expiresIn: expiresIn)
    }
    switch answer.error {
    case "invalid_client", "unauthorized_client": return .wrongClient
    case "invalid_grant": return .rejected
    default: throw QuotaError.unsupportedResponse(.antigravity)
    }
  }

  private func perform(_ request: URLRequest) async throws -> (status: Int, body: Data) {
    do {
      return try await send(request)
    } catch let error as QuotaError {
      throw error
    } catch let error as URLError where error.code == .timedOut {
      throw QuotaError.requestTimedOut(.antigravity)
    } catch {
      throw QuotaError.network(.antigravity)
    }
  }

  private func readRefreshToken() throws -> String {
    guard let data = try? Data(contentsOf: tokenFile) else {
      throw QuotaError.credentialsMissing(.antigravity)
    }
    guard let file = try? JSONDecoder().decode(AgyTokenFile.self, from: data) else {
      throw QuotaError.malformedResponse(.antigravity)
    }
    guard let refreshToken = file.token?.refreshToken, !refreshToken.isEmpty else {
      throw QuotaError.credentialsMissing(.antigravity)
    }
    return refreshToken
  }

  private func oauthClients() throws -> [OAuthClient] {
    let url = try executable().resolvingSymlinksInPath()
    let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
    let identity = BinaryIdentity(
      path: url.path,
      size: attributes[.size] as? Int ?? -1,
      modified: attributes[.modificationDate] as? Date ?? .distantPast
    )
    if let clients, clients.binary == identity { return clients.clients }
    let data = try Data(contentsOf: url, options: .alwaysMapped)
    let found = Self.oauthClients(in: data)
    guard !found.isEmpty else { throw QuotaError.unsupportedResponse(.antigravity) }
    clients = (identity, found)
    workingClient = nil
    return found
  }

  /// Every pairing of the Google OAuth client ids and secrets embedded in a binary. Each id is
  /// `<digits>-<lowercase alphanumerics>.apps.googleusercontent.com`; each secret is `GOCSPX-`
  /// plus exactly 28 characters (strings in a Go binary run together, so the length matters).
  static func oauthClients(in data: Data) -> [OAuthClient] {
    let suffix = Data(".apps.googleusercontent.com".utf8)
    let ids = occurrences(of: suffix, in: data).compactMap { match -> String? in
      var start = match.lowerBound
      while start > data.startIndex, isIDCharacter(data[start - 1]) { start -= 1 }
      // Strings run together, so letters may precede the id: keep the matching suffix.
      guard let run = String(data: data[start..<match.lowerBound], encoding: .ascii),
        let id = run.firstMatch(of: /[0-9]{6,}-[a-z0-9]{20,}$/)
      else { return nil }
      return String(id.output) + ".apps.googleusercontent.com"
    }
    let marker = Data("GOCSPX-".utf8)
    let secrets = occurrences(of: marker, in: data).compactMap { match -> String? in
      let end = match.upperBound + 28
      guard end <= data.endIndex, data[match.upperBound..<end].allSatisfy(isSecretCharacter)
      else { return nil }
      return String(data: data[match.lowerBound..<end], encoding: .ascii)
    }
    return Array(Set(ids)).sorted().flatMap { id in
      Array(Set(secrets)).sorted().map { OAuthClient(id: id, secret: $0) }
    }
  }

  /// Every match of `needle`, using `Data.range(of:)` so a memory-mapped binary is never copied.
  private static func occurrences(of needle: Data, in data: Data) -> [Range<Data.Index>] {
    var found: [Range<Data.Index>] = []
    var from = data.startIndex
    while from < data.endIndex, let match = data.range(of: needle, in: from..<data.endIndex) {
      found.append(match)
      from = match.upperBound
    }
    return found
  }

  private static func isIDCharacter(_ byte: UInt8) -> Bool {
    (0x30...0x39).contains(byte) || (0x61...0x7A).contains(byte) || byte == 0x2D
  }

  private static func isSecretCharacter(_ byte: UInt8) -> Bool {
    (0x30...0x39).contains(byte) || (0x41...0x5A).contains(byte) || (0x61...0x7A).contains(byte)
      || byte == 0x2D || byte == 0x5F
  }
}

/// Google's OAuth token endpoint answer: a token on success, an `error` code otherwise.
private struct GoogleTokenAnswer: Decodable {
  let accessToken: String?
  let expiresIn: TimeInterval?
  let error: String?
  enum CodingKeys: String, CodingKey {
    case accessToken = "access_token"
    case expiresIn = "expires_in"
    case error
  }
}

/// agy's `antigravity-oauth-token`; only the refresh token is read.
private struct AgyTokenFile: Decodable {
  let token: AgyToken?
}

private struct AgyToken: Decodable {
  let refreshToken: String?
  enum CodingKeys: String, CodingKey { case refreshToken = "refresh_token" }
}
