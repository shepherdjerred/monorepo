import { afterEach, describe, expect, test } from "vitest";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { STACK_MANIFEST } from "./tofu-stack-manifest.ts";
import {
  TOFU_STACK_ROOT,
  fileReferences,
  stackFileReferences,
  verifyStackExternalFiles,
  verifyTofuExternalFiles,
} from "./tofu-external-files.ts";

const repository = path.resolve(import.meta.dir, "../../../..");
const scratch: string[] = [];
afterEach(async () => {
  await Promise.all(
    scratch.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

/** A throwaway repository with one stack that reads a shared file and a module template. */
async function fixture(main: string, options: { shared?: boolean } = {}) {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "tofu-external-files-"));
  scratch.push(repoRoot);
  const stackDirectory = path.join(repoRoot, TOFU_STACK_ROOT, "cloudflare");
  await mkdir(path.join(stackDirectory, "modules/static-cache"), {
    recursive: true,
  });
  await mkdir(path.join(stackDirectory, "tests"), { recursive: true });
  await Bun.write(path.join(stackDirectory, "main.tf"), main);
  await Bun.write(path.join(stackDirectory, "local.json"), "{}\n");
  await Bun.write(
    path.join(stackDirectory, "modules/static-cache/main.tf"),
    'locals {\n  template = templatefile("${path.module}/rule.tftpl", {})\n}\n',
  );
  await Bun.write(
    path.join(stackDirectory, "modules/static-cache/rule.tftpl"),
    "rule\n",
  );
  await Bun.write(
    path.join(stackDirectory, "tests/ignored.tf"),
    'locals {\n  ignored = file("${path.module}/../../../../../../nowhere.json")\n}\n',
  );
  if (options.shared !== false)
    await Bun.write(
      path.join(repoRoot, "packages/homelab/src/domain-registry.json"),
      "{}\n",
    );
  return { repoRoot, stackDirectory };
}
const readsRegistry =
  'locals {\n  registry = jsondecode(file("${path.module}/../../domain-registry.json"))\n  local    = jsondecode(file("local.json"))\n}\n';

describe("stack external file declarations", () => {
  test("the live manifest declares exactly the files every stack reads outside its directory", async () => {
    await expect(verifyTofuExternalFiles(repository)).resolves.toBeUndefined();
    const cloudflare = await stackFileReferences({
      repoRoot: repository,
      stackDirectory: path.join(repository, TOFU_STACK_ROOT, "cloudflare"),
    });
    expect(cloudflare.map((reference) => reference.target)).toContain(
      "packages/homelab/src/domain-registry.json",
    );
    expect(STACK_MANIFEST.posthog.externalFiles).toEqual([
      "config/analytics-sites.json",
    ]);
    expect(STACK_MANIFEST.dockerhub.externalFiles).toEqual([
      "packages/version-catalog/src/image-registry.json",
    ]);
  });

  test("resolves module-relative, root-relative and bare paths against the right directory", async () => {
    const { repoRoot, stackDirectory } = await fixture(readsRegistry);
    const references = await verifyStackExternalFiles({
      repoRoot,
      stackDirectory,
      declared: ["packages/homelab/src/domain-registry.json"],
    });
    expect(references.map((reference) => reference.target).sort()).toEqual([
      "packages/homelab/src/domain-registry.json",
      `${TOFU_STACK_ROOT}/cloudflare/local.json`,
      `${TOFU_STACK_ROOT}/cloudflare/modules/static-cache/rule.tftpl`,
    ]);
  });

  test("an undeclared escaping reference fails loudly", async () => {
    const { repoRoot, stackDirectory } = await fixture(readsRegistry);
    await expect(
      verifyStackExternalFiles({ repoRoot, stackDirectory, declared: [] }),
    ).rejects.toThrow(/undeclared external files[\s\S]*domain-registry\.json/u);
  });

  test("a declared file must exist and must actually be read", async () => {
    const missing = await fixture(readsRegistry, { shared: false });
    await expect(
      verifyStackExternalFiles({
        ...missing,
        declared: ["packages/homelab/src/domain-registry.json"],
      }),
    ).rejects.toThrow("not a regular file");
    const unread = await fixture('locals {\n  local = file("local.json")\n}\n');
    await expect(
      verifyStackExternalFiles({
        ...unread,
        declared: ["packages/homelab/src/domain-registry.json"],
      }),
    ).rejects.toThrow("does not read");
  });

  test("references that cannot be resolved statically are rejected rather than skipped", () => {
    const input = {
      repoRoot: "/repo",
      stackDirectory: `/repo/${TOFU_STACK_ROOT}/cloudflare`,
      file: `/repo/${TOFU_STACK_ROOT}/cloudflare/main.tf`,
    };
    expect(() =>
      fileReferences({ ...input, content: "x = file(var.registry)" }),
    ).toThrow("without a literal path");
    expect(() =>
      fileReferences({
        ...input,
        content: 'x = file("${path.module}/${var.name}")',
      }),
    ).toThrow("not a literal path");
    expect(() =>
      fileReferences({ ...input, content: 'x = file("${var.dir}/a.json")' }),
    ).toThrow("not a literal path");
    expect(() =>
      fileReferences({ ...input, content: 'x = file("${path.cwd}/a.json")' }),
    ).toThrow("path.cwd");
    expect(() =>
      fileReferences({
        ...input,
        content: 'x = file("${path.module}/../../../../../../../etc/passwd")',
      }),
    ).toThrow("outside the repository");
    expect(
      fileReferences({
        ...input,
        content:
          '# x = file("${path.module}/../commented.json")\ny = filemd5("${path.root}/public/index.html")',
      }),
    ).toEqual([
      {
        source: `${TOFU_STACK_ROOT}/cloudflare/main.tf`,
        expression: "${path.root}/public/index.html",
        target: `${TOFU_STACK_ROOT}/cloudflare/public/index.html`,
      },
    ]);
  });
});
