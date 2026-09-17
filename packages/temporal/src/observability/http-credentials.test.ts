import { expect, test } from "vitest";
import { sanitizeHttpCredentialBreadcrumb } from "./http-credentials.ts";
test("does not retain BlueBubbles query authentication in HTTP breadcrumbs", () => {
  const url = new URL("http://localhost:1234");
  url.searchParams.set("password", "test-secret");
  const sanitized = sanitizeHttpCredentialBreadcrumb({
    category: "fetch",
    data: { url: url.toString(), status_code: 200 },
  });
  expect(sanitized.data?.["url"]).toBe(url.origin + "/");
  expect(JSON.stringify(sanitized)).not.toContain("test-secret");
  expect(sanitized.data?.["status_code"]).toBe(200);
});
