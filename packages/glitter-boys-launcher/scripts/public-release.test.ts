import { expect, test } from "vitest";
import { parsePublicationRecord } from "./public-release.ts";

test("unpublished installers have no download; published metadata is version-specific", () => {
  expect(
    parsePublicationRecord({ schema: 1, release: null }).release,
  ).toBeNull();
  const release = {
    version: "0.1.1",
    expires: 1_800_000_000,
    installer: {
      url: "https://glitter-boys.com/launcher/releases/0.1.1/glitter-boys_0.1.1_x64-setup.exe",
      bytes: 123,
      sha256: "a".repeat(64),
    },
  };
  expect(parsePublicationRecord({ schema: 1, release }).release).toEqual(
    release,
  );
  for (const installer of [
    { ...release.installer, url: "https://example.com/setup.exe" },
    {
      ...release.installer,
      url: release.installer.url.replaceAll("0.1.1", "0.1.7"),
    },
    { ...release.installer, bytes: 0 },
    { ...release.installer, sha256: "invalid" },
    { ...release.installer, extra: true },
  ])
    expect(() =>
      parsePublicationRecord({ schema: 1, release: { ...release, installer } }),
    ).toThrow();
  expect(() => parsePublicationRecord({ schema: 2, release })).toThrow();
  for (const expires of [
    0,
    -1,
    1.5,
    "1800000000",
    Number.NaN,
    9_000_000_000_000,
  ])
    expect(() =>
      parsePublicationRecord({ schema: 1, release: { ...release, expires } }),
    ).toThrow();
  expect(() =>
    parsePublicationRecord({ schema: 1, release, extra: true }),
  ).toThrow();
});
