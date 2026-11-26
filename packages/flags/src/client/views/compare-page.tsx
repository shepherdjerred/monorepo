import {
  Button,
  Card,
  CardToolbar,
  PageBody,
  PageHeading,
  SearchField,
  Segmented,
  SeverityBadge,
  SummaryGrid,
} from "@shepherdjerred/console-ui";
import { ArrowLeftRightIcon, ExternalLinkIcon } from "lucide-react";
import { Link, useSearchParams } from "react-router";
import {
  useDeployments,
  type DeploymentDocument,
} from "@shepherdjerred/flags/client/api.ts";
import { FlagStateCell } from "@shepherdjerred/flags/client/flag-table.tsx";
import { LinkButton } from "@shepherdjerred/flags/client/link-button.tsx";
import {
  flagPath,
  flagText,
  splitDeploymentId,
  stageLabel,
  withQuery,
} from "@shepherdjerred/flags/client/model.ts";
import {
  COMPARE_STATUS_SEVERITY,
  comparePair,
  countRows,
  diffDocuments,
  statusLabel,
  visibleRows,
  type CompareRow,
} from "./compare-model.ts";
import { FlagDiff } from "./flag-diff.tsx";
import { useDocuments } from "./views-api.ts";

/**
 * Short names for the two sides: stage labels ("Beta", "Prod") when both are
 * stages of one catalog, the full ids otherwise.
 */
export function sideNames(
  left: string,
  right: string,
): { readonly left: string; readonly right: string } {
  const leftRoute = splitDeploymentId(left);
  const rightRoute = splitDeploymentId(right);
  return leftRoute.catalog === rightRoute.catalog &&
    leftRoute.stage !== rightRoute.stage
    ? { left: stageLabel(leftRoute.stage), right: stageLabel(rightRoute.stage) }
    : { left, right };
}

function DeploymentSelect({
  label,
  ids,
  value,
  onChange,
}: {
  readonly label: string;
  readonly ids: readonly string[];
  readonly value: string;
  readonly onChange: (id: string) => void;
}): React.JSX.Element {
  return (
    <label className="fl-select">
      <span>{label}</span>
      <select
        className="ui-select"
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      >
        {ids.map((id) => (
          <option key={id} value={id}>
            {id}
          </option>
        ))}
      </select>
    </label>
  );
}

function StateCell({
  flag,
}: {
  readonly flag: CompareRow["left"];
}): React.JSX.Element {
  return flag === undefined ? (
    <span className="ui-muted" aria-label="absent">
      —
    </span>
  ) : (
    <FlagStateCell flag={flag} />
  );
}

function OpenLink({
  id,
  flagKey,
}: {
  readonly id: string;
  readonly flagKey: string;
}): React.JSX.Element {
  const { catalog, stage } = splitDeploymentId(id);
  return (
    <LinkButton to={flagPath(catalog, stage, flagKey)}>
      <ExternalLinkIcon aria-hidden="true" />
      Edit in {id}
    </LinkButton>
  );
}

function CompareDetail({
  row,
  flagKey,
  left,
  right,
  names,
}: {
  readonly row: CompareRow | undefined;
  readonly flagKey: string | undefined;
  readonly left: string;
  readonly right: string;
  readonly names: { readonly left: string; readonly right: string };
}): React.JSX.Element {
  if (flagKey === undefined) {
    return (
      <Card className="fl-cmp-detail fl-cmp-placeholder">
        <p className="ui-state">Select a flag to compare.</p>
      </Card>
    );
  }
  if (row === undefined) {
    return (
      <Card className="fl-cmp-detail">
        <p className="ui-state" role="alert">
          Neither {left} nor {right} has a flag {flagKey}.
        </p>
      </Card>
    );
  }
  return (
    <Card className="fl-cmp-detail" label={`${row.key} compared`}>
      <div className="fl-cmp-detail-body">
        <div className="fl-cmp-detail-head">
          <h2 className="fl-detail-title ui-mono" id="compare-flag-heading">
            {row.key}
          </h2>
          <SeverityBadge
            severity={COMPARE_STATUS_SEVERITY[row.status]}
            label={statusLabel(row.status, names.left, names.right)}
          />
        </div>
        <FlagDiff
          left={row.left === undefined ? "" : flagText(row.left)}
          right={row.right === undefined ? "" : flagText(row.right)}
          leftLabel={left}
          rightLabel={right}
        />
        <div className="fl-actions">
          {row.left === undefined ? null : (
            <OpenLink id={left} flagKey={row.key} />
          )}
          {row.right === undefined ? null : (
            <OpenLink id={right} flagKey={row.key} />
          )}
        </div>
      </div>
    </Card>
  );
}

type Pair = { readonly left: string; readonly right: string };

function CompareTable({
  rows,
  pair,
  names,
  flagKey,
  linkTo,
}: {
  readonly rows: readonly CompareRow[];
  readonly pair: Pair;
  readonly names: Pair;
  readonly flagKey: string | undefined;
  readonly linkTo: (key: string) => string;
}): React.JSX.Element {
  return (
    <div
      className="ui-data-scroll"
      tabIndex={0}
      role="region"
      aria-label={`${pair.left} against ${pair.right}`}
    >
      <table className="ui-data fl-table">
        <thead>
          <tr>
            <th scope="col">Flag</th>
            <th scope="col">{names.left}</th>
            <th scope="col">{names.right}</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const current = row.key === flagKey;
            return (
              <tr key={row.key} data-current={current ? "" : undefined}>
                <th scope="row" data-label="Flag">
                  <Link
                    className="fl-key"
                    to={linkTo(row.key)}
                    aria-current={current ? "page" : undefined}
                  >
                    {row.key}
                  </Link>
                </th>
                <td data-label={names.left}>
                  <StateCell flag={row.left} />
                </td>
                <td data-label={names.right}>
                  <StateCell flag={row.right} />
                </td>
                <td data-label="Status">
                  <SeverityBadge
                    severity={COMPARE_STATUS_SEVERITY[row.status]}
                    label={statusLabel(row.status, names.left, names.right)}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** The summary, the filtered table and the selected flag's diff. */
function CompareResults({
  pair,
  left,
  right,
}: {
  readonly pair: Pair;
  readonly left: DeploymentDocument;
  readonly right: DeploymentDocument;
}): React.JSX.Element {
  const [params, setParams] = useSearchParams();
  const query = params.get("q") ?? "";
  const showSame = params.get("same") === "1";
  const flagKey = params.get("key") ?? undefined;
  const names = sideNames(pair.left, pair.right);
  const rows = diffDocuments(left, right);
  const counts = countRows(rows);
  const shown = visibleRows(rows, { showSame, query });
  const linkTo = (key: string): string => {
    const next = new URLSearchParams(params);
    next.set("left", pair.left);
    next.set("right", pair.right);
    next.set("key", key);
    return `?${next.toString()}`;
  };
  return (
    <>
      <SummaryGrid
        label="Comparison summary"
        items={[
          {
            label: "Differ",
            value: counts.differs,
            severity: counts.differs === 0 ? "ok" : "warning",
          },
          {
            label: `Only in ${names.left}`,
            value: counts["only-left"],
            severity: counts["only-left"] === 0 ? "ok" : "info",
          },
          {
            label: `Only in ${names.right}`,
            value: counts["only-right"],
            severity: counts["only-right"] === 0 ? "ok" : "info",
          },
          { label: "Identical", value: counts.same, severity: "ok" },
        ]}
      />
      <div
        className="fl-cmp-body"
        data-flag={flagKey === undefined ? undefined : ""}
      >
        <Card label="Compared flags">
          <CardToolbar>
            <SearchField
              label="Search"
              value={query}
              placeholder="Filter flags by key"
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => {
                setParams((current) => withQuery(current, event.target.value), {
                  replace: true,
                });
              }}
            />
            <Segmented
              label="Show"
              value={showSame ? "all" : "differences"}
              options={[
                {
                  value: "differences",
                  label: "Differences",
                  count: rows.length - counts.same,
                },
                { value: "all", label: "All", count: rows.length },
              ]}
              onChange={(next) => {
                const updated = new URLSearchParams(params);
                if (next === "all") updated.set("same", "1");
                else updated.delete("same");
                setParams(updated, { replace: true });
              }}
            />
            <span className="ui-count" aria-live="polite">
              {shown.length} of {rows.length}
            </span>
          </CardToolbar>
          {shown.length === 0 ? (
            <p className="ui-state">
              {query.trim().length > 0
                ? `No flags match “${query.trim()}”.`
                : "Every flag is identical."}
            </p>
          ) : (
            <CompareTable
              rows={shown}
              pair={pair}
              names={names}
              flagKey={flagKey}
              linkTo={linkTo}
            />
          )}
        </Card>
        <CompareDetail
          row={rows.find((row) => row.key === flagKey)}
          flagKey={flagKey}
          left={pair.left}
          right={pair.right}
          names={names}
        />
      </div>
    </>
  );
}

/** Loads both documents and shows their comparison, or why it cannot. */
function CompareDocuments({ pair }: { readonly pair: Pair }) {
  const documents = useDocuments([pair.left, pair.right]);
  const [leftResult, rightResult] = documents;
  const failure = documents.find((result) => result.isError)?.error;
  if (failure !== undefined)
    return (
      <p className="ui-state" role="alert">
        {failure.message}
      </p>
    );
  const left = leftResult?.data;
  const right = rightResult?.data;
  return left === undefined || right === undefined ? (
    <p className="ui-state" role="status">
      Loading flags…
    </p>
  ) : (
    <CompareResults pair={pair} left={left} right={right} />
  );
}

/** Two deployments side by side: which flags differ, and how. */
export function ComparePage(): React.JSX.Element {
  const deployments = useDeployments();
  const [params, setParams] = useSearchParams();
  const ids = deployments.data?.map((deployment) => deployment.id) ?? [];
  const pair = comparePair(ids, {
    left: params.get("left"),
    right: params.get("right"),
  });

  function choose(next: Pair): void {
    const updated = new URLSearchParams(params);
    updated.set("left", next.left);
    updated.set("right", next.right);
    setParams(updated);
  }

  return (
    <PageBody>
      <PageHeading
        eyebrow="Flags"
        title="Compare"
        description={
          pair === undefined
            ? "Two deployments side by side."
            : `${pair.left} against ${pair.right}.`
        }
        actions={
          pair === undefined ? undefined : (
            <Button
              size="page"
              onClick={() => {
                choose({ left: pair.right, right: pair.left });
              }}
            >
              <ArrowLeftRightIcon aria-hidden="true" />
              Swap sides
            </Button>
          )
        }
      />
      {deployments.isPending ? (
        <p className="ui-state" role="status">
          Loading deployments…
        </p>
      ) : deployments.isError ? (
        <p className="ui-state" role="alert">
          {deployments.error.message}
        </p>
      ) : pair === undefined ? (
        <p className="ui-state">Comparing needs at least two deployments.</p>
      ) : (
        <>
          <div className="fl-cmp-pick">
            <DeploymentSelect
              label="Left"
              ids={ids}
              value={pair.left}
              onChange={(id) => {
                choose({ left: id, right: pair.right });
              }}
            />
            <span className="ui-muted" aria-hidden="true">
              vs
            </span>
            <DeploymentSelect
              label="Right"
              ids={ids}
              value={pair.right}
              onChange={(id) => {
                choose({ left: pair.left, right: id });
              }}
            />
          </div>
          <CompareDocuments pair={pair} />
        </>
      )}
    </PageBody>
  );
}
