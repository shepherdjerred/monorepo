import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router";
import type { MediaUser } from "#shared/contract.ts";
import { CommandResultSchema } from "#shared/api.ts";
import { NativeRecoveryInventorySchema } from "#shared/native-recovery.ts";
import { NotSentError, readApi, writeApi } from "#client/api.ts";
import { PageTitle } from "#client/components.tsx";
import { Button, ButtonLink, ButtonRow } from "#client/ui/button.tsx";
import { DataList, DataRow } from "#client/ui/data-list.tsx";
import { Badge, LoadError } from "#client/ui/feedback.tsx";
import { ChoiceField } from "#client/ui/forms/field.tsx";
import { EmptyNote, Panel, SkeletonRows } from "#client/ui/panel.tsx";
import { PickBox, PickList, WriteFailure } from "#client/ui/workflow.tsx";
import { NativeRecoveryReview } from "./review.tsx";
import { NativeArchiveIndex } from "./archive/index.tsx";
import { NativeCompensationIndex } from "./compensation/index.tsx";
import { CursorButtons, Prerequisites } from "./shell.tsx";
import { REVIEW_STATE, phrase, reviewState, when } from "./vocabulary.ts";

export function NativeRecoveryPage({ user }: { user: MediaUser }) {
  const { id } = useParams();
  if (id === "archives") return <NativeArchiveIndex user={user} />;
  if (id === "compensations") return <NativeCompensationIndex user={user} />;
  return id === undefined ? (
    <NativeRecoveryIndex user={user} />
  ) : (
    <NativeRecoveryReview key={id} user={user} id={id} />
  );
}

type Lifecycle = "published" | "committed_quarantine";

function NativeRecoveryIndex({ user }: { user: MediaUser }) {
  const [cursor, setCursor] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [lifecycle, setLifecycle] = useState<Lifecycle>("published");
  const navigate = useNavigate();
  const inventory = useQuery({
    queryKey: ["native-recovery", cursor],
    queryFn: async () => {
      const read = await readApi(
        `/admin/native-recovery${cursor === null ? "" : `?cursor=${encodeURIComponent(cursor)}`}`,
        NativeRecoveryInventorySchema,
      );
      for (const plan of read.plans) reviewState(plan.state);
      return read;
    },
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
        void navigate(`/manage/recovery/native/${result.nativeRecoveryId}`);
    },
  });
  const data = inventory.data;
  return (
    <>
      <PageTitle title="Reprove restored library files">
        <p>
          After a restore from backup, recover ownership of the files Media
          published before it. A separate household review protects requests,
          Keep choices, and pins that may be missing from the backup.
        </p>
        <ButtonRow>
          <ButtonLink to="/recovery">Household recovery protection</ButtonLink>
          <ButtonLink to="/manage/recovery/native/archives">
            Review upgrade archives
          </ButtonLink>
          <ButtonLink to="/manage/recovery/native/compensations">
            Review interrupted upgrades
          </ButtonLink>
        </ButtonRow>
      </PageTitle>
      {inventory.isPending && (
        <SkeletonRows label="Loading the inventory" rows={3} tall />
      )}
      {inventory.error !== null && (
        <LoadError
          what="The file inventory"
          error={inventory.error}
          retry={() => {
            void inventory.refetch();
          }}
        />
      )}
      {data !== undefined && (
        <>
          <Prerequisites
            intro={`The runtime is ${phrase(data.runtime.mode).toLowerCase()}. Both libraries need current Plex exclusion proofs and previously approved storage. Legacy writers must remain stopped.`}
            prerequisites={data.prerequisites}
            done="Recorded prerequisites are present. The worker will freshly verify writers, mounts, Plex identities and file contents."
          />
          <Panel
            id="files"
            title="1. Choose complete physical files"
            description={
              <p>
                Select up to 25 files. Shared files include every covered
                episode, up to 100 titles. Published and quarantined files use
                separate reviews. Preparing writes the review down and changes
                nothing; you approve it on the next page.
              </p>
            }
          >
            <ChoiceField
              legend="Recovery kind"
              description={
                lifecycle === "committed_quarantine"
                  ? "File approval keeps these files in quarantine. A new positive request or household declaration is required to restore them. This does not authorize deletion or renew old requests."
                  : undefined
              }
              name="lifecycle"
              layout="stack"
              value={lifecycle}
              onChange={(value) => {
                setLifecycle(
                  value === "committed_quarantine"
                    ? "committed_quarantine"
                    : "published",
                );
                setSelected([]);
              }}
              options={[
                { value: "published", label: "Published library files" },
                {
                  value: "committed_quarantine",
                  label: "Committed quarantine",
                },
              ]}
            />
            {data.assets.filter((asset) =>
              lifecycle === "committed_quarantine"
                ? asset.state === "quarantined"
                : asset.state !== "quarantined",
            ).length === 0 ? (
              <EmptyNote>No earlier-epoch owned files on this page.</EmptyNote>
            ) : (
              <PickList
                data-field="assets"
                data-field-label="Files"
                tabIndex={-1}
              >
                {data.assets
                  .filter((asset) =>
                    lifecycle === "committed_quarantine"
                      ? asset.state === "quarantined"
                      : asset.state !== "quarantined",
                  )
                  .map((asset) => (
                    <PickBox
                      key={asset.id}
                      checked={selected.includes(asset.id)}
                      disabled={
                        asset.reasons.length > 0 ||
                        (!selected.includes(asset.id) && selected.length >= 25)
                      }
                      onChange={(checked) => {
                        setSelected(
                          checked
                            ? [...selected, asset.id]
                            : selected.filter((id) => id !== asset.id),
                        );
                      }}
                    >
                      {asset.titles.join(", ") || "Unresolved coverage"}
                      <br />
                      <small>
                        {phrase(asset.state)}
                        {asset.reasons.length > 0
                          ? `. Cannot be selected: ${asset.reasons.map((reason) => phrase(reason).toLowerCase()).join("; ")}`
                          : ""}
                      </small>
                    </PickBox>
                  ))}
              </PickList>
            )}
            <CursorButtons
              hasPrevious={cursor !== null}
              next={data.nextCursor}
              nextLabel="Next files"
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
                {prepare.isPending ? "Preparing…" : "Prepare exact file review"}
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
                    "reload the prepared reviews to see whether it is listed",
                }}
                action={
                  <Button
                    onClick={() => {
                      prepare.reset();
                      void inventory.refetch();
                    }}
                  >
                    Reload the prepared reviews
                  </Button>
                }
              />
            )}
          </Panel>
          <Panel
            id="reviews"
            title="2. Prepared reviews"
            description={
              <p>Open a review to read what it proves and to approve it.</p>
            }
          >
            {data.plans.length === 0 ? (
              <EmptyNote>No file review has been prepared yet.</EmptyNote>
            ) : (
              <DataList label="Prepared reviews">
                {data.plans.map((plan) => (
                  <DataRow
                    key={plan.id}
                    title={`Review prepared ${when(plan.createdAt)}`}
                    status={
                      <Badge>
                        {REVIEW_STATE[reviewState(plan.state)].label}
                      </Badge>
                    }
                    actions={
                      <ButtonLink to={`/manage/recovery/native/${plan.id}`}>
                        Open review
                      </ButtonLink>
                    }
                  />
                ))}
              </DataList>
            )}
          </Panel>
        </>
      )}
    </>
  );
}
