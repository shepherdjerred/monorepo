import type { RemediationPlan } from "./remediation.ts";

/** The plan as operator-readable lines. Carries ids only, never payloads. */
export function formatRemediationPlan(plan: RemediationPlan): string[] {
  const lines: string[] = [];
  const scope =
    plan.scope.kind === "owner"
      ? `owner ${plan.scope.ownerId}`
      : `device ${plan.scope.deviceId}`;
  lines.push(`Scope: ${scope}`);
  lines.push(`Devices: ${plan.devices.length.toString()}`);
  for (const device of plan.devices) {
    lines.push(
      `  device ${device.id} owner ${device.ownerId} (${device.deviceName}) ${device.deviceState}`,
    );
  }
  lines.push(
    `1. Revoke ${plan.revokeDeviceIds.length.toString()} active device(s)`,
  );
  const timelines = plan.matches.filter(
    (match) =>
      match.action === "timeline" ||
      ((match.action === "rederive" || match.action === "delete") &&
        match.archived.timeline),
  ).length;
  lines.push(
    `Supplied: ${plan.matches.length.toString()} match(es), ${timelines.toString()} client-derived timeline(s), ${plan.prematchObservationIds.length.toString()} prematch observation(s), ${plan.prematchSnapshots.length.toString()} canonical prematch snapshot(s)`,
  );
  lines.push("2. Matches");
  for (const match of plan.matches) {
    const others =
      match.otherSuppliers > 0
        ? ` (${match.otherSuppliers.toString()} other device upload(s) exist)`
        : "";
    lines.push(
      `  ${match.matchId} ${match.action}${others} observations: ${match.observationIds.join(", ")}`,
    );
  }
  for (const snapshot of plan.prematchSnapshots) {
    lines.push(
      `  prematch ${snapshot.matchId} remove canonical snapshot from observation ${snapshot.observationId}`,
    );
  }
  lines.push(
    `3. Delete ${plan.observationTotal.toString()} raw observation(s) ${JSON.stringify(plan.observationCounts)} and ${plan.aliasCount.toString()} learned alias(es)`,
  );
  lines.push(
    "4. Rebuild the report lake, then refresh Hall of Fame and competitions",
  );
  return lines;
}
