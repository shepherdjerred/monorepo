import { afterEach, expect, test } from "vitest";
import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readlink,
  rm,
  stat,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";
import { parse } from "yaml";
import { git } from "#src/checkout/git.ts";
import { checkoutSource } from "#src/checkout/snapshot.ts";
import {
  cacheSourceSteps,
  SOURCE_CACHE_PREPARATION_IMAGE,
} from "#src/pipeline/source-cache.ts";
import { emitWorkflow } from "#src/pipeline/emit.ts";
import { TEST_IDENTITY, testPipelineSteps } from "./identity.ts";
const { join } = path;

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true })),
  );
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "ci-source-cache-test-"));
  roots.push(root);
  const repository = join(root, "origin");
  await mkdir(repository);
  await git(repository, ["init", "--quiet"]);
  await Bun.write(join(repository, "run.sh"), "#!/bin/sh\necho checked\n");
  await chmod(join(repository, "run.sh"), 0o755);
  await symlink("run.sh", join(repository, "link"));
  await git(repository, ["add", "run.sh", "link"]);
  await git(repository, [
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "commit",
    "-qm",
    "fixture",
  ]);
  const commit = await git(repository, ["rev-parse", "HEAD"]);
  return { root, repository, commit, cache: join(root, "cache") };
}

test("cold and warm checkouts retain full trees, Git history, symlinks and modes", async () => {
  const input = await fixture();
  const outputs = [];
  for (const name of ["cold", "warm"]) {
    const workspace = join(input.root, name);
    await mkdir(workspace);
    outputs.push(await checkoutSource({ ...input, workspace }));
    expect(await git(workspace, ["rev-parse", "HEAD"])).toBe(input.commit);
    expect(await git(workspace, ["remote", "get-url", "origin"])).toBe(
      input.repository,
    );
    expect(await readlink(join(workspace, "link"))).toBe("run.sh");
    const scriptInfo = await stat(join(workspace, "run.sh"));
    expect(scriptInfo.mode & 0o111).toBe(0o111);
    expect(await git(workspace, ["status", "--porcelain"])).toBe("");
    await git(workspace, ["fetch", "--deepen=10", "origin"]);
  }
  expect(outputs.map((output) => output.cache)).toEqual(["miss", "hit"]);
  expect(outputs[0]?.downloadedObjectBytes).toBeGreaterThan(0);
  expect(outputs[1]?.downloadedObjectBytes).toBe(0);
  const object = join(
    ".git/objects",
    input.commit.slice(0, 2),
    input.commit.slice(2),
  );
  const coldObject = await stat(join(input.root, "cold", object));
  const warmObject = await stat(join(input.root, "warm", object));
  expect(coldObject.ino).not.toBe(warmObject.ino);
});

test("cache identity corruption fails visibly instead of silently fetching again", async () => {
  const input = await fixture();
  const cold = join(input.root, "cold");
  await mkdir(cold);
  await checkoutSource({ ...input, workspace: cold });
  const [repo] = await readdir(join(input.cache, "v1"));
  if (repo === undefined) throw new Error("Expected cache repository");
  const snapshot = join(input.cache, "v1", repo, input.commit);
  const contents = await readdir(snapshot);
  expect(contents.toSorted()).toEqual(["manifest.json", "objects", "shallow"]);
  const manifest = await Bun.file(join(snapshot, "manifest.json")).json();
  await Bun.write(
    join(snapshot, "manifest.json"),
    JSON.stringify({ ...manifest, tree: "f".repeat(40) }),
  );
  const warm = join(input.root, "warm");
  await mkdir(warm);
  await expect(checkoutSource({ ...input, workspace: warm })).rejects.toThrow(
    "tree mismatch",
  );
});

test("unapproved work and local jobs cannot mount caches; trusted jobs mount only in clone", () => {
  const steps = testPipelineSteps();
  const image = `ghcr.io/shepherdjerred/woodpecker-config-extension@sha256:${"a".repeat(64)}`;
  expect(
    cacheSourceSteps(steps, {
      enabled: true,
      credentialless: true,
      main: false,
      image,
    }),
  ).toEqual(steps);
  expect(
    cacheSourceSteps(steps, {
      enabled: false,
      credentialless: false,
      main: false,
      image,
    }),
  ).toEqual(steps);
  for (const main of [true, false]) {
    const cached = cacheSourceSteps(steps, {
      enabled: true,
      credentialless: false,
      main,
      image,
    });
    const verify = cached.find((step) => step.key === "verify");
    if (verify === undefined) throw new Error("Missing verify fixture");
    const config = z
      .object({
        clone: z.array(
          z.object({
            name: z.string(),
            image: z.string(),
            volumes: z.array(z.string()).optional(),
            commands: z.array(z.string()),
            backend_options: z.object({
              kubernetes: z.object({
                securityContext: z.record(z.string(), z.unknown()),
              }),
            }),
          }),
        ),
        steps: z.array(z.object({ volumes: z.array(z.string()).optional() })),
      })
      .parse(parse(emitWorkflow(verify, TEST_IDENTITY)));
    const prepare = config.clone[0];
    const clone = config.clone[1];
    const finalize = config.clone[2];
    if (finalize === undefined) throw new Error("Missing clone finalizer");
    expect(config.clone).toHaveLength(3);
    expect(prepare?.name).toBe("prepare-clone");
    expect(prepare?.image).toBe(SOURCE_CACHE_PREPARATION_IMAGE);
    expect(prepare?.image).toMatch(/^busybox:.*@sha256:[a-f\d]{64}$/u);
    expect(prepare?.commands).toEqual([
      "chown 1000:1000 . /woodpecker/source-cache /woodpecker/source-control",
    ]);
    expect(prepare?.backend_options.kubernetes.securityContext).toEqual({
      allowPrivilegeEscalation: false,
    });
    expect(clone?.name).toBe("clone");
    expect(clone?.image).toBe(image);
    expect(clone?.backend_options.kubernetes.securityContext).toEqual({
      runAsUser: 1000,
      runAsGroup: 1000,
      runAsNonRoot: true,
      fsGroup: 1000,
      fsGroupChangePolicy: "OnRootMismatch",
      allowPrivilegeEscalation: false,
    });
    expect(clone?.volumes).toContain(
      `woodpecker-source-${main ? "main" : "pr"}:/woodpecker/source-cache`,
    );
    expect(prepare?.volumes).toEqual(clone?.volumes);
    expect(finalize.name).toBe("finalize-clone");
    expect(finalize.image).toBe(SOURCE_CACHE_PREPARATION_IMAGE);
    expect(finalize.volumes).toBeUndefined();
    expect(finalize.commands).toEqual([
      "test -d .git",
      "test ! -L .git",
      "chown 0:0 . .git",
    ]);
    expect(finalize.backend_options.kubernetes.securityContext).toEqual({
      runAsUser: 0,
      runAsGroup: 0,
      allowPrivilegeEscalation: false,
    });
    expect(clone?.commands.join("\n")).toContain("flock -s");
    expect(
      config.steps
        .flatMap((step) => step.volumes ?? [])
        .some((volume) => volume.includes("source-")),
    ).toBe(false);
  }
});
