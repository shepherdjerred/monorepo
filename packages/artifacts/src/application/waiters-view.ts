import type { FeedbackScope } from "#shared/contract.ts";
import { ArtifactsError } from "./errors.ts";
import type { Deps } from "./types.ts";
import type { Waiters } from "./waiters.ts";

/** Who is waiting, optionally narrowed to a board or an artifact. */
export function createWaitersView(deps: Deps, waiters: Waiters) {
  async function scopeFilter(input: {
    board?: string | undefined;
    artifactId?: string | undefined;
  }): Promise<((scope: FeedbackScope) => boolean) | null> {
    if (input.board === undefined && input.artifactId === undefined)
      return null;
    const artifacts = await deps.db.artifact.findMany({
      where: {
        deletedAt: null,
        ...(input.artifactId === undefined
          ? input.board === undefined
            ? {}
            : { board: { slug: input.board } }
          : { id: input.artifactId }),
      },
      select: { id: true, ownerKey: true, board: { select: { slug: true } } },
    });
    if (input.artifactId !== undefined && artifacts.length === 0)
      throw new ArtifactsError("NOT_FOUND", "Artifact not found");
    const ids = new Set(artifacts.map((artifact) => artifact.id));
    const owners = new Set(artifacts.map((artifact) => artifact.ownerKey));
    const slugs = new Set(artifacts.map((artifact) => artifact.board.slug));
    if (input.board !== undefined) slugs.add(input.board);
    return (scope) =>
      scope.type === "owner"
        ? owners.has(scope.ownerKey)
        : scope.type === "artifact"
          ? ids.has(scope.artifactId)
          : slugs.has(scope.board);
  }

  return {
    async list(input: {
      board?: string | undefined;
      artifactId?: string | undefined;
    }) {
      const matches = await scopeFilter(input);
      return {
        waiters: waiters
          .all()
          .filter((waiter) => matches === null || matches(waiter.scope))
          .map((waiter) => ({
            actor: waiter.actor,
            scope: waiter.scope,
            since: waiter.since.toISOString(),
          })),
      };
    },
  };
}
