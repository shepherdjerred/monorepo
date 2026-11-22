import { StatusGlyph, type Severity } from "@shepherdjerred/console-ui";

import type { AlertView } from "#shared/schema";

type LedgerSeverity = AlertView["severity"];

/**
 * The alert ledger's severities on the shared severity vocabulary: a ledger
 * `critical` is an `error` tone that keeps its own word.
 */
const LEDGER_TONE: Readonly<Record<LedgerSeverity, Severity>> = {
  critical: "error",
  warning: "warning",
  info: "info",
  unknown: "unknown",
};

const LEDGER_LABEL: Readonly<Record<LedgerSeverity, string>> = {
  critical: "Critical",
  warning: "Warning",
  info: "Info",
  unknown: "Unknown",
};

/** An alert's severity as a glyph and its word, like every ops severity. */
export function AlertSeverity({
  severity,
}: {
  readonly severity: LedgerSeverity;
}): React.JSX.Element {
  return (
    <StatusGlyph
      severity={LEDGER_TONE[severity]}
      label={LEDGER_LABEL[severity]}
    />
  );
}

/**
 * A house chore's priority: a critical alert is an urgent chore and a
 * warning a routine one; the rest keep their ledger severity.
 */
const PRIORITY: Readonly<
  Record<LedgerSeverity, { readonly tone: Severity; readonly label: string }>
> = {
  critical: { tone: "warning", label: "Urgent" },
  warning: { tone: "info", label: "Chore" },
  info: { tone: "info", label: "Info" },
  unknown: { tone: "unknown", label: "Unknown" },
};

export function ChorePriority({
  severity,
}: {
  readonly severity: LedgerSeverity;
}): React.JSX.Element {
  const { tone, label } = PRIORITY[severity];
  return <StatusGlyph severity={tone} label={label} />;
}
