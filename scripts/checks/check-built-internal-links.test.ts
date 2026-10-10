import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "vitest";

const checker = new URL("check-built-internal-links.ts", import.meta.url)
  .pathname;

test("the Storm build validates page and asset destinations at the site root", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "built-links-"));
  try {
    const dist = path.join(directory, "dist");
    await mkdir(path.join(dist, "world_downloads"), { recursive: true });
    await writeFile(
      path.join(dist, "world_downloads/index.html"),
      "<h1>Downloads</h1>",
    );
    await writeFile(path.join(dist, "icon.svg"), "<svg />");
    const index = path.join(dist, "index.html");
    await writeFile(
      index,
      '<a href="/world_downloads/?page=1#archive">Downloads</a><img src="/icon.svg"><a href="//example.test/">External</a>',
    );
    const run = async () => {
      const child = Bun.spawn(["bun", checker, "ts-mc-docs"], {
        cwd: directory,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [exitCode, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      return { exitCode, stdout, stderr };
    };
    const valid = await run();
    expect(valid.exitCode).toBe(0);
    expect(valid.stdout).toContain(
      "checked 2 built internal page and asset links",
    );
    await writeFile(index, '<a href="/missing/">Missing</a>');
    const broken = await run();
    expect(broken.exitCode).not.toBe(0);
    expect(broken.stderr).toContain("index.html -> /missing/");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
