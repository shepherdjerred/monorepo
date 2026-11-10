import Foundation
import XCTest

@testable import QuotaBarCore

final class CaptureDecodingTests: XCTestCase {
  func testDecodesTheSharedCapturesFixture() throws {
    let page: HistoryCapturesPage = try decode("captures", path: "/v1/captures")
    XCTAssertNil(page.session)
    XCTAssertTrue(page.hasMore)
    XCTAssertEqual(page.captures.map(\.id), [5, 4])
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
    XCTAssertEqual(capture.context.newBytes, 251)
    XCTAssertEqual(capture.context.totalBytes, 697)
    XCTAssertEqual(capture.blockCount, 7)
    XCTAssertEqual(capture.newBlockCount, 3)
    XCTAssertTrue(capture.contextComplete)
    XCTAssertEqual(capture.previousCaptureId, 4)
    XCTAssertEqual(page.captures[1].usage?.reasoningTokens, 3)
  }

  func testDecodesTheSharedCaptureDetailFixture() throws {
    let detail: HistoryCaptureDetail = try decode("capture-detail", path: "/v1/captures/2")
    XCTAssertEqual(detail.capture.id, 2)
    XCTAssertEqual(detail.capture.format, .anthropicMessages)
    XCTAssertEqual(detail.capture.httpStatus, 200)
    XCTAssertEqual(detail.capture.usage?.cacheReadTokens, 34_031)
    XCTAssertEqual(detail.request.system.map(\.isNew), [false, false, true])
    XCTAssertEqual(detail.request.system.first?.inherited, true)
    XCTAssertEqual(detail.request.tools.compactMap(CaptureText.toolName), ["Bash", "Read"])
    XCTAssertEqual(detail.request.tools.first?.section, .tools)
    XCTAssertNil(detail.request.tools.first?.role)
    XCTAssertEqual(detail.request.messages.map(\.role), ["user", "assistant", "user"])
    XCTAssertEqual(detail.request.messages.first?.category, .conversation)
    XCTAssertEqual(
      detail.request.messages[1].parts,
      [.toolCall(id: "toolu_1", name: "Bash", arguments: .object(["command": .string("echo hi")]))])
    XCTAssertEqual(
      detail.request.messages[2].parts, [.toolCallResponse(id: "toolu_1", response: .string("hi"))])
    XCTAssertEqual(detail.response?.text, "hi")
    XCTAssertEqual(detail.response?.reasoning, "")
    XCTAssertEqual(detail.response?.toolCalls, [])
    XCTAssertEqual(detail.response?.stopReason, "end_turn")
    XCTAssertEqual(detail.newBlocks.map(\.id), ["system-2", "messages-1", "messages-2"])
    XCTAssertEqual(detail.rawRequest["model"], .string("claude-opus-5-5"))
    XCTAssertEqual(detail.rawRequest["stream"], .bool(true))
    XCTAssertEqual(detail.rawResponse["usage"]?["input_tokens"], .integer(2))
    XCTAssertNil(detail.fields)
    XCTAssertEqual(detail.blocks(.system).count, 3)
    XCTAssertEqual(detail.blocks(.conversation).count, 3)
    XCTAssertEqual(detail.toolDefinitions.map(\.name), ["Bash", "Read"])
    XCTAssertEqual(detail.toolDefinitions.map(\.id), ["tools-0-0", "tools-1-0"])
    XCTAssertEqual(detail.toolDefinitions.first?.description, "Run a shell command")
    XCTAssertNil(detail.rawToolDefinition(detail.toolDefinitions[0]))
  }

  func testDecodesEveryPartTypeAndAProtobufDump() throws {
    let body = """
      {"apiVersion":1,"capture":\(captureJSON),"request":{"system":[],"tools":[\(block(
        #"{"type":"tool_definition","name":"Read","description":null}"#, category: "tools"))],"messages":[\(block(
        #"{"type":"reasoning","content":"think"},{"type":"other","content":{"k":[1,2.5]}},"#
        + #"{"type":"tool_call","id":null,"name":"x"}"#))]},\
      "response":null,"newBlocks":[],\
      "rawRequest":{"tools":[{"type":"function","function":{"name":"Read"}}]},\
      "fields":[{"path":"1.2","wire":"varint","value":"7"}]}
      """
    let detail: HistoryCaptureDetail = try HistoryClient.decode(
      jsonResponse(body), path: "/v1/captures/9")
    XCTAssertEqual(
      detail.request.tools[0].parts, [.toolDefinition(name: "Read", description: nil)])
    XCTAssertEqual(
      detail.request.messages[0].parts,
      [
        .reasoning("think"), .other(.object(["k": .array([.integer(1), .number(2.5)])])),
        .toolCall(id: nil, name: "x", arguments: .null),
      ])
    XCTAssertNil(detail.response)
    XCTAssertEqual(detail.rawResponse, .null)
    XCTAssertEqual(detail.fields, [CaptureProtoField(path: "1.2", wire: .varint, value: "7")])
    XCTAssertEqual(
      detail.rawToolDefinition(detail.toolDefinitions[0]),
      .object(["type": .string("function"), "function": .object(["name": .string("Read")])]))
  }

  func testFindsACodexToolInsideItsRawInputItem() throws {
    let tools =
      #"{"type":"tool_definition","name":"functions","description":""},"#
      + #"{"type":"tool_definition","name":"clock","description":"time"}"#
    let body = """
      {"apiVersion":1,"capture":\(captureJSON),"request":{"system":[],"tools":[],"messages":[\(
        block(tools, category: "tools")),\(block(#"{"type":"text","content":"hi"}"#))]},\
      "response":null,"newBlocks":[],"rawRequest":{"input":[{"type":"additional_tools",\
      "tools":[{"type":"namespace","name":"functions","tools":[]},{"name":"clock","x":1}]}]},\
      "rawResponse":null,"fields":null}
      """
    let detail: HistoryCaptureDetail = try HistoryClient.decode(
      jsonResponse(body), path: "/v1/captures/9")
    XCTAssertEqual(detail.toolDefinitions.map(\.name), ["functions", "clock"])
    XCTAssertEqual(detail.blocks(.tools).count, 1)
    XCTAssertEqual(detail.blocks(.conversation).count, 1)
    XCTAssertEqual(
      detail.rawToolDefinition(detail.toolDefinitions[1]),
      .object(["name": .string("clock"), "x": .integer(1)]))
    XCTAssertEqual(
      detail.rawToolDefinition(detail.toolDefinitions[0])?["type"], .string("namespace"))
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
    "blockCount":0,"newBlockCount":0,"contextComplete":false,"previousCaptureId":null}
    """

  private func block(_ parts: String, category: String = "conversation") -> String {
    """
    {"hash":"h","section":"messages","category":"\(category)","index":0,"role":"user",\
    "bytes":1,"inherited":false,"isNew":true,"parts":[\(parts)]}
    """
  }

  private func decode<Value: HistoryVersionedResponse>(_ fixture: String, path: String) throws
    -> Value
  {
    try HistoryClient.decode(jsonResponse(try sharedHistoryFixture(fixture)), path: path)
  }
}
