import {
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { z } from "zod";
import { seedIosLocalMutationVault } from "./ios-local-mutation-acceptance.ts";
import { verifyVault } from "./ios-native-e2e.ts";
import {
  initializeMutationOwner,
  mutationOwnerMarker,
  requireMutationOwner,
} from "./native-acceptance/local-mutation-owner.ts";

test("completed mutation seed retains required canonical dates and passes the original vault gate", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "facet-mutation-seed-"));
  const vault = path.join(directory, "vault");
  try {
    await seedIosLocalMutationVault(vault);
    const note = await Bun.file(path.join(vault, "Tasks/Mutation.md")).text();
    const frontmatter = /^---\n([\s\S]*?)\n---(?:\n|$)/u.exec(note)?.[1];
    expect(frontmatter).toBeDefined();
    const metadata = z
      .object({
        title: z.literal("E2E edited task"),
        status: z.literal("done"),
        dateCreated: z.iso.datetime(),
        dateModified: z.iso.datetime(),
        completedDate: z.iso.date(),
        priority: z.literal("normal"),
        contexts: z.array(z.string()),
        projects: z.array(z.string()),
        tags: z.array(z.string()).refine((tags) => tags.includes("task")),
      })
      .parse(Bun.YAML.parse(z.string().parse(frontmatter)));
    expect(Date.parse(metadata.dateModified)).toBeGreaterThanOrEqual(
      Date.parse(metadata.dateCreated),
    );
    expect(note).toContain("Synthetic mutation acceptance body.\n");
    await expect(verifyVault(vault)).resolves.toBeUndefined();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("mutation ownership is exclusive, preserves collisions and rejects changed run markers", async () => {
  const directory = await realpath(
    await mkdtemp(path.join(tmpdir(), "facet-mutation-owner-")),
  );
  const vault = path.join(directory, "vault");
  const owner = crypto.randomUUID();
  try {
    await seedIosLocalMutationVault(vault);
    await initializeMutationOwner(vault, owner);
    await expect(requireMutationOwner(vault, owner)).resolves.toBeUndefined();
    await expect(
      initializeMutationOwner(vault, crypto.randomUUID()),
    ).rejects.toThrow();
    expect(await readFile(path.join(vault, mutationOwnerMarker), "utf8")).toBe(
      owner + "\n",
    );
    await expect(
      requireMutationOwner(vault, crypto.randomUUID()),
    ).rejects.toThrow();
    await writeFile(path.join(vault, mutationOwnerMarker), owner + "\ncorrupt");
    await expect(requireMutationOwner(vault, owner)).rejects.toThrow();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("mutation ownership rejects linked vaults and marker files", async () => {
  const directory = await realpath(
    await mkdtemp(path.join(tmpdir(), "facet-mutation-links-")),
  );
  const vault = path.join(directory, "vault");
  const owner = crypto.randomUUID();
  try {
    await seedIosLocalMutationVault(vault);
    const link = path.join(directory, "linked-vault");
    await symlink(vault, link);
    await expect(initializeMutationOwner(link, owner)).rejects.toThrow();
    await initializeMutationOwner(vault, owner);
    await expect(requireMutationOwner(link, owner)).rejects.toThrow();
    const marker = path.join(vault, mutationOwnerMarker);
    const detached = path.join(directory, "detached-owner");
    await writeFile(detached, owner + "\n");
    await rm(marker);
    await symlink(detached, marker);
    await expect(requireMutationOwner(vault, owner)).rejects.toThrow();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
