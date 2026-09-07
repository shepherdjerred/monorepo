import { describe, expect, test } from "vitest";
import { notificationIntentCodec } from "#src/notifications/intent-codec.ts";
import {
  makeIntent,
  statesByKind,
} from "#src/notifications/intent.test-fixtures.ts";

describe("notificationIntentCodec", () => {
  test("declares its discriminator and current version", () => {
    expect(notificationIntentCodec.kind).toBe("notification-intent");
    expect(notificationIntentCodec.version).toBe(1);
  });

  test.each(Object.entries(statesByKind()))(
    "round-trips an intent in the %s state",
    (_kind, state) => {
      const intent = makeIntent(state);
      const envelope = notificationIntentCodec.serialize(intent);
      expect(envelope).toEqual({
        kind: "notification-intent",
        version: 1,
        data: intent,
      });
      expect(notificationIntentCodec.parse(envelope)).toEqual(intent);
    },
  );

  test("round-trips through JSON text like a real store", () => {
    const intent = makeIntent(statesByKind().sending);
    const wire = JSON.stringify(notificationIntentCodec.serialize(intent));
    expect(notificationIntentCodec.parse(JSON.parse(wire))).toEqual(intent);
  });

  test("rejects an unknown version", () => {
    const envelope = notificationIntentCodec.serialize(
      makeIntent({ kind: "pending" }),
    );
    expect(() =>
      notificationIntentCodec.parse({ ...envelope, version: 999 }),
    ).toThrow();
  });

  test("rejects a foreign kind", () => {
    const envelope = notificationIntentCodec.serialize(
      makeIntent({ kind: "pending" }),
    );
    expect(() =>
      notificationIntentCodec.parse({ ...envelope, kind: "recovery-batch" }),
    ).toThrow();
  });

  test("rejects malformed data", () => {
    expect(() =>
      notificationIntentCodec.parse({
        kind: "notification-intent",
        version: 1,
        data: { state: { kind: "pending" } },
      }),
    ).toThrow();
  });
});
