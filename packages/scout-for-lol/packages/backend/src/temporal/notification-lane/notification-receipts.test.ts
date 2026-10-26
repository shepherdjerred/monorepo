import { describe, expect, test } from "vitest";
import { NotificationIntentKindSchema } from "@scout-for-lol/domain/notifications/intent.ts";
import {
  SCOUT_NOTIFICATION_RENDER_RECEIPT_KINDS,
  scoutNotificationRenderReceiptKind,
  scoutNotificationRenderEvidenceCodec,
} from "#src/temporal/notification-lane/notification-receipts.ts";

describe("review retirement evidence compatibility", () => {
  const object = {
    objectKey: "games/2026/09/16/NA1_9301/report.png",
    digest: "f".repeat(64),
    bytes: 5,
    contentType: "image/png",
  };
  const legacy = {
    kind: "scout-v2-notification-render-evidence",
    version: 2,
    data: {
      artifact: "report",
      riotMatchId: "NA1_9301",
      image: object,
      content: "jerred finished a solo game\n\nHistorical review text.",
      components: "match-link",
      review: {
        ...object,
        objectKey: "games/2026/09/16/NA1_9301/ai-review.png",
      },
    },
  };

  test("reads version 2 without exposing the retired image or mutating history", () => {
    const original = JSON.stringify(legacy);
    const parsed = scoutNotificationRenderEvidenceCodec.parse(legacy);
    expect(parsed).not.toHaveProperty("review");
    expect(parsed).toMatchObject({
      content: legacy.data.content,
      image: object,
      components: "match-link",
    });
    expect(JSON.stringify(legacy)).toBe(original);
    const current = scoutNotificationRenderEvidenceCodec.serialize(parsed);
    expect(current.version).toBe(2);
    expect(scoutNotificationRenderEvidenceCodec.parse(current)).toEqual(parsed);
  });

  test("validates retired attachment evidence before discarding it", () => {
    expect(() =>
      scoutNotificationRenderEvidenceCodec.parse({
        ...legacy,
        data: { ...legacy.data, review: { ...legacy.data.review, bytes: -1 } },
      }),
    ).toThrow();
  });

  test("rejects unknown legacy fields and unsupported versions", () => {
    expect(() =>
      scoutNotificationRenderEvidenceCodec.parse({
        ...legacy,
        data: { ...legacy.data, unknown: true },
      }),
    ).toThrow();
    for (const version of [1, 3]) {
      expect(() =>
        scoutNotificationRenderEvidenceCodec.parse({ ...legacy, version }),
      ).toThrow();
    }
  });
});

describe("the V2 notification render receipt kind", () => {
  const matchKinds = NotificationIntentKindSchema.options.filter(
    (kind) =>
      kind !== "duel-status" &&
      kind !== "dare-status" &&
      kind !== "product-announcement",
  );
  test("is distinct per intent kind", () => {
    // A prematch and a postmatch intent name the same match id and render
    // different images; one receipt kind for both would let whichever
    // rendered first stand for the other, and a post-match report would be
    // delivered carrying the loading screen.
    const kinds = matchKinds.map((kind) =>
      scoutNotificationRenderReceiptKind(kind),
    );
    expect(new Set(kinds).size).toBe(kinds.length);
  });

  test("stays inside the receipt kind vocabulary", () => {
    for (const kind of matchKinds) {
      expect(scoutNotificationRenderReceiptKind(kind)).toMatch(
        /^v2-notification-render-[a-z-]+$/u,
      );
    }
  });

  test("names every intent kind and nothing else", () => {
    expect(Object.keys(SCOUT_NOTIFICATION_RENDER_RECEIPT_KINDS).sort()).toEqual(
      [...matchKinds].sort(),
    );
  });
});
