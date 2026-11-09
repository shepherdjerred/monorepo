import path from "node:path";
import { cp, lstat, mkdir, rename, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PublicMediaSchema } from "#protocol/media.ts";
import { sha256 } from "#src/capture/media.ts";
import { LegacyOutputSchema, type LegacyOutput } from "./define.ts";

async function backup(destination: string, backupRoot: string) {
  const parent = await lstat(path.dirname(destination));
  if (parent.isSymbolicLink()) throw new Error("Linked legacy directory");
  try {
    const existing = await lstat(destination);
    if (!existing.isFile() || existing.isSymbolicLink())
      throw new Error("Invalid legacy destination");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return;
    throw error;
  }
  await mkdir(backupRoot, { recursive: true, mode: 0o700 });
  await cp(
    destination,
    path.join(backupRoot, `${path.basename(destination)}-${randomUUID()}`),
    { force: false, errorOnExist: true },
  );
}

async function install(
  source: string,
  destination: string,
  backupRoot: string,
) {
  await mkdir(path.dirname(destination), { recursive: true });
  await backup(destination, backupRoot);
  const temporary = `${destination}.stage-${randomUUID()}`;
  try {
    await cp(source, temporary, { errorOnExist: true, force: false });
    if ((await sha256(source)) !== (await sha256(temporary)))
      throw new Error("Legacy copy hash differs");
    await rename(temporary, destination);
  } finally {
    await rm(temporary, { force: true });
  }
}

/** Only already verified public derivatives are eligible; selected shots alone update aliases. */
export async function publishLegacy(
  outputs: LegacyOutput[],
  names: string[],
  publicRoot: string,
  backupRoot: string,
): Promise<void> {
  const selected = new Set(names);
  for (const value of outputs) {
    const output = LegacyOutputSchema.parse(value);
    if (!selected.has(output.shot)) continue;
    const root = path.join(publicRoot, "media", output.shot);
    const manifest = PublicMediaSchema.parse(
      await Bun.file(path.join(root, "media.json")).json(),
    );
    if (manifest.name !== output.shot)
      throw new Error("Legacy source identity differs");
    const video = output.path.endsWith(".mp4");
    if ((manifest.kind === "video") !== video)
      throw new Error(`Legacy output type differs: ${output.path}`);
    const source = path.join(root, video ? "clip.mp4" : "original.webp");
    const destination = path.join(publicRoot, output.path.slice(1));
    await install(source, destination, backupRoot);
  }
}
