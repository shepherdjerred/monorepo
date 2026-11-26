import { SeverityBadge } from "@shepherdjerred/console-ui";
import { Link } from "react-router";
import {
  deploymentCounts,
  driftPath,
  driftSeverity,
  itemCount,
  type DeploymentDrift,
} from "./drift-model.ts";

/** A deployment's drift as a badge linking to its section of the drift page. */
export function DriftChip({
  entry,
}: {
  readonly entry: DeploymentDrift | undefined;
}): React.JSX.Element | null {
  if (entry === undefined) return null;
  const counts = deploymentCounts(entry);
  const total = itemCount(counts);
  return (
    <Link
      className="fl-drift-chip"
      to={driftPath(entry.id)}
      aria-label={
        total === 0
          ? `${entry.id} matches the inventory`
          : `${entry.id} has ${String(total)} drifted ${total === 1 ? "item" : "items"}`
      }
    >
      <SeverityBadge
        severity={driftSeverity(counts)}
        label={total === 0 ? "In sync" : `${String(total)} drift`}
      />
    </Link>
  );
}
