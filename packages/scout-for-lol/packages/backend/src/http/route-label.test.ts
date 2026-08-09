/**
 * Route-label normalization.
 *
 * Prometheus keeps a series per label combination, so the guarantee this file
 * exists to protect is that `classifyRoute` can only ever return a value from a
 * fixed, finite set — no matter what an internet-facing scanner sends.
 */

import { describe, it, expect } from "bun:test";
import {
  classifyRoute,
  statusClass,
  OTHER_ROUTE_LABEL,
} from "#src/http/route-label.ts";

describe("classifyRoute", () => {
  it.each([
    "/ping",
    "/livez",
    "/healthz",
    "/metrics",
    "/api/version",
    "/api/auth/discord/start",
    "/api/auth/discord/callback",
    "/api/auth/logout",
    "/api/discord/install",
    "/api/dev/login",
    "/api/summoner-icon",
    "/api/reports/query-agent/stream",
  ])("maps the known route %s to itself", (path) => {
    expect(classifyRoute(path)).toBe(path);
  });

  it("collapses every tRPC procedure onto one label", () => {
    // Per-procedure detail comes from scout_trpc_calls_total instead.
    expect(classifyRoute("/trpc")).toBe("/trpc");
    expect(classifyRoute("/trpc/subscription.list")).toBe("/trpc");
    expect(classifyRoute("/trpc/guild.listManageable,auth.sessionState")).toBe(
      "/trpc",
    );
  });

  it("templates dynamic id segments", () => {
    expect(classifyRoute("/api/competition/42/leaderboard.png")).toBe(
      "/api/competition/:id/leaderboard.png",
    );
    expect(classifyRoute("/api/report/7/runs/1234.png")).toBe(
      "/api/report/:id/runs/:id.png",
    );
  });

  it.each([
    "/wp-login.php",
    "/.env",
    "/../../etc/passwd",
    "/api/competition/not-a-number/leaderboard.png",
    "/api/report/1/runs/abc.png",
    "/random/deep/unknown/path",
    "",
    "/",
  ])("buckets unrecognised path %p as other", (path) => {
    // A scanner must never be able to mint new series.
    expect(classifyRoute(path)).toBe(OTHER_ROUTE_LABEL);
  });

  it("produces a bounded label set across adversarial input", () => {
    const labels = new Set<string>();
    for (let i = 0; i < 500; i += 1) {
      labels.add(classifyRoute(`/attack-${i.toString()}`));
      labels.add(classifyRoute(`/trpc/procedure${i.toString()}`));
      labels.add(classifyRoute(`/api/report/${i.toString()}/runs/1.png`));
    }
    expect(labels).toEqual(
      new Set([OTHER_ROUTE_LABEL, "/trpc", "/api/report/:id/runs/:id.png"]),
    );
  });
});

describe("statusClass", () => {
  it.each([
    [200, "2xx"],
    [204, "2xx"],
    [302, "3xx"],
    [404, "4xx"],
    [429, "4xx"],
    [500, "5xx"],
    [503, "5xx"],
  ])("buckets %i as %s", (status, expected) => {
    expect(statusClass(status)).toBe(expected);
  });
});
