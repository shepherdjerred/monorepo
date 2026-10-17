import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router";
import type { MediaUser } from "#shared/contract.ts";
import { NativeArchiveInventorySchema } from "#shared/native-recovery/archive-view.ts";
import { CommandResultSchema } from "#shared/api.ts";
import { readApi, writeApi } from "#client/api.ts";
import { PageTitle, Loading, ErrorNotice } from "#client/components.tsx";
import { archiveBytes, archiveReasons } from "./presentation.ts";

export function NativeArchiveIndex({ user }: { user: MediaUser }) {
  const [cursor, setCursor] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const navigate = useNavigate();
  const inventory = useQuery({
    queryKey: ["native-archives", cursor],
    queryFn: () =>
      readApi(
        `/admin/native-recovery/archives${cursor === null ? "" : `?cursor=${encodeURIComponent(cursor)}`}`,
        NativeArchiveInventorySchema,
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
        path: "/admin/native-recovery/archives",
        schema: CommandResultSchema,
        body: {
          restoreOperationId: data.restoreOperationId,
          recoveryEpoch: data.runtime.recoveryEpoch,
          runtimeVersion: data.runtime.version,
          activation: data.runtime.mode === "active" ? "extend" : "activate",
          cleanupIds: selected,
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
      <PageTitle eyebrow="Operator recovery" title="Review upgrade archives">
        <p>
          Select the old versions whose original expiry cleanup should resume.
          The review includes retained dependencies and current playable files,
          without selecting them for deletion.
        </p>
      </PageTitle>
      <p>
        <Link to="/recovery/native">Native file recovery</Link> ·{" "}
        <Link to="/recovery">Household recovery protection</Link>
      </p>
      {inventory.isPending && <Loading />}
      {inventory.error !== null && <ErrorNotice error={inventory.error} />}{" "}
      {prepare.error !== null && <ErrorNotice error={prepare.error} />}
      {inventory.data !== undefined && (
        <>
          <section className="panel">
            <h2>Before archive review</h2>
            <p>
              The original seven-day rollback deadline is preserved. Approval
              does not delete files, renew requests or release household holds.
              Fresh Plex, storage and file checks remain required.
            </p>
            {inventory.data.prerequisites.map((reason) => (
              <p key={reason}>{reason.replaceAll("_", " ")}</p>
            ))}
          </section>
          <section className="panel">
            <h2>Explicit cleanup selection</h2>
            <p>
              Select up to 25 pending cleanups. Dependencies are added only to
              the read-only review.
            </p>
            {inventory.data.cleanups.map((item) => (
              <label className="check-label" key={item.id}>
                <input
                  type="checkbox"
                  checked={selected.includes(item.id)}
                  disabled={
                    item.reasons.length > 0 ||
                    (!selected.includes(item.id) && selected.length >= 25)
                  }
                  onChange={(event) => {
                    setSelected(
                      event.target.checked
                        ? [...selected, item.id]
                        : selected.filter((id) => id !== item.id),
                    );
                  }}
                />
                <span>
                  {item.titles.join(" · ") || "Unresolved coverage"}
                  <small>
                    {" "}
                    · {archiveBytes(item.sizeBytes)} · Original expiry:{" "}
                    {new Date(item.expiresAt).toLocaleString()}
                  </small>
                  {item.reasons.map((reason) => (
                    <span className="muted" key={reason}>
                      {archiveReasons[reason]}
                    </span>
                  ))}
                </span>
              </label>
            ))}
            {inventory.data.cleanups.length === 0 && (
              <p>No upgrade archives on this page.</p>
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
              {prepare.isPending
                ? "Preparing…"
                : "Prepare exact archive review"}
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
                  Next archives
                </button>
              )}
            </div>
          </section>
        </>
      )}
    </>
  );
}
