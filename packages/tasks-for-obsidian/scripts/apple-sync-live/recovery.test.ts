import { describe, expect, test } from "vitest";
import { digest } from "./model";
import {
  assertOfficialRemoteVersion,
  officialHistoryHead,
} from "./official-artifact";

const relative = "Tasks/Existing.md";
const content =
  "---\ntitle: Facet remote conflict test\n---\n\nPreserved trailing whitespace. \n";
const expected = new TextEncoder().encode(content);
const timestamp = "2026-10-12 12:30:01";
const history = `0: ${timestamp} (233 bytes) [Synthetic reference]\n1: 2026-10-12 12:29:00 (10 bytes) [Synthetic reference]\n`;
const head = officialHistoryHead(history);
function output(
  body = content,
  path = relative,
  time = timestamp,
  version = 0,
) {
  return new TextEncoder().encode(
    `${path} (version ${String(version)}, ${time})\n---\n${body}`,
  );
}

describe("Mac-only official remote publication proof", () => {
  test("selects the current zero-index remote history version and verifies exact bytes", () => {
    expect(head).toMatchObject({
      version: 0,
      timestamp,
      storedSize: 233,
    });
    expect(head.historyHeadSHA256).toBe(digest(history.split("\n")[0] ?? ""));
    expect(
      assertOfficialRemoteVersion(output(), relative, head, expected),
    ).toEqual({ size: expected.length, sha256: digest(expected) });
  });
  test("rejects unavailable, deleted, renamed and non-current history heads", () => {
    for (const value of [
      "No sync history found for this file.",
      history.replace(/^0:/u, "1:"),
      history.replace(
        "[Synthetic reference]\n1:",
        "[Synthetic reference] [deleted]\n1:",
      ),
      history.replace(
        "[Synthetic reference]\n1:",
        "[Synthetic reference] (renamed from Tasks/Other.md)\n1:",
      ),
    ])
      expect(() => officialHistoryHead(value)).toThrow(
        "no current file version",
      );
  });
  test("rejects wrong path, selected version and history date", () => {
    for (const bytes of [
      output(content, "Tasks/Other.md"),
      output(content, relative, timestamp, 1),
      output(content, relative, "2026-10-12 12:29:00"),
    ])
      expect(() =>
        assertOfficialRemoteVersion(bytes, relative, head, expected),
      ).toThrow("header differs");
  });
  test("preserves whitespace and rejects local-only or truncated content", () => {
    for (const body of [
      content.trim(),
      `${content}\n`,
      content.replace("remote", "local"),
      content.slice(0, -1),
    ])
      expect(() =>
        assertOfficialRemoteVersion(output(body), relative, head, expected),
      ).toThrow("divergent reference bytes");
  });
});
