import { describe, expect, it } from "bun:test";
import { rangeSupportsProtobufV8 } from "./protobuf-watch.ts";

describe("rangeSupportsProtobufV8", () => {
  it.each(["^8.1.0", ">=8.2 <9", "7 || 8", "^7.2.0 || ^8.4.0"])(
    "detects a range intersecting protobufjs v8: %s",
    (range) => {
      expect(rangeSupportsProtobufV8(range)).toBeTrue();
    },
  );

  it.each(["^7.2.0", "<8", ">=9.0.0"])(
    "rejects a range outside protobufjs v8: %s",
    (range) => {
      expect(rangeSupportsProtobufV8(range)).toBeFalse();
    },
  );
});
