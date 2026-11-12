public import Foundation

// Captured agent requests: `/v1/captures` and `/v1/captures/<id>`.
// Contracts: `packages/toolkit/schemas/history-api-captures.schema.json` and
// `history-api-capture-detail.schema.json`.

/// Token usage the API reported for one captured request.
public struct CaptureUsage: Decodable, Equatable, Sendable {
  public let inputTokens: Int
  public let outputTokens: Int
  /// Anthropic: additive cache reads.
  public let cacheReadTokens: Int
  /// Anthropic: additive cache writes.
  public let cacheCreationTokens: Int
  /// OpenAI: the cached subset of `inputTokens`.
  public let cachedInputTokens: Int
  public let reasoningTokens: Int

  public var totalTokens: Int {
    inputTokens + outputTokens + cacheReadTokens + cacheCreationTokens
  }
}

/// Serialized bytes of each part of the context a request sent.
public struct CaptureContext: Decodable, Equatable, Sendable {
  public let systemBytes: Int
  public let toolsBytes: Int
  /// Conversation shared with the previous request in the session.
  public let historyBytes: Int
  /// Conversation this request added.
  public let newBytes: Int

  public var totalBytes: Int { systemBytes + toolsBytes + historyBytes + newBytes }
}

public enum CaptureTransport: String, Decodable, Sendable {
  case http
  case websocket
}

public enum CaptureFormat: String, Decodable, Sendable {
  case anthropicMessages = "anthropic-messages"
  case openAIResponses = "openai-responses"
  case openAIChat = "openai-chat"
  case unknown
}

public enum CaptureStatus: String, Decodable, Sendable {
  case pending
  case ok
  case error
  case incomplete
}

/// One captured inference request.
public struct HistoryCapture: Decodable, Equatable, Identifiable, Sendable {
  /// Stable: captures are never rebuilt.
  public let id: Int
  public let cli: String
  public let transport: CaptureTransport
  public let format: CaptureFormat
  public let host: String
  public let path: String
  /// The CLI's session id (Claude) or thread id (Codex), when sent.
  public let sessionId: String?
  public let cwd: String?
  public let startedAt: Date
  public let endedAt: Date?
  public let durationMs: Int?
  public let model: String?
  public let status: CaptureStatus
  public let httpStatus: Int?
  public let error: String?
  public let usage: CaptureUsage?
  public let context: CaptureContext
  public let blockCount: Int
  public let newBlockCount: Int
  /// False when a chained request's parent was never captured.
  public let contextComplete: Bool
  /// The request this one is diffed against; never a warm-up.
  public let previousCaptureId: Int?
  /// A Codex warm-up (`generate: false`): it carries no context or output.
  public let warmup: Bool
}

/// `/v1/captures`.
public struct HistoryCapturesPage: HistoryVersionedResponse, Equatable, Sendable {
  public let apiVersion: Int
  /// The history session filter, or `nil` for every capture.
  public let session: Int?
  public let captures: [HistoryCapture]
  public let hasMore: Bool
}

/// One part of a request block, in the OpenTelemetry GenAI message-part
/// shape plus tool definitions. An unknown `type` fails decoding.
public enum CapturePart: Decodable, Equatable, Sendable {
  case text(String)
  case reasoning(String)
  case toolCall(id: String?, name: String, arguments: HistoryJSON)
  case toolCallResponse(id: String?, response: HistoryJSON)
  /// `namespace` is the dotted path of the namespaces that grouped the tool
  /// (Codex `functions`); `parameters` is its argument schema or grammar.
  case toolDefinition(
    name: String, namespace: String?, description: String?, parameters: HistoryJSON)
  case other(HistoryJSON)

  private enum CodingKeys: String, CodingKey {
    case type, content, id, name, arguments, response, description, namespace, parameters
  }

  public init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    let type = try container.decode(String.self, forKey: .type)
    switch type {
    case "text":
      self = .text(try container.decode(String.self, forKey: .content))
    case "reasoning":
      self = .reasoning(try container.decode(String.self, forKey: .content))
    case "tool_call":
      self = .toolCall(
        id: try container.decode(String?.self, forKey: .id),
        name: try container.decode(String.self, forKey: .name),
        arguments: try container.decodeOpenValue(forKey: .arguments))
    case "tool_call_response":
      self = .toolCallResponse(
        id: try container.decode(String?.self, forKey: .id),
        response: try container.decodeOpenValue(forKey: .response))
    case "tool_definition":
      self = .toolDefinition(
        name: try container.decode(String.self, forKey: .name),
        namespace: try container.decode(String?.self, forKey: .namespace),
        description: try container.decode(String?.self, forKey: .description),
        parameters: try container.decodeOpenValue(forKey: .parameters))
    case "other":
      self = .other(try container.decodeOpenValue(forKey: .content))
    default:
      throw DecodingError.dataCorruptedError(
        forKey: .type, in: container, debugDescription: "unknown capture part type \(type)")
    }
  }
}

public enum CaptureSection: String, Decodable, Sendable {
  case system
  case tools
  case messages
}

public enum CaptureCategory: String, Decodable, Sendable {
  case system
  case tools
  case conversation
}

/// One request block: a system part, a tool definition, or a message.
public struct CaptureBlock: Decodable, Equatable, Identifiable, Sendable {
  public let hash: String
  /// Where the wire format put it.
  public let section: CaptureSection
  /// What it is, wherever it was sent (Codex sends its system prompt as
  /// `developer` messages).
  public let category: CaptureCategory
  public let index: Int
  public let role: String?
  public let bytes: Int
  /// Not sent in this request; rebuilt from the chained parent (Codex).
  public let inherited: Bool
  /// New relative to the previous request in the session.
  public let isNew: Bool
  /// The block's position in `rawRequest`; `nil` when it was inherited.
  public let sentIndex: Int?
  public let parts: [CapturePart]

  public var id: String { "\(section.rawValue)-\(index)" }
}

public struct CaptureRequest: Decodable, Equatable, Sendable {
  public let system: [CaptureBlock]
  public let tools: [CaptureBlock]
  public let messages: [CaptureBlock]
}

public struct CaptureToolCall: Decodable, Equatable, Sendable {
  public let id: String?
  public let name: String
  public let arguments: HistoryJSON

  private enum CodingKeys: String, CodingKey { case id, name, arguments }

  public init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    id = try container.decode(String?.self, forKey: .id)
    name = try container.decode(String.self, forKey: .name)
    arguments = try container.decodeOpenValue(forKey: .arguments)
  }
}

public struct CaptureResponse: Decodable, Equatable, Sendable {
  public let text: String
  public let reasoning: String
  public let toolCalls: [CaptureToolCall]
  public let stopReason: String?
}

/// One field of a schema-less protobuf dump.
public struct CaptureProtoField: Decodable, Equatable, Sendable {
  public enum Wire: String, Decodable, Sendable {
    case varint, fixed64, fixed32, string, bytes
  }

  public let path: String
  public let wire: Wire
  public let value: String
}

/// `/v1/captures/<id>`: the rebuilt request, the response, and what changed.
public struct HistoryCaptureDetail: HistoryVersionedResponse, Equatable, Sendable {
  public let apiVersion: Int
  public let capture: HistoryCapture
  public let request: CaptureRequest
  public let response: CaptureResponse?
  /// The blocks this request added over `previousCaptureId`, in order.
  public let newBlocks: [CaptureBlock]
  /// The body exactly as sent (redacted). A chained request's holds only its
  /// incremental input; `request` is the full rebuilt context.
  public let rawRequest: HistoryJSON
  /// The final response object, assembled from SSE or WebSocket events.
  public let rawResponse: HistoryJSON
  /// A schema-less dump when the request body is protobuf.
  public let fields: [CaptureProtoField]?

  private enum CodingKeys: String, CodingKey {
    case apiVersion, capture, request, response, newBlocks, rawRequest, rawResponse, fields
  }

  public init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    apiVersion = try container.decode(Int.self, forKey: .apiVersion)
    capture = try container.decode(HistoryCapture.self, forKey: .capture)
    request = try container.decode(CaptureRequest.self, forKey: .request)
    response = try container.decode(CaptureResponse?.self, forKey: .response)
    newBlocks = try container.decode([CaptureBlock].self, forKey: .newBlocks)
    rawRequest = try container.decodeOpenValue(forKey: .rawRequest)
    rawResponse = try container.decodeOpenValue(forKey: .rawResponse)
    fields = try container.decode([CaptureProtoField]?.self, forKey: .fields)
  }

  /// Every block of a category, wherever the wire format put it: Codex
  /// sends its system prompt and tools as `developer` messages.
  public func blocks(_ category: CaptureCategory) -> [CaptureBlock] {
    (request.system + request.tools + request.messages).filter { $0.category == category }
  }

  /// Each tool definition, one per `tool_definition` part.
  public var toolDefinitions: [CaptureToolDefinition] {
    blocks(.tools).flatMap { block in
      block.parts.enumerated().compactMap { offset, part in
        guard case let .toolDefinition(name, namespace, description, parameters) = part else {
          return nil
        }
        return CaptureToolDefinition(
          id: "\(block.id)-\(offset)", name: name, namespace: namespace,
          description: description, parameters: parameters, block: block)
      }
    }
  }

  /// Tool definitions grouped by namespace, in the order each namespace
  /// first appears; top-level tools have a `nil` namespace.
  public var toolGroups: [CaptureToolGroup] {
    var groups: [CaptureToolGroup] = []
    for tool in toolDefinitions {
      if let index = groups.firstIndex(where: { $0.namespace == tool.namespace }) {
        groups[index].tools.append(tool)
      } else {
        groups.append(CaptureToolGroup(namespace: tool.namespace, tools: [tool]))
      }
    }
    return groups
  }

  /// Whether `rawRequest` leaves out context this request inherited.
  public var omitsInheritedContext: Bool {
    (request.system + request.tools + request.messages).contains(where: \.inherited)
  }
}

/// One tool definition and the block that carried it.
public struct CaptureToolDefinition: Equatable, Identifiable, Sendable {
  public let id: String
  public let name: String
  public let namespace: String?
  public let description: String?
  /// The argument schema or grammar; `.null` when the tool declares none.
  public let parameters: HistoryJSON
  public let block: CaptureBlock
}

/// The tools of one namespace.
public struct CaptureToolGroup: Equatable, Identifiable, Sendable {
  public let namespace: String?
  public var tools: [CaptureToolDefinition]

  public var id: String { namespace ?? "" }
}

extension KeyedDecodingContainer {
  /// A `z.unknown()` field: JSON serialization drops an `undefined` value,
  /// so an absent key is the contract's undefined, read as JSON null.
  fileprivate func decodeOpenValue(forKey key: Key) throws -> HistoryJSON {
    try decodeIfPresent(HistoryJSON.self, forKey: key) ?? .null
  }
}
