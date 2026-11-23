import {
  CircleCheckIcon,
  CircleMinusIcon,
  CrosshairIcon,
  type LucideIcon,
} from "lucide-react";
import type { FlagValue } from "@shepherdjerred/feature-flags/evaluate.ts";
import { flagPath, flagState, searchSuffix, type FlagState } from "./model.ts";

/*
 * On is ok (green). Off is neutral (`unknown`'s grey) rather than an error:
 * a switched-off flag is a normal state, not a fault. Targeted is info (blue):
 * it is neither on nor off for everyone. `unknown`'s "?" icon would read as
 * "we do not know", so Off draws a minus instead.
 */
const GLYPHS: Readonly<
  Record<
    Exclude<FlagState["kind"], "variant">,
    { readonly severity: "ok" | "unknown" | "info"; readonly icon: LucideIcon }
  >
> = {
  on: { severity: "ok", icon: CircleCheckIcon },
  off: { severity: "unknown", icon: CircleMinusIcon },
  targeted: { severity: "info", icon: CrosshairIcon },
};

export function FlagStateCell({
  flag,
}: {
  readonly flag: FlagValue;
}): React.JSX.Element {
  const state = flagState(flag);
  if (state.kind === "variant") {
    return (
      <span className="ui-mono fl-value" title={state.label}>
        {state.label}
      </span>
    );
  }
  const glyph = GLYPHS[state.kind];
  const Icon = glyph.icon;
  return (
    <span className="ui-glyph" data-sev={glyph.severity}>
      <Icon className="ui-glyph-icon" aria-hidden="true" />
      <span>{state.label}</span>
    </span>
  );
}

export type FlagTableProps = {
  readonly catalog: string;
  readonly stage: string;
  readonly flags: readonly FlagValue[];
  readonly selectedKey: string | undefined;
  /** The active search; links carry it so a row click keeps the filter. */
  readonly query: string;
};

/** Flag, State and Type for each flag; the selected row is `aria-current`. */
export function FlagTable({
  catalog,
  stage,
  flags,
  selectedKey,
  query,
}: FlagTableProps): React.JSX.Element {
  return (
    <div
      className="ui-table-scroll"
      tabIndex={0}
      role="region"
      aria-label={`${catalog}/${stage} flags`}
    >
      <table className="ui-table">
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
            return (
              <tr key={flag.key} data-current={selected ? "" : undefined}>
                <th scope="row">
                  <a
                    className="ui-mono fl-key"
                    href={`${flagPath(catalog, stage, flag.key)}${searchSuffix(query)}`}
                    aria-current={selected ? "page" : undefined}
                  >
                    {flag.key}
                  </a>
                </th>
                <td>
                  <FlagStateCell flag={flag} />
                </td>
                <td className="ui-muted">{flag.type}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
