import { describe, expect, test } from "vitest";
import {
  createRequestLoad,
  MEMORY_PRESSURE_BYTES,
  routeShape,
} from "./request-load.ts";

describe("routeShape", () => {
  test("groups requests by what they ask for, never by which record", () => {
    expect(
      routeShape(
        "GET",
        "/api/v1/deployments/0f8fad5b-d9cb-469f-a165-70867728950e/stages",
      ),
    ).toBe("GET /api/v1/deployments/:id/stages");
    expect(routeShape("GET", "/api/v1/hub/commits/3a7b9c2d1e")).toBe(
      "GET /api/v1/hub/commits/:id",
    );
    expect(routeShape("POST", "/api/v1/builds")).toBe("POST /api/v1/builds");
  });

  test("never carries a query string", () => {
    expect(routeShape("GET", "/api/v1/hub/commits?cursor=secret")).toBe(
      "GET /api/v1/hub/commits",
    );
  });
});

describe("request load", () => {
  test("names what is in flight and drops it when the request ends", async () => {
    const load = createRequestLoad({
      log: () => {
        // Nothing here is slow.
      },
    });
    const gate = Promise.withResolvers<null>();
    const held = load.track("GET", "/api/v1/hub/commits", () => gate.promise);
    await load.track("GET", "/api/v1/hub/commits", () => Promise.resolve(null));
    expect(load.snapshot()).toEqual([
      { route: "GET /api/v1/hub/commits", count: 1 },
    ]);
    gate.resolve(null);
    await held;
    expect(load.snapshot()).toEqual([]);
  });

  test("logs a slow request by route shape, and a failing one still counts", async () => {
    const lines: string[] = [];
    let clock = 0;
    const load = createRequestLoad({
      log: (line) => lines.push(line),
      now: () => clock,
    });
    await expect(
      load.track("GET", "/api/v1/hub/commits", () => {
        clock += 4000;
        return Promise.reject(new Error("boom"));
      }),
    ).rejects.toThrow("boom");
    await load.track("GET", "/api/v1/hub/grid", () => {
      clock += 10;
      return Promise.resolve();
    });
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "")).toMatchObject({
      message: "delivery_slow_request",
      route: "GET /api/v1/hub/commits",
      ms: 4000,
    });
  });

  test("names the busiest routes only once memory is high", async () => {
    const lines: string[] = [];
    const load = createRequestLoad({ log: (line) => lines.push(line) });
    const gate = Promise.withResolvers<null>();
    const held = load.track("GET", "/api/v1/overview", () => gate.promise);
    expect(
      load.watchMemory(() => ({ rss: MEMORY_PRESSURE_BYTES - 1, heapUsed: 1 })),
    ).toBe(false);
    expect(lines).toEqual([]);
    expect(
      load.watchMemory(() => ({
        rss: MEMORY_PRESSURE_BYTES + 1,
        heapUsed: 100 * 1024 * 1024,
      })),
    ).toBe(true);
    expect(JSON.parse(lines[0] ?? "")).toMatchObject({
      message: "delivery_memory_pressure",
      heapMb: 100,
      inFlight: [{ route: "GET /api/v1/overview", count: 1 }],
    });
    gate.resolve(null);
    await held;
  });
});
