import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  assetCommand,
  planFile,
  type PlannedInput,
  renderPlannedGifs,
} from "#commands/pr/asset.ts";
import { PUBLIC_HOST } from "#lib/s3/assets.ts";
import { aggArgv, CastGifRenderError } from "#lib/s3/cast-gif.ts";

describe("planFile", () => {
  test("plans a cast, its player page, and its GIF preview", async () => {
    const plan = planFile(12, "/rec/demo.cast", "/scratch/0.gif");

    expect(
      plan.uploads.map(({ key, contentType, source }) => ({
        key,
        contentType,
        source,
      })),
    ).toEqual([
      {
        key: "pr/assets/12/demo.cast",
        contentType: "application/x-asciicast",
        source: "/rec/demo.cast",
      },
      {
        key: "pr/assets/12/demo.cast.html",
        contentType: "text/html; charset=utf-8",
        source: "/rec/demo.cast (generated player page)",
      },
      {
        key: "pr/assets/12/demo.cast.gif",
        contentType: "image/gif",
        source: "/rec/demo.cast (generated GIF preview)",
      },
    ]);
    expect(plan.gifRenders).toEqual([
      { castPath: "/rec/demo.cast", gifPath: "/scratch/0.gif" },
    ]);
    // The bare URL stays the interactive player page.
    expect(plan.url).toBe(`${PUBLIC_HOST}/pr/assets/12/demo.cast.html`);
    expect(plan.markdown).toBe(
      `[![demo.cast (terminal recording)](${PUBLIC_HOST}/pr/assets/12/demo.cast.gif)](${PUBLIC_HOST}/pr/assets/12/demo.cast.html)`,
    );
  });

  test("uploads the GIF bytes the renderer wrote", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "asset-plan-test-"));
    try {
      const gifPath = path.join(dir, "0.gif");
      const plan = planFile(1, "demo.cast", gifPath);
      await writeFile(gifPath, "GIF89a");
      const gifUpload = plan.uploads.find((upload) =>
        upload.key.endsWith(".gif"),
      );
      expect(new TextDecoder().decode(await gifUpload?.body())).toBe("GIF89a");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("plans no GIF render for non-cast files", () => {
    const plan = planFile(3, "/shots/after.png", "/scratch/0.gif");
    expect(plan.uploads.map((upload) => upload.key)).toEqual([
      "pr/assets/3/after.png",
    ]);
    expect(plan.gifRenders).toEqual([]);
    expect(plan.markdown).toBe(
      `![after.png](${PUBLIC_HOST}/pr/assets/3/after.png)`,
    );
  });
});

describe("renderPlannedGifs", () => {
  const inputs: PlannedInput[] = [
    planFile(1, "a.cast", "/scratch/0.gif"),
    planFile(1, "b.png", "/scratch/1.gif"),
    planFile(1, "c.cast", "/scratch/2.gif"),
  ];

  test("renders every planned cast in argument order", async () => {
    const calls: string[][] = [];
    await renderPlannedGifs(inputs, (castPath, gifPath) => {
      calls.push([castPath, gifPath]);
      return Promise.resolve();
    });
    expect(calls).toEqual([
      ["a.cast", "/scratch/0.gif"],
      ["c.cast", "/scratch/2.gif"],
    ]);
  });

  test("stops at the first render failure", async () => {
    const renderer = vi.fn((castPath: string) =>
      Promise.reject(new CastGifRenderError(castPath, "boom")),
    );
    await expect(renderPlannedGifs(inputs, renderer)).rejects.toThrow(
      "could not render a GIF from 'a.cast' with agg: boom",
    );
    expect(renderer).toHaveBeenCalledTimes(1);
  });
});

describe("aggArgv", () => {
  test("passes the cast and output paths as separate argv entries", () => {
    expect(aggArgv("/bin/agg", "my demo.cast", "/tmp/out 0.gif")).toEqual([
      "/bin/agg",
      "--quiet",
      "--idle-time-limit",
      "2",
      "--last-frame-duration",
      "4",
      "my demo.cast",
      "/tmp/out 0.gif",
    ]);
  });
});

describe("assetCommand GIF rendering", () => {
  let dir: string;
  let castPath: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "asset-command-test-"));
    castPath = path.join(dir, "demo.cast");
    await writeFile(castPath, '{"version":2,"width":80,"height":24}\n');
  });

  afterEach(async () => {
    process.exitCode = undefined;
    vi.restoreAllMocks();
    await rm(dir, { recursive: true, force: true });
  });

  test("a failed render exits 1 before any upload and cleans up", async () => {
    const errors: string[] = [];
    vi.spyOn(console, "error").mockImplementation((message: unknown) => {
      errors.push(String(message));
    });
    const log = vi.spyOn(console, "log").mockImplementation(() => {
      /* no output expected */
    });
    let renderedGifPath: string | undefined;

    await assetCommand("7", [castPath], { markdown: true }, (cast, gif) => {
      renderedGifPath = gif;
      return Promise.reject(
        new CastGifRenderError(cast, "agg is not installed or not on PATH"),
      );
    });

    expect(process.exitCode).toBe(1);
    expect(errors[0]).toBe(
      `Error: could not render a GIF from '${castPath}' with agg: agg is not installed or not on PATH`,
    );
    expect(errors[1]).toContain("brew install agg");
    expect(errors[1]).toContain("Nothing was uploaded.");
    expect(log).not.toHaveBeenCalled();
    expect(renderedGifPath).toBeDefined();
    await expect(
      stat(path.dirname(renderedGifPath ?? "")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("an unexpected renderer error propagates", async () => {
    await expect(
      assetCommand("7", [castPath], {}, () =>
        Promise.reject(new Error("unexpected")),
      ),
    ).rejects.toThrow("unexpected");
  });
});
