import { RuntimeCapabilityError } from "#src/configuration/runtime-capability-error.ts";
import type { ScoutRuntimeCapabilities } from "#src/configuration/runtime-role.ts";

export function assertReportLakeAccess(
  capabilities: Pick<ScoutRuntimeCapabilities, "reportLakeAccess">,
): void {
  if (capabilities.reportLakeAccess) return;
  throw new RuntimeCapabilityError(
    "reportLakeAccess",
    "This process's runtime role does not declare reportLakeAccess, so it must not query the report lake. An unmounted or unpublished lake answers every query with zero rows instead of failing, which a caller records as a successful run that found nothing.",
  );
}
