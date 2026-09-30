import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, Outlet, useOutletContext } from "react-router";
import { Button } from "@scout-for-lol/design-system/components/button";
import { LoadingState } from "@scout-for-lol/design-system/domain/states";
import { EmptyState } from "@scout-for-lol/design-system/layout";
import {
  operationsAccessNotice,
  resolveOperationsAccess,
} from "#src/lib/operations/operations-access.ts";
import { useTRPC } from "#src/lib/query/trpc.ts";

/**
 * The gate in front of every operations page.
 *
 * The gate IS the server. `availability` is an operations procedure, so asking
 * it is the same question the console's real work asks: a non-operator is
 * refused before the rollout flag is even read, and an operator meeting a
 * disabled console gets the same NOT_FOUND every other flag-gated surface here
 * answers with. Nothing below this component decides who may be here.
 *
 * That is worth being explicit about because the flag is the weaker of the two
 * checks by design. Identical SPA bytes ship to every stage and the path can be
 * typed, so hiding the console protects nothing — the Git-managed operator
 * allowlist is the whole access decision, and it is enforced on every request
 * rather than by this render.
 */

export type OperationsAvailability = { temporal: "available" | "unavailable" };

export function useOperationsAvailability(): OperationsAvailability {
  return useOutletContext<OperationsAvailability>();
}

function OperationsPage(props: { children: ReactNode }) {
  return (
    <div className="mx-auto max-w-6xl space-y-6 px-6 py-8 sm:px-8 sm:py-12">
      {props.children}
    </div>
  );
}

export function OperationsWorkspace() {
  const trpc = useTRPC();
  // One failure is the answer, so the probe does not retry into a refusal that
  // will not change.
  const availability = useQuery(
    trpc.operations.availability.queryOptions(undefined, { retry: false }),
  );
  const access = resolveOperationsAccess({
    hasData: availability.data !== undefined,
    error: availability.error,
  });
  const notice = operationsAccessNotice(access);

  if (notice !== null) {
    return (
      <OperationsPage>
        <div data-operations-access={access.kind}>
          <EmptyState>
            <h2>{notice.title}</h2>
            <p>{notice.message}</p>
            <Button asChild>
              <Link to="/">Back to Scout</Link>
            </Button>
          </EmptyState>
        </div>
      </OperationsPage>
    );
  }

  if (availability.data === undefined) {
    return (
      <OperationsPage>
        <LoadingState label="Checking operations access…" />
      </OperationsPage>
    );
  }

  return (
    <OperationsPage>
      <Outlet context={availability.data} />
    </OperationsPage>
  );
}
