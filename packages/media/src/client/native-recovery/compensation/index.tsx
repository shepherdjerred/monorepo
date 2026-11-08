import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router";
import type { MediaUser } from "#shared/contract.ts";
import { NativeCompensationInventorySchema } from "#shared/native-recovery/compensation-runtime.ts";
import { NativeRecoveryInventorySchema } from "#shared/native-recovery.ts";
import { CommandResultSchema } from "#shared/api.ts";
import { readApi, writeApi } from "#client/api.ts";
import {
  PageTitle,
  Loading,
  ErrorNotice,
  humanize,
} from "#client/components.tsx";

export function NativeCompensationIndex({ user }: { user: MediaUser }) {
  const [cursor, setCursor] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const navigate = useNavigate();
  const inventory = useQuery({
    queryKey: ["native-compensations", cursor],
    queryFn: () =>
      readApi(
        `/admin/native-recovery/compensations${cursor === null ? "" : `?cursor=${encodeURIComponent(cursor)}`}`,
        NativeCompensationInventorySchema,
      ),
  });
  const context = useQuery({
    queryKey: ["native-compensation-context"],
    queryFn: () =>
      readApi("/admin/native-recovery", NativeRecoveryInventorySchema),
  });
  const prepare = useMutation({
    mutationFn: () => {
      const current = context.data;
      if (selected === null || current?.restoreOperationId == null)
        throw new Error(
          "Select a complete interrupted upgrade after restore-to-observe",
        );
      if (
        inventory.data?.items.some(
          (item) => item.transitionId === selected && item.selectable,
        ) !== true
      )
        throw new Error(
          "This interrupted upgrade is protected; refresh and review its current evidence",
        );
      return writeApi({
        actorId: user.id,
        path: "/admin/native-recovery/compensations",
        schema: CommandResultSchema,
        body: {
          lifecycleKind: "publication_compensation",
          transitionId: selected,
          restoreOperationId: current.restoreOperationId,
          recoveryEpoch: current.runtime.recoveryEpoch,
          runtimeVersion: current.runtime.version,
          activation: current.runtime.mode === "active" ? "extend" : "activate",
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
        title="Review interrupted upgrades"
      >
        <p>
          Restore the reviewed predecessor files while retaining successor
          bytes. A restored database cannot prove whether the successor was
          published after the backup.
        </p>
      </PageTitle>
      <p>
        <Link to="/recovery/native">Native file recovery</Link> ·{" "}
        <Link to="/recovery">Household protection</Link>
      </p>
      {(inventory.isPending || context.isPending) && <Loading />}
      {[inventory.error, context.error, prepare.error].map((error, index) =>
        error === null ? null : <ErrorNotice key={index} error={error} />,
      )}
      {context.data !== undefined && (
        <section className="panel">
          <h2>Before review</h2>
          <p>
            Only complete upgrades with durable original intent and acknowledged
            physical effects can be reviewed. Missing or uncertain evidence
            remains protected. Approval does not release household holds or
            resume the old download.
          </p>
          {context.data.prerequisites.map((reason) => (
            <p key={reason}>{humanize(reason)}</p>
          ))}
        </section>
      )}
      {inventory.data !== undefined && (
        <section className="panel">
          <h2>Select one complete upgrade</h2>
          <p>
            Every covered title and file participates. Entries cannot be
            selected individually.
          </p>
          {inventory.data.items.map((item) => (
            <label className="check-label" key={item.transitionId}>
              <input
                type="radio"
                name="compensation-transition"
                checked={selected === item.transitionId}
                disabled={!item.selectable || prepare.isPending}
                onChange={() => {
                  setSelected(item.transitionId);
                }}
              />
              <span>
                {item.media.map((media) => media.title).join(" · ")}
                <small>
                  {" "}
                  · {item.predecessors.length} predecessor files; successor
                  bytes retained
                </small>
                {item.protection !== null && (
                  <span className="muted">{humanize(item.protection)}</span>
                )}
              </span>
            </label>
          ))}
          {inventory.data.items.length === 0 && (
            <p>No interrupted upgrades on this page.</p>
          )}
          <button
            className="button primary"
            disabled={
              selected === null ||
              context.data?.restoreOperationId == null ||
              context.data.prerequisites.length > 0 ||
              prepare.isPending
            }
            onClick={() => {
              prepare.mutate();
            }}
          >
            {prepare.isPending
              ? "Preparing…"
              : "Prepare predecessor restoration review"}
          </button>
          <div className="button-row">
            <button
              className="button"
              disabled={inventory.isFetching || context.isFetching}
              onClick={() => {
                setSelected(null);
                void inventory.refetch();
                void context.refetch();
              }}
            >
              Refresh evidence
            </button>
            {cursor !== null && (
              <button
                className="button"
                onClick={() => {
                  setCursor(null);
                  setSelected(null);
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
                  setSelected(null);
                }}
              >
                Next upgrades
              </button>
            )}
          </div>
        </section>
      )}
    </>
  );
}
