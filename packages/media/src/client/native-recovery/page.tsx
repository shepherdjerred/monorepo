import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router";
import type { MediaUser } from "#shared/contract.ts";
import { CommandResultSchema } from "#shared/api.ts";
import { NativeRecoveryInventorySchema } from "#shared/native-recovery.ts";
import { readApi, writeApi } from "#client/api.ts";
import {
  PageTitle,
  Loading,
  ErrorNotice,
  humanize,
} from "#client/components.tsx";
import { NativeRecoveryReview } from "./review.tsx";

export function NativeRecoveryPage({ user }: { user: MediaUser }) {
  const { id } = useParams();
  return id === undefined ? (
    <NativeRecoveryIndex user={user} />
  ) : (
    <NativeRecoveryReview user={user} id={id} />
  );
}
function NativeRecoveryIndex({ user }: { user: MediaUser }) {
  const [cursor, setCursor] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [lifecycle, setLifecycle] = useState<
    "published" | "committed_quarantine"
  >("published");
  const navigate = useNavigate();
  const inventory = useQuery({
    queryKey: ["native-recovery", cursor],
    queryFn: () =>
      readApi(
        `/admin/native-recovery${cursor === null ? "" : `?cursor=${encodeURIComponent(cursor)}`}`,
        NativeRecoveryInventorySchema,
      ),
  });
  const prepare = useMutation({
    mutationFn: async () => {
      const data = inventory.data;
      if (data?.restoreOperationId == null)
        throw new Error(
          "Complete the operator restore-to-observe procedure first",
        );
      return writeApi({
        actorId: user.id,
        path:
          lifecycle === "published"
            ? "/admin/native-recovery"
            : "/admin/native-recovery/quarantine",
        schema: CommandResultSchema,
        body: {
          ...(lifecycle === "published" ? {} : { lifecycleKind: lifecycle }),
          restoreOperationId: data.restoreOperationId,
          recoveryEpoch: data.runtime.recoveryEpoch,
          runtimeVersion: data.runtime.version,
          activation: data.runtime.mode === "active" ? "extend" : "activate",
          assetIds: selected,
        },
      });
    },
    onSuccess: (result) => {
      if (result.nativeRecoveryId !== undefined)
        void navigate(`/recovery/native/${result.nativeRecoveryId}`);
    },
  });
  return (
    <>
      <PageTitle
        eyebrow="Operator recovery"
        title="Reprove restored library files"
      >
        <p>
          Recover ownership of files previously published by Media. A separate
          household review protects requests, Keep choices and pins that may be
          missing from the backup.
        </p>
      </PageTitle>
      <p>
        <Link to="/recovery">Household recovery protection</Link>
      </p>
      {inventory.isPending && <Loading />}
      {inventory.error !== null && <ErrorNotice error={inventory.error} />}
      {prepare.error !== null && <ErrorNotice error={prepare.error} />}
      {inventory.data !== undefined && (
        <>
          <section className="panel">
            <h2>Before file review</h2>
            <p>
              Runtime: {humanize(inventory.data.runtime.mode)}. Both libraries
              need current Plex exclusion proofs and previously approved
              storage. Legacy writers must remain stopped.
            </p>
            {inventory.data.prerequisites.length > 0 ? (
              <ul>
                {inventory.data.prerequisites.map((reason) => (
                  <li key={reason}>{humanize(reason)}</li>
                ))}
              </ul>
            ) : (
              <p>
                Recorded prerequisites are present. The worker will freshly
                verify writers, mounts, Plex identities and file contents.
              </p>
            )}
          </section>
          <section className="panel">
            <h2>Select complete physical files</h2>
            <label>
              Recovery kind
              <select
                value={lifecycle}
                onChange={(event) => {
                  setLifecycle(
                    event.target.value === "committed_quarantine"
                      ? "committed_quarantine"
                      : "published",
                  );
                  setSelected([]);
                }}
              >
                <option value="published">Published library files</option>
                <option value="committed_quarantine">
                  Committed quarantine
                </option>
              </select>
            </label>
            <p>
              Select up to 25 files. Shared files include every covered episode,
              up to 100 titles. Published and quarantined files use separate
              reviews.
            </p>
            {lifecycle === "committed_quarantine" && (
              <p>
                File approval keeps these files in quarantine. A new positive
                request or household declaration is required to restore them.
                This does not authorize deletion or renew old requests.
              </p>
            )}
            {inventory.data.assets
              .filter((asset) =>
                lifecycle === "committed_quarantine"
                  ? asset.state === "quarantined"
                  : asset.state !== "quarantined",
              )
              .map((asset) => (
                <label className="check-label" key={asset.id}>
                  <input
                    type="checkbox"
                    checked={selected.includes(asset.id)}
                    disabled={
                      asset.reasons.length > 0 ||
                      (!selected.includes(asset.id) && selected.length >= 25)
                    }
                    onChange={(event) => {
                      setSelected(
                        event.target.checked
                          ? [...selected, asset.id]
                          : selected.filter((id) => id !== asset.id),
                      );
                    }}
                  />
                  <span>
                    {asset.titles.join(" · ") || "Unresolved coverage"}
                    <small>
                      {" "}
                      {humanize(asset.state)}
                      {asset.reasons.length > 0
                        ? ` · ${asset.reasons.map((reason) => humanize(reason)).join("; ")}`
                        : ""}
                    </small>
                  </span>
                </label>
              ))}
            {inventory.data.assets.length === 0 && (
              <p>No earlier-epoch owned files on this page.</p>
            )}
            <button
              className="button primary"
              disabled={
                selected.length === 0 ||
                inventory.data.prerequisites.length > 0 ||
                prepare.isPending
              }
              onClick={() => {
                prepare.mutate();
              }}
            >
              {prepare.isPending ? "Preparing…" : "Prepare exact file review"}
            </button>
            <div className="button-row">
              {cursor !== null && (
                <button
                  className="button"
                  onClick={() => {
                    setCursor(null);
                    setSelected([]);
                  }}
                >
                  First page
                </button>
              )}
              {inventory.data.nextCursor !== null && (
                <button
                  className="button"
                  onClick={() => {
                    setCursor(inventory.data.nextCursor);
                    setSelected([]);
                  }}
                >
                  Next files
                </button>
              )}
            </div>
          </section>
          <section className="panel">
            <h2>Prepared reviews</h2>
            {inventory.data.plans.map((plan) => (
              <p key={plan.id}>
                <Link to={`/recovery/native/${plan.id}`}>
                  {humanize(plan.state)} ·{" "}
                  {new Date(plan.createdAt).toLocaleString()}
                </Link>
              </p>
            ))}
          </section>
        </>
      )}
    </>
  );
}
