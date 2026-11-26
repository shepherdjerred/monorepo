import { expect, test } from "vitest";
import { handle } from "./server.ts";

test("reports health", async () => {
  const response = handle(new Request("http://localhost/healthz"));
  expect(response.status).toBe(200);
  expect(await response.text()).toBe("ok");
});

test("answers 404 elsewhere", () => {
  expect(handle(new Request("http://localhost/")).status).toBe(404);
});
