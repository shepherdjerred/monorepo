import path from "node:path";
import type { MediaAutomationContext } from "#automation/context.ts";
import { IntegrationError } from "#integrations/http.ts";

export function ownedTorrent(
  context: MediaAutomationContext,
  observed: Parameters<
    MediaAutomationContext["qbittorrent"]["validateOwnership"]
  >[0],
  attempt: { id: string; operationId: string },
): boolean {
  try {
    context.qbittorrent.validateOwnership(observed, {
      operationId: attempt.operationId,
      attemptId: attempt.id,
      savePath: path.join(context.downloadRoot, "media", attempt.id),
    });
    return true;
  } catch (error) {
    if (!(error instanceof IntegrationError)) throw error;
    return false;
  }
}
