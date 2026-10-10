import { z } from "zod";
import { isDeepStrictEqual } from "node:util";
import { createHash } from "node:crypto";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { BoxSchema } from "#protocol/bridge.ts";
import { BUILD_FILES, type BuildManifest } from "#protocol/build.ts";
import { lastOf, readLog } from "#build/build-log.ts";
import { buildArtifactPath, type ArtifactWorkspace } from "./artifact-path.ts";

const CaptureIdentity = z.strictObject({
  id: z.uuid(),
  siteHash: z.string().min(1),
  box: BoxSchema,
  filesHash: z.string().regex(/^[a-f0-9]{64}$/u),
});

async function captureDigest(workspace: ArtifactWorkspace): Promise<string> {
  const root = await buildArtifactPath(workspace, BUILD_FILES.siteDir);
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  const files = new Map<string, string>();
  for (const entry of entries) {
    const relative = path.relative(
      root,
      path.join(entry.parentPath, entry.name),
    );
    if (relative === "parts" && entry.isDirectory()) continue;
    if (!entry.isFile())
      throw new Error(`unexpected captured site artifact: ${relative}`);
    if (relative === "capture.json") continue;
    if (
      !/^(?:site\.(?:schem|json)|parts\/(?:parts\.json|\d+\.schem))$/u.test(
        relative,
      )
    )
      throw new Error(`unexpected captured site artifact: ${relative}`);
    const bytes = await Bun.file(
      await buildArtifactPath(
        workspace,
        path.join(BUILD_FILES.siteDir, relative),
      ),
    ).bytes();
    files.set(relative, createHash("sha256").update(bytes).digest("hex"));
  }
  const hash = createHash("sha256");
  for (const [file, digest] of [...files.entries()].toSorted(([a], [b]) =>
    a.localeCompare(b),
  ))
    hash.update(`${file}\0${digest}\n`);
  return hash.digest("hex");
}

/** This marker travels with the atomically installed site directory. */
export async function writeCaptureIdentity(
  workspace: ArtifactWorkspace,
  identity: Omit<z.infer<typeof CaptureIdentity>, "filesHash">,
): Promise<void> {
  await Bun.write(
    workspace.file(BUILD_FILES.siteIdentity),
    `${JSON.stringify(CaptureIdentity.parse({ ...identity, filesHash: await captureDigest(workspace) }))}\n`,
  );
}

/** Journal-first capture installation must never admit an older site or manifest. */
export async function validateCaptureIdentity(
  workspace: ArtifactWorkspace,
  manifest: BuildManifest,
): Promise<void> {
  const capture = lastOf(await readLog(workspace.dir), "capture");
  const file = Bun.file(workspace.file(BUILD_FILES.siteIdentity));
  if (!(await file.exists())) {
    if (
      (capture?.kind === "capture" && capture.id !== undefined) ||
      manifest.site?.id !== undefined
    )
      throw new Error("missing capture identity; capture the site again");
    return;
  }
  const identity = CaptureIdentity.parse(
    await Bun.file(
      await buildArtifactPath(workspace, BUILD_FILES.siteIdentity),
    ).json(),
  );
  const box =
    manifest.site === undefined
      ? null
      : {
          world: manifest.world,
          min: manifest.site.min,
          max: manifest.site.max,
        };
  if (
    capture?.kind !== "capture" ||
    capture.id !== identity.id ||
    manifest.site?.id !== identity.id ||
    capture.siteHash !== identity.siteHash ||
    manifest.site.siteHash !== identity.siteHash ||
    !isDeepStrictEqual(capture.box, identity.box) ||
    !isDeepStrictEqual(box, identity.box)
  )
    throw new Error(
      "capture identity does not match the installed site, manifest and journal; capture the site again",
    );
  if ((await captureDigest(workspace)) !== identity.filesHash)
    throw new Error(
      "captured site artifact hash does not match its capture identity; capture the site again",
    );
}
