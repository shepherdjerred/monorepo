import { FileGuardError } from "#automation/files/types.ts";

export function assertDefaultFileEdition(edition: string): void {
  if (edition !== "default") throw new FileGuardError("edition_not_available");
}
