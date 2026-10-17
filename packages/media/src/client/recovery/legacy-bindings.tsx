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
import { readApi, writeApi, queryClient } from "#client/api.ts";
import { ErrorNotice, Loading, Notice, humanize } from "#client/components.tsx";

type Inventory = z.infer<typeof LegacyRequesterListSchema>;
export function LegacyRequesterBindings({ user }: { user: MediaUser }) {
  const [parameters] = useSearchParams();
  const [captureId, setCaptureId] = useState(parameters.get("captureId") ?? "");
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
  const captureIds = [...new Set(captures.data?.map((item) => item.captureId))];
  return (
    <section className="panel stack-form">
      <h2>Associate legacy requesters</h2>
      <p>
        Map an exact source requester to a verified household identity. This
        records your identity association only; it creates no request and
        releases no recovery protection. Independent accounts must still declare
        for themselves.
      </p>
      <label>
        Uploaded source capture
        <select
          value={captureId}
          onChange={(event) => {
            setCaptureId(event.target.value);
          }}
        >
          <option value="">Choose a capture</option>
          {captureIds.map((id) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
        </select>
      </label>
      {captures.error !== null && <ErrorNotice error={captures.error} />}
      {captureId !== "" && inventory.isPending && <Loading />}
      {inventory.error !== null && <ErrorNotice error={inventory.error} />}
      {inventory.data !== undefined && (
        <>
          <p>
            Source: {humanize(inventory.data.sourceKind)} · instance{" "}
            {inventory.data.sourceInstanceId.slice(0, 12)}. Capture{" "}
            {inventory.data.captureHash.slice(0, 12)}.
          </p>
          {inventory.data.requesters.length === 0 && (
            <p>No source requesters in this capture.</p>
          )}
          {inventory.data.requesters.map((requester) => (
            <RequesterBinding
              key={`${requester.requesterSourceId}:${String(requester.latestRevision)}`}
              user={user}
              inventory={inventory.data}
              requester={requester}
            />
          ))}
        </>
      )}
    </section>
  );
}
function RequesterBinding({
  user,
  inventory,
  requester,
}: {
  user: MediaUser;
  inventory: Inventory;
  requester: Inventory["requesters"][number];
}) {
  const [target, setTarget] = useState(requester.binding?.userId ?? "");
  const [acknowledged, setAcknowledged] = useState(false);
  const mutation = useMutation({
    mutationFn: () =>
      writeApi({
        actorId: user.id,
        path: "/admin/legacy-requester-bindings",
        schema: CommandResultSchema,
        body: BindLegacyRequesterSchema.parse({
          captureId: inventory.captureId,
          requesterSourceId: requester.requesterSourceId,
          requesterEvidenceHash: requester.requesterEvidenceHash,
          userId: target,
          expectedRevision: requester.latestRevision,
          acknowledgeIdentityOnly: acknowledged,
        }),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["legacy-requester-bindings"],
      });
      await queryClient.invalidateQueries({ queryKey: ["recovery"] });
    },
  });
  const selected = inventory.targets.find((item) => item.userId === target);
  return (
    <article className="stack-form">
      <h3>Source requester {requester.requesterSourceId}</h3>
      <p>
        {requester.requestCount} captured requests ·{" "}
        {requester.binding === null
          ? "Unmapped"
          : `Owner-declared association, revision ${String(requester.binding.revision)}`}
      </p>
      <label>
        Exact household identity
        <select
          value={target}
          onChange={(event) => {
            setTarget(event.target.value);
            setAcknowledged(false);
          }}
        >
          <option value="">Choose an identity</option>
          {inventory.targets.map((person) => (
            <option
              key={person.userId}
              value={person.userId}
              disabled={!person.eligible}
            >
              {person.displayName} · {humanize(person.identity.kind)} · account{" "}
              {person.identity.plexAccountId}
              {person.eligible ? "" : " · requires access reconciliation"}
            </option>
          ))}
        </select>
      </label>
      {selected !== undefined && (
        <p>
          Server {selected.identity.serverMachineId} · Home ID{" "}
          {selected.identity.homeUserId ?? "none"} · server account{" "}
          {selected.identity.serverAccountId ?? "none"} · mapping version{" "}
          {selected.identity.version}.
        </p>
      )}
      <label className="check-label">
        <input
          type="checkbox"
          checked={acknowledged}
          onChange={(event) => {
            setAcknowledged(event.target.checked);
          }}
        />
        I verified this exact source requester and household identity. This
        association does not declare their current demand.
      </label>
      <button
        className="button"
        disabled={
          mutation.isPending || !acknowledged || selected?.eligible !== true
        }
        onClick={() => {
          mutation.mutate();
        }}
      >
        Save identity association
      </button>
      {mutation.error !== null && <ErrorNotice error={mutation.error} />}
      {mutation.isSuccess && (
        <Notice>
          Identity association recorded. Prepare a fresh household review for
          current declarations.
        </Notice>
      )}
    </article>
  );
}
