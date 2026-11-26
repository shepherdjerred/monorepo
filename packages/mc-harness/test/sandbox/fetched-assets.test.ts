import { createHash } from "node:crypto";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  AssetManifestSchema,
  ensureAssets,
  staleAssets,
} from "#sandbox/fetched-assets.ts";
import { stageEntries } from "#sandbox/staging.ts";

const mesh = "baked mesh bytes";
const sha256 = createHash("sha256").update(mesh).digest("hex");

let repo: string;
let manifest: string;

/** A command that writes `content` to `file`, standing in for the real fetch. */
function writes(file: string, content: string): string[] {
  return [
    "bun",
    "-e",
    `await Bun.write(${JSON.stringify(file)}, ${JSON.stringify(content)})`,
  ];
}

beforeEach(async () => {
  repo = await mkdtemp(path.join(tmpdir(), "mc-fetched-assets-"));
  manifest = path.join(repo, "owned", "rwf", "nav-manifest.json");
  await mkdir(path.join(repo, "owned", "rwf", "lobby"), { recursive: true });
  await Bun.write(path.join(repo, "owned", "config.yml"), "a: 1\n");
  await Bun.write(
    manifest,
    JSON.stringify({
      baseUrl: "https://assets.example/nav/sha256",
      objects: [{ path: "lobby/nav.rwfnav", sha256, bytes: mesh.length }],
    }),
  );
});

describe("fetched assets", () => {
  it("rejects a manifest that could write outside its folder", () => {
    const entry = { sha256, bytes: 1 };
    const parse = (assetPath: string) =>
      AssetManifestSchema.safeParse({
        baseUrl: "https://assets.example/nav",
        objects: [{ ...entry, path: assetPath }],
      }).success;
    expect(parse("maps/valley/nav.rwfnav")).toBe(true);
    expect(parse("../nav.rwfnav")).toBe(false);
    expect(parse("maps/../../nav.rwfnav")).toBe(false);
    expect(parse("/etc/nav.rwfnav")).toBe(false);
  });

  it("names files that are absent or hold other bytes", async () => {
    const file = path.join(repo, "owned", "rwf", "lobby", "nav.rwfnav");
    expect(await staleAssets(manifest)).toEqual(["lobby/nav.rwfnav"]);
    await Bun.write(file, "baked mesh BYTES");
    expect(await staleAssets(manifest)).toEqual(["lobby/nav.rwfnav"]);
    await Bun.write(file, mesh);
    expect(await staleAssets(manifest)).toEqual([]);
  });

  it("runs the fetch only when something is stale", async () => {
    const file = path.join(repo, "owned", "rwf", "lobby", "nav.rwfnav");
    await ensureAssets({ manifest, fetch: writes(file, mesh), cwd: repo });
    expect(await Bun.file(file).text()).toBe(mesh);
    // Present and exact: a fetch that would fail is never started.
    await ensureAssets({ manifest, fetch: ["false"], cwd: repo });
  });

  it("fails when the fetch fails or leaves an asset wrong", async () => {
    const file = path.join(repo, "owned", "rwf", "lobby", "nav.rwfnav");
    await expect(
      ensureAssets({ manifest, fetch: ["false"], cwd: repo }),
    ).rejects.toThrow(/false failed \(1\)/u);
    await expect(
      ensureAssets({ manifest, fetch: writes(file, "other"), cwd: repo }),
    ).rejects.toThrow(/left 1 of .* missing or altered: lobby\/nav\.rwfnav/u);
  });

  it("fetches a staged directory's assets before copying it", async () => {
    const file = path.join(repo, "owned", "rwf", "lobby", "nav.rwfnav");
    const plugins = path.join(repo, "plugins");
    await stageEntries(plugins, repo, [
      {
        kind: "repo-dir",
        source: "owned",
        target: "Owned",
        assets: {
          manifest: path.join("owned", "rwf", "nav-manifest.json"),
          fetch: writes(file, mesh),
        },
      },
    ]);
    expect(
      await Bun.file(
        path.join(plugins, "Owned", "rwf", "lobby", "nav.rwfnav"),
      ).text(),
    ).toBe(mesh);
  });

  it("copies a source tree from before the manifest existed as it is", async () => {
    const plugins = path.join(repo, "plugins");
    await stageEntries(plugins, repo, [
      {
        kind: "repo-dir",
        source: "owned",
        target: "Owned",
        assets: { manifest: "owned/rwf/absent.json", fetch: ["false"] },
      },
    ]);
    expect(
      await Bun.file(path.join(plugins, "Owned", "config.yml")).text(),
    ).toBe("a: 1\n");
  });
});
