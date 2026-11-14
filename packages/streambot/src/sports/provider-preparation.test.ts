import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createSportsPreparer,
  type ValidateSportsInput,
} from "./provider-preparation.ts";
import { SportsPlaybackError } from "./failures.ts";
import type { SportsPageRenderer } from "./pinchtab.ts";

const page = "https://v2.streameast.ga/nba/fixture/";
const signal = new AbortController().signal;
const html = `<li class="se-stream" data-stream-i="0"><a href="${page}2">Server 2</a></li><li class="se-stream is-pro" data-stream-i="1"><a href="${page}3">Pro</a></li>`;
afterEach(() => vi.unstubAllGlobals());
function browser(content = html): SportsPageRenderer {
  return {
    html: vi.fn(async () => content),
    runtimeStreams: vi.fn(async () => ({ resources: [], headers: {} })),
  };
}

describe("sports candidate preparation", () => {
  it("keeps TvSportsLive on its existing browser verification path", async () => {
    const b = { ...browser(), mediaPage: vi.fn() };
    const legacy = vi.fn(async () => ({
      title: "Fixture",
      input: "fixture",
      headers: {},
    }));
    const validate = vi.fn<ValidateSportsInput>(async (input) => input);
    const prepare = createSportsPreparer(b, legacy, validate);
    const url = "https://tvsportslive.fr/fixture/";
    const result = await prepare({ sourceUrl: url }, signal);
    expect(legacy).toHaveBeenCalledExactlyOnceWith(url, signal);
    expect(b.mediaPage).not.toHaveBeenCalled();
    expect(validate).toHaveBeenCalledOnce();
    await result.close();
  });
  it.each([
    "https://v2.streameast.ga/ClearKeyEmbed.php?t=private",
    page + "?ticket=private",
    page + "#private",
    "https://v2.streameast.ga/nba/fixture/2/extra",
  ])(
    "rejects private player and noncanonical source recipes: %s",
    async (url) => {
      const b = browser();
      const prepare = createSportsPreparer(b, vi.fn(), vi.fn());
      await expect(prepare({ sourceUrl: url }, signal)).rejects.toMatchObject({
        kind: "unsupported-format",
      });
      expect(b.html).not.toHaveBeenCalled();
    },
  );
  it("retains the root event title instead of the adapter's generic player title", async () => {
    const prepare = createSportsPreparer(
      browser(`<title>Warriors &amp; Spurs | StreamEast</title>${html}`),
      async () => ({ title: "Live sports", input: "fixture", headers: {} }),
      async (input) => input,
    );
    const result = await prepare({ sourceUrl: page }, signal);
    expect(result.title).toBe("Warriors & Spurs");
    await result.close();
  });

  it("rejects all-subscriber menus before resolving media", async () => {
    const legacy = vi.fn();
    const prepare = createSportsPreparer(
      browser('<li class="se-stream is-pro" data-stream-i="0"></li>'),
      legacy,
      vi.fn(),
    );
    await expect(prepare({ sourceUrl: page }, signal)).rejects.toMatchObject({
      kind: "subscriber-only",
    });
    expect(legacy).not.toHaveBeenCalled();
  });

  it("tries another free server when media validation fails", async () => {
    const legacy = vi.fn(async (url: string) => ({
      title: "Fixture",
      input: url,
      headers: {},
    }));
    const validate = vi.fn<ValidateSportsInput>(async (input) => {
      if (input.input === page) throw new SportsPlaybackError("unavailable");
      return input;
    });
    const prepare = createSportsPreparer(browser(), legacy, validate);
    const prepared = await prepare({ sourceUrl: page }, signal);
    expect(prepared.input).toBe(page + "2");
    expect(legacy.mock.calls.map(([url]) => url)).toEqual([page, page + "2"]);
    await prepared.close();
  });

  it("does not try other servers after cancellation during validation", async () => {
    const abort = new AbortController();
    const legacy = vi.fn(async (url: string) => ({
      title: "Fixture",
      input: url,
      headers: {},
    }));
    const prepare = createSportsPreparer(browser(), legacy, async () => {
      abort.abort(new Error("cancelled"));
      throw new Error("probe failed");
    });
    await expect(prepare({ sourceUrl: page }, abort.signal)).rejects.toThrow(
      "cancelled",
    );
    expect(legacy).toHaveBeenCalledOnce();
  });

  it("reports an ended event without touching media", async () => {
    const legacy = vi.fn();
    const prepare = createSportsPreparer(
      browser("window._SE={showEndedScreen:true}"),
      legacy,
      vi.fn(),
    );
    await expect(prepare({ sourceUrl: page }, signal)).rejects.toMatchObject({
      kind: "ended",
    });
    expect(legacy).not.toHaveBeenCalled();
  });

  it("rejects a source outside the approved provider boundary", async () => {
    const b = browser();
    const prepare = createSportsPreparer(b, vi.fn(), vi.fn());
    await expect(
      prepare({ sourceUrl: "https://untrusted.invalid/" }, signal),
    ).rejects.toMatchObject({ kind: "unsupported-format" });
    expect(b.html).not.toHaveBeenCalled();
  });
});
