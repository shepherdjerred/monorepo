import { describe, expect, test } from "vitest";
import { recoveryBatchCodec } from "#src/recovery/batch-codec.ts";
import { makeBatch, statesByKind } from "#src/recovery/batch.test-fixtures.ts";

describe("recoveryBatchCodec", () => {
  test("declares its discriminator and current version", () => {
    expect(recoveryBatchCodec.kind).toBe("recovery-batch");
    expect(recoveryBatchCodec.version).toBe(1);
  });

  test.each(Object.entries(statesByKind()))(
    "round-trips a batch in the %s state",
    (_kind, state) => {
      const batch = makeBatch(state, "no-external");
      const envelope = recoveryBatchCodec.serialize(batch);
      expect(envelope).toEqual({
        kind: "recovery-batch",
        version: 1,
        data: batch,
      });
      expect(recoveryBatchCodec.parse(envelope)).toEqual(batch);
    },
  );

  test("round-trips through JSON text like a real store", () => {
    const batch = makeBatch(statesByKind().scanning);
    const wire = JSON.stringify(recoveryBatchCodec.serialize(batch));
    expect(recoveryBatchCodec.parse(JSON.parse(wire))).toEqual(batch);
  });

  test("rejects an unknown version", () => {
    const envelope = recoveryBatchCodec.serialize(
      makeBatch({ kind: "planned" }),
    );
    expect(() =>
      recoveryBatchCodec.parse({ ...envelope, version: 999 }),
    ).toThrow();
  });

  test("rejects a foreign kind", () => {
    const envelope = recoveryBatchCodec.serialize(
      makeBatch({ kind: "planned" }),
    );
    expect(() =>
      recoveryBatchCodec.parse({ ...envelope, kind: "notification-intent" }),
    ).toThrow();
  });

  test("rejects malformed data", () => {
    expect(() =>
      recoveryBatchCodec.parse({
        kind: "recovery-batch",
        version: 1,
        data: { state: { kind: "planned" } },
      }),
    ).toThrow();
  });
});
