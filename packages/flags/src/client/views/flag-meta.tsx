import { useState } from "react";
import { Chip } from "@shepherdjerred/console-ui";
import {
  useFlagMetadata,
  type FlagMetadata,
} from "@shepherdjerred/flags/client/management-api.ts";
import { addedText, lastChangedText } from "./history-model.ts";

/** A deployment's flag descriptions by key, for the table and its search. */
export function descriptionsOf(
  flags: readonly FlagMetadata[] | undefined,
): ReadonlyMap<string, string> {
  return new Map(
    (flags ?? []).flatMap((flag) =>
      flag.purpose === undefined ? [] : [[flag.key, flag.purpose] as const],
    ),
  );
}

const CHIPS = ["owner", "namespace", "source"] as const;

/**
 * The inventory's description of a flag (read-only: it is edited in
 * `managed-flag-inventory.json`), its owner, namespace and source, and when it
 * was added and last changed.
 */
export function FlagMeta({
  catalog,
  stage,
  flagKey,
}: {
  readonly catalog: string;
  readonly stage: string;
  readonly flagKey: string;
}): React.JSX.Element | null {
  const metadata = useFlagMetadata(catalog, stage);
  // "3 hours ago" is measured from when the editor opened.
  const [now] = useState(Date.now);
  if (metadata.isPending) return null;
  if (metadata.isError) {
    return (
      <p className="ui-muted fl-meta-failed">
        Description and dates unavailable: {metadata.error.message}
      </p>
    );
  }
  const meta = metadata.data.flags.find((flag) => flag.key === flagKey);
  if (meta === undefined) return null;
  const chips = CHIPS.flatMap((name) => {
    const value = meta[name];
    return value === undefined ? [] : [{ name, value }];
  });
  const changed = lastChangedText(meta, now);
  return (
    <div className="fl-meta">
      {meta.purpose === undefined ? null : (
        <p className="fl-purpose">{meta.purpose}</p>
      )}
      {meta.declared ? null : (
        <p className="fl-undeclared">Not declared in the inventory</p>
      )}
      {chips.length === 0 ? null : (
        <div className="fl-chips fl-meta-chips">
          {chips.map((chip) => (
            <Chip key={chip.name} label={chip.name} value={chip.value} />
          ))}
        </div>
      )}
      <p className="ui-muted fl-meta-dates">
        <span>{addedText(meta, metadata.data.auditStartedAt)}</span>
        {changed === undefined ? null : (
          <>
            <span aria-hidden="true"> · </span>
            <span title={meta.lastChangedAt ?? undefined}>{changed}</span>
          </>
        )}
      </p>
    </div>
  );
}
