import {
  CircleCheckIcon,
  CircleMinusIcon,
  CrosshairIcon,
  type LucideIcon,
} from "lucide-react";
import { Link } from "react-router";
import { SeverityBadge, type Severity } from "@shepherdjerred/console-ui";
import type { FlagValue } from "@shepherdjerred/feature-flags/evaluate.ts";
import { flagPath, flagState, searchSuffix, type FlagState } from "./model.ts";

/*
 * On is ok (green). Off is neutral (`unknown`'s grey) rather than an error:
 * a switched-off flag is a normal state, not a fault. Targeted is info (blue):
 * it is neither on nor off for everyone. `unknown`'s "?" glyph would read as
 * "we do not know", so Off draws a minus and Targeted a crosshair.
 */
const BADGES: Readonly<
  Record<
    Exclude<FlagState["kind"], "variant">,
    { readonly severity: Severity; readonly icon: LucideIcon }
  >
> = {
  on: { severity: "ok", icon: CircleCheckIcon },
  off: { severity: "unknown", icon: CircleMinusIcon },
  targeted: { severity: "info", icon: CrosshairIcon },
};

/** A boolean's state as Hub's severity badge; a variant's value as mono text. */
export function FlagStateCell({
  flag,
}: {
  readonly flag: FlagValue;
}): React.JSX.Element {
  const state = flagState(flag);
  if (state.kind === "variant") {
    return (
      <span className="fl-value" title={state.label}>
        {state.label}
      </span>
    );
  }
  const badge = BADGES[state.kind];
  return (
    <SeverityBadge
      severity={badge.severity}
      label={state.label}
      icon={badge.icon}
    />
  );
}

export type FlagTableProps = {
  readonly catalog: string;
  readonly stage: string;
  readonly flags: readonly FlagValue[];
  /** Inventory descriptions by key, shown muted under each key. */
  readonly descriptions?: ReadonlyMap<string, string> | undefined;
  readonly selectedKey: string | undefined;
  /** The active search; links carry it so a row click keeps the filter. */
  readonly query: string;
};

/** Flag, State and Type for each flag; the selected row is `aria-current`. */
export function FlagTable({
  catalog,
  stage,
  flags,
  descriptions,
  selectedKey,
  query,
}: FlagTableProps): React.JSX.Element {
  return (
    <div
      className="ui-data-scroll"
      tabIndex={0}
      role="region"
      aria-label={`${catalog}/${stage} flags`}
    >
      <table className="ui-data fl-table">
        <thead>
          <tr>
            <th scope="col">Flag</th>
            <th scope="col">State</th>
            <th scope="col">Type</th>
          </tr>
        </thead>
        <tbody>
          {flags.map((flag) => {
            const selected = flag.key === selectedKey;
            const description = descriptions?.get(flag.key);
            return (
              <tr key={flag.key} data-current={selected ? "" : undefined}>
                <th scope="row" data-label="Flag">
                  <Link
                    className="fl-key"
                    to={`${flagPath(catalog, stage, flag.key)}${searchSuffix(query)}`}
                    aria-current={selected ? "page" : undefined}
                  >
                    {flag.key}
                  </Link>
                  {description === undefined ? null : (
                    <span className="fl-desc" title={description}>
                      {description}
                    </span>
                  )}
                </th>
                <td data-label="State">
                  <FlagStateCell flag={flag} />
                </td>
                <td className="ui-muted" data-label="Type">
                  {flag.type}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
