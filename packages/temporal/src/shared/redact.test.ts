import { describe, expect, test } from "bun:test";
import { redactSecrets } from "./redact.ts";

describe("redactSecrets", () => {
  test("replaces every occurrence of every token", () => {
    const out = redactSecrets("alpha=ABCDEFGH; beta=12345678", [
      "ABCDEFGH",
      "12345678",
    ]);
    expect(out).toBe("alpha=***; beta=***");
  });

  test("skips tokens shorter than 8 chars", () => {
    const out = redactSecrets("short=abc; long=ABCDEFGH", ["abc", "ABCDEFGH"]);
    expect(out).toBe("short=abc; long=***");
  });

  test("skips undefined and empty entries", () => {
    const out = redactSecrets("token=ABCDEFGH", [undefined, "", "ABCDEFGH"]);
    expect(out).toBe("token=***");
  });

  test("returns input unchanged when no tokens match", () => {
    const out = redactSecrets("nothing to redact here", ["ZZZZZZZZ"]);
    expect(out).toBe("nothing to redact here");
  });

  test("handles repeated occurrences of the same token", () => {
    const out = redactSecrets("ABCDEFGH and ABCDEFGH again", ["ABCDEFGH"]);
    expect(out).toBe("*** and *** again");
  });
});
