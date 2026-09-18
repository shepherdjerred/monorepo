import { describe, expect, test } from "vitest";
import { notificationIntentCodec } from "#src/notifications/intent-codec.ts";
import {
  makeIntent,
  statesByKind,
} from "#src/notifications/intent.test-fixtures.ts";

describe("notificationIntentCodec", () => {
  test("declares its discriminator and current version", () => {
    expect(notificationIntentCodec.kind).toBe("notification-intent");
    expect(notificationIntentCodec.version).toBe(2);
  });

  test.each(Object.entries(statesByKind()))(
    "round-trips an intent in the %s state",
    (_kind, state) => {
      const intent = makeIntent(state);
      const envelope = notificationIntentCodec.serialize(intent);
      expect(envelope).toEqual({
        kind: "notification-intent",
        version: 2,
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
        version: 2,
        data: { state: { kind: "pending" } },
      }),
    ).toThrow();
  });

  test("rejects a current-version payload with no kind or origin", () => {
    // The fields are required at version 2; only a version-1 envelope earns
    // the derivation, and only through the migration.
    const {
      kind: _kind,
      origin: _origin,
      ...bare
    } = makeIntent({
      kind: "pending",
    });
    expect(() =>
      notificationIntentCodec.parse({
        kind: "notification-intent",
        version: 2,
        data: bare,
      }),
    ).toThrow();
  });
});

/** A version-1 envelope: the same intent before `kind` and `origin` existed. */
function version1(key: string): unknown {
  const {
    kind: _kind,
    origin: _origin,
    ...legacy
  } = makeIntent({
    kind: "ready",
  });
  return {
    kind: "notification-intent",
    version: 1,
    data: { ...legacy, key },
  };
}

describe("migrating a version-1 notification intent", () => {
  test.each([
    { key: "postmatch-discord:NA1_9101:100000000000000001", kind: "postmatch" },
    { key: "prematch-discord:NA1_9101:100000000000000001", kind: "prematch" },
  ] as const)(
    "derives $kind from the key prefix and stamps a live origin",
    ({ key, kind }) => {
      const migrated = notificationIntentCodec.parse(version1(key));
      expect(migrated.kind).toBe(kind);
      expect(migrated.origin).toEqual({ kind: "live" });
      expect(migrated.key).toBe(key);
      expect(migrated.state).toEqual({ kind: "ready" });
    },
  );

  test("refuses a version-1 key that names no kind", () => {
    // Guessing here would render a game-start announcement as a post-match
    // report. Neither version-1 producer ever minted such a key.
    expect(() =>
      notificationIntentCodec.parse(
        version1("notify:match:NA1_1234567890:channel:123456789012345678"),
      ),
    ).toThrow("names no kind this codec can migrate");
  });
});
