export type PermanentImportErrorCode = "authentication" | "contract";

export class PermanentImportError extends Error {
  readonly code: PermanentImportErrorCode;

  constructor(
    code: PermanentImportErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "PermanentImportError";
    this.code = code;
  }
}

export class LakeStagingError extends Error {
  constructor(subject: string, cause?: unknown) {
    super(
      `Lake staging failed for ${subject}`,
      cause === undefined ? undefined : { cause },
    );
    this.name = "LakeStagingError";
  }
}

export class ImportStorageError extends Error {
  constructor(matchId: string, cause: unknown) {
    super(`Canonical storage failed for imported match ${matchId}`, { cause });
    this.name = "ImportStorageError";
  }
}
