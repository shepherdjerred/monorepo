import Foundation
import Testing

@testable import TaskNotesKit

@Suite("Shared native contract")
struct FacetSchemaTests {
    @Test func timestampClockAndOffsetRangesAreStrict() throws {
        let schema = try FacetSchema(
            data: Data(#"{"$defs":{"timestamp":{"type":"string","format":"date-time"}}}"#.utf8)
        )
        for valid in [
            "2026-10-07T00:00:00Z", "2026-10-07T23:59:59+23:59",
            "2026-10-07T23:59:59-23:59", "2026-10-07T12:00:00+00:00",
            "2026-10-07T12:00:00-00:00", "2026-10-07T23:59:59.123456789123456789Z",
        ] {
            try schema.validate(.string(valid), definition: "timestamp")
        }
        for invalid in [
            "2026-10-07T24:00:00Z", "2026-10-07T12:60:00Z", "2026-10-07T12:00:60Z",
            "2026-10-07T12:00:00+24:00", "2026-10-07T12:00:00-24:00",
            "2026-10-07T12:00:00+01:60", "2026-10-07T12:00:00. Z",
        ] {
            #expect(throws: FacetContractError.self, Comment(rawValue: invalid)) {
                try schema.validate(.string(invalid), definition: "timestamp")
            }
        }
    }

    @Test func writtenCalendarDatesPreserveOffsetsAndFractions() throws {
        let schema = try FacetSchema(
            data: Data(#"{"$defs":{"timestamp":{"type":"string","format":"date-time"}}}"#.utf8)
        )
        for valid in [
            "2024-02-29T01:00:00Z", "2000-02-29T01:00:00Z",
            "2026-01-01T00:00:00+14:00", "2026-12-31T23:59:59-12:00",
            "2026-10-07T12:00:00.250000001Z", "2024-02-29T23:59:59.123456789+05:45",
        ] {
            try schema.validate(.string(valid), definition: "timestamp")
        }
        for invalid in [
            "2026-02-30T01:00:00Z", "2026-02-30T01:00:00+05:45",
            "2026-02-29T01:00:00Z", "1900-02-29T01:00:00Z",
            "2024-02-30T01:00:00Z", "2026-04-31T01:00:00-12:00",
            "2026-13-01T01:00:00Z", "2026-01-00T01:00:00Z",
        ] {
            #expect(throws: FacetContractError.self, Comment(rawValue: invalid)) {
                try schema.validate(.string(invalid), definition: "timestamp")
            }
        }
    }

    @Test func exactRawNumericBoundaries() throws {
        let schema = try FacetSchema.bundled()
        for invalid in [
            "1.0000000000000000001", "1.00000000000000000000000000000000000000001", "1e-999999",
        ] {
            #expect(throws: (any Error).self) {
                try schema.validate(
                    json: "{\"schemaVersion\":\(invalid),\"profiles\":[]}", definition: "profiles")
            }
        }
        try schema.validate(json: #"{"schemaVersion":1.0,"profiles":[]}"#, definition: "profiles")
        try schema.validate(json: #"{"schemaVersion":1e0,"profiles":[]}"#, definition: "profiles")
        let numeric = try FacetSchema(
            data: Data(#"{"$defs":{"bounded":{"type":"integer","maximum":9007199254740992}}}"#.utf8)
        )
        try numeric.validate(json: "9007199254740992", definition: "bounded")
        #expect(throws: (any Error).self) {
            try numeric.validate(json: "9007199254740993", definition: "bounded")
        }
        let value = try JSONDecoder().decode(FacetValue.self, from: Data("9007199254740993".utf8))
        #expect(value == .integer(9_007_199_254_740_993))
    }
    @Test func positiveAndNegativeSharedCorpus() throws {
        let schema = try FacetSchema.bundled()
        let source = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        let corpus = try FacetJSON.parse(
            Data(
                contentsOf: source.appendingPathComponent(
                    "tasknotes-fixtures/vault/facet-contract.json")))
        let cases = try #require(corpus.object?.fields["cases"]?.array?.elements)
        for item in cases {
            let test = try #require(item.object?.fields)
            let name = try #require(test["id"]?.text)
            let definition = try #require(test["definition"]?.text)
            let value = try #require(test["value"])
            let expected = test["valid"] == .bool(true)
            var accepted = false
            do {
                try schema.validate(value, definition: definition)
                accepted = true
            } catch {}
            #expect(accepted == expected, Comment(rawValue: name))
        }
    }

    @Test func sharedRawNumericCorpus() throws {
        let schema = try FacetSchema.bundled()
        let source = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        let corpus = try FacetJSON.parse(
            Data(
                contentsOf: source.appendingPathComponent(
                    "tasknotes-fixtures/vault/facet-raw-contract.json")))
        let cases = try #require(corpus.object?.fields["cases"]?.array?.elements)
        for item in cases {
            let test = try #require(item.object?.fields)
            let name = try #require(test["id"]?.text)
            let definition = try #require(test["definition"]?.text)
            let raw = try #require(test["raw"]?.text)
            var accepted = false
            do {
                try schema.validate(json: raw, definition: definition)
                accepted = true
            } catch {}
            #expect(accepted == (test["valid"] == .bool(true)), Comment(rawValue: name))
        }
    }

    @Test func openNumericFieldsRemainExactAcrossNativeDecodingAndEncoding() throws {
        struct Properties: Decodable { let properties: [String: FacetValue] }
        let input =
            #"{"properties":{"fraction":1.00000000000000000000000000000000000000001,"#
            + #""huge":1e9999999999999999999999999999,"negativeZero":-0.0,"largeInteger":9007199254740993}}"#
        let data = Data(input.utf8)
        let decoded = try FacetJSON.decoder(data).decode(Properties.self, from: data)
        #expect(
            decoded.properties["fraction"]
                == .rawNumber("1.00000000000000000000000000000000000000001"))
        #expect(decoded.properties["huge"] == .rawNumber("1e9999999999999999999999999999"))
        #expect(decoded.properties["negativeZero"] == .rawNumber("-0.0"))
        let output = try FacetJSON.encode(.object(["properties": .object(decoded.properties)]))
        #expect(try FacetJSON.parse(Data(output.utf8)) == FacetJSON.parse(data))
        let schema = try FacetSchema(
            data: Data(
                #"{"$defs":{"open":{"type":"object","properties":{"properties":{"type":"object"}}}}}"#
                    .utf8))
        try schema.validate(json: input, definition: "open")
    }
}
