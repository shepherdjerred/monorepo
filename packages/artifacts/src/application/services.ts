import { createArtifacts } from "./artifacts.ts";
import { createBoards } from "./boards.ts";
import { createFeedback } from "./feedback.ts";
import { createInbox } from "./inbox.ts";
import { createMaintenance } from "./maintenance.ts";
import { createThreads } from "./threads.ts";
import type { Deps } from "./types.ts";
import { createUploads } from "./uploads.ts";
import { createWaiters } from "./waiters.ts";
import { createWaitersView } from "./waiters-view.ts";

export type Services = ReturnType<typeof createServices>;

/** Every use case, built over one set of dependencies. */
export function createServices(deps: Deps) {
  const waiters = createWaiters();
  return {
    deps,
    boards: createBoards(deps),
    artifacts: createArtifacts(deps),
    threads: createThreads(deps),
    feedback: createFeedback(deps),
    uploads: createUploads(deps),
    inbox: createInbox(deps),
    maintenance: createMaintenance(deps),
    waiters,
    waitersView: createWaitersView(deps, waiters),
  };
}
