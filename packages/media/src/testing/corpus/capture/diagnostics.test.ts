import { expect, test } from "vitest";
import { z } from "zod";
import { captureDiagnostic, PrivateCaptureError } from "./diagnostics.ts";
import { captureInstalledCatalog } from "./manager.ts";
import { installedCaptureFixture } from "./test-fixture.ts";
import { assertPrivateCaptureContent } from "./private.ts";

test("actual installed schema refusal reports only fixed endpoint and safe issue path/code", async () => {
  const f = installedCaptureFixture();
  const source = f.sources[0];
  if (source === undefined) throw new Error("Synthetic source missing");
  f.change((url, body) =>
    url.pathname === "/api/v3/movie" ? [{ ...f.movie, imdbId: "" }] : body,
  );
  try {
    await captureInstalledCatalog(source, f.transport);
    throw new Error("Malformed wire unexpectedly accepted");
  } catch (error) {
    expect(error).toBeInstanceOf(PrivateCaptureError);
    const diagnostic = captureDiagnostic(error, {
      source: "local",
      stage: "arguments",
    }).diagnostic;
    expect(diagnostic).toEqual({
      source: "radarr",
      stage: "installed_first",
      endpoint: "movie",
      reason: "schema",
      issues: [{ path: ["[]", "imdbId"], code: "too_small" }],
    });
    expect(JSON.stringify(diagnostic)).not.toMatch(
      /Paper Lantern|credential|127\.0\.0\.1|downloadUrl/u,
    );
  }
});
test("diagnostics suppress dynamic record keys, issue messages and invalid values", () => {
  const parsed = z
    .record(z.string(), z.number())
    .safeParse({ "private-title-and-key": "private-invalid-value" });
  if (parsed.success) throw new Error("Expected schema refusal");
  const diagnostic = captureDiagnostic(parsed.error, {
    source: "sonarr",
    stage: "profiles_before",
  }).diagnostic;
  expect(diagnostic).toEqual({
    source: "sonarr",
    stage: "profiles_before",
    reason: "schema",
    issues: [{ path: ["<field>"], code: "invalid_type" }],
  });
  expect(JSON.stringify(diagnostic)).not.toContain("private");
});
test("profile transport fixed error identifies endpoint without forwarding arbitrary message content", () => {
  expect(
    captureDiagnostic(
      new Error("Read-only radarr inventory failed at qualitydefinition"),
      { source: "radarr", stage: "profiles_before" },
    ).diagnostic,
  ).toEqual({
    source: "radarr",
    stage: "profiles_before",
    endpoint: "qualitydefinition",
    reason: "read_failed",
  });
  expect(
    captureDiagnostic(new Error("https://private.invalid/?api_key=secret"), {
      source: "radarr",
      stage: "profiles_before",
    }).diagnostic,
  ).toEqual({
    source: "radarr",
    stage: "profiles_before",
    reason: "unexpected",
  });
});

test.each([
  { value: "synthetic-secret-literal", subreason: "credential_literal" },
  { value: "api_key=synthetic-pattern", subreason: "credential_pattern" },
  { value: "https://private.invalid/value", subreason: "url_value" },
] as const)(
  "sanitizer reports $subreason with only safe profile path",
  ({ value, subreason }) => {
    try {
      assertPrivateCaptureContent(
        { customFormats: [{ specifications: [{ fields: [{ value }] }] }] },
        ["synthetic-secret-literal"],
      );
      throw new Error("Forbidden value unexpectedly accepted");
    } catch (error) {
      const diagnostic = captureDiagnostic(error, {
        source: "sonarr",
        stage: "sanitization",
        artifact: "profiles",
      }).diagnostic;
      expect(diagnostic).toEqual({
        source: "sonarr",
        stage: "sanitization",
        artifact: "profiles",
        reason: "forbidden_content",
        content: {
          path: [
            "customFormats",
            "[]",
            "specifications",
            "[]",
            "fields",
            "[]",
            "value",
          ],
          subreason,
        },
      });
      expect(JSON.stringify(diagnostic)).not.toContain(value);
    }
  },
);
test("sanitizer masks forbidden and arbitrary keys without retaining their values", () => {
  try {
    assertPrivateCaptureContent(
      { "private-user-title": { apiKey: "private-key-value" } },
      [],
    );
    throw new Error("Forbidden key unexpectedly accepted");
  } catch (error) {
    const diagnostic = captureDiagnostic(error, {
      source: "sonarr",
      stage: "sanitization",
      artifact: "installed",
    }).diagnostic;
    expect(diagnostic).toEqual({
      source: "sonarr",
      stage: "sanitization",
      artifact: "installed",
      reason: "forbidden_content",
      content: { path: ["<field>", "<field>"], subreason: "forbidden_key" },
    });
    expect(JSON.stringify(diagnostic)).not.toMatch(
      /private-user-title|apiKey|private-key-value/u,
    );
  }
});
