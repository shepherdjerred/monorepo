import Foundation
import XCTest

@testable import QuotaBarCore

final class OpenAIAnthropicAPITests: XCTestCase {
  func testOpenAISumsCurrentMonthCostsAndProjects() async throws {
    let endpoints = testOpenAIEndpoints()
    let now = date("2026-09-07T12:00:00Z")
    let start = try APIPlatformProjection.monthStart(
      platform: .openAI, now: now, timeZone: utcTimeZone())
    let transport = APIPlatformRoutingTransport(
      routes: [
        endpoints.costs(
          startTime: Int(start.timeIntervalSince1970),
          endTime: Int(now.timeIntervalSince1970),
          page: nil
        ).absoluteString: response(fixture("openai-costs"))
      ]
    )
    let client = OpenAIAPIClient(transport: transport, endpoints: endpoints)
    let snapshot = try await client.fetchSnapshot(
      token: "openai-admin",
      now: now,
      timeZone: utcTimeZone()
    )

    XCTAssertEqual(snapshot.platform, .openAI)
    XCTAssertNil(snapshot.creditsRemaining)
    XCTAssertEqual(snapshot.monthlySpend, decimal("12.5"))
    XCTAssertEqual(snapshot.projectedSpend, decimal("12.5") / Decimal(7) * Decimal(30))
    let requests = await transport.requests
    XCTAssertEqual(requests.count, 1)
    XCTAssertTrue(requests.allSatisfy { !$0.description.contains("openai-admin") })
  }

  func testOpenAIPaginatesCostBuckets() async throws {
    let endpoints = testOpenAIEndpoints()
    let now = date("2026-09-07T12:00:00Z")
    let start = try APIPlatformProjection.monthStart(
      platform: .openAI, now: now, timeZone: utcTimeZone())
    let startTime = Int(start.timeIntervalSince1970)
    let endTime = Int(now.timeIntervalSince1970)
    let firstPage = endpoints.costs(startTime: startTime, endTime: endTime, page: nil)
    let secondPage = endpoints.costs(startTime: startTime, endTime: endTime, page: "page-2")
    let transport = APIPlatformRoutingTransport(
      routes: [
        firstPage.absoluteString: response(
          Data(
            #"""
            {
              "object": "page",
              "data": [{ "results": [{ "amount": { "value": 4.25, "currency": "usd" } }] }],
              "has_more": true,
              "next_page": "page-2"
            }
            """#.utf8)
        ),
        secondPage.absoluteString: response(
          Data(
            #"""
            {
              "object": "page",
              "data": [{ "results": [{ "amount": { "value": 8.25, "currency": "usd" } }] }],
              "has_more": false,
              "next_page": null
            }
            """#.utf8)
        ),
      ]
    )
    let snapshot = try await OpenAIAPIClient(transport: transport, endpoints: endpoints)
      .fetchSnapshot(token: "secret", now: now, timeZone: utcTimeZone())
    XCTAssertEqual(snapshot.monthlySpend, decimal("12.5"))
    let requests = await transport.requests
    XCTAssertEqual(
      requests.map(\.url.absoluteString),
      [
        firstPage.absoluteString, secondPage.absoluteString,
      ])
  }

  func testOpenAIRejectsNonUSDAndUnauthorized() async throws {
    let endpoints = testOpenAIEndpoints()
    let now = date("2026-09-07T12:00:00Z")
    let start = try APIPlatformProjection.monthStart(
      platform: .openAI, now: now, timeZone: utcTimeZone())
    let costsURL = endpoints.costs(
      startTime: Int(start.timeIntervalSince1970),
      endTime: Int(now.timeIntervalSince1970),
      page: nil
    ).absoluteString

    let nonUSD = OpenAIAPIClient(
      transport: APIPlatformRoutingTransport(
        routes: [costsURL: response(fixture("openai-costs-eur"))]
      ),
      endpoints: endpoints
    )
    do {
      _ = try await nonUSD.fetchSnapshot(token: "secret", now: now, timeZone: utcTimeZone())
      XCTFail("Expected malformed non-USD response")
    } catch let error as APIPlatformError {
      XCTAssertEqual(error, .malformedResponse(.openAI))
    }

    let unauthorized = OpenAIAPIClient(
      transport: APIPlatformRoutingTransport(
        routes: [costsURL: APIPlatformResponse(statusCode: 401, data: Data())]
      ),
      endpoints: endpoints
    )
    do {
      _ = try await unauthorized.fetchSnapshot(token: "secret", now: now, timeZone: utcTimeZone())
      XCTFail("Expected unauthorized")
    } catch let error as APIPlatformError {
      XCTAssertEqual(error, .unauthorized(.openAI))
    }
  }

  func testAnthropicConvertsCentsAndProjects() async throws {
    let endpoints = testAnthropicEndpoints()
    let now = date("2026-09-07T12:00:00Z")
    let start = try APIPlatformProjection.monthStart(
      platform: .anthropic, now: now, timeZone: utcTimeZone())
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime]
    let reportURL = endpoints.costReport(
      startingAt: formatter.string(from: start),
      endingAt: formatter.string(from: now),
      page: nil
    ).absoluteString
    let transport = APIPlatformRoutingTransport(
      routes: [reportURL: response(fixture("anthropic-cost-report"))]
    )
    let client = AnthropicAPIClient(transport: transport, endpoints: endpoints)
    let snapshot = try await client.fetchSnapshot(
      token: "sk-ant-admin",
      now: now,
      timeZone: utcTimeZone()
    )

    XCTAssertEqual(snapshot.platform, .anthropic)
    XCTAssertNil(snapshot.creditsRemaining)
    XCTAssertEqual(snapshot.monthlySpend, decimal("8.5"))
    XCTAssertEqual(snapshot.projectedSpend, decimal("8.5") / Decimal(7) * Decimal(30))
    let requests = await transport.requests
    XCTAssertEqual(requests.count, 1)
    XCTAssertTrue(requests[0].headers["x-api-key"] == "sk-ant-admin")
    XCTAssertTrue(requests.allSatisfy { !$0.description.contains("sk-ant-admin") })
  }

  func testAnthropicRejectsNonUSDAndMalformedAmounts() async throws {
    let endpoints = testAnthropicEndpoints()
    let now = date("2026-09-07T12:00:00Z")
    let start = try APIPlatformProjection.monthStart(
      platform: .anthropic, now: now, timeZone: utcTimeZone())
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime]
    let reportURL = endpoints.costReport(
      startingAt: formatter.string(from: start),
      endingAt: formatter.string(from: now),
      page: nil
    ).absoluteString
    let client = AnthropicAPIClient(
      transport: APIPlatformRoutingTransport(
        routes: [reportURL: response(fixture("anthropic-cost-report-eur"))]
      ),
      endpoints: endpoints
    )
    do {
      _ = try await client.fetchSnapshot(token: "secret", now: now, timeZone: utcTimeZone())
      XCTFail("Expected malformed non-USD response")
    } catch let error as APIPlatformError {
      XCTAssertEqual(error, .malformedResponse(.anthropic))
    }

    let leftover = AnthropicAPIClient(
      transport: APIPlatformRoutingTransport(
        routes: [
          reportURL: response(
            Data(
              #"""
              {
                "data": [{
                  "starting_at": "2026-09-01T00:00:00Z",
                  "ending_at": "2026-09-02T00:00:00Z",
                  "results": [{ "amount": "12.34extra", "currency": "USD" }]
                }],
                "has_more": false,
                "next_page": null
              }
              """#.utf8)
          )
        ]
      ),
      endpoints: endpoints
    )
    do {
      _ = try await leftover.fetchSnapshot(token: "secret", now: now, timeZone: utcTimeZone())
      XCTFail("Expected leftover decimal digits to fail")
    } catch let error as APIPlatformError {
      XCTAssertEqual(error, .malformedResponse(.anthropic))
    }
  }
}
