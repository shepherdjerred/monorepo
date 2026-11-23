import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { RotateCwIcon } from "lucide-react";
import { useNavigate } from "react-router";
import type { MediaUser } from "#shared/contract.ts";
import { NativeCompensationInventorySchema } from "#shared/native-recovery/compensation-runtime.ts";
import { NativeRecoveryInventorySchema } from "#shared/native-recovery.ts";
import { CommandResultSchema } from "#shared/api.ts";
import { NotSentError, readApi, writeApi } from "#client/api.ts";
import { PageTitle } from "#client/components.tsx";
import { Button, ButtonLink, ButtonRow } from "#client/ui/button.tsx";
import { LoadError } from "#client/ui/feedback.tsx";
import { EmptyNote, Panel, SkeletonRows } from "#client/ui/panel.tsx";
import { PickList, WriteFailure } from "#client/ui/workflow.tsx";
import {
  CursorButtons,
  Prerequisites,
} from "#client/native-recovery/shell.tsx";
import { phrase } from "#client/native-recovery/vocabulary.ts";
import styles from "./compensation.module.css";
import { classNames } from "#client/ui/class-names.ts";

const cx = classNames(styles);

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
        throw new NotSentError(
          "Select a complete interrupted upgrade after restore-to-observe",
        );
      if (
        inventory.data?.items.some(
          (item) => item.transitionId === selected && item.selectable,
        ) !== true
      )
        throw new NotSentError(
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
        void navigate(`/manage/recovery/native/${result.nativeRecoveryId}`);
    },
  });
  const items = inventory.data;
  return (
    <>
      <PageTitle title="Review interrupted upgrades">
        <p>
          Restore the reviewed predecessor files while retaining successor
          bytes. A restored database cannot prove whether the successor was
          published after the backup.
        </p>
        <ButtonRow>
          <ButtonLink to="/manage/recovery/native">
            Native file recovery
          </ButtonLink>
          <ButtonLink to="/recovery">Household recovery protection</ButtonLink>
        </ButtonRow>
      </PageTitle>
      {(inventory.isPending || context.isPending) && (
        <SkeletonRows label="Loading the interrupted upgrades" rows={3} tall />
      )}
      {[inventory.error, context.error].map((error, index) =>
        error === null ? null : (
          <LoadError
            key={index}
            what="The interrupted upgrades"
            error={error}
            retry={() => {
              void inventory.refetch();
              void context.refetch();
            }}
          />
        ),
      )}
      {context.data !== undefined && (
        <Prerequisites
          intro="Only complete upgrades with durable original intent and acknowledged physical effects can be reviewed. Missing or uncertain evidence remains protected. Approval does not release household holds or resume the old download."
          prerequisites={context.data.prerequisites}
          done="No prerequisites are outstanding."
          title="Before review"
        />
      )}
      {items !== undefined && (
        <Panel
          id="upgrades"
          title="Choose one complete upgrade"
          description={
            <p>
              Every covered title and file participates; entries cannot be
              selected individually. Preparing changes nothing; you approve the
              review on the next page.
            </p>
          }
        >
          {items.items.length === 0 ? (
            <EmptyNote>No interrupted upgrades on this page.</EmptyNote>
          ) : (
            <PickList
              data-field="upgrade"
              data-field-label="Interrupted upgrade"
              tabIndex={-1}
            >
              {items.items.map((item) => (
                <label className={cx("choice")} key={item.transitionId}>
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
                    {item.media.map((media) => media.title).join(", ")}
                    <br />
                    <small>
                      {item.predecessors.length} predecessor file
                      {item.predecessors.length === 1 ? "" : "s"}; successor
                      bytes retained
                    </small>
                    {item.protection !== null && (
                      <small>
                        <br />
                        Cannot be selected:{" "}
                        {phrase(item.protection).toLowerCase()}
                      </small>
                    )}
                  </span>
                </label>
              ))}
            </PickList>
          )}
          <CursorButtons
            hasPrevious={cursor !== null}
            next={items.nextCursor}
            nextLabel="Next upgrades"
            onFirst={() => {
              setCursor(null);
              setSelected(null);
            }}
            onNext={(next) => {
              setCursor(next);
              setSelected(null);
            }}
          />
          <ButtonRow>
            <Button
              variant="primary"
              busy={prepare.isPending}
              disabled={
                selected === null ||
                context.data?.restoreOperationId == null ||
                context.data.prerequisites.length > 0
              }
              onClick={() => {
                prepare.mutate();
              }}
            >
              {prepare.isPending
                ? "Preparing…"
                : "Prepare predecessor restoration review"}
            </Button>
            <Button
              busy={inventory.isFetching || context.isFetching}
              onClick={() => {
                setSelected(null);
                void inventory.refetch();
                void context.refetch();
              }}
            >
              <RotateCwIcon aria-hidden="true" />
              Refresh evidence
            </Button>
          </ButtonRow>
          {prepare.error !== null && (
            <WriteFailure
              error={prepare.error}
              refused={{
                title: "The review was not prepared",
                state: "Nothing was prepared and no file was changed.",
              }}
              unknown={{
                title: "Whether the review was prepared is not known",
                about: "whether the review was saved",
                check: "open the prepared reviews to see whether it is listed",
              }}
              action={
                <ButtonLink to="/manage/recovery/native#reviews">
                  Open the prepared reviews
                </ButtonLink>
              }
            />
          )}
        </Panel>
      )}
    </>
  );
}
