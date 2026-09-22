import Foundation
import XCTest

@testable import QuotaBarCore

final class MuseProviderTests: XCTestCase {
  func testMuseParsesWindowAndWeeklyPools() throws {
    let now = date("2026-09-20T12:00:00Z")
    let snapshot = try MuseProvider.parse(data: fixture("muse-success"), now: now)

    XCTAssertEqual(snapshot.provider, .muse)
    XCTAssertEqual(snapshot.accountLabel, "Muse Code High Usage")
    XCTAssertEqual(snapshot.windows.map(\.label), ["5-hour", "Weekly"])
    XCTAssertEqual(snapshot.windows.compactMap(\.usedPercent), [62, 25])
    XCTAssertEqual(snapshot.windows[0].resetAt, date("2026-09-20T17:00:00Z"))
    XCTAssertEqual(snapshot.windows[1].resetAt, date("2026-09-22T00:00:00Z"))
    XCTAssertEqual(snapshot.sourceTimestamp, now)
    XCTAssertTrue(
      snapshot.notes.contains(
        "Uses the signed-in Muse OAuth credential read-only; only quota data is kept."))
  }

  func testMuseInactiveSubscriptionIsUnsupported() {
    XCTAssertThrowsError(try MuseProvider.parse(data: fixture("muse-inactive"))) { error in
      XCTAssertEqual(error as? QuotaError, .unsupportedResponse(.muse))
    }
  }

  func testMuseMissingUsageBlockIsUnsupported() {
    XCTAssertThrowsError(try MuseProvider.parse(data: fixture("muse-no-usage"))) { error in
      XCTAssertEqual(error as? QuotaError, .unsupportedResponse(.muse))
    }
    XCTAssertThrowsError(try MuseProvider.parse(data: Data("not-json".utf8))) { error in
      XCTAssertEqual(error as? QuotaError, .malformedResponse(.muse))
    }
  }

  func testMuseDropsWindowsWithoutUsablePercentages() throws {
    let missingWeekly = museResponse(windowUsed: 62, weeklyUsed: nil)
    let snapshot = try MuseProvider.parse(data: missingWeekly)
    XCTAssertEqual(snapshot.windows.map(\.label), ["5-hour"])
  }

  func testMuseRejectsPresentButUnusableValues() {
    // A present negative percentage fails loudly instead of dropping the window.
    let negativeWindow = museResponse(windowUsed: -5)
    XCTAssertThrowsError(try MuseProvider.parse(data: negativeWindow)) { error in
      XCTAssertEqual(error as? QuotaValidationError, .invalidPercentage)
    }
    // A present percentage with an unexpected type surfaces provider drift as malformed.
    let stringPercent = Data(
      (#"{"is_subs_active":true,"subs_usage":{"window":{"used_percent":"62","#
        + #""window_duration_mins":300},"weekly":{"used_percent":25}}}"#).utf8)
    XCTAssertThrowsError(try MuseProvider.parse(data: stringPercent)) { error in
      XCTAssertEqual(error as? QuotaError, .malformedResponse(.muse))
    }
    // A present duration with an unexpected type is malformed, not a silent relabel.
    let stringDuration = Data(
      (#"{"is_subs_active":true,"subs_usage":{"window":{"used_percent":62,"#
        + #""window_duration_mins":"300"},"weekly":{"used_percent":25}}}"#).utf8)
    XCTAssertThrowsError(try MuseProvider.parse(data: stringDuration)) { error in
      XCTAssertEqual(error as? QuotaError, .malformedResponse(.muse))
    }
  }

  func testMuseAcceptsFloatPercentagesAndStringResets() throws {
    let response = museResponse(windowUsed: 62.5, windowReset: .string("2026-09-20T17:00:00Z"))
    let snapshot = try MuseProvider.parse(data: response)
    XCTAssertEqual(snapshot.windows.compactMap(\.usedPercent), [62.5, 25])
    XCTAssertEqual(snapshot.windows[0].resetAt, date("2026-09-20T17:00:00Z"))
  }

  func testMuseOverQuotaClampsToFullWithNote() throws {
    let snapshot = try MuseProvider.parse(data: museResponse(windowUsed: 142))
    XCTAssertEqual(snapshot.windows.compactMap(\.usedPercent), [100, 25])
    XCTAssertTrue(
      snapshot.notes.contains("Muse reports over-quota usage; shown as fully used."))
  }

  func testMuseLabelsNonStandardDurations() throws {
    let snapshot = try MuseProvider.parse(data: museResponse(windowMinutes: 1_440))
    XCTAssertEqual(snapshot.windows.map(\.label), ["1d", "Weekly"])
  }

  func testMuseFetchPostsVersionedSubscriptionRequest() async throws {
    let endpoint = try XCTUnwrap(URL(string: "https://example.com/muse-code/key"))
    let transport = StubTransport([
      .success(ProviderResponse(statusCode: 200, data: fixture("muse-success")))
    ])
    let credentials = StubCredentialStore(tokens: ["muse-token"])
    let client = ProviderHTTPClient(transport: transport, credentials: credentials)
    let snapshot = try await MuseProvider(client: client, endpoint: endpoint).fetch()

    XCTAssertEqual(snapshot.provider, .muse)
    let requests = await transport.requests
    let request = try XCTUnwrap(requests.first)
    XCTAssertEqual(request.method, .post)
    XCTAssertEqual(request.url, endpoint)
    XCTAssertEqual(request.bearerToken, "muse-token")
    XCTAssertEqual(request.headers["x-api-version"], "1.0.0")
    XCTAssertEqual(request.headers["Content-Type"], "application/json")
    XCTAssertEqual(request.body, Data("{}".utf8))
  }

  func testMuseFetchUnauthorizedSurfacesExpiredCredentials() async throws {
    let endpoint = try XCTUnwrap(URL(string: "https://example.com/muse-code/key"))
    let transport = StubTransport([
      .success(ProviderResponse(statusCode: 401, data: Data())),
      .success(ProviderResponse(statusCode: 401, data: Data())),
    ])
    let client = ProviderHTTPClient(
      transport: transport,
      credentials: StubCredentialStore(tokens: ["stale-token", "fresh-token"])
    )
    do {
      _ = try await MuseProvider(client: client, endpoint: endpoint).fetch()
      XCTFail("Expected unauthorized for a twice-rejected token")
    } catch {
      XCTAssertEqual(error as? QuotaError, .unauthorized(.muse))
    }
  }

  func testMuseSubscriptionURLIsFixed() {
    XCTAssertEqual(
      MuseProvider.subscriptionURL.absoluteString, "https://api.meta.ai/muse-code/key")
  }
}

private enum MuseResetValue {
  case seconds(Int64)
  case string(String)
}

private func museResponse(
  windowUsed: Double? = 62,
  windowMinutes: Int = 300,
  windowReset: MuseResetValue = .seconds(1_789_923_600),
  weeklyUsed: Double? = 25,
  weeklyReset: Int64 = 1_790_035_200
) -> Data {
  let head = "\"window\":{"
  let used = windowUsed.map { "\"used_percent\":\($0)," } ?? ""
  let duration = "\"window_duration_mins\":\(windowMinutes),"
  let reset: String
  switch windowReset {
  case .seconds(let seconds):
    reset = "\"resets_at\":\(seconds)"
  case .string(let string):
    reset = "\"resets_at\":\"\(string)\""
  }
  let weeklyUsed = weeklyUsed.map { "\"used_percent\":\($0)," } ?? ""
  let weekly =
    "\"weekly\":{\(weeklyUsed)\"resets_at\":\(weeklyReset)},\"tier\":\"1000000000000001\""
  let body =
    "{\"is_subs_active\":true,\"subs_usage\":{\(head)\(used)\(duration)\(reset)},\(weekly)}}"
  return Data(body.utf8)
}
