import { link, rename } from "node:fs/promises";
import { sha256File, unlinkRegular } from "./operations-io.ts";
import { FileOperationConflict } from "./operations-types.ts";
import type { ContentProof } from "./content-proof.ts";

export function contentIO(
  proof: ContentProof | undefined,
  checkpoint: () => Promise<void>,
) {
  return {
    async digest(path: string): Promise<string> {
      if (proof === undefined) return await sha256File(path, checkpoint);
      const result = await proof.digest(path);
      if (result === null)
        throw new FileOperationConflict("Preverified media file is missing");
      return result;
    },
    async link(source: string, target: string): Promise<void> {
      if (proof === undefined) await link(source, target);
      else await proof.link(source, target);
    },
    async rename(source: string, target: string): Promise<void> {
      if (proof === undefined) await rename(source, target);
      else await proof.rename(source, target);
    },
    async unlink(path: string): Promise<void> {
      if (proof === undefined) await unlinkRegular(path);
      else await proof.unlink(path);
    },
  };
}
