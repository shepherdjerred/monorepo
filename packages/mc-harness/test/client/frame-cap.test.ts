import { expect, it } from "vitest";
import { CLIENT_ACTION_REQUEST_SCHEMAS } from "#protocol/client.ts";

it("keeps helper frame caps inside the shared capture budget", () => {
  const schema = CLIENT_ACTION_REQUEST_SCHEMAS["frame-cap"];
  for (const fps of [30, 60, 120])
    expect(schema.parse({ fps })).toEqual({ fps });
  for (const fps of [0, 29, 121, 30.5, Infinity])
    expect(schema.safeParse({ fps }).success).toBe(false);
  expect(schema.safeParse({ fps: 30, extra: true }).success).toBe(false);
});
