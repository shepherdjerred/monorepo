import Foundation
import XCTest

@testable import QuotaBarCore

@MainActor
final class CapturesModelTests: XCTestCase {
  func testLoadsASessionsCapturesOnceAndPagesOn() async {
    let transport = fixtureTransport()
    let model = SessionsModel(client: HistoryClient(transport: transport)).captures
    XCTAssertEqual(model.listPhase, .idle)

    await model.load(session: 42)
    XCTAssertEqual(model.session, 42)
    XCTAssertEqual(model.listPhase, .loaded)
    XCTAssertEqual(model.captures.map(\.id), [5, 4])
    XCTAssertTrue(model.hasMore)

    await model.load(session: 42)
    await model.loadMore()
    XCTAssertEqual(model.captures.count, 4)
    await model.load(session: 42, force: true)
    XCTAssertEqual(model.captures.count, 2)

    let targets = await transport.log.targets
    XCTAssertEqual(
      targets,
      [
        "/v1/captures?session=42&limit=100&offset=0",
        "/v1/captures?session=42&limit=100&offset=2",
        "/v1/captures?session=42&limit=100&offset=0",
      ])
  }

  func testLoadsADetailOnlyWhenSelected() async {
    let transport = fixtureTransport()
    let model = CapturesModel(client: HistoryClient(transport: transport))
    await model.load(session: 42)
    await model.loadSelectedDetail()
    XCTAssertEqual(model.detailPhase, .idle)
    XCTAssertNil(model.detail)

    model.selectedCaptureID = 2
    await model.loadSelectedDetail()
    XCTAssertEqual(model.detailPhase, .loaded)
    XCTAssertEqual(model.detail?.capture.id, 2)
    await model.loadSelectedDetail()

    model.selectedCaptureID = nil
    await model.loadSelectedDetail()
    XCTAssertNil(model.detail)

    let targets = await transport.log.targets
    XCTAssertEqual(targets.filter { $0.hasPrefix("/v1/captures/") }, ["/v1/captures/2"])
  }

  func testAnotherSessionResetsTheSelection() async {
    let model = CapturesModel(client: HistoryClient(transport: fixtureTransport()))
    await model.load(session: 42)
    model.selectedCaptureID = 2
    await model.loadSelectedDetail()
    await model.load(session: 43)
    XCTAssertEqual(model.session, 43)
    XCTAssertNil(model.selectedCaptureID)
    XCTAssertNil(model.detail)
    XCTAssertEqual(model.detailPhase, .idle)
  }

  func testFailuresAreTypedAndRetried() async {
    let model = CapturesModel(
      client: HistoryClient(transport: fixtureTransport(failing: "/v1/captures")))
    await model.loadMore()
    await model.load(session: 99)
    XCTAssertEqual(
      model.listPhase.error,
      .server(
        status: 404,
        message: "History record 99 no longer exists; local ids change after a rebuild."))
    await model.load(session: 99)
    XCTAssertNotNil(model.listPhase.error)

    model.selectedCaptureID = 77
    await model.loadSelectedDetail()
    XCTAssertEqual(model.detailPhase.error, .server(status: 404, message: "Not found"))
  }
}

final class CaptureTextTests: XCTestCase {
  func testDurationsBytesAndStatus() throws {
    XCTAssertEqual(CaptureText.duration(nil), "—")
    XCTAssertEqual(CaptureText.duration(850), "850 ms")
    XCTAssertEqual(CaptureText.duration(2_000), "2.0 s")
    XCTAssertEqual(CaptureText.bytes(697), Int64(697).formatted(.byteCount(style: .file)))
    XCTAssertEqual(CaptureText.bytes(0), "0 bytes")
    let page: HistoryCapturesPage = try HistoryClient.decode(
      jsonResponse(try sharedHistoryFixture("captures")), path: "/v1/captures")
    XCTAssertNil(CaptureText.attention(page.captures[0]))
    let failed = utf8Text(try sharedHistoryFixture("captures"))
      .replacingOccurrences(of: #""status": "ok""#, with: #""status": "error""#)
      .replacingOccurrences(of: #""httpStatus": null"#, with: #""httpStatus": 529"#)
    let failedPage: HistoryCapturesPage = try HistoryClient.decode(
      jsonResponse(failed), path: "/v1/captures")
    XCTAssertEqual(CaptureText.attention(failedPage.captures[0]), "Error 529")
    let other =
      failed
      .replacingOccurrences(of: #""status": "error""#, with: #""status": "pending""#)
    let otherPage: HistoryCapturesPage = try HistoryClient.decode(
      jsonResponse(other), path: "/v1/captures")
    XCTAssertEqual(CaptureText.attention(otherPage.captures[0]), "Pending")
    let incomplete = failed.replacingOccurrences(
      of: #""status": "error""#, with: #""status": "incomplete""#)
    let incompletePage: HistoryCapturesPage = try HistoryClient.decode(
      jsonResponse(incomplete), path: "/v1/captures")
    XCTAssertEqual(CaptureText.attention(incompletePage.captures[0]), "Incomplete")
  }

  func testTokensNameOnlyWhatTheAPISent() throws {
    let detail: HistoryCaptureDetail = try HistoryClient.decode(
      jsonResponse(try sharedHistoryFixture("capture-detail")), path: "/v1/captures/2")
    XCTAssertEqual(CaptureText.tokens(detail.capture.usage), "in 2 · out 9 · cache r 34K w 92")
    let page: HistoryCapturesPage = try HistoryClient.decode(
      jsonResponse(try sharedHistoryFixture("captures")), path: "/v1/captures")
    XCTAssertEqual(CaptureText.tokens(page.captures[0].usage), "in 26.3K · out 7 · cached 26.1K")
    XCTAssertEqual(
      CaptureText.tokens(page.captures[1].usage),
      "in 26.2K · out 48 · cached 7.2K · reasoning 3")
    XCTAssertEqual(CaptureText.tokens(nil), "no usage")
    XCTAssertFalse(CaptureText.incompleteContextNote.isEmpty)
  }

  func testPartsReadAsText() {
    let parts: [CapturePart] = [
      .text("hi"), .reasoning("hmm"),
      .toolCall(id: "t", name: "Bash", arguments: .object(["command": .string("ls")])),
      .toolCallResponse(id: "t", response: .string("out")),
      .toolDefinition(name: "Read", description: "Read a file"),
      .toolDefinition(name: "Edit", description: nil), .other(.integer(1)),
    ]
    XCTAssertEqual(
      parts.map(CaptureText.text),
      [
        "hi", "hmm", "Bash {\n  \"command\" : \"ls\"\n}", "out", "Read: Read a file", "Edit",
        "1",
      ])
    XCTAssertEqual(
      parts.map(CaptureText.label),
      [
        "text", "reasoning", "tool call Bash", "tool result", "tool Read", "tool Edit", "other",
      ])
  }
}
