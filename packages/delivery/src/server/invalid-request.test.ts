import { expect, test } from "vitest";
import { z } from "zod";
import { invalidRequestMessage } from "./app.ts";

test("an invalid request names the failing field paths and rules, never the values", () => {
  const result = z
    .object({ artifact: z.object({ id: z.string().max(5) }) })
    .safeParse({ artifact: { id: "secret-value-too-long" } });
  if (result.success) throw new Error("expected a validation failure");
  const message = invalidRequestMessage(result.error);
  expect(message).toBe("Invalid request: artifact.id: too_big");
  expect(message).not.toContain("secret-value");
});

test("malformed JSON says so", () => {
  expect(invalidRequestMessage(new SyntaxError("Unexpected token"))).toBe(
    "Invalid request: malformed JSON",
  );
});
