/**
 * What a deployment that has not ended is doing, in the one vocabulary every
 * page uses: it is `queued` until an executor claims it, and `deploying` only
 * once one has (the deployment is running). Null for a status that is not an
 * unfinished attempt.
 */
export function attemptPhase(status: string): "queued" | "deploying" | null {
  switch (status) {
    case "queued":
    case "pending": {
      return "queued";
    }
    case "running": {
      return "deploying";
    }
    default: {
      return null;
    }
  }
}
