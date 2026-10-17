import { MediaError } from "#application/errors.ts";
export class NativeArchiveScopeProtection extends MediaError {
  constructor(message: string) {
    super("archive_transition_reconciliation_required", message, 409);
  }
}
