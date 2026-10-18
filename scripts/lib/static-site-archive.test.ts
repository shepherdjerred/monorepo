import { afterEach, describe, expect, test } from "vitest";
import { chmod, mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";
import { packTar } from "modern-tar";
import type { TarEntry } from "modern-tar";
import {
  createStaticArchive,
  restoreStaticArchive,
  staticArchiveDigest,
} from "./static-site-archive.ts";
import {
  staticArchiveUri,
  validateStaticArchiveUri,
} from "./static-site-publication.ts";
import {
  staticSiteWriter,
  assertStaticSiteDeliveryOwner,
} from "../../packages/homelab/src/static-site-delivery-ownership.ts";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true })),
  );
});
async function scratch() {
  const directory = await mkdtemp(path.join(tmpdir(), "static-archive-test-"));
  directories.push(directory);
  return directory;
}
async function malicious(entries: TarEntry[]) {
  const root = await scratch();
  const archive = path.join(root, "archive.tar");
  await Bun.write(archive, await packTar(entries));
  const target = path.join(root, "target");
  await mkdir(target);
  return { archive, target, digest: await staticArchiveDigest(archive) };
}

describe("immutable static archives", () => {
  test("round trips binary and root files without depending on source timestamps", async () => {
    const root = await scratch();
    const source = path.join(root, "source");
    const target = path.join(root, "target");
    await mkdir(path.join(source, "assets"), { recursive: true });
    await mkdir(target);
    await Bun.write(path.join(source, "index.html"), "<h1>Release</h1>");
    await Bun.write(
      path.join(source, "assets", "font.woff"),
      new Uint8Array([0, 255, 12, 1]),
    );
    const archive = path.join(root, "site.tar");
    const first = await createStaticArchive(source, archive);
    const second = await createStaticArchive(
      source,
      path.join(root, "second.tar"),
    );
    expect(first.digest).toBe(second.digest);
    expect(await restoreStaticArchive(archive, target, first.digest)).toEqual([
      "assets/font.woff",
      "index.html",
    ]);
    expect(
      await Bun.file(path.join(target, "assets", "font.woff")).bytes(),
    ).toEqual(new Uint8Array([0, 255, 12, 1]));
    await expect(
      restoreStaticArchive(archive, target, first.digest),
    ).rejects.toThrow("must be empty");
  });
  test("rejects altered bytes before writing any extracted file", async () => {
    const input = await malicious([
      { header: { name: "index.html", type: "file", size: 2 }, body: "ok" },
    ]);
    await expect(
      restoreStaticArchive(
        input.archive,
        input.target,
        `sha256:${"0".repeat(64)}`,
      ),
    ).rejects.toThrow("checksum");
    expect(
      await Array.fromAsync(new Bun.Glob("**/*").scan(input.target)),
    ).toEqual([]);
  });
  test.each([
    "../escape",
    "/absolute",
    "a/../../escape",
    String.raw`a\escape`,
    "C:/escape",
  ])("rejects traversal path %s", async (name) => {
    const input = await malicious([
      { header: { name, type: "file", size: 2 }, body: "ok" },
    ]);
    await expect(
      restoreStaticArchive(input.archive, input.target, input.digest),
    ).rejects.toThrow("Unsafe static archive path");
  });
  test("rejects archive links and repeated names", async () => {
    const link = await malicious([
      {
        header: {
          name: "index.html",
          type: "symlink",
          linkname: "../other",
          size: 0,
        },
      },
    ]);
    await expect(
      restoreStaticArchive(link.archive, link.target, link.digest),
    ).rejects.toThrow("nonregular");
    const duplicate = await malicious(
      [1, 2].map(() => ({
        header: { name: "index.html", type: "file", size: 2 },
        body: "ok",
      })),
    );
    await expect(
      restoreStaticArchive(
        duplicate.archive,
        duplicate.target,
        duplicate.digest,
      ),
    ).rejects.toThrow("duplicate");
  });
  test("rejects symlinks in build output instead of archiving their targets", async () => {
    const root = await scratch();
    const source = path.join(root, "source");
    await mkdir(source);
    await Bun.write(path.join(root, "outside"), "private");
    await symlink(path.join(root, "outside"), path.join(source, "index.html"));
    await expect(
      createStaticArchive(source, path.join(root, "site.tar")),
    ).rejects.toThrow("regular files");
  });
  test("only accepts content-addressed URIs in the durable artifact bucket", () => {
    const digest = `sha256:${"a".repeat(64)}`;
    const uri = staticArchiveUri("wiki-sjer-red", digest);
    expect(() => validateStaticArchiveUri(uri, digest)).not.toThrow();
    expect(() =>
      validateStaticArchiveUri(uri, `sha256:${"b".repeat(64)}`),
    ).toThrow("immutable digest");
    expect(() =>
      validateStaticArchiveUri(
        uri.replace("delivery-artifacts", "ci-handoff"),
        digest,
      ),
    ).toThrow();
  });
});

describe("one static-site writer", () => {
  test("publication alone retains the legacy writer", () => {
    expect(staticSiteWriter("wiki-sjer-red", true, {})).toBe("legacy");
  });
  test("a delegated bucket never falls back when publication is disabled or unavailable", () => {
    const owners = { "wiki-sjer-red": "wiki/prod" };
    expect(staticSiteWriter("wiki-sjer-red", true, owners)).toBe("delivery");
    expect(() => staticSiteWriter("wiki-sjer-red", false, owners)).toThrow(
      "publication is required",
    );
    expect(() =>
      assertStaticSiteDeliveryOwner("wiki-sjer-red", "other/prod", owners),
    ).toThrow("not delegated");
    expect(() =>
      assertStaticSiteDeliveryOwner("unowned", "wiki/prod", owners),
    ).toThrow("not delegated");
  });
});

test.each([true, false])(
  "archive publication requires its dedicated credential (present=%s)",
  async (present) => {
    const root = await scratch();
    const source = path.join(root, "site");
    const bin = path.join(root, "bin");
    await mkdir(source);
    await mkdir(bin);
    await Bun.write(path.join(source, "index.html"), "archive fixture");
    const executable = path.join(bin, "aws");
    await Bun.write(
      executable,
      String.raw`#!${process.execPath}
import { appendFile, copyFile } from 'node:fs/promises';
const args = process.argv.slice(2);
await appendFile(process.env.FIXTURE_CALLS, JSON.stringify({
  args,
  access: process.env.AWS_ACCESS_KEY_ID,
  secret: process.env.AWS_SECRET_ACCESS_KEY,
  vault: process.env.OP_SERVICE_ACCOUNT_TOKEN ?? null,
  session: process.env.AWS_SESSION_TOKEN ?? null,
}) + '\n');
if (args[1] === 'put-object') {
  await copyFile(args[args.indexOf('--body') + 1], process.env.FIXTURE_OBJECT);
  process.exitCode = 75; // Lost upload response: exact readback still proves creation.
}
else if (args[0] === 's3') await copyFile(process.env.FIXTURE_OBJECT, args[3]);
`,
    );
    await chmod(executable, 0o755);
    const env = {
      ...Bun.env,
      PATH: `${bin}:${Bun.env["PATH"] ?? ""}`,
      FIXTURE_CALLS: path.join(root, "calls.jsonl"),
      FIXTURE_OBJECT: path.join(root, "object.tar"),
      FIXTURE_PUBLICATION: JSON.stringify({
        bucket: "wiki-sjer-red",
        source,
        metadataDirectory: path.join(root, "metadata"),
      }),
      CI_REPO_ID: "1",
      CI_PIPELINE_NUMBER: "123",
      AWS_ACCESS_KEY_ID: "legacy-site-access",
      AWS_SECRET_ACCESS_KEY: "legacy-site-secret",
      OP_SERVICE_ACCOUNT_TOKEN: "parent-vault-only",
      AWS_SESSION_TOKEN: "parent-session-only",
      DELIVERY_ARCHIVE_PUBLISHER_ACCESS_KEY_ID: present
        ? "publisher-access"
        : "",
      DELIVERY_ARCHIVE_PUBLISHER_SECRET_ACCESS_KEY: present
        ? "publisher-secret"
        : "",
    };
    const moduleUrl = new URL("static-site-publication.ts", import.meta.url);
    const child =
      await Bun.$`${process.execPath} --eval ${`import { publishStaticSiteArchive } from ${JSON.stringify(moduleUrl.href)}; await publishStaticSiteArchive(JSON.parse(process.env.FIXTURE_PUBLICATION));`}`
        .env(env)
        .quiet()
        .nothrow();
    if (!present) {
      expect(child.exitCode).not.toBe(0);
      expect(child.stderr.toString()).toContain(
        "DELIVERY_ARCHIVE_PUBLISHER_ACCESS_KEY_ID",
      );
      expect(await Bun.file(env.FIXTURE_CALLS).exists()).toBe(false);
      return;
    }
    expect(child.exitCode, child.stderr.toString()).toBe(0);
    const callText = await Bun.file(env.FIXTURE_CALLS).text();
    const calls = callText
      .trim()
      .split("\n")
      .map((line) =>
        z
          .object({
            args: z.array(z.string()),
            access: z.literal("publisher-access"),
            secret: z.literal("publisher-secret"),
            vault: z.null(),
            session: z.null(),
          })
          .parse(JSON.parse(line)),
      );
    expect(calls.map((call) => call.args.slice(0, 2))).toEqual([
      ["s3api", "put-object"],
      ["s3", "cp"],
    ]);
    expect(calls[0]?.args).toContain("--if-none-match");
    expect(calls[0]?.args).toContain("*");
  },
);
