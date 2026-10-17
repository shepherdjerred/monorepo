import { afterEach, expect, test, vi } from "vitest";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  realpath,
  rm,
} from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { ContentProof } from "#filesystem/content-proof.ts";
import { saveManifest } from "#filesystem/operations-io.ts";
import type { FileOperationManifest } from "#filesystem/operations-types.ts";
import type * as FsPromises from "node:fs/promises";

const observation = vi.hoisted(
  (): {
    afterStat: ((filename: string) => void) | null;
    afterClose: (() => void) | null;
  } => ({ afterStat: null, afterClose: null }),
);
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromises>();
  return {
    ...actual,
    lstat: async (...args: Parameters<typeof actual.lstat>) => {
      try {
        return await actual.lstat(...args);
      } finally {
        observation.afterStat?.(String(args[0]));
      }
    },
    open: async (...args: Parameters<typeof actual.open>) => {
      const handle = await actual.open(...args);
      const close = handle.close.bind(handle);
      handle.close = async () => {
        await close();
        observation.afterClose?.();
      };
      return handle;
    },
  };
});
const directories: string[] = [];
afterEach(async () => {
  observation.afterStat = null;
  observation.afterClose = null;
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

async function fixture(targetExists: boolean) {
  const directory = await realpath(
    await mkdtemp(path.join(tmpdir(), "media-before-effect-")),
  );
  directories.push(directory);
  const source = path.join(directory, "source");
  const target = path.join(directory, "target");
  await writeFile(source, "source bytes");
  if (targetExists) await writeFile(target, "target bytes");
  const proof = new ContentProof();
  await proof.capture(source, () => Promise.resolve());
  await proof.capture(target, () => Promise.resolve());
  proof.seal();
  return { directory, source, target, proof };
}

test.each(["link", "rename", "unlink"] as const)(
  "%s checks cancellation after its last awaited stat, before actual mutation",
  async (primitive) => {
    const f = await fixture(primitive === "rename");
    let cancelled = false;
    let sourceStats = 0;
    observation.afterStat = (filename) => {
      if (primitive === "unlink") {
        if (filename === f.source && ++sourceStats === 2) cancelled = true;
      } else if (filename === f.target) cancelled = true;
    };
    const guard = () => {
      if (cancelled) throw new Error("invocation cancelled during final stat");
    };
    const mutate =
      primitive === "unlink"
        ? f.proof.unlink(f.source, guard)
        : primitive === "rename"
          ? f.proof.rename(f.source, f.target, guard)
          : f.proof.link(f.source, f.target, guard);
    await expect(mutate).rejects.toThrow(
      "invocation cancelled during final stat",
    );
    expect(cancelled).toBe(true);
    expect(await readFile(f.source, "utf8")).toBe("source bytes");
    if (primitive === "rename")
      expect(await readFile(f.target, "utf8")).toBe("target bytes");
    else
      await expect(readFile(f.target)).rejects.toMatchObject({
        code: "ENOENT",
      });
  },
);

test("journal install rechecks deadline after awaited close and leaves the original bytes unchanged", async () => {
  const f = await fixture(false);
  const directory = path.join(f.directory, "journal");
  await mkdir(directory);
  const filename = path.join(directory, "operation.json");
  const manifest: FileOperationManifest = {
    version: 1,
    operationId: "operation",
    kind: "import",
    source: f.source,
    target: f.target,
    sha256: "a".repeat(64),
    previousSha256: null,
    phase: "staged",
  };
  await saveManifest(filename, manifest);
  let expired = false;
  observation.afterClose = () => {
    expired = true;
  };
  await expect(
    saveManifest(
      filename,
      { ...manifest, phase: "complete" },
      {
        beforeInstall: () => {
          if (expired) throw new Error("deadline passed during close");
        },
      },
    ),
  ).rejects.toThrow("deadline passed during close");
  expect(await readFile(filename, "utf8")).toBe(JSON.stringify(manifest));
  expect(await readFile(`${filename}.tmp`, "utf8")).toBe(
    JSON.stringify({ ...manifest, phase: "complete" }),
  );
});
