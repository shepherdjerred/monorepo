import { NativeArchiveScopeProtection } from "#infrastructure/native-archive/errors.ts";

/** Invocation-local resource bound; repeated reads also consume the complete closure's allowance. */
export class PublicationAuthorityReadBudget {
  private remaining = 100;

  get take(): number {
    return this.remaining + 1;
  }

  consume(count: number): void {
    if (!Number.isSafeInteger(count) || count < 0)
      throw new Error("Invalid publication authority read count");
    this.remaining -= count;
    if (this.remaining < 0)
      throw new NativeArchiveScopeProtection(
        "Native archive authority exceeds 100 total queried records",
      );
  }
}
