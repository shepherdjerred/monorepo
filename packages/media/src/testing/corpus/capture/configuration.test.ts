import { expect, test } from "vitest";
import { assertRecyclarrReference, captureSources } from "./configuration.ts";

const yaml = `radarr:
  films:
    base_url: http://radarr.invalid
    api_key: synthetic-radarr-credential
sonarr:
  television:
    base_url: http://sonarr.invalid
    api_key: synthetic-sonarr-credential
`;
test("configuration uses exact Recyclarr item reference and explicit loopback sources without guessing login titles", () => {
  expect(() =>
    assertRecyclarrReference(`op://Synthetic/${"a".repeat(26)}/recyclarr.yaml`),
  ).not.toThrow();
  expect(() =>
    assertRecyclarrReference("op://Synthetic/Radarr/api_key"),
  ).toThrow("Exact Recyclarr");
  expect(
    captureSources(yaml, {
      radarr: "http://127.0.0.1:17878",
      sonarr: "http://127.0.0.1:18989",
    }),
  ).toEqual([
    {
      source: "radarr",
      baseUrl: "http://127.0.0.1:17878/",
      apiKey: "synthetic-radarr-credential",
    },
    {
      source: "sonarr",
      baseUrl: "http://127.0.0.1:18989/",
      apiKey: "synthetic-sonarr-credential",
    },
  ]);
});
test.each([
  "http://radarr.invalid:7878",
  "http://user:password@127.0.0.1:17878",
  "http://127.0.0.1:17878?api_key=secret",
])("configuration rejects an unreviewed source override %s", (radarr) => {
  expect(() =>
    captureSources(yaml, { radarr, sonarr: "http://127.0.0.1:18989" }),
  ).toThrow("loopback");
});
test("configuration refuses multiple configured instances instead of selecting the first", () => {
  expect(() =>
    captureSources(
      yaml.replace(
        "  films:",
        "  another: {base_url: 'http://other.invalid', api_key: synthetic-other}\n  films:",
      ),
      { radarr: "http://127.0.0.1:17878", sonarr: "http://127.0.0.1:18989" },
    ),
  ).toThrow("Exactly one");
});
