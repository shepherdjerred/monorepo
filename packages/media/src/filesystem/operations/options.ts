import type { ContentProof } from "#filesystem/content-proof.ts";
import type { PrimitiveRecorder } from "#filesystem/publication-proof/recorder.ts";
import type {
  FileOperationManifest,
  MediaFileRoots,
} from "#filesystem/operations-types.ts";

export type FileOperationOptions = {
  /** Rechecks committed intent/generation and operation ownership while the path lock is held. */
  authorize: (manifest: FileOperationManifest) => Promise<void>;
  verifyPlexExclusion?: (roots: MediaFileRoots) => Promise<void>;
  minimumFreeBytes?: number;
  /** Activity heartbeat/cancellation checkpoint. Throwing leaves a recoverable journal. */
  checkpoint?: (phase: string) => Promise<void>;
  contentProof?: ContentProof;
  effectRecorder?: PrimitiveRecorder;
  /** Invocation-local authority check immediately before a syscall or journal installation. */
  beforeEffect?: () => void;
};
