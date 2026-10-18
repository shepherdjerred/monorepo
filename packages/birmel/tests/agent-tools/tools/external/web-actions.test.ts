import { expect, test, vi } from "vitest";

const mockFetchSafePublicText = vi.fn();

vi.mock("@shepherdjerred/birmel/utils/safe-fetch.ts", () => ({
  fetchSafePublicText: (...args: unknown[]) => mockFetchSafePublicText(...args),
}));

import { handleFetchUrl } from "@shepherdjerred/birmel/agent-tools/tools/external/web-actions.ts";

test.each([
  { maxLength: 10, expected: `${"a".repeat(9)}...` },
  { maxLength: 10.7, expected: `${"a".repeat(9)}...` },
  { maxLength: 11, expected: `${"a".repeat(9)}😀...` },
])(
  "fetch-url content keeps emoji whole at maxLength $maxLength",
  async ({ maxLength, expected }) => {
    mockFetchSafePublicText.mockResolvedValueOnce({
      text: `<html><body>${"a".repeat(9)}😀${"b".repeat(20)}</body></html>`,
      url: "https://example.com/",
    });
    const result = await handleFetchUrl("https://example.com/", maxLength);
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ content: expected });
  },
);
