import { useState } from "react";
import { useSearchParams } from "react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { z } from "zod";
import type { MediaUser } from "#shared/contract.ts";
import { CommandResultSchema } from "#shared/api.ts";
import { MigrationProposalListSchema } from "#shared/migration.ts";
import {
  LegacyRequesterListSchema,
  BindLegacyRequesterSchema,
} from "#shared/recovery-claims.ts";
import { dateLabel, humanize } from "#client/components.tsx";
import { queryClient, readApi, writeApi } from "#client/api.ts";
import { Badge, LoadError } from "#client/ui/feedback.tsx";
import { CheckboxField, SelectField } from "#client/ui/forms/field.tsx";
import { Form, FormFooter, useSavedNotes } from "#client/ui/forms/form.tsx";
import {
  Disclosure,
  DisclosureList,
  EmptyNote,
  Panel,
  SkeletonRows,
} from "#client/ui/panel.tsx";
import { Facts, Plain } from "./parts.tsx";

type Inventory = z.infer<typeof LegacyRequesterListSchema>;
type Requester = Inventory["requesters"][number];

/**
 * Matches each requester in an uploaded copy of the old system's data to the
 * household member they were. The match is an identity association only: it
 * creates no request and releases no protection.
 */
export function LegacyRequesterBindings({ user }: { user: MediaUser }) {
  const [parameters] = useSearchParams();
  const [captureId, setCaptureId] = useState(parameters.get("captureId") ?? "");
  const notes = useSavedNotes();
  const captures = useQuery({
    queryKey: ["migration"],
    queryFn: () => readApi("/admin/migration", MigrationProposalListSchema),
  });
  const inventory = useQuery({
    queryKey: ["legacy-requester-bindings", captureId],
    queryFn: () =>
      readApi(
        `/admin/legacy-requester-bindings?captureId=${encodeURIComponent(captureId)}`,
        LegacyRequesterListSchema,
      ),
    enabled: captureId !== "",
  });
  const uploaded = new Map(
    (captures.data ?? []).map((item) => [item.captureId, item]),
  );
  const unmatched =
    inventory.data?.requesters.filter((item) => item.binding === null) ?? [];
  // Requesters still to match come first, then the ones already matched.
  const ordered = [
    ...unmatched,
    ...(inventory.data?.requesters.filter((item) => item.binding !== null) ??
      []),
  ];
  return (
    <Panel
      title="Associate legacy requesters"
      description="The old system recorded who asked for each title. Match each of its requesters to the household member they were. A match records your identity association only: it creates no request and releases no recovery protection. Independent accounts must still declare for themselves."
    >
      {captures.isPending && (
        <SkeletonRows label="Loading uploaded captures" rows={1} />
      )}
      {captures.error !== null && (
        <LoadError
          what="Uploaded captures"
          error={captures.error}
          retry={() => {
            void captures.refetch();
          }}
        />
      )}
      {captures.data?.length === 0 && (
        <EmptyNote>
          No source capture has been uploaded. Upload one from Migration, then
          come back to match its requesters.
        </EmptyNote>
      )}
      {captures.data !== undefined && captures.data.length > 0 && (
        <SelectField
          label="Uploaded source capture"
          description="A capture is a copy of the old system's data that you uploaded in Migration."
          value={captureId}
          onChange={(event) => {
            setCaptureId(event.target.value);
          }}
        >
          <option value="">Choose a capture</option>
          {[...uploaded].map(([id, item]) => (
            <option key={id} value={id}>
              {humanize(item.source.kind)} {item.source.version}, uploaded{" "}
              {dateLabel(item.createdAt)}
            </option>
          ))}
        </SelectField>
      )}
      {captureId !== "" && inventory.isPending && (
        <SkeletonRows label="Loading requesters" rows={3} />
      )}
      {inventory.error !== null && (
        <LoadError
          what="Requesters"
          error={inventory.error}
          retry={() => {
            void inventory.refetch();
          }}
        />
      )}
      {inventory.data !== undefined && (
        <>
          <Plain>
            Source: {humanize(inventory.data.sourceKind)}, instance{" "}
            {inventory.data.sourceInstanceId.slice(0, 12)}. Capture{" "}
            {inventory.data.captureHash.slice(0, 12)}.
          </Plain>
          {inventory.data.requesters.length === 0 && (
            <EmptyNote>No source requesters in this capture.</EmptyNote>
          )}
          {inventory.data.requesters.length > 0 && (
            <>
              <Plain>
                {unmatched.length === 0
                  ? `All ${String(inventory.data.requesters.length)} requesters are matched.`
                  : `${String(unmatched.length)} of ${String(inventory.data.requesters.length)} requesters are not matched yet.`}
              </Plain>
              <DisclosureList>
                {ordered.map((requester) => (
                  <RequesterRow
                    key={`${requester.requesterSourceId}:${String(requester.latestRevision)}`}
                    user={user}
                    inventory={inventory.data}
                    requester={requester}
                    saved={notes.note(requester.requesterSourceId)}
                    onSaved={(message) => {
                      notes.saved(requester.requesterSourceId, message);
                    }}
                    onEdited={() => {
                      notes.edited(requester.requesterSourceId);
                    }}
                  />
                ))}
              </DisclosureList>
            </>
          )}
        </>
      )}
    </Panel>
  );
}

function RequesterRow({
  user,
  inventory,
  requester,
  saved,
  onSaved,
  onEdited,
}: {
  user: MediaUser;
  inventory: Inventory;
  requester: Requester;
  saved: string | null;
  onSaved: (message: string) => void;
  onEdited: () => void;
}) {
  const [target, setTarget] = useState(requester.binding?.userId ?? "");
  const mutation = useMutation({
    mutationFn: (userId: string) =>
      writeApi({
        actorId: user.id,
        path: "/admin/legacy-requester-bindings",
        schema: CommandResultSchema,
        body: BindLegacyRequesterSchema.parse({
          captureId: inventory.captureId,
          requesterSourceId: requester.requesterSourceId,
          requesterEvidenceHash: requester.requesterEvidenceHash,
          userId,
          expectedRevision: requester.latestRevision,
          acknowledgeIdentityOnly: true,
        }),
      }),
    // Saved here, not where the form submits: the list reloads and mounts a
    // new row for the new revision, and this one is gone by then.
    onSuccess: async () => {
      onSaved(
        "Identity association recorded. Prepare a fresh household review for current declarations.",
      );
      await queryClient.invalidateQueries({
        queryKey: ["legacy-requester-bindings"],
      });
      await queryClient.invalidateQueries({ queryKey: ["recovery"] });
    },
  });
  const selected = inventory.targets.find((item) => item.userId === target);
  const matchedTo = inventory.targets.find(
    (item) => item.userId === requester.binding?.userId,
  );
  const headingId = `requester-${requester.requesterSourceId}`;
  return (
    <Disclosure
      title={`Source requester ${requester.requesterSourceId}`}
      titleId={headingId}
      meta={
        <>
          <span>
            {requester.requestCount} captured{" "}
            {requester.requestCount === 1 ? "request" : "requests"}
          </span>
          {requester.binding === null ? (
            <Badge tone="warn">Not matched yet</Badge>
          ) : (
            <Badge tone="ok">
              Matched to {matchedTo?.displayName ?? "a household member"}
            </Badge>
          )}
        </>
      }
    >
      <Form
        labelledBy={headingId}
        onEdit={onEdited}
        validate={() =>
          selected !== undefined && !selected.eligible
            ? {
                identity:
                  "This identity needs its Plex access reconciled before a requester can be matched to it.",
              }
            : {}
        }
        onSubmit={() => {
          mutation.mutate(target);
        }}
      >
        <Plain>
          {requester.binding === null
            ? "Nobody is matched to this requester."
            : `Owner-declared association, revision ${String(requester.binding.revision)}. Saving a different member records a new revision.`}
        </Plain>
        <SelectField
          label="Exact household identity"
          name="identity"
          required
          requiredMessage="Choose the household identity this requester was."
          value={target}
          onChange={(event) => {
            setTarget(event.target.value);
          }}
        >
          <option value="">Choose an identity</option>
          {inventory.targets.map((person) => (
            <option
              key={person.userId}
              value={person.userId}
              disabled={!person.eligible}
            >
              {person.displayName}, {humanize(person.identity.kind)}, account{" "}
              {person.identity.plexAccountId}
              {person.eligible ? "" : " (requires access reconciliation)"}
            </option>
          ))}
        </SelectField>
        {selected !== undefined && (
          <Facts
            mono={false}
            rows={[
              ["Server", selected.identity.serverMachineId],
              ["Home ID", selected.identity.homeUserId ?? "none"],
              ["Server account", selected.identity.serverAccountId ?? "none"],
              ["Mapping version", String(selected.identity.version)],
            ]}
          />
        )}
        <CheckboxField
          name="verified"
          required
          requiredMessage="Confirm you verified this requester and identity."
          label="I verified this exact source requester and household identity. This association does not declare their current demand."
        />
        <FormFooter
          submitLabel="Save identity association"
          pendingLabel="Saving association"
          pending={mutation.isPending}
          error={mutation.error}
          saved={saved}
          note="Saving records the association and nothing else: no request is created and no recovery protection is released."
        />
      </Form>
    </Disclosure>
  );
}
