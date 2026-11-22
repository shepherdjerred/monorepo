import type { CatalogReconcileRecord } from "#shared/model/route-contract.ts";
import { Fact, Facts } from "#client/components/facts.tsx";

/** One catalog reconcile: what the document created, renamed, rebound, retired and refused (4.1). */
export function CatalogReconcile({
  result,
}: {
  result: CatalogReconcileRecord;
}) {
  const rows = [
    ["Services created", result.services.created],
    ["Service lineage changed", result.services.lineageChanged],
    ["Services retired", result.services.retired],
    ["Environments created", result.environments.created],
    [
      "Environments renamed",
      result.environments.renamed.map((entry) => `${entry.from} → ${entry.to}`),
    ],
    ["Environments rebound", result.environments.rebound],
    ["Environments retired", result.environments.retired],
    ["Selections carried", result.environments.carried],
    ["Recipe revisions created", result.recipes.created],
    ["Configuration revisions created", result.configurations.created],
    ["Refused", result.refused.map((entry) => `${entry.id}: ${entry.reason}`)],
  ] as const;
  const changed = rows.filter(([, ids]) => ids.length > 0);
  return (
    <div className="catalog-result">
      {changed.length === 0 ? (
        <p className="muted">
          The record already matched the catalog document.
        </p>
      ) : (
        <Facts>
          {changed.map(([label, ids]) => (
            <Fact
              key={label}
              label={
                <>
                  {label} ({ids.length})
                </>
              }
              mono
            >
              {ids.join(", ")}
            </Fact>
          ))}
        </Facts>
      )}
      <p className="muted">
        {result.unchanged} unchanged · {result.edges} prerequisite edges ·{" "}
        {result.references} component references
      </p>
    </div>
  );
}
