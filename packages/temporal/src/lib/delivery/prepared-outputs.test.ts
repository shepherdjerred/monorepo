import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  chmod,
  mkdir,
  mkdtemp,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";
import {
  keepPreparedOutputs,
  restorePreparedOutputs,
  type PreparedWorkspace,
} from "./prepared-outputs.ts";

const KEY = "a".repeat(64);
const OTHER = "b".repeat(64);
let root = "";
let workspace: PreparedWorkspace;

function git(args: string[]) {
  const result = Bun.spawnSync(["git", ...args], {
    cwd: workspace.source,
    env: {
      PATH: Bun.env["PATH"],
      HOME: root,
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@localhost",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@localhost",
    },
    stderr: "pipe",
  });
  if (result.exitCode !== 0)
    throw new Error(`git ${args.join(" ")}: ${result.stderr.toString()}`);
}

const OUTPUTS = {
  "packages/delivery/generated/prisma/client.ts": "export const client = 1;\n",
  "packages/llm-models/dist/index.js": "export {};\n",
  ".turbo/turbo-generate.log": "generated\n",
};

async function prepare() {
  for (const [file, content] of Object.entries(OUTPUTS)) {
    await mkdir(path.dirname(path.join(workspace.source, file)), {
      recursive: true,
    });
    await writeFile(path.join(workspace.source, file), content);
  }
  await mkdir(workspace.bin, { recursive: true });
  await writeFile(path.join(workspace.bin, "toolkit"), "binary\n");
  await chmod(path.join(workspace.bin, "toolkit"), 0o755);
}

/** What the next Job's clean leaves: the tracked tree and node_modules only. */
async function nextJob() {
  git(["clean", "-ffdxq", "-e", "node_modules"]);
  await rm(workspace.bin, { recursive: true, force: true });
  await mkdir(workspace.bin);
}

const restoredFiles = async () => {
  const present: string[] = [];
  for (const file of [
    ...Object.keys(OUTPUTS).map((name) => path.join(workspace.source, name)),
    path.join(workspace.bin, "toolkit"),
  ])
    if (await Bun.file(file).exists()) present.push(file);
  return present;
};

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "prepared-outputs-"));
  workspace = {
    source: path.join(root, "source"),
    bin: path.join(root, "bin"),
    prepared: path.join(root, "prepared"),
  };
  await mkdir(path.join(workspace.source, "packages/delivery"), {
    recursive: true,
  });
  await writeFile(
    path.join(workspace.source, "packages/delivery/schema.prisma"),
    "model A {}\n",
  );
  git(["init", "-q"]);
  git(["add", "-A"]);
  git(["commit", "-q", "-m", "tracked"]);
  await mkdir(path.join(workspace.source, "node_modules/prisma"), {
    recursive: true,
  });
  await writeFile(
    path.join(workspace.source, "node_modules/prisma/index.js"),
    "dep\n",
  );
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const KeptManifest = z.object({
  files: z.array(z.object({ path: z.string(), sha256: z.string() })),
});

/**
 * Add `kept` to the kept outputs with a matching sha256 in the manifest, as
 * something sharing the claim could, and return the restore result.
 */
async function restoreForged(kept: string, content: string) {
  await prepare();
  await keepPreparedOutputs(workspace, KEY);
  const target = path.join(workspace.prepared, kept);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content);
  const manifest = path.join(workspace.prepared, "manifest.json");
  const { files } = KeptManifest.parse(await Bun.file(manifest).json());
  files.push({
    path: kept,
    sha256: createHash("sha256").update(content).digest("hex"),
  });
  await writeFile(manifest, JSON.stringify({ key: KEY, files }));
  await nextJob();
  return await restorePreparedOutputs(workspace, KEY);
}

describe("prepared outputs kept between stage Jobs", () => {
  it("keeps hard links to every generated output and the toolkit, and restores them for the same inputs", async () => {
    await prepare();
    expect(await keepPreparedOutputs(workspace, KEY)).toEqual({
      kept: true,
      files: 4,
    });
    const kept = await stat(path.join(workspace.prepared, "bin/toolkit"));
    const linked = await stat(path.join(workspace.bin, "toolkit"));
    expect(kept.ino).toBe(linked.ino);
    // node_modules is the install's, not a prepared output.
    expect(
      await Bun.file(
        path.join(workspace.prepared, "source/node_modules/prisma/index.js"),
      ).exists(),
    ).toBe(false);

    await nextJob();
    expect(await restoredFiles()).toEqual([]);
    expect(await restorePreparedOutputs(workspace, KEY)).toEqual({
      restored: true,
      files: 4,
    });
    for (const [file, content] of Object.entries(OUTPUTS))
      expect(await Bun.file(path.join(workspace.source, file)).text()).toBe(
        content,
      );
    const toolkit = await stat(path.join(workspace.bin, "toolkit"));
    expect(toolkit.ino).toBe(kept.ino);
    expect(toolkit.mode & 0o111).toBe(0o111);
  });

  it("restores nothing for other inputs", async () => {
    await prepare();
    await keepPreparedOutputs(workspace, KEY);
    await nextJob();
    expect(await restorePreparedOutputs(workspace, OTHER)).toEqual({
      restored: false,
      reason: "other-inputs",
    });
    expect(await restoredFiles()).toEqual([]);
  });

  it.each([
    [
      "a kept output's content changed",
      async () => {
        // Written through the checkout's hard link, as a later step might.
        await writeFile(
          path.join(workspace.source, "packages/llm-models/dist/index.js"),
          "export const changed = 1;\n",
        );
      },
      "source/packages/llm-models/dist/index.js",
    ],
    [
      "a file was added to the kept outputs",
      async () => {
        await writeFile(
          path.join(workspace.prepared, "source/packages/extra.ts"),
          "x\n",
        );
      },
      "kept outputs were added or removed",
    ],
    [
      "a kept output was removed",
      async () => {
        await rm(path.join(workspace.prepared, "bin/toolkit"));
      },
      "kept outputs were added or removed",
    ],
    [
      "a kept output became a symlink",
      async () => {
        await rm(path.join(workspace.prepared, "bin/toolkit"));
        await symlink("/bin/sh", path.join(workspace.prepared, "bin/toolkit"));
      },
      "a kept output is not a regular file",
    ],
  ])(
    "regenerates when %s, and links nothing",
    async (_name, damage, detail) => {
      await prepare();
      await keepPreparedOutputs(workspace, KEY);
      await damage();
      await nextJob();
      expect(await restorePreparedOutputs(workspace, KEY)).toEqual({
        restored: false,
        reason: "changed",
        detail,
      });
      expect(await restoredFiles()).toEqual([]);
    },
  );

  it("treats a manifest naming a path outside the kept directory as absent", async () => {
    await prepare();
    await keepPreparedOutputs(workspace, KEY);
    await writeFile(
      path.join(workspace.prepared, "manifest.json"),
      JSON.stringify({
        key: KEY,
        files: [{ path: "source/../../escape", sha256: KEY }],
      }),
    );
    await nextJob();
    expect(await restorePreparedOutputs(workspace, KEY)).toEqual({
      restored: false,
      reason: "absent",
    });
  });

  it("keeps nothing when preparation changed a tracked file", async () => {
    await prepare();
    await writeFile(
      path.join(workspace.source, "packages/delivery/schema.prisma"),
      "model B {}\n",
    );
    expect(await keepPreparedOutputs(workspace, KEY)).toEqual({
      kept: false,
      detail: "preparation changed tracked files",
    });
    await expect(stat(workspace.prepared)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("keeps nothing when an output is not a regular file", async () => {
    await prepare();
    await symlink(
      "/bin/sh",
      path.join(workspace.source, "packages/llm-models/dist/link"),
    );
    expect(await keepPreparedOutputs(workspace, KEY)).toEqual({
      kept: false,
      detail: "source/packages/llm-models/dist/link is not a regular file",
    });
    await expect(stat(workspace.prepared)).rejects.toMatchObject({
      code: "ENOENT",
    });
    await nextJob();
    expect(await restorePreparedOutputs(workspace, KEY)).toEqual({
      restored: false,
      reason: "absent",
    });
  });
});

describe("restoring a manifest that keepPreparedOutputs never wrote", () => {
  it.each([
    ["repository configuration", "source/.git/config"],
    ["a hook", "source/.git/hooks/post-checkout"],
    ["a nested repository's metadata", "source/packages/x/.GIT/config"],
    ["an installed package", "source/node_modules/prisma/index.js"],
    ["a binary other than the toolkit", "bin/git"],
  ])(
    "treats a manifest naming %s as absent and links nothing",
    async (_name, kept) => {
      const config = path.join(workspace.source, ".git/config");
      const before = await Bun.file(config).text();
      expect(await restoreForged(kept, "[core]\n\thooksPath = /tmp\n")).toEqual(
        {
          restored: false,
          reason: "absent",
        },
      );
      expect(await restoredFiles()).toEqual([]);
      expect(await Bun.file(config).text()).toBe(before);
      expect(
        await Bun.file(
          path.join(workspace.source, "node_modules/prisma/index.js"),
        ).text(),
      ).toBe("dep\n");
    },
  );

  it.each([
    ["is a tracked file", "source/packages/delivery/schema.prisma"],
    ["is a tracked directory", "source/docs"],
    ["lies under a tracked file", "source/packages/delivery/schema.prisma/x"],
    ["lies under a tracked symlink", "source/packages/linked/schema.prisma"],
  ])(
    "regenerates when a kept path %s, and links nothing",
    async (_name, kept) => {
      // A tracked symlink to a tracked directory: writing through it would
      // replace tracked content without naming a tracked path.
      await symlink("delivery", path.join(workspace.source, "packages/linked"));
      await mkdir(path.join(workspace.source, "docs"));
      await writeFile(
        path.join(workspace.source, "docs/guide.md"),
        "# Guide\n",
      );
      git(["add", "packages/linked", "docs"]);
      git(["commit", "-q", "-m", "link"]);
      expect(await restoreForged(kept, "model Forged {}\n")).toEqual({
        restored: false,
        reason: "changed",
        detail: `${kept} is or lies under a tracked path`,
      });
      expect(await restoredFiles()).toEqual([]);
      expect(
        await Bun.file(
          path.join(workspace.source, "packages/delivery/schema.prisma"),
        ).text(),
      ).toBe("model A {}\n");
    },
  );
});
