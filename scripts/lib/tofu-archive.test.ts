import { afterEach, describe, expect, test } from "vitest";
import { mkdir, mkdtemp, rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { TOFU_STACK_ROOT } from "../../packages/homelab/scripts/tofu/tofu-external-files.ts";
import { restoreStaticArchive } from "./static-site-archive.ts";
import {
  createTofuStackArchive,
  TOFU_ARCHIVE_LAYOUT,
  tofuStackArchiveFiles,
} from "./tofu-archive.ts";
import {
  tofuArchiveArtifactId,
  tofuArchiveComponent,
  tofuArchiveServiceId,
  tofuArchiveUri,
  validateTofuArchiveUri,
} from "./tofu-archive-identity.ts";

const repository = path.resolve(import.meta.dir, "../..");
const digest = `sha256:${"a".repeat(64)}`;
const scratch: string[] = [];
afterEach(async () => {
  await Promise.all(
    scratch.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

/**
 * The file the fixture stack reads outside its directory. Every live stack is
 * synthesized with its registries inline and declares none, so the fixture
 * passes its own declaration.
 */
const DECLARED = ["packages/homelab/src/domain-registry.json"];

/** A throwaway repository holding one stack with every kind of member and local clutter. */
async function fixture(options: { declaredRead?: boolean } = {}) {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "tofu-archive-"));
  scratch.push(repoRoot);
  const stack = path.join(repoRoot, TOFU_STACK_ROOT, "cloudflare");
  const files: Record<string, string> = {
    "backend.tf":
      'terraform {\n  backend "s3" {\n    use_lockfile = true\n  }\n}\n',
    "main.tf":
      options.declaredRead === false
        ? 'locals {\n  x = jsondecode(file("${path.module}/../../undeclared.json"))\n}\n'
        : 'locals {\n  registry = jsondecode(file("${path.module}/../../domain-registry.json"))\n}\n',
    ".terraform.lock.hcl": 'provider "x" {}\n',
    "modules/static-cache/main.tf": 'variable "zone" {}\n',
    "desired-state.json": "{}\n",
    "tests/domain.tftest.hcl": "run {}\n",
    ".terraform/providers/x/binary": "binary\n",
    "terraform.tfstate": "{}\n",
    "terraform.tfstate.backup": "{}\n",
    "plan.tfplan": "plan\n",
    "plan.tfplan.enc": "plan\n",
  };
  for (const [name, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(stack, name)), { recursive: true });
    await Bun.write(path.join(stack, name), content);
  }
  await Bun.write(
    path.join(repoRoot, "packages/homelab/src/domain-registry.json"),
    '{"zones":[]}\n',
  );
  await Bun.write(
    path.join(repoRoot, "packages/homelab/src/undeclared.json"),
    "{}\n",
  );
  await Bun.write(path.join(repoRoot, TOFU_ARCHIVE_LAYOUT), "2\n");
  return { repoRoot, stack };
}

describe("OpenTofu stack archives", () => {
  test("hold the stack source, lock file, local modules and declared inputs under repository paths", async () => {
    const { repoRoot } = await fixture();
    expect(
      await tofuStackArchiveFiles("cloudflare", repoRoot, DECLARED),
    ).toEqual([
      "packages/homelab/src/domain-registry.json",
      TOFU_ARCHIVE_LAYOUT,
      `${TOFU_STACK_ROOT}/cloudflare/.terraform.lock.hcl`,
      `${TOFU_STACK_ROOT}/cloudflare/backend.tf`,
      `${TOFU_STACK_ROOT}/cloudflare/main.tf`,
      `${TOFU_STACK_ROOT}/cloudflare/modules/static-cache/main.tf`,
    ]);
  });

  test("the same source bytes give the same digest regardless of timestamps, and any input change gives another", async () => {
    const { repoRoot, stack } = await fixture();
    const first = await createTofuStackArchive(
      "cloudflare",
      repoRoot,
      path.join(repoRoot, "first.tar"),
      DECLARED,
    );
    const past = new Date("2001-01-01T00:00:00Z");
    for (const file of first.files)
      await utimes(path.join(repoRoot, file), past, past);
    const second = await createTofuStackArchive(
      "cloudflare",
      repoRoot,
      path.join(repoRoot, "second.tar"),
      DECLARED,
    );
    expect(second.digest).toBe(first.digest);
    expect(second.files).toEqual(first.files);
    const restored = path.join(repoRoot, "restored");
    await mkdir(restored);
    expect(
      await restoreStaticArchive(
        path.join(repoRoot, "second.tar"),
        restored,
        first.digest,
      ),
    ).toEqual(first.files);
    expect(
      await Bun.file(
        path.join(restored, "packages/homelab/src/domain-registry.json"),
      ).text(),
    ).toBe('{"zones":[]}\n');
    await Bun.write(
      path.join(repoRoot, "packages/homelab/src/domain-registry.json"),
      '{"zones":["sjer.red"]}\n',
    );
    const changedInput = await createTofuStackArchive(
      "cloudflare",
      repoRoot,
      path.join(repoRoot, "third.tar"),
      DECLARED,
    );
    expect(changedInput.digest).not.toBe(first.digest);
    await Bun.write(path.join(stack, "desired-state.json"), '{"ignored":1}\n');
    const changedExcluded = await createTofuStackArchive(
      "cloudflare",
      repoRoot,
      path.join(repoRoot, "fourth.tar"),
      DECLARED,
    );
    expect(changedExcluded.digest).toBe(changedInput.digest);
  });

  test("an undeclared read outside the stack is rejected rather than archived incomplete", async () => {
    const { repoRoot } = await fixture({ declaredRead: false });
    await expect(
      createTofuStackArchive(
        "cloudflare",
        repoRoot,
        path.join(repoRoot, "rejected.tar"),
      ),
    ).rejects.toThrow(/undeclared external files[\s\S]*undeclared\.json/u);
    expect(await Bun.file(path.join(repoRoot, "rejected.tar")).exists()).toBe(
      false,
    );
  });

  test("the live cloudflare and anthropic stacks archive their reviewed source only", async () => {
    // The synthesized cloudflare stack carries the domain registry and the
    // platform model inline: no module, no test and no external file.
    expect(await tofuStackArchiveFiles("cloudflare", repository)).toEqual([
      TOFU_ARCHIVE_LAYOUT,
      `${TOFU_STACK_ROOT}/cloudflare/.terraform.lock.hcl`,
      `${TOFU_STACK_ROOT}/cloudflare/dns-audit-2026-02-04.md`,
      `${TOFU_STACK_ROOT}/cloudflare/main.tf.json`,
    ]);
    const anthropic = await tofuStackArchiveFiles("anthropic", repository);
    expect(anthropic).not.toContain(
      `${TOFU_STACK_ROOT}/anthropic/desired-state.json`,
    );
    expect(anthropic).toContain(`${TOFU_STACK_ROOT}/anthropic/main.tf.json`);
  });

  test("a stack synthesized by cdktn archives its committed JSON and lock file", async () => {
    const github = await tofuStackArchiveFiles("github", repository);
    expect(github).toEqual([
      TOFU_ARCHIVE_LAYOUT,
      `${TOFU_STACK_ROOT}/github/.terraform.lock.hcl`,
      `${TOFU_STACK_ROOT}/github/main.tf.json`,
    ]);
  });

  test("a stack directory without configuration is not archived", async () => {
    const { repoRoot, stack } = await fixture();
    await rm(path.join(stack, "backend.tf"));
    await rm(path.join(stack, "main.tf"));
    await rm(path.join(stack, "modules"), { recursive: true });
    await expect(
      tofuStackArchiveFiles("cloudflare", repoRoot, DECLARED),
    ).rejects.toThrow("has no configuration to archive");
    // Synthesized JSON counts as configuration: the stack now gets as far as
    // the external-file check, which no longer finds the declared read.
    await Bun.write(path.join(stack, "main.tf.json"), "{}\n");
    await expect(
      tofuStackArchiveFiles("cloudflare", repoRoot, DECLARED),
    ).rejects.toThrow("declares external files it does not read");
  });

  test("archive identities are content-addressed per stack", () => {
    expect(tofuArchiveServiceId("github")).toBe("tofu-github");
    expect(tofuArchiveComponent("github")).toBe("archive:tofu-github");
    expect(tofuArchiveArtifactId(1, 42, "github")).toBe("ci/1/42/tofu/github");
    expect(tofuArchiveUri("github", digest)).toBe(
      `s3://delivery-artifacts/tofu/github/${"a".repeat(64)}.tar`,
    );
    expect(() => tofuArchiveUri("github", "latest")).toThrow("digest");
    expect(() =>
      validateTofuArchiveUri(
        `s3://delivery-artifacts/tofu/github/${"b".repeat(64)}.tar`,
        "github",
        digest,
      ),
    ).toThrow("does not match");
    expect(() =>
      validateTofuArchiveUri(tofuArchiveUri("arr", digest), "github", digest),
    ).toThrow("does not match");
  });
});
