import { test, expect } from "bun:test";
import { parseProfile } from "./release-profile.ts";

const preview = {
  schema: 1,
  channel: "preview",
  manifest_url: "https://glitter-boys.com/launcher/preview.json",
  public_keys: [],
  publisher: null,
};
test("unsigned preview is explicit; partial signing and malformed profiles fail", () => {
  expect(parseProfile(preview).publisher).toBeNull();
  for (const change of [
    { schema: 2 },
    { manifest_url: "https://example.com/update" },
    { public_keys: ["a".repeat(64)] },
    { publisher: "CN=Example" },
    { extra: true },
  ])
    expect(() => parseProfile({ ...preview, ...change })).toThrow();
});
test("a stable channel requires publisher and a valid verification key", () => {
  const stable = {
    ...preview,
    channel: "stable",
    manifest_url: "https://glitter-boys.com/launcher/stable.json",
  };
  expect(() => parseProfile(stable)).toThrow();
  expect(
    parseProfile({
      ...stable,
      publisher: "CN=Example",
      public_keys: ["a".repeat(64)],
    }).channel,
  ).toBe("stable");
  expect(() =>
    parseProfile({
      ...stable,
      publisher: "CN=Example",
      public_keys: ["x".repeat(64)],
    }),
  ).toThrow();
});
