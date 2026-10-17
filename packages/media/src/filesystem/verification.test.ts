import { afterEach, expect, it, vi } from "vitest";
import {
  mkdtemp,
  mkdir,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { FileOperations } from "./operations.ts";

const temporaryRoots: string[] = [];
const approved = async () => {
  /* Test supplies an explicit authoritative decision. */
};
afterEach(async () => {
  for (const root of temporaryRoots.splice(0))
    await rm(root, { recursive: true, force: true });
});

async function fixture() {
  const root = await mkdtemp(
    path.join(await realpath(tmpdir()), "media-verification-"),
  );
  temporaryRoots.push(root);
  const roots = {
    downloads: path.join(root, "downloads"),
    library: path.join(root, "library"),
    control: path.join(root, "control"),
  };
  await Promise.all(
    Object.values(roots).map(async (directory) => await mkdir(directory)),
  );
  const content = "committed media";
  const target = path.join(roots.library, "movie.mkv");
  await writeFile(target, content);
  const input = {
    libraryPath: "movie.mkv",
    sha256: createHash("sha256").update(content).digest("hex"),
    sizeBytes: String(Buffer.byteLength(content)),
  };
  return { roots, target, input, content };
}

it("hashes before the callback and retains the canonical mutation lock until it finishes", async () => {
  const { roots, input } = await fixture();
  const authorize = vi.fn(approved);
  const checkpoints: string[] = [];
  const operations = new FileOperations(roots, {
    authorize,
    checkpoint: async (phase) => {
      checkpoints.push(phase);
    },
  });
  const move = {
    ...input,
    operationId: "quarantine-proof",
    quarantineId: "asset-proof",
  };
  await expect(
    operations.withVerifiedFile(input, async () => {
      expect(checkpoints).toContain("hashing");
      await expect(
        new FileOperations(roots, { authorize }).quarantine(move),
      ).rejects.toMatchObject({ kind: "busy" });
      return "validated";
    }),
  ).resolves.toBe("validated");
  expect(authorize).not.toHaveBeenCalled();
  await expect(operations.quarantine(move)).resolves.toMatchObject({
    phase: "complete",
  });
});

it.each(["size", "checksum", "symlink", "cancel"])(
  "never invokes authority after invalid %s verification",
  async (reason) => {
    const { roots, input, target } = await fixture();
    if (reason === "size") input.sizeBytes = "1";
    if (reason === "checksum") input.sha256 = "0".repeat(64);
    if (reason === "symlink") {
      await rename(target, `${target}.original`);
      await symlink(`${target}.original`, target);
    }
    const action = vi.fn(approved);
    const operations = new FileOperations(roots, {
      authorize: approved,
      checkpoint: async () => {
        if (reason === "cancel") throw new Error("cancelled");
      },
    });
    await expect(operations.withVerifiedFile(input, action)).rejects.toThrow();
    expect(action).not.toHaveBeenCalled();
  },
);

it.each(["replace", "rewrite"])(
  "rejects a same-content %s during hashing by file identity",
  async (mutation) => {
    const { roots, input, target, content } = await fixture();
    let checkpoints = 0;
    const action = vi.fn(approved);
    const operations = new FileOperations(roots, {
      authorize: approved,
      checkpoint: async () => {
        if (++checkpoints !== 2) return;
        if (mutation === "replace") {
          await writeFile(`${target}.replacement`, content);
          await rename(`${target}.replacement`, target);
        } else await writeFile(target, content);
      },
    });
    await expect(operations.withVerifiedFile(input, action)).rejects.toThrow(
      "identity changed",
    );
    expect(action).not.toHaveBeenCalled();
  },
);

it("releases the file lock after a rejected short authority check", async () => {
  const { roots, input } = await fixture();
  const operations = new FileOperations(roots, {
    authorize: approved,
  });
  await expect(
    operations.withVerifiedFile(input, async () => {
      throw new Error("generation changed");
    }),
  ).rejects.toThrow("generation changed");
  await expect(
    operations.withVerifiedFile(input, async () => "fresh"),
  ).resolves.toBe("fresh");
});

it("releases the hash lock and reacquires it for a short identity-only authority check", async () => {
  const { roots, input } = await fixture();
  let hashes = 0;
  const operations = new FileOperations(roots, {
    authorize: approved,
    checkpoint: async () => {
      hashes += 1;
    },
  });
  const proof = await operations.withVerifiedFile(
    input,
    async (verified) => verified,
  );
  expect(Object.isFrozen(proof)).toBe(true);
  expect(hashes).toBeGreaterThan(0);
  const hashesBefore = hashes;
  await expect(
    operations.withFileIdentity(proof, async () => {
      await expect(
        operations.withFileIdentity(proof, async () => "overlap"),
      ).rejects.toMatchObject({ kind: "busy" });
      return "authority accepted";
    }),
  ).resolves.toBe("authority accepted");
  expect(hashes).toBe(hashesBefore);
  await expect(
    operations.withFileIdentity(proof, async () => {
      throw new Error("revoked");
    }),
  ).rejects.toThrow("revoked");
  await expect(
    operations.withFileIdentity(proof, async () => "released"),
  ).resolves.toBe("released");
});

it.each(["replace", "rewrite"])(
  "rejects %s after releasing the hash lock",
  async (mutation) => {
    const { roots, input, target, content } = await fixture();
    const operations = new FileOperations(roots, {
      authorize: approved,
    });
    const proof = await operations.withVerifiedFile(
      input,
      async (verified) => verified,
    );
    if (mutation === "replace") {
      await writeFile(`${target}.replacement`, content);
      await rename(`${target}.replacement`, target);
    } else await writeFile(target, content);
    const action = vi.fn(approved);
    await expect(operations.withFileIdentity(proof, action)).rejects.toThrow(
      "identity changed",
    );
    expect(action).not.toHaveBeenCalled();
  },
);
