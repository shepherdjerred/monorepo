import { createHash } from "node:crypto";
import { describe, expect, test, vi } from "vitest";
import {
  nativeBuildFromReleaseVersion,
  observeReplayPatch,
} from "./upstream.ts";

const currentRelease =
  "16.22.8348910+branch.releases-16-22.code.public.content.release.anticheat.vanguard";
const observedAt = new Date("2026-11-13T12:00:00.000Z");

describe("official native replay build discovery", () => {
  test.each([
    [currentRelease, "16.22.834.8910"],
    ["16.21.8298620+branch.releases-16-21.code.public", "16.21.829.8620"],
    ["16.19.8230722+branch.releases-16-19.code.public", "16.19.823.722"],
  ])("decodes native build identity from %s", (release, expected) => {
    expect(nativeBuildFromReleaseVersion(release)).toBe(expected);
  });

  test.each([
    "16.22.834.8910",
    "16.22.1",
    "16.22.8348910+branch.releases-16-21.code.public",
    "16.22.8348910+branch.pbe.code.public",
    "16.22.8348910+branch.releases-16-22.code.public/other",
  ])("rejects an unknown or inconsistent release identity: %s", (release) => {
    expect(() => nativeBuildFromReleaseVersion(release)).toThrow();
  });

  test("retains the official response digest and chooses the newest numerical identity", async () => {
    const body = JSON.stringify({
      compat_versions: [
        { id: currentRelease },
        { id: "16.9.9999999+branch.releases-16-9.code.public" },
        { id: "16.22.8340900+branch.releases-16-22.code.public" },
      ],
    });
    const get = vi.fn<typeof fetch>().mockResolvedValue(new Response(body));
    const observation = await observeReplayPatch("NA1", {
      fetch: get,
      now: () => observedAt,
    });
    expect(observation).toEqual({
      platformId: "NA1",
      patch: "16.22",
      gameBuild: "16.22.834.8910",
      sourceUrl:
        "https://sieve.services.riotcdn.net/api/v1/products/lol/version-sets/NA1/versions?platform=windows",
      sourceSha256: createHash("sha256").update(body).digest("hex"),
      observedAt: observedAt.toISOString(),
    });
    expect(get).toHaveBeenCalledWith(
      observation.sourceUrl,
      expect.objectContaining({ redirect: "error" }),
    );
    expect(observation).not.toHaveProperty("protocol");
    expect(observation).not.toHaveProperty("renderPackage");
  });

  test.each([403, 404, 500, 302])(
    "refuses HTTP %s without recording an observation",
    async (status) => {
      const get = vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response("upstream", { status }));
      await expect(observeReplayPatch("NA1", { fetch: get })).rejects.toThrow(
        `HTTP ${String(status)}`,
      );
    },
  );

  test.each([
    "{}",
    '{"compat_versions":[]}',
    '{"compat_versions":[{"id":"invented"}]}',
    "not-json",
  ])("rejects incomplete or unknown release data: %s", async (body) => {
    const get = vi.fn<typeof fetch>().mockResolvedValue(new Response(body));
    await expect(observeReplayPatch("NA1", { fetch: get })).rejects.toThrow();
  });

  test("rejects a platform before it can alter the fixed official URL", async () => {
    const get = vi.fn<typeof fetch>();
    await expect(
      observeReplayPatch("NA1/../../other", { fetch: get }),
    ).rejects.toThrow();
    expect(get).not.toHaveBeenCalled();
  });

  test("bounds and cancels an oversized upstream response", async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(1024 * 1024 + 1));
      },
      cancel,
    });
    const get = vi.fn<typeof fetch>().mockResolvedValue(new Response(stream));
    await expect(observeReplayPatch("NA1", { fetch: get })).rejects.toThrow(
      "size limit",
    );
    expect(cancel).toHaveBeenCalledOnce();
  });
});
