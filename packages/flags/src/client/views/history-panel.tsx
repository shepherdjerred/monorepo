import { useId, useState } from "react";
import { ChevronDownIcon, ChevronRightIcon, HistoryIcon } from "lucide-react";
import { Button, Tag } from "@shepherdjerred/console-ui";
import type { FlagValue } from "@shepherdjerred/feature-flags/evaluate.ts";
import {
  useFlagHistory,
  type HistoryEntry,
} from "@shepherdjerred/flags/client/management-api.ts";
import { FlagDiff } from "./flag-diff.tsx";
import {
  ACTION_LABEL,
  actorLabel,
  actorTitle,
  bodyText,
  formatInstant,
  restoreCheck,
} from "./history-model.ts";

/** What the editor lends the timeline so an old version can become the draft. */
export type RestoreTarget = {
  /** The value stored at the editor's revision. */
  readonly stored: FlagValue;
  readonly onRestore: (flag: FlagValue) => void;
};

function RestoreAction({
  entry,
  restore,
}: {
  readonly entry: HistoryEntry;
  readonly restore: RestoreTarget;
}): React.JSX.Element {
  const hintId = useId();
  const [restored, setRestored] = useState(false);
  const check = restoreCheck(entry, restore.stored);
  return (
    <div className="fl-history-restore">
      <Button
        type="button"
        disabled={!check.ok}
        title={check.ok ? undefined : check.reason}
        aria-describedby={check.ok ? undefined : hintId}
        onClick={() => {
          if (!check.ok) return;
          restore.onRestore(check.flag);
          setRestored(true);
        }}
      >
        Restore this version
      </Button>
      {check.ok ? (
        restored ? (
          <span role="status" className="ui-muted">
            Loaded into the draft. Review save to write it.
          </span>
        ) : null
      ) : (
        <span id={hintId} className="ui-muted">
          {check.reason}
        </span>
      )}
    </div>
  );
}

function Entry({
  entry,
  restore,
}: {
  readonly entry: HistoryEntry;
  readonly restore: RestoreTarget | undefined;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  const Chevron = open ? ChevronDownIcon : ChevronRightIcon;
  return (
    <li className="fl-history-entry" data-action={entry.action}>
      <button
        type="button"
        className="fl-history-toggle"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => {
          setOpen(!open);
        }}
      >
        <Chevron aria-hidden="true" />
        <Tag className="fl-history-action">{ACTION_LABEL[entry.action]}</Tag>
        <span className="ui-mono" title={actorTitle(entry.actor)}>
          {actorLabel(entry.actor)}
        </span>
        <time className="ui-muted" dateTime={entry.at} title={entry.at}>
          {formatInstant(entry.at)}
        </time>
        <span className="ui-muted fl-revision">rev {entry.revisionAfter}</span>
      </button>
      {open ? (
        <div id={bodyId} className="fl-history-body">
          <FlagDiff
            left={bodyText(entry.before)}
            right={bodyText(entry.after)}
            leftLabel="Before"
            rightLabel="After"
          />
          {restore === undefined || entry.action === "retire" ? null : (
            <RestoreAction entry={entry} restore={restore} />
          )}
        </div>
      ) : null}
    </li>
  );
}

/**
 * A key's recorded changes, newest first, each expandable to its before/after
 * diff. With `restore`, a create or update can be loaded into the editor's
 * draft; the archive shows the same timeline read-only.
 */
export function HistoryPanel({
  catalog,
  stage,
  flagKey,
  restore,
}: {
  readonly catalog: string;
  readonly stage: string;
  readonly flagKey: string;
  readonly restore?: RestoreTarget | undefined;
}): React.JSX.Element {
  const headingId = useId();
  const history = useFlagHistory(catalog, stage, flagKey);
  const entries = history.data?.pages.flatMap((page) => page.entries) ?? [];
  const startedAt = history.data?.pages[0]?.auditStartedAt;
  return (
    <section className="fl-history" aria-labelledby={headingId}>
      <h3 id={headingId} className="fl-history-title">
        <HistoryIcon aria-hidden="true" />
        History
      </h3>
      {history.isPending ? (
        <p className="ui-muted" role="status">
          Loading history…
        </p>
      ) : history.isError ? (
        <p className="ui-field-error" role="alert">
          History failed to load: {history.error.message}
        </p>
      ) : entries.length === 0 ? (
        <p className="ui-muted">
          {startedAt === undefined
            ? "No recorded changes."
            : `No recorded changes since ${formatInstant(startedAt)}.`}
        </p>
      ) : (
        <ol className="fl-history-list">
          {entries.map((entry) => (
            <Entry key={entry.id} entry={entry} restore={restore} />
          ))}
        </ol>
      )}
      {history.hasNextPage ? (
        <div>
          <Button
            type="button"
            disabled={history.isFetchingNextPage}
            onClick={() => {
              void history.fetchNextPage();
            }}
          >
            {history.isFetchingNextPage ? "Loading…" : "Load older"}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
