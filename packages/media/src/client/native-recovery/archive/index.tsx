import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import type { MediaUser } from "#shared/contract.ts";
import { NativeArchiveInventorySchema } from "#shared/native-recovery/archive-view.ts";
import { CommandResultSchema } from "#shared/api.ts";
import { NotSentError, readApi, writeApi } from "#client/api.ts";
import { PageTitle } from "#client/components.tsx";
import { Button, ButtonLink, ButtonRow } from "#client/ui/button.tsx";
import { LoadError } from "#client/ui/feedback.tsx";
import { EmptyNote, Panel, SkeletonRows } from "#client/ui/panel.tsx";
import { PickBox, PickList, WriteFailure } from "#client/ui/workflow.tsx";
import {
  CursorButtons,
  Prerequisites,
} from "#client/native-recovery/shell.tsx";
import { when } from "#client/native-recovery/vocabulary.ts";
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
        throw new NotSentError(
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
        void navigate(`/manage/recovery/native/${result.nativeRecoveryId}`);
    },
  });
  const data = inventory.data;
  return (
    <>
      <PageTitle title="Review upgrade archives">
        <p>
          Select the old versions whose original expiry cleanup should resume.
          The review includes retained dependencies and current playable files,
          without selecting them for deletion.
        </p>
        <ButtonRow>
          <ButtonLink to="/manage/recovery/native">
            Native file recovery
          </ButtonLink>
          <ButtonLink to="/recovery">Household recovery protection</ButtonLink>
        </ButtonRow>
      </PageTitle>
      {inventory.isPending && (
        <SkeletonRows label="Loading the archives" rows={3} tall />
      )}
      {inventory.error !== null && (
        <LoadError
          what="The upgrade archives"
          error={inventory.error}
          retry={() => {
            void inventory.refetch();
          }}
        />
      )}
      {data !== undefined && (
        <>
          <Prerequisites
            title="Before archive review"
            intro="The original seven-day rollback deadline is preserved. Approval does not delete files, renew requests, or release household holds. Fresh Plex, storage, and file checks remain required."
            prerequisites={data.prerequisites}
            done="No prerequisites are outstanding."
          />
          <Panel
            id="cleanups"
            title="Choose the cleanups to resume"
            description={
              <p>
                Select up to 25 pending cleanups. Dependencies are added only to
                the read-only review. Preparing changes nothing; you approve the
                review on the next page.
              </p>
            }
          >
            {data.cleanups.length === 0 ? (
              <EmptyNote>No upgrade archives on this page.</EmptyNote>
            ) : (
              <PickList
                data-field="cleanups"
                data-field-label="Cleanups"
                tabIndex={-1}
              >
                {data.cleanups.map((item) => (
                  <PickBox
                    key={item.id}
                    checked={selected.includes(item.id)}
                    disabled={
                      item.reasons.length > 0 ||
                      (!selected.includes(item.id) && selected.length >= 25)
                    }
                    onChange={(checked) => {
                      setSelected(
                        checked
                          ? [...selected, item.id]
                          : selected.filter((id) => id !== item.id),
                      );
                    }}
                  >
                    {item.titles.join(", ") || "Unresolved coverage"}
                    <br />
                    <small>
                      {archiveBytes(item.sizeBytes)}. Original expiry:{" "}
                      {when(item.expiresAt)}
                    </small>
                    {item.reasons.map((reason) => (
                      <small key={reason}>
                        <br />
                        {archiveReasons[reason]}
                      </small>
                    ))}
                  </PickBox>
                ))}
              </PickList>
            )}
            <CursorButtons
              hasPrevious={cursor !== null}
              next={data.nextCursor}
              nextLabel="Next archives"
              onFirst={() => {
                setCursor(null);
                setSelected([]);
              }}
              onNext={(next) => {
                setCursor(next);
                setSelected([]);
              }}
            />
            <div>
              <Button
                variant="primary"
                busy={prepare.isPending}
                disabled={
                  selected.length === 0 || data.prerequisites.length > 0
                }
                onClick={() => {
                  prepare.mutate();
                }}
              >
                {prepare.isPending
                  ? "Preparing…"
                  : "Prepare exact archive review"}
              </Button>
            </div>
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
                  check:
                    "open the prepared reviews to see whether it is listed",
                }}
                action={
                  <ButtonLink to="/manage/recovery/native#reviews">
                    Open the prepared reviews
                  </ButtonLink>
                }
              />
            )}
          </Panel>
        </>
      )}
    </>
  );
}
