import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { resolveCiImages } from "#src/images.ts";
import { renderPmsReproduction, PmsReproductionIdentity } from "./media-pms.ts";

const execute = promisify(execFile);
const root = fileURLToPath(new URL("../../../../", import.meta.url));

async function git(args: readonly string[]): Promise<string> {
  const result = await execute("git", ["-C", root, ...args], {
    encoding: "utf8",
    timeout: 30_000,
    maxBuffer: 2 * 1024 * 1024,
  });
  return result.stdout.trim();
}

/** Positional arguments: full pushed SHA, branch, request UUID, new output directory. */
async function main() {
  const [source, branch, requestId, output] = z
    .tuple([z.string(), z.string(), z.string(), z.string()])
    .parse(Bun.argv.slice(2));
  const identity = PmsReproductionIdentity.parse({ source, branch, requestId });
  await git(["check-ref-format", `refs/heads/${branch}`]);
  if ((await git(["status", "--porcelain"])) !== "")
    throw new Error("Render requires a clean source tree");
  if ((await git(["rev-parse", "HEAD"])) !== source)
    throw new Error("Renderer and requested source revision differ");
  const origin = await git(["remote", "get-url", "origin"]);
  if (
    ![
      "https://github.com/shepherdjerred/monorepo.git",
      "git@github.com:shepherdjerred/monorepo.git",
    ].includes(origin)
  )
    throw new Error("Unexpected repository origin");
  const remote = await git([
    "ls-remote",
    "--exit-code",
    "origin",
    `refs/heads/${branch}`,
  ]);
  if (remote !== `${source}\trefs/heads/${branch}`)
    throw new Error(
      "Remote branch does not point at the exact source revision",
    );
  const images = await resolveCiImages(source, (file, commit) =>
    git(["show", `${commit}:${file}`]),
  );
  const rendered = renderPmsReproduction(identity, images);
  const destination = path.resolve(output);
  const relative = path.relative(root, destination);
  if (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  )
    throw new Error("Review artifacts must be outside the clean source tree");
  await mkdir(destination, { mode: 0o700 });
  await writeFile(
    path.join(destination, "media-pms-wire.yaml"),
    rendered.yaml,
    { flag: "wx", mode: 0o600 },
  );
  await writeFile(
    path.join(destination, "plan.json"),
    `${JSON.stringify(rendered.plan, null, 2)}\n`,
    { flag: "wx", mode: 0o600 },
  );
  process.stdout.write(
    `${JSON.stringify({ ...identity, output: destination, yamlSha256: rendered.plan.yamlSha256, execution: "requires-reviewed-exact-source-runner" })}\n`,
  );
}

if (import.meta.main) await main();
