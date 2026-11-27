import { expect, test } from "vitest";
import { handle } from "./server.ts";

const probe = (path: string) => handle(new Request(`http://localhost${path}`));

test("answers the health probe with ok", async () => {
  const response = probe("/healthz");
  expect(response.status).toBe(200);
  expect(await response.text()).toBe("ok");
});

test("answers every other path with 404", () => {
  expect(probe("/").status).toBe(404);
});
