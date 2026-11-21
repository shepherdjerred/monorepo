import { describe, expect, it, vi } from "vitest";
import { PinchTabSubtitleBrowser } from "./browser-subtitles.ts";
import { SubtitleBrowserCredentialSchema } from "./subtitle-browser-profile.ts";

const profileId = "prof_a123b456";
const connection = { baseUrl: "http://pinchtab.local", token: "fixture" };
const target = {
  id: "inst-current",
  profileId,
  status: "running",
  attached: false,
};
const foreign = {
  id: "inst-foreign",
  profileId: "prof_f234c567",
  status: "running",
  attached: false,
};
const profilePath = `/profiles/${profileId}`;
const startPath = `${profilePath}/start`;
const openPath = "/instances/inst-current/tabs/open";

describe("SubHD PinchTab profile", () => {
  it("preserves the fixed instance credential and journals immediately before opening", async () => {
    const beforeOpen = vi.fn(async () => {
      /* The fixture observes the journal callback. */
    });
    const transport = vi.fn(async (url: URL, init: RequestInit) => {
      expect(url.pathname).toBe(openPath);
      expect(init.method).toBe("POST");
      expect(beforeOpen).toHaveBeenCalledTimes(1);
      return Response.json({ tabId: "owned-tab" });
    });
    const credential = SubtitleBrowserCredentialSchema.parse({
      ...connection,
      instanceId: target.id,
    });
    const browser = new PinchTabSubtitleBrowser(credential, transport);
    await expect(browser.openSubhd("abc", undefined, beforeOpen)).resolves.toBe(
      "owned-tab",
    );
    expect(transport).toHaveBeenCalledTimes(1);
    expect(
      SubtitleBrowserCredentialSchema.safeParse({ ...credential, profileId })
        .success,
    ).toBe(false);
  });

  it("reuses the configured profile and never chooses another running instance", async () => {
    const paths: string[] = [];
    const credential = SubtitleBrowserCredentialSchema.parse({
      ...connection,
      profileId,
    });
    const browser = new PinchTabSubtitleBrowser(
      credential,
      async (url, init) => {
        expect(new Headers(init.headers).get("authorization")).toBe(
          "Bearer fixture",
        );
        paths.push(url.pathname);
        return url.pathname === "/instances"
          ? Response.json([foreign, target])
          : Response.json({ tabId: "owned-tab" });
      },
    );
    await expect(browser.openSubhd("abc")).resolves.toBe("owned-tab");
    expect(paths).toEqual(["/instances", openPath]);
  });

  it("starts the exact profile and confirms the returned instance before journaling", async () => {
    const paths: string[] = [];
    const browser = new PinchTabSubtitleBrowser(
      { ...connection, profileId },
      async (url, init) => {
        paths.push(url.pathname);
        if (url.pathname === profilePath) {
          expect(init.method).toBe("GET");
          return Response.json({ id: profileId });
        }
        if (url.pathname === startPath) {
          expect(init).toMatchObject({
            method: "POST",
            body: JSON.stringify({
              headless: true,
              securityPolicy: { allowedDomains: ["subhd.tv", "www.subhd.tv"] },
            }),
          });
          return Response.json(
            { ...target, status: "starting" },
            { status: 201 },
          );
        }
        if (url.pathname === "/instances") {
          expect(init.method).toBe("GET");
          if (paths.length === 1) return Response.json([foreign]);
          const status = paths.length === 4 ? "starting" : "running";
          return Response.json([foreign, { ...target, status }]);
        }
        return Response.json({ tabId: "owned-tab" });
      },
    );
    await expect(
      browser.openSubhd("abc", undefined, async () => {
        paths.push("journal");
      }),
    ).resolves.toBe("owned-tab");
    expect(paths).toEqual([
      "/instances",
      profilePath,
      startPath,
      "/instances",
      "/instances",
      "journal",
      openPath,
    ]);
  });

  it.each(["conflict", "lost response"])(
    "reads back a %s without repeating the start",
    async (outcome) => {
      const paths: string[] = [];
      const browser = new PinchTabSubtitleBrowser(
        { ...connection, profileId },
        async (url) => {
          paths.push(url.pathname);
          if (url.pathname === profilePath)
            return Response.json({ id: profileId });
          if (url.pathname === startPath) {
            if (outcome === "conflict")
              return new Response(null, { status: 409 });
            throw new Error("fixture transport dropped the response");
          }
          if (url.pathname === "/instances")
            return Response.json(paths.length === 1 ? [foreign] : [target]);
          return Response.json({ tabId: "owned-tab" });
        },
      );
      await expect(browser.openSubhd("abc")).resolves.toBe("owned-tab");
      expect(paths).toEqual([
        "/instances",
        profilePath,
        startPath,
        "/instances",
        openPath,
      ]);
    },
  );

  it("rejects multiple matches and stops before journaling or opening a tab", async () => {
    const beforeOpen = vi.fn(async () => {
      /* The fixture observes the journal callback. */
    });
    const transport = vi.fn(async () =>
      Response.json([target, { ...target, id: "inst-other" }]),
    );
    const browser = new PinchTabSubtitleBrowser(
      { ...connection, profileId },
      transport,
    );
    await expect(
      browser.openSubhd("abc", undefined, beforeOpen),
    ).rejects.toMatchObject({ kind: "conflict" });
    expect(transport).toHaveBeenCalledTimes(1);
    expect(beforeOpen).not.toHaveBeenCalled();
  });

  it("does not use an external attachment even if its profile ID matches", async () => {
    const transport = vi.fn(async () =>
      Response.json([{ ...target, attached: true }]),
    );
    const browser = new PinchTabSubtitleBrowser(
      { ...connection, profileId },
      transport,
    );
    await expect(browser.openSubhd("abc")).rejects.toMatchObject({
      kind: "conflict",
    });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("does not start a profile if PinchTab interpreted the ID as another profile's name", async () => {
    const paths: string[] = [];
    const browser = new PinchTabSubtitleBrowser(
      { ...connection, profileId },
      async (url) => {
        paths.push(url.pathname);
        return url.pathname === "/instances"
          ? Response.json([])
          : Response.json({ id: foreign.profileId, name: profileId });
      },
    );
    await expect(browser.openSubhd("abc")).rejects.toMatchObject({
      kind: "invalid-response",
    });
    expect(paths).toEqual(["/instances", profilePath]);
  });

  it("closes an existing tab without looking up or starting a profile", async () => {
    const transport = vi.fn(async (url: URL, init: RequestInit) => {
      expect(url.pathname).toBe("/tabs/owned-tab/close");
      expect(init.method).toBe("POST");
      return Response.json({});
    });
    const browser = new PinchTabSubtitleBrowser(
      { ...connection, profileId },
      transport,
    );
    await browser.close("owned-tab");
    expect(transport).toHaveBeenCalledTimes(1);
  });
});
