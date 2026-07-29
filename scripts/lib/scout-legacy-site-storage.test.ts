import { expect, test } from "bun:test";

import { parseScoutImageManifestDigest } from "./scout-legacy-site-storage.ts";

const DIGEST =
  "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

test("legacy Scout tag resolution accepts only a canonical manifest digest", () => {
  expect(
    parseScoutImageManifestDigest(
      JSON.stringify({
        schemaVersion: 2,
        mediaType: "application/vnd.oci.image.index.v1+json",
        digest: DIGEST,
      }),
    ),
  ).toBe(DIGEST);
  expect(() =>
    parseScoutImageManifestDigest(JSON.stringify({ digest: "latest" })),
  ).toThrow();
  expect(() => parseScoutImageManifestDigest("not-json")).toThrow(
    "not valid JSON",
  );
});
