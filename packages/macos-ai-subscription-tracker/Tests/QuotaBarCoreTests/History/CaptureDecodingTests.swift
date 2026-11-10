import Foundation
import XCTest

@testable import QuotaBarCore

final class CaptureDecodingTests: XCTestCase {
  func testDecodesTheSharedCapturesFixture() throws {
    let page: HistoryCapturesPage = try decode("captures", path: "/v1/captures")
    XCTAssertNil(page.session)
    XCTAssertTrue(page.hasMore)
    XCTAssertEqual(page.captures.map(\.id), [5, 4, 3])
    XCTAssertEqual(page.captures.map(\.warmup), [false, false, true])
    XCTAssertEqual(page.captures.map(\.previousCaptureId), [4, nil, nil])
    let capture = page.captures[0]
    XCTAssertEqual(capture.cli, "codex")
    XCTAssertEqual(capture.transport, .websocket)
    XCTAssertEqual(capture.format, .openAIResponses)
    XCTAssertEqual(capture.host, "chatgpt.com")
    XCTAssertEqual(capture.sessionId, "01a1c37b-1894-7231-a7ae-e3d2da985034")
    XCTAssertEqual(capture.startedAt, date("2026-11-10T03:30:08Z"))
    XCTAssertEqual(capture.endedAt, date("2026-11-10T03:30:10Z"))
    XCTAssertEqual(capture.durationMs, 2_000)
    XCTAssertEqual(capture.status, .ok)
    XCTAssertNil(capture.httpStatus)
    XCTAssertNil(capture.error)
    XCTAssertEqual(capture.usage?.cachedInputTokens, 26_112)
    XCTAssertEqual(capture.usage?.totalTokens, 26_317)
    XCTAssertEqual(capture.context.toolsBytes, 567)
    XCTAssertEqual(capture.context.totalBytes, 1_144)
    XCTAssertEqual(capture.blockCount, 7)
    XCTAssertEqual(capture.newBlockCount, 3)
    XCTAssertTrue(capture.contextComplete)
    XCTAssertEqual(page.captures[1].usage?.reasoningTokens, 3)
    let warmup = page.captures[2]
    XCTAssertNil(warmup.cwd)
    XCTAssertEqual(warmup.blockCount, 0)
    XCTAssertEqual(warmup.context.totalBytes, 0)
  }

  func testDecodesTheSharedCaptureDetailFixture() throws {
    let detail: HistoryCaptureDetail = try decode("capture-detail", path: "/v1/captures/5")
    XCTAssertEqual(detail.capture.id, 5)
    XCTAssertEqual(detail.capture.previousCaptureId, 4)
    XCTAssertFalse(detail.capture.warmup)
    XCTAssertTrue(detail.request.system.isEmpty)
    XCTAssertTrue(detail.request.tools.isEmpty)
    let messages = detail.request.messages
    XCTAssertEqual(messages.map(\.index), Array(0...6))
    XCTAssertEqual(messages.map(\.sentIndex), [nil, nil, nil, nil, nil, nil, 0])
    XCTAssertEqual(messages.map(\.inherited), [true, true, true, true, true, true, false])
    XCTAssertEqual(messages.first?.category, .tools)
    XCTAssertEqual(messages.first?.role, "developer")
    XCTAssertEqual(detail.blocks(.system).map(\.index), [1])
    XCTAssertEqual(detail.blocks(.tools).map(\.index), [0])
    XCTAssertEqual(detail.blocks(.conversation).map(\.index), [2, 3, 4, 5, 6])
    XCTAssertEqual(messages[1].parts, [.text("You are Codex.")])
    XCTAssertEqual(
      messages[5].parts,
      [.toolCall(id: "call_1", name: "exec", arguments: .object(["cmd": .string("echo hi")]))])
    XCTAssertEqual(messages[6].parts, [.toolCallResponse(id: "call_1", response: .string("hi"))])

    XCTAssertEqual(detail.toolDefinitions.map(\.name), ["exec", "apply_patch", "sleep"])
    XCTAssertEqual(
      detail.toolDefinitions.map(\.id), ["messages-0-0", "messages-0-1", "messages-0-2"])
    XCTAssertEqual(detail.toolDefinitions.first?.description, "Run a command")
    XCTAssertEqual(detail.toolDefinitions.last?.parameters, .null)
    XCTAssertEqual(
      detail.toolDefinitions.first?.parameters["properties"]?["cmd"]?["type"], .string("string"))
    XCTAssertEqual(detail.toolGroups.map(\.namespace), ["functions", "clock"])
    XCTAssertEqual(detail.toolGroups.map(\.id), ["functions", "clock"])
    XCTAssertEqual(detail.toolGroups.first?.tools.map(\.name), ["exec", "apply_patch"])

    XCTAssertEqual(detail.response?.text, "hi")
    XCTAssertEqual(detail.response?.reasoning, "")
    XCTAssertEqual(detail.response?.toolCalls, [])
    XCTAssertEqual(detail.response?.stopReason, "completed")
    XCTAssertEqual(detail.newBlocks.map(\.id), ["messages-4", "messages-5", "messages-6"])
    XCTAssertEqual(detail.newBlocks.map(\.sentIndex), [nil, nil, 0])
    XCTAssertEqual(detail.rawRequest["previous_response_id"], .string("resp_1"))
    XCTAssertEqual(detail.rawRequest["input"]?.arrayValue?.count, 1)
    XCTAssertTrue(detail.omitsInheritedContext)
    XCTAssertNotEqual(detail.rawResponse, .null)
    XCTAssertNil(detail.fields)
  }

  func testDecodesEveryPartTypeAndAProtobufDump() throws {
    let body = """
      {"apiVersion":1,"capture":\(captureJSON),"request":{"system":[],"tools":[\(block(
        #"{"type":"tool_definition","name":"Read","namespace":null,"description":null}"#,
        category: "tools"))],"messages":[\(block(
        #"{"type":"reasoning","content":"think"},{"type":"other","content":{"k":[1,2.5]}},"#
        + #"{"type":"tool_call","id":null,"name":"x"}"#))]},\
      "response":null,"newBlocks":[],\
      "rawRequest":{"tools":[{"type":"function","function":{"name":"Read"}}]},\
      "fields":[{"path":"1.2","wire":"varint","value":"7"}]}
      """
    let detail: HistoryCaptureDetail = try HistoryClient.decode(
      jsonResponse(body), path: "/v1/captures/9")
    XCTAssertEqual(
      detail.request.tools[0].parts,
      [.toolDefinition(name: "Read", namespace: nil, description: nil, parameters: .null)])
    XCTAssertEqual(detail.toolGroups.map(\.namespace), [nil])
    XCTAssertEqual(detail.toolGroups.first?.id, "")
    XCTAssertFalse(detail.omitsInheritedContext)
    XCTAssertEqual(
      detail.request.messages[0].parts,
      [
        .reasoning("think"), .other(.object(["k": .array([.integer(1), .number(2.5)])])),
        .toolCall(id: nil, name: "x", arguments: .null),
      ])
    XCTAssertNil(detail.response)
    XCTAssertEqual(detail.rawResponse, .null)
    XCTAssertEqual(detail.fields, [CaptureProtoField(path: "1.2", wire: .varint, value: "7")])
  }

  func testRejectsAnUnknownPartType() {
    let body = """
      {"apiVersion":1,"capture":\(captureJSON),"request":{"system":[\(block(
        #"{"type":"image","url":"x"}"#))],"tools":[],"messages":[]},"response":null,\
      "newBlocks":[],"rawRequest":null,"rawResponse":null,"fields":null}
      """
    XCTAssertThrowsError(
      try HistoryClient.decode(jsonResponse(body), path: "/v1/captures/9") as HistoryCaptureDetail
    ) { error in
      guard case let .decoding(_, detail) = error as? HistoryAPIError else {
        return XCTFail("Expected a decoding error, got \(error)")
      }
      XCTAssertTrue(detail.contains("unknown capture part type image"), detail)
    }
  }

  func testJSONValuesPrettyPrintWithSortedKeys() throws {
    let value = try JSONDecoder().decode(
      HistoryJSON.self, from: Data(#"{"b":[true,null,1,1.5],"a":"x/y"}"#.utf8))
    XCTAssertEqual(
      value.prettyPrinted,
      "{\n  \"a\" : \"x/y\",\n  \"b\" : [\n    true,\n    null,\n    1,\n    1.5\n  ]\n}")
    XCTAssertEqual(HistoryJSON.string("plain").prettyPrinted, "plain")
    XCTAssertEqual(HistoryJSON.integer(3).prettyPrinted, "3")
    XCTAssertNil(HistoryJSON.integer(3)["a"])
    XCTAssertNil(HistoryJSON.integer(3).arrayValue)
    XCTAssertNil(HistoryJSON.integer(3).stringValue)
  }

  func testBuildsCaptureTargets() {
    XCTAssertEqual(
      HistoryEndpoint.captures(session: 42, limit: 100, offset: 0).target,
      "/v1/captures?session=42&limit=100&offset=0")
    XCTAssertEqual(HistoryEndpoint.capture(id: 7).target, "/v1/captures/7")
  }

  private let captureJSON = """
    {"id":9,"cli":"cursor-agent","transport":"http","format":"unknown","host":"api2.cursor.sh",\
    "path":"/aiserver.v1.ChatService/StreamChat","sessionId":null,"cwd":null,\
    "startedAt":"2026-11-10T03:30:08Z","endedAt":null,"durationMs":null,"model":null,\
    "status":"pending","httpStatus":null,"error":null,"usage":null,\
    "context":{"systemBytes":0,"toolsBytes":0,"historyBytes":0,"newBytes":0},\
    "blockCount":0,"newBlockCount":0,"contextComplete":false,"previousCaptureId":null,\
    "warmup":false}
    """

  private func block(_ parts: String, category: String = "conversation") -> String {
    """
    {"hash":"h","section":"messages","category":"\(category)","index":0,"role":"user",\
    "bytes":1,"inherited":false,"isNew":true,"sentIndex":0,"parts":[\(parts)]}
    """
  }

  private func decode<Value: HistoryVersionedResponse>(_ fixture: String, path: String) throws
    -> Value
  {
    try HistoryClient.decode(jsonResponse(try sharedHistoryFixture(fixture)), path: path)
  }
}
