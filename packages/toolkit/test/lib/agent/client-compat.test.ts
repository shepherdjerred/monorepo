import { expect, test } from "vitest";
import { z } from "zod";
import { stripRejectedMetadataKeys } from "#lib/tracker/client.ts";

const StrippedSchema = z.object({
  json: z.object({
    actor: z.object({ metadata: z.record(z.string(), z.unknown()) }),
    title: z.string(),
  }),
});

const rejection = JSON.stringify({
  error: {
    message:
      '[{"code":"unrecognized_keys","keys":["hcAddress","herdrTab"],"path":["actor","metadata"],"message":"Unrecognized keys"}]',
  },
});

test("strips server-rejected keys from actor metadata only", () => {
  const body = JSON.stringify({
    json: {
      actor: {
        key: "muse:s",
        metadata: {
          harness: "muse",
          hcAddress: "t9",
          herdrTab: "tb1",
          hcTerminal: "t9",
        },
      },
      title: "hcAddress stays in prose",
    },
  });
  const stripped = stripRejectedMetadataKeys(body, rejection);
  expect(stripped).not.toBeNull();
  const parsed = StrippedSchema.parse(JSON.parse(stripped ?? "{}"));
  expect(parsed.json.actor.metadata).toEqual({
    harness: "muse",
    hcTerminal: "t9",
  });
  expect(parsed.json.title).toContain("hcAddress");
});

test("returns null for unrelated errors or unchanged payloads", () => {
  const body = JSON.stringify({
    json: { actor: { metadata: { harness: "muse" } } },
  });
  expect(stripRejectedMetadataKeys(body, rejection)).toBeNull();
  expect(stripRejectedMetadataKeys(body, "some other error")).toBeNull();
  expect(stripRejectedMetadataKeys("not json", rejection)).toBeNull();
});
