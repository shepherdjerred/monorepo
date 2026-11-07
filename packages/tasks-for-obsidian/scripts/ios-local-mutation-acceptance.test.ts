import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { z } from "zod";
import { seedIosLocalMutationVault } from "./ios-local-mutation-acceptance.ts";
import { verifyVault } from "./ios-native-e2e.ts";

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
