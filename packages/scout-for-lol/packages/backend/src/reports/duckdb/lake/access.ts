import { RuntimeCapabilityError } from "#src/configuration/runtime-capability-error.ts";
import type { ScoutRuntimeCapabilities } from "#src/configuration/runtime-role.ts";

/**
 * Refuse to resolve lake files on a role that does not declare lake access.
 *
 * This is a *structural* rule, and it is here rather than in `runtime/`
 * because of how the boot gate failed. `subsystems.ts` verifies a published
 * build only for roles whose `reportLakeAccess` is true — so the check a role
 * skips by declaring `false` is the very check that would have caught the
 * role reading the lake anyway. A capability whose `false` skips a safety
 * check cannot protect the role that sets it false; only an assertion at the
 * read site can.
 *
 * And the read site is where the damage is silent. An unmounted or
 * unpublished lake is not an error for DuckDB — it scans zero parquet files
 * and returns zero rows — so the caller does not fail, it reports "no games
 * found" and records a successful run. Every in-process lake reader funnels
 * through {@link resolveLakeFiles}, which is what makes one assertion here
 * cover Explore turns, report runs, dare settlement, parlay generation and
 * the consumer profile alike.
 *
 * No role in the table sets this false today, and that is the intended end
 * state rather than the reason to drop the guard: the table is the claim, and
 * this is what makes a future role's claim true or make it fail loudly.
 */
export function assertReportLakeAccess(
  capabilities: Pick<ScoutRuntimeCapabilities, "reportLakeAccess">,
): void {
  if (capabilities.reportLakeAccess) return;
  throw new RuntimeCapabilityError(
    "reportLakeAccess",
    "This process's runtime role does not declare reportLakeAccess, so it must not query the report lake. An unmounted or unpublished lake answers every query with zero rows instead of failing, which a caller records as a successful run that found nothing.",
  );
}
