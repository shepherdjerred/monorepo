import Foundation
import Testing

@testable import HKCTLCore

@Test
func decodesVersionedBatchRequest() throws {
  let data = Data(
    """
    {
      "version": 1,
      "home": "Home",
      "operations": [
        { "kind": "rename-room", "from": "Guest", "to": "Guest Bedroom" },
        { "kind": "assign-accessory", "name": "Desk Lamp", "room": "Office" }
      ]
    }
    """.utf8
  )

  let request = try BatchRequest.decode(data: data)

  #expect(request.version == 1)
  #expect(request.home == "Home")
  #expect(
    request.operations == [
      .renameRoom(from: "Guest", to: "Guest Bedroom"),
      .assignAccessory(selector: .name("Desk Lamp", manufacturer: nil), room: "Office"),
    ]
  )
}

@Test
func decodesAndNormalizesAccessoryIDSelectorsInVersionOne() throws {
  let data = Data(
    """
    {
      "version": 1,
      "operations": [
        {
          "kind": "assign-accessory",
          "id": "dd8cadc8-4576-50b8-8f34-d10a73393c9b",
          "room": "Laundry"
        }
      ]
    }
    """.utf8
  )

  let request = try BatchRequest.decode(data: data)

  #expect(
    request.operations
      == [
        .assignAccessory(
          selector: .id("DD8CADC8-4576-50B8-8F34-D10A73393C9B"),
          room: "Laundry"
        )
      ]
  )
}

@Test
func rejectsMissingDuplicateAndInvalidAccessorySelectors() {
  let requests = [
    #"{"version":1,"operations":[{"kind":"remove-accessory"}]}"#,
    """
    {"version":1,"operations":[{"kind":"remove-accessory","name":"Lamp",\
    "id":"DD8CADC8-4576-50B8-8F34-D10A73393C9B"}]}
    """,
    #"{"version":1,"operations":[{"kind":"remove-accessory","id":"not-a-uuid"}]}"#,
    """
    {"version":1,"operations":[{"kind":"rename-accessory",\
    "id":"DD8CADC8-4576-50B8-8F34-D10A73393C9B",\
    "manufacturer":"Zooz","to":"Lamp"}]}
    """,
  ]

  for request in requests {
    #expect(throws: HKCTLError.self) {
      try BatchRequest.decode(data: Data(request.utf8))
    }
  }
}

@Test
func rejectsUnknownBatchAndOperationFields() {
  let requests = [
    #"{"version":1,"operations":[{"kind":"remove-room","name":"Guest"}],"hom":"Home"}"#,
    """
    {"version":1,"operations":[{"kind":"rename-accessory",\
    "from":"Lamp","manufactuer":"Hue","to":"Desk Lamp"}]}
    """,
  ]

  for request in requests {
    #expect(throws: HKCTLError.self) {
      try BatchRequest.decode(data: Data(request.utf8))
    }
  }
}

@Test
func rejectsUnsupportedBatchVersion() {
  let data = Data(
    #"{"version":2,"operations":[{"kind":"remove-room","name":"Guest"}]}"#.utf8
  )

  #expect(throws: HKCTLError.self) {
    try BatchRequest.decode(data: data)
  }
}

@Test
func rejectsEmptyBatchOperations() {
  let data = Data(#"{"version":1,"operations":[]}"#.utf8)

  #expect(throws: HKCTLError.self) {
    try BatchRequest.decode(data: data)
  }
}

@Test
func operationEncodingUsesStableKindNames() throws {
  let request = BatchRequest(
    version: 1,
    home: nil,
    operations: [.removeAccessory(selector: .name("Stale Bridge", manufacturer: nil))]
  )
  let data = try JSONEncoder().encode(request)
  let object = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
  let operations = try #require(object["operations"] as? [[String: Any]])

  #expect(operations.first?["kind"] as? String == "remove-accessory")
}

@Test
func operationEncodingUsesFlatAccessoryIDSelector() throws {
  let id = "DD8CADC8-4576-50B8-8F34-D10A73393C9B"
  let request = BatchRequest(
    version: 1,
    home: nil,
    operations: [.assignAccessory(selector: .id(id), room: "Laundry")]
  )
  let data = try JSONEncoder().encode(request)
  let object = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
  let operations = try #require(object["operations"] as? [[String: Any]])

  #expect(operations.first?["kind"] as? String == "assign-accessory")
  #expect(operations.first?["id"] as? String == id)
  #expect(operations.first?["name"] == nil)
}
