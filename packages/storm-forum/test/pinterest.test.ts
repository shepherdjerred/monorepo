import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

const source = await Bun.file(
  new URL("../assets/pinterest.js", import.meta.url),
).text();

function load(
  hostname = "ts-mc.net",
  privacy = {},
  crypto: { randomUUID: () => string } | boolean = true,
) {
  const browser: {
    location: { hostname: string };
    crypto?: { randomUUID: () => string };
    pintrk?: { (...args: unknown[]): void; queue: unknown[][] };
  } = {
    location: { hostname },
    ...(crypto === true
      ? {
          crypto: {
            randomUUID: () => "00000000-0000-4000-8000-000000000001",
          },
        }
      : crypto === false
        ? {}
        : { crypto }),
  };
  const scripts: object[] = [];
  const document = Object.assign(new EventTarget(), {
    createElement: () => ({ src: "", async: false }),
    getElementsByTagName: () => [
      {
        parentNode: { insertBefore: (script: object) => scripts.push(script) },
      },
    ],
  });
  runInNewContext(source, { window: browser, document, navigator: privacy });
  const copy = (edition: "java" | "bedrock", field: "address" | "port") =>
    document.dispatchEvent(
      new CustomEvent("storm:server-address-copied", {
        detail: { edition, field, surface: "forum" },
      }),
    );
  return { browser, scripts, copy };
}

describe("Pinterest join intent", () => {
  it("queues page measurement before the SDK arrives, with the shared tag", () => {
    const fixture = load();
    expect(fixture.scripts).toEqual([
      { async: true, src: "https://s.pinimg.com/ct/core.js" },
    ]);
    expect(fixture.browser.pintrk?.queue).toEqual([
      ["load", "2612722784413"],
      ["page"],
      ["track", "pagevisit"],
    ]);
  });

  it.each(["java", "bedrock"] as const)(
    "counts one %s address intent, excluding port copies and repeats",
    (edition) => {
      const fixture = load();
      fixture.copy("bedrock", "port");
      expect(fixture.browser.pintrk?.queue).toHaveLength(3);
      fixture.copy(edition, "address");
      fixture.copy(edition, "address");
      fixture.copy("bedrock", "port");
      fixture.copy(edition === "java" ? "bedrock" : "java", "address");
      expect(fixture.browser.pintrk?.queue).toHaveLength(4);
      expect(fixture.browser.pintrk?.queue[3]).toEqual([
        "track",
        "lead",
        {
          lead_type: "storm_server_address_copied",
          edition,
          event_id: "00000000-0000-4000-8000-000000000001",
        },
      ]);
    },
  );

  it("uses a timestamp/random event id when randomUUID is unavailable", () => {
    const fixture = load("ts-mc.net", {}, false);
    fixture.copy("java", "address");
    expect(fixture.browser.pintrk?.queue[3]).toEqual([
      "track",
      "lead",
      expect.objectContaining({
        lead_type: "storm_server_address_copied",
        edition: "java",
        event_id: expect.stringMatching(/^\d+-[a-z0-9]+$/),
      }),
    ]);
  });

  it.each([
    ["localhost", {}],
    ["127.0.0.1", {}],
    ["beta.ts-mc.net", {}],
    ["ts-mc.net", { doNotTrack: "1" }],
    ["ts-mc.net", { globalPrivacyControl: true }],
  ] as const)("does not load tracking for %s with %o", (hostname, privacy) => {
    const fixture = load(hostname, privacy);
    fixture.copy("java", "address");
    expect(fixture.scripts).toHaveLength(0);
    expect(fixture.browser.pintrk).toBeUndefined();
  });
});
