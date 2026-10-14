export class ReplayUploadError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export type ReplayUploadResult = {
  readonly outcome: "accepted" | "already_accepted";
  readonly digest: string;
  readonly bytes: number;
};

export function completedReplay(
  existing: {
    readonly gameId: string;
    readonly digest: string;
    readonly bytes: bigint;
  },
  requestedGameId: string,
): ReplayUploadResult {
  if (existing.gameId !== requestedGameId)
    throw new ReplayUploadError(
      "Replay digest already belongs to another game",
      400,
    );
  return {
    outcome: "already_accepted",
    digest: existing.digest,
    bytes: Number(existing.bytes),
  };
}
