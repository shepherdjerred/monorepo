import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { MigrationDiscoveryResultSchema } from "#shared/migration-catalog.ts";
import type { MigrationProposalSchema } from "#shared/migration.ts";
import type { z } from "zod";
import { writeApi, queryClient } from "./api.ts";
import { ErrorNotice } from "./components.tsx";

export function MigrationDiscovery({
  proposal,
  actorId,
}: {
  proposal: z.infer<typeof MigrationProposalSchema>;
  actorId: string;
}) {
  const [cursor, setCursor] = useState(0);
  const discovery = useMutation({
    mutationFn: async () =>
      writeApi({
        actorId,
        path: `/admin/migration/captures/${proposal.captureId}/discover`,
        body: { captureHash: proposal.captureHash, cursor },
        schema: MigrationDiscoveryResultSchema,
      }),
    onSuccess: async (result) => {
      setCursor(result.nextCursor ?? 0);
      await queryClient.invalidateQueries({ queryKey: ["migration"] });
    },
  });
  if (
    !proposal.report.complete ||
    !proposal.report.stable ||
    !["radarr", "sonarr"].includes(proposal.source.kind)
  )
    return null;
  return (
    <section className="panel">
      <h3>Discover catalog identities</h3>
      <p>
        Resolve up to ten exact source identities per step. This adds catalog
        metadata only. Series wait for canonical episode projection; no requests
        or file ownership are imported. Regenerate the combined report after
        discovery finishes.
      </p>
      <button
        className="button"
        disabled={discovery.isPending}
        onClick={() => {
          discovery.mutate();
        }}
      >
        {discovery.isPending
          ? "Resolving identities…"
          : cursor > 0
            ? "Continue catalog discovery"
            : "Discover catalog identities"}
      </button>
      {discovery.error !== null && <ErrorNotice error={discovery.error} />}
      {discovery.data !== undefined && (
        <>
          <p role="status">
            {discovery.data.nextCursor === null
              ? "Capture page complete; pending series can be checked again."
              : "More identities remain. Continue with the next page."}
          </p>
          <ul>
            {discovery.data.entries.map((entry) => (
              <li key={entry.sourceId}>
                Source {entry.sourceId}: {entry.status.replaceAll("_", " ")}
                {entry.reason === null
                  ? ""
                  : ` — ${entry.reason.replaceAll("_", " ")}`}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
