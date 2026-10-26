import { expect, it, vi } from "vitest";
import { scheduleHandler } from "./schedule-server.ts";
it("requires the scheduler credential and exact internal POST route", async () => {
  const reconcile = vi.fn(() => Promise.resolve());
  const token = crypto.randomUUID();
  const handler = scheduleHandler(token, { reconcile });
  const url = "http://localhost/internal/sports/reconcile";
  const unauthorized = await handler(new Request(url, { method: "POST" }));
  const wrongMethod = await handler(
    new Request(url, { headers: { authorization: `Bearer ${token}` } }),
  );
  const accepted = await handler(
    new Request(url, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
    }),
  );
  expect(unauthorized.status).toBe(401);
  expect(wrongMethod.status).toBe(404);
  expect(accepted.status).toBe(200);
  expect(reconcile).toHaveBeenCalledTimes(1);
});
