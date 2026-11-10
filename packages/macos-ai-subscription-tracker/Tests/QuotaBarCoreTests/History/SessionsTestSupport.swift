import Foundation
import XCTest

@testable import QuotaBarCore

/// The fixtures toolkit's server is also tested against
/// (`packages/toolkit/schemas/fixtures/history-api-*.json`).
func sharedHistoryFixture(_ name: String) throws -> Data {
  var url = URL(fileURLWithPath: #filePath)
  for _ in 0..<5 { url.deleteLastPathComponent() }
  return try Data(
    contentsOf: url.appendingPathComponent("toolkit/schemas/fixtures/history-api-\(name).json"))
}

func utf8Text(_ data: Data) -> String {
  guard let text = String(bytes: data, encoding: .utf8) else {
    preconditionFailure("Expected UTF-8 test data")
  }
  return text
}

func jsonResponse(_ body: Data, status: Int = 200) -> HistoryHTTPResponse {
  HistoryHTTPResponse(status: status, body: body)
}

func jsonResponse(_ body: String, status: Int = 200) -> HistoryHTTPResponse {
  HistoryHTTPResponse(status: status, body: Data(body.utf8))
}

/// Records each request target and answers from a handler keyed by path.
actor HistoryRequestLog {
  private(set) var targets: [String] = []

  func record(_ target: String) { targets.append(target) }
}

struct FakeHistoryTransport: HistoryTransport {
  let log = HistoryRequestLog()
  let handler: @Sendable (_ path: String, _ target: String) throws -> HistoryHTTPResponse

  func get(_ target: String) async throws -> HistoryHTTPResponse {
    await log.record(target)
    let path = String(target.prefix { $0 != "?" })
    return try handler(path, target)
  }
}

/// Serves the shared fixtures, a two-page session list, and a two-page
/// conversation.
func fixtureTransport(failing failingPath: String? = nil) -> FakeHistoryTransport {
  FakeHistoryTransport { path, target in
    if path == failingPath {
      return jsonResponse(try sharedHistoryFixture("error"), status: 404)
    }
    switch path {
    case "/v1/sessions", "/v1/search":
      return jsonResponse(try sharedHistoryFixture("sessions"))
    case "/v1/sessions/42":
      let offset = target.contains("offset=0") ? 0 : 2
      return jsonResponse(conversationPage(offset: offset))
    case "/v1/usage":
      let body = try sharedHistoryFixture("usage")
      return jsonResponse(target.contains("groupBy=day") ? body : regroup(body, target: target))
    case "/v1/tools":
      return jsonResponse(try sharedHistoryFixture("tools"))
    default:
      return jsonResponse(#"{"error":"Not found"}"#, status: 404)
    }
  }
}

/// The usage fixture with its rows rekeyed for a non-day grouping.
private func regroup(_ body: Data, target: String) -> Data {
  let group = target.components(separatedBy: "groupBy=")[1].prefix { $0 != "&" }
  let keys: [String: [String]] = [
    "machine": ["null", #""jerred-desktop""#],
    "source": [#""codex-mirror""#, #""claude""#],
    "workspace": [#""C:\\Users\\jerred\\git\\monorepo""#, "null"],
    "model": [#""gpt-5.5-codex""#, #""claude-opus-5-5""#],
  ]
  var text = utf8Text(body)
    .replacingOccurrences(of: #""groupBy": "day""#, with: #""groupBy": "\#(group)""#)
  for (day, key) in zip([#""2026-11-07""#, #""2026-11-08""#], keys[String(group)] ?? []) {
    text = text.replacingOccurrences(of: #""key": \#(day)"#, with: #""key": \#(key)"#)
  }
  return Data(text.utf8)
}

/// A three-message session served as pages of two messages and one.
private func conversationPage(offset: Int) -> String {
  let messages = [
    #"{"role":"user","text":"Prune it.","createdAt":"2026-11-08T17:02:11Z","toolName":null}"#,
    #"{"role":"tool","text":"Bash argocd app list","createdAt":null,"toolName":"Bash"}"#,
    #"{"role":"assistant","text":"Done.","createdAt":null,"toolName":null}"#,
  ]
  let page = offset == 0 ? messages[0..<2] : messages[2...]
  let session = """
    {"id":42,"source":"claude","sourceId":"a.jsonl","title":"Prune","agent":"Claude Code",\
    "machine":null,"workspace":"/w","gitBranch":"main","primaryModel":"claude-opus-5-5",\
    "createdAt":"2026-11-08T17:02:11.000Z","updatedAt":"2026-11-08T18:40:03Z",\
    "messageCount":3,"toolCallCount":1,"usage":{"inputTokens":1,"outputTokens":2,\
    "cacheReadTokens":3,"cacheCreationTokens":4,"cachedInputTokens":0,"reasoningTokens":0,\
    "costUsd":1.5,"costComplete":true}}
    """
  return """
    {"apiVersion":1,"session":\(session),"messages":[\(page.joined(separator: ","))],\
    "offset":\(offset),"totalMessages":3}
    """
}
