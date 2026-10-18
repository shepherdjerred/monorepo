import { expect, test } from "vitest";
import { chmod, copyFile, mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { prepareStaticSite } from "../lib/sites/build.ts";
import {
  createCiArtifactArchive,
  restoreCiArtifactArchive,
} from "../lib/ci/ci-artifact-archive.ts";
import {
  createStaticArchive,
  restoreStaticArchive,
} from "../lib/static-site-archive.ts";

async function runSiteCommand(
  script: string,
  args: string[],
  environment: Record<string, string> = {},
) {
  const directory = await mkdtemp(path.join(tmpdir(), "site-build-contract-"));
  try {
    const aws = path.join(directory, "aws");
    await Bun.write(
      aws,
      "#!/bin/sh\necho 'unexpected remote AWS call' >&2\nexit 91\n",
    );
    await chmod(aws, 0o755);
    const git = path.join(directory, "git");
    await Bun.write(
      git,
      '#!/bin/sh\nif [ "$1" = diff ]; then\n  for path in "$@"; do\n    case "$SELECTOR_CHANGED_PATH" in "$path"|"$path"/*) printf "%s\\n" "$SELECTOR_CHANGED_PATH"; break;; esac\n  done\nfi\nexit 0\n',
    );
    await chmod(git, 0o755);
    const child = Bun.spawn([process.execPath, script, ...args], {
      cwd: new URL("../..", import.meta.url).pathname,
      env: { ...environment, PATH: `${directory}:${Bun.env["PATH"] ?? ""}` },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, status] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    return { stdout, stderr, status };
  } finally {
    await rm(directory, { recursive: true });
  }
}
test.each(["ts-mc", "sjer.red", "glitter-boys"])(
  "%s publication rehearsal never invokes activation or needs credentials",
  async (site) => {
    const result = await runSiteCommand("scripts/release/deploy-site.ts", [
      site,
      "--archive",
      "--dry-run",
    ]);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("activation belongs to Delivery");
    expect(result.stdout).not.toContain("+++ sync:");
    expect(result.stdout).not.toContain("purge");
  },
);
test.each([
  "packages/glitter-boys/src/pages/index.astro",
  "packages/glitter-boys-launcher/published-release.json",
  "packages/glitter-boys-launcher/scripts/public-release.ts",
  "packages/glitter-boys-launcher/scripts/release-manifest.ts",
])("Glitter Boys archive selection includes %s", async (changed) => {
  const result = await runSiteCommand(
    "ci/scripts/selectors/ci-changed.ts",
    ["site-glitter-boys"],
    {
      CI_CHANGED_BASE: "a".repeat(40),
      CI_PIPELINE_EVENT: "push",
      SELECTOR_CHANGED_PATH: changed,
    },
  );
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toContain("1 matching change(s)");
});
test("credential-free validation selects the same reviewed source and rejects unknown targets", async () => {
  const valid = await runSiteCommand("scripts/release/check-site-build.ts", [
    "ts-mc",
  ]);
  expect(valid.status, valid.stderr).toBe(0);
  expect(valid.stdout).toContain("ts-mc-docs");
  const invalid = await runSiteCommand("scripts/release/check-site-build.ts", [
    "unknown-target",
  ]);
  expect(invalid.status).not.toBe(0);
  expect(invalid.stderr).toContain("Unknown site");
});

test.each(["site-resume", "resume", "sites"])(
  "%s selects a change to the runtime site builder",
  async (lane) => {
    const result = await runSiteCommand(
      "ci/scripts/selectors/ci-changed.ts",
      [lane],
      {
        CI_CHANGED_BASE: "a".repeat(40),
        CI_PIPELINE_EVENT: "push",
        SELECTOR_CHANGED_PATH: "scripts/lib/sites/build.ts",
      },
    );
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("1 matching change(s)");
    expect(result.stdout).toContain("scripts/lib/sites/build.ts; running");
  },
);

test("Resume's PDF handoff packages only the served entrypoints and PDF", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "resume-site-output-"));
  try {
    const producer = path.join(directory, "producer");
    const checkout = path.join(directory, "checkout");
    const source = path.join(checkout, "packages/resume");
    await mkdir(path.join(producer, "packages/resume"), { recursive: true });
    await mkdir(source, { recursive: true });
    const pdf = Buffer.from("%PDF-1.4\nopaque handoff bytes\n%%EOF\n");
    await Bun.write(path.join(producer, "packages/resume/resume.pdf"), pdf);
    for (const name of ["index.html", "404.html"])
      await copyFile(
        new URL(`../../packages/resume/${name}`, import.meta.url),
        path.join(source, name),
      );
    await Bun.write(path.join(source, "AGENTS.md"), "private source guidance");
    await Bun.write(path.join(source, "resume.tex"), "private TeX source");
    await symlink("AGENTS.md", path.join(source, "CLAUDE.md"));
    await restoreCiArtifactArchive(
      "resume-pdf",
      await createCiArtifactArchive("resume-pdf", producer),
      checkout,
    );
    const selected = await prepareStaticSite(
      ["resume", "--prebuilt", "--archive"],
      false,
      checkout,
    );
    expect(selected).toEqual({
      bucket: "resume",
      source: path.join(source, "dist"),
      root: checkout,
    });
    if (selected === null) throw new Error("Missing Resume selection");
    const archive = path.join(directory, "site.tar");
    const packed = await createStaticArchive(selected.source, archive);
    expect(packed.files).toEqual(["404.html", "index.html", "resume.pdf"]);
    const restored = path.join(directory, "restored");
    await mkdir(restored);
    expect(
      await restoreStaticArchive(archive, restored, packed.digest),
    ).toEqual(packed.files);
    expect(await Bun.file(path.join(restored, "resume.pdf")).bytes()).toEqual(
      new Uint8Array(pdf),
    );
    for (const name of ["index.html", "404.html"])
      expect(await Bun.file(path.join(restored, name)).text()).toBe(
        await Bun.file(path.join(source, name)).text(),
      );
    expect(await Bun.file(path.join(restored, "index.html")).text()).toContain(
      'src="resume.pdf"',
    );
    await symlink(
      "../AGENTS.md",
      path.join(selected.source, "unexpected-link"),
    );
    await expect(createStaticArchive(selected.source, archive)).rejects.toThrow(
      "Static archives require regular files: unexpected-link",
    );
    await rm(path.join(source, "resume.pdf"));
    await symlink("AGENTS.md", path.join(source, "resume.pdf"));
    await expect(
      prepareStaticSite(["resume", "--prebuilt"], false, checkout),
    ).rejects.toThrow("Resume site requires a regular file: resume.pdf");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
