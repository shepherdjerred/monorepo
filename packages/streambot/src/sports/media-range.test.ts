import { expect, it } from "vitest";
import { sportsMediaResponse } from "./media-range.ts";

it.each([
  { range: "bytes=1-2", expected: [20, 30], contentRange: "bytes 1-2/4" },
  { range: "bytes=2-", expected: [30, 40], contentRange: "bytes 2-3/4" },
  { range: "bytes=-2", expected: [30, 40], contentRange: "bytes 2-3/4" },
  { range: "bytes=1-99", expected: [20, 30, 40], contentRange: "bytes 1-3/4" },
])(
  "serves a decoded media range $range",
  async ({ range, expected, contentRange }) => {
    const response = sportsMediaResponse(
      new Uint8Array([10, 20, 30, 40]),
      range,
    );
    expect(response.status).toBe(206);
    expect(response.headers.get("Content-Range")).toBe(contentRange);
    expect(response.headers.get("Content-Length")).toBe(
      String(expected.length),
    );
    const bytes = await response.arrayBuffer();
    expect([...new Uint8Array(bytes)]).toEqual(expected);
  },
);

it.each(["bytes=4-", "bytes=3-2", "bytes=-0", "bytes=0-1,2-3", "bytes=-"])(
  "rejects unsatisfiable or unsupported ranges %s",
  (range) => {
    const response = sportsMediaResponse(
      new Uint8Array([10, 20, 30, 40]),
      range,
    );
    expect(response.status).toBe(416);
    expect(response.headers.get("Content-Range")).toBe("bytes */4");
  },
);
