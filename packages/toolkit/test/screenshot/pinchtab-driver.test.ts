import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import nodePath from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  captureScreenshot,
  type PinchtabDriverClient,
} from "#lib/screenshot/pinchtab-driver.ts";
import { createPinchtabLease } from "#lib/screenshot/pinchtab-lease.ts";

function makeFakeClient(overrides: Partial<PinchtabDriverClient> = {}): {
  client: PinchtabDriverClient;
  events: string[];
} {
  const events: string[] = [];
  const client: PinchtabDriverClient = {
    createSession: (agentId) => {
      events.push("createSession");
      return Promise.resolve({
        success: true,
        data: {
          id: "ses_test_1",
          agentId,
          sessionToken: "tok_test_1",
          status: "active",
        },
      });
    },
    revokeSession: (id) => {
      events.push(`revokeSession:${id}`);
      return Promise.resolve({ success: true, data: "revoked" });
    },
    navigateNewTab: (_token, url) => {
      events.push(`navigateNewTab:${url}`);
      return Promise.resolve({ success: true, data: "tab_test_1" });
    },
    navigateTab: (_token, tabId, url) => {
      events.push(`navigateTab:${tabId}:${url}`);
      return Promise.resolve({ success: true, data: tabId });
    },
    setViewport: () => Promise.resolve({ success: true, data: "ok" }),
    setMedia: () => Promise.resolve({ success: true, data: "ok" }),
    countSelector: (_token, _tabId, selector) =>
      Promise.resolve({ success: true, data: { selector, count: 1 } }),
    currentUrl: () =>
      Promise.resolve({ success: true, data: "http://localhost:5180/app/" }),
    screenshot: (_token, tabId, outPath) => {
      events.push(`screenshot:${tabId}`);
      return Promise.resolve({ success: true, data: outPath });
    },
    closeTab: (_token, tabId) => {
      events.push(`closeTab:${tabId}`);
      return Promise.resolve({ success: true, data: "closed" });
    },
    ...overrides,
  };
  return { client, events };
}

describe("pinchtab lease tracking & tab cleanup", () => {
  let tempTendDir = "";
  const prevTendDir = Bun.env["TOOLKIT_TEND_DIR"];

  beforeEach(async () => {
    tempTendDir = await mkdtemp(nodePath.join(os.tmpdir(), "toolkit-tend-"));
    Bun.env["TOOLKIT_TEND_DIR"] = tempTendDir;
  });

  afterEach(async () => {
    if (prevTendDir === undefined) {
      delete Bun.env["TOOLKIT_TEND_DIR"];
    } else {
      Bun.env["TOOLKIT_TEND_DIR"] = prevTendDir;
    }
    if (tempTendDir !== "") {
      await rm(tempTendDir, { recursive: true, force: true });
    }
  });

  test("writes valid PinchTab lease JSON and deletes it on release", async () => {
    const handle = await createPinchtabLease("ses_123", 10_000);
    const raw = await readFile(handle.filePath, "utf8");
    const parsed: unknown = JSON.parse(raw);
    expect(parsed).toMatchObject({
      version: 1,
      id: handle.lease.id,
      kind: "pinchtab",
      target: "ses_123",
      ownerPid: process.pid,
    });
    expect(typeof handle.lease.processStart).toBe("string");
    expect(handle.lease.processStart.length).toBeGreaterThan(0);
    expect(Date.parse(handle.lease.expiresAt)).toBeGreaterThan(
      Date.parse(handle.lease.createdAt),
    );

    await handle.release();
    const remaining = await readdir(nodePath.join(tempTendDir, "leases"));
    expect(remaining).toEqual([]);
  });

  test("tracks leases during captureScreenshot and cleans up tab + leases on success", async () => {
    let observedLeasesDuringShot: string[] = [];
    const { client, events } = makeFakeClient({
      screenshot: async (_token, tabId, outPath) => {
        events.push(`screenshot:${tabId}`);
        observedLeasesDuringShot = await readdir(
          nodePath.join(tempTendDir, "leases"),
        );
        return { success: true, data: outPath };
      },
    });

    const result = await captureScreenshot({
      baseUrl: "http://localhost:4321",
      route: "/",
      outPath: nodePath.join(tempTendDir, "out.png"),
      waitForSelector: "main",
      client,
    });

    expect(result.path).toContain("out.png");
    expect(observedLeasesDuringShot).toHaveLength(2);
    expect(events).toEqual([
      "createSession",
      "navigateNewTab:about:blank",
      "navigateTab:tab_test_1:http://localhost:4321/",
      "screenshot:tab_test_1",
      "closeTab:tab_test_1",
      "revokeSession:ses_test_1",
    ]);

    const remaining = await readdir(nodePath.join(tempTendDir, "leases"));
    expect(remaining).toEqual([]);
  });

  test("closes opened PinchTab tab and removes leases in finally when capture fails", async () => {
    const { client, events } = makeFakeClient({
      screenshot: () =>
        Promise.resolve({ success: false, error: "renderer crashed" }),
    });

    await expect(
      captureScreenshot({
        baseUrl: "http://localhost:4321",
        route: "/",
        outPath: nodePath.join(tempTendDir, "out.png"),
        waitForSelector: "main",
        client,
      }),
    ).rejects.toThrow("renderer crashed");

    expect(events).toEqual([
      "createSession",
      "navigateNewTab:about:blank",
      "navigateTab:tab_test_1:http://localhost:4321/",
      "closeTab:tab_test_1",
      "revokeSession:ses_test_1",
    ]);

    const remaining = await readdir(nodePath.join(tempTendDir, "leases"));
    expect(remaining).toEqual([]);
  });
});
