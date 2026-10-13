import { expect, test, vi } from "vitest";
import { downloadLinearFile } from "#lib/tracker/migration/files.ts";

test("private uploads use the registered API scheme without leaking auth on redirects", async () => {
  const request = vi.fn(async (_url: URL, _options: RequestInit) =>
    Response.json({}),
  );
  request.mockResolvedValueOnce(
    new Response(null, {
      status: 302,
      headers: {
        Location: "https://storage.example.cloudfront.net/file?signature=test",
      },
    }),
  );
  request.mockResolvedValueOnce(
    new Response("bytes", {
      headers: {
        "Content-Type": "text/plain",
        "Content-Disposition": 'attachment; filename="original.txt"',
      },
    }),
  );
  const result = await downloadLinearFile(
    "https://uploads.linear.app/workspace/file",
    "lin_api_test",
    request,
  );
  expect(
    new Headers(request.mock.calls[0]?.[1].headers).get("Authorization"),
  ).toBe("lin_api_test");
  expect(
    new Headers(request.mock.calls[1]?.[1].headers).has("Authorization"),
  ).toBe(false);
  expect(result.filename).toBe("original.txt");
  expect(new TextDecoder().decode(result.bytes)).toBe("bytes");
});

test("refuses untrusted redirects and oversized uploads", async () => {
  const request = vi.fn(
    async () =>
      new Response(null, {
        status: 302,
        headers: { Location: "http://127.0.0.1/private" },
      }),
  );
  await expect(
    downloadLinearFile("https://public.linear.app/file", undefined, request),
  ).rejects.toThrow("outside trusted file storage");
  request.mockResolvedValue(
    new Response("", {
      headers: { "Content-Length": String(101 * 1024 * 1024) },
    }),
  );
  await expect(
    downloadLinearFile("https://public.linear.app/file", undefined, request),
  ).rejects.toThrow("size limit");
});
