import { z } from "zod";

export const IdSchema = z.string().regex(/^[\w-]{1,100}$/u);
export const DigestSchema = z.string().regex(/^[a-f0-9]{64}$/u);
export const ManifestSchema = z.object({
  version: z.literal(1),
  operationId: IdSchema,
  kind: z.enum(["import", "rollback", "quarantine", "restore", "purge"]),
  source: z.string(),
  target: z.string(),
  sha256: DigestSchema,
  previousSha256: DigestSchema.nullable(),
  phase: z.enum(["prepared", "staged", "complete"]),
});
export type FileOperationManifest = z.infer<typeof ManifestSchema>;

export class FileOperationConflict extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FileOperationConflict";
  }
}

export type MediaFileRoots = {
  downloads: string;
  library: string;
  /** Sibling of the scanned library on the same filesystem; never inside a Plex scan root. */
  control: string;
  /** Opt-in only after a live Plex scan proves the control subtree is excluded. */
  controlPolicy?: "plex-excluded";
};

export type ImportFile = {
  operationId: string;
  downloadPath: string;
  libraryPath: string;
  sha256: string;
  /** Required to replace an existing file. Omit for a new publication. */
  previousSha256?: string;
  /** Stage the verified copy without publishing it. Resume with the same operation ID. */
  stopAfterStaging?: boolean;
};

export type MoveFile = {
  operationId: string;
  libraryPath: string;
  quarantineId: string;
  sha256: string;
};
