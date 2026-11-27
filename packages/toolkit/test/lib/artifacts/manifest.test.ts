import { mkdir, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "vitest";
import {
  buildSource,
  DEFAULT_LIMITS,
  inferKind,
  manifestDigest,
  mediaTypeFor,
  parseKind,
} from "#lib/artifacts/manifest.ts";
import { tempDirectory } from "#test/support/artifacts.ts";

const sha = (text: string) =>
  new Bun.CryptoHasher("sha256").update(text).digest("hex");

test("a single file is its own entry with kind inferred from the extension", async () => {
  const dir = await tempDirectory();
  const file = path.join(dir, "plan.pdf");
  await writeFile(file, "%PDF-1.7 fixture");
  const source = await buildSource(file);
  expect(source).toMatchObject({
    kind: "pdf",
    entryPath: "plan.pdf",
    defaultTitle: "plan",
    totalBytes: 16,
  });
  expect(source.files).toEqual([
    {
      path: "plan.pdf",
      absolutePath: file,
      size: 16,
      sha256: sha("%PDF-1.7 fixture"),
      mediaType: "application/pdf",
    },
  ]);
});

test.each([
  ["a.html", "html"],
  ["a.HTM", "html"],
  ["a.pdf", "pdf"],
  ["a.png", "image"],
  ["a.jpeg", "image"],
  ["a.svg", "image"],
  ["a.avif", "image"],
  ["a.mp4", "video"],
  ["a.mov", "video"],
  ["a.md", "markdown"],
  ["a.cast", "cast"],
  ["a.mmd", "mermaid"],
  ["a.zip", "file"],
  ["noextension", "file"],
] as const)("%s is kind %s", (name, kind) => {
  expect(inferKind(name)).toBe(kind);
});

test("a Mermaid source is uploaded as diagram.mmd", async () => {
  const dir = await tempDirectory();
  const file = path.join(dir, "flow.mmd");
  await writeFile(file, "graph TD; A-->B");
  const source = await buildSource(file);
  expect(source.kind).toBe("mermaid");
  expect(source.entryPath).toBe("diagram.mmd");
  expect(source.files[0]?.path).toBe("diagram.mmd");
  expect(source.defaultTitle).toBe("flow");
});

test("--kind overrides the inferred kind", async () => {
  const dir = await tempDirectory();
  const file = path.join(dir, "notes.txt");
  await writeFile(file, "hi");
  const source = await buildSource(file, { kind: "markdown" });
  expect(source.kind).toBe("markdown");
  expect(() => parseKind("nonsense")).toThrow(/--kind must be one of/u);
});

test("a directory with index.html is a site with every file in the manifest", async () => {
  const dir = await tempDirectory();
  await mkdir(path.join(dir, "assets"));
  await writeFile(path.join(dir, "index.html"), "<html></html>");
  await writeFile(path.join(dir, "assets", "app.js"), "export {}");
  await writeFile(path.join(dir, "assets", "font.woff2"), "wOF2");
  await mkdir(path.join(dir, ".git"));
  await writeFile(path.join(dir, ".git", "config"), "ignored");
  await writeFile(path.join(dir, ".DS_Store"), "ignored");
  const source = await buildSource(dir);
  expect(source.kind).toBe("site");
  expect(source.entryPath).toBe("index.html");
  expect(source.files.map((file) => file.path)).toEqual([
    "assets/app.js",
    "assets/font.woff2",
    "index.html",
  ]);
  expect(source.files.map((file) => file.mediaType)).toEqual([
    "text/javascript; charset=utf-8",
    "font/woff2",
    "text/html; charset=utf-8",
  ]);
});

test("a directory without index.html says how to publish files instead", async () => {
  const dir = await tempDirectory();
  await writeFile(path.join(dir, "a.png"), "x");
  await expect(buildSource(dir)).rejects.toThrow(
    /no index\.html at its root.*separate paths/u,
  );
});

test("kind and shape must agree", async () => {
  const dir = await tempDirectory();
  await writeFile(path.join(dir, "index.html"), "x");
  await expect(buildSource(dir, { kind: "pdf" })).rejects.toThrow(
    /publishes as a site/u,
  );
  await expect(
    buildSource(path.join(dir, "index.html"), { kind: "site" }),
  ).rejects.toThrow(/needs a directory/u);
});

test("reserved names, symlinks, and missing paths fail with the fix", async () => {
  const dir = await tempDirectory();
  await writeFile(path.join(dir, "_private.png"), "x");
  await expect(buildSource(path.join(dir, "_private.png"))).rejects.toThrow(
    /Rename it/u,
  );
  await writeFile(path.join(dir, "real.txt"), "x");
  await symlink(path.join(dir, "real.txt"), path.join(dir, "link.txt"));
  await expect(buildSource(path.join(dir, "link.txt"))).rejects.toThrow(
    /symbolic link/u,
  );
  const site = await tempDirectory();
  await writeFile(path.join(site, "index.html"), "x");
  await symlink(path.join(dir, "real.txt"), path.join(site, "escape.txt"));
  await expect(buildSource(site)).rejects.toThrow(
    /escape\.txt is a symbolic link/u,
  );
  await expect(buildSource(path.join(dir, "missing.html"))).rejects.toThrow(
    /does not exist/u,
  );
});

test("limits are enforced client-side with the number that was exceeded", async () => {
  const dir = await tempDirectory();
  await writeFile(path.join(dir, "index.html"), "0123456789");
  await writeFile(path.join(dir, "b.txt"), "0123456789");
  const limits = { ...DEFAULT_LIMITS };
  await expect(
    buildSource(dir, { limits: { ...limits, maxFileBytes: 5 } }),
  ).rejects.toThrow(/per-file limit/u);
  await expect(
    buildSource(dir, { limits: { ...limits, maxVersionBytes: 15 } }),
  ).rejects.toThrow(/per-version limit/u);
  await expect(
    buildSource(dir, { limits: { ...limits, maxFiles: 1 } }),
  ).rejects.toThrow(/more than 1 files.*build output/u);
});

test("the digest is stable, order independent, and sensitive to content and entry", () => {
  const a = {
    path: "a.txt",
    sha256: sha("a"),
    size: 1,
    mediaType: "text/plain",
  };
  const b = {
    path: "b.txt",
    sha256: sha("b"),
    size: 1,
    mediaType: "text/plain",
  };
  expect(manifestDigest("a.txt", [a, b])).toBe(manifestDigest("a.txt", [b, a]));
  expect(manifestDigest("a.txt", [a, b])).toMatch(/^[0-9a-f]{64}$/u);
  expect(manifestDigest("b.txt", [a, b])).not.toBe(
    manifestDigest("a.txt", [a, b]),
  );
  expect(manifestDigest("a.txt", [{ ...a, sha256: sha("c") }, b])).not.toBe(
    manifestDigest("a.txt", [a, b]),
  );
});

test("media types extend the shared upload map", () => {
  expect(mediaTypeFor("x.md")).toBe("text/markdown; charset=utf-8");
  expect(mediaTypeFor("x.mp4")).toBe("video/mp4");
  expect(mediaTypeFor("x.unknown")).toBe("application/octet-stream");
});
