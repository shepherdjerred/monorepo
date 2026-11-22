import { useId, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type { z } from "zod";
import { MigrationDiscoveryResultSchema } from "#shared/migration-catalog.ts";
import type { MigrationProposalSchema } from "#shared/migration.ts";
import { queryClient, writeApi } from "#client/api.ts";
import { Button } from "#client/ui/button.tsx";
import { Badge } from "#client/ui/feedback.tsx";
import { DataList, DataRow } from "#client/ui/data-list.tsx";
import { ActionFailure } from "#client/ui/workflow.tsx";
import { reasonLabel } from "./vocabulary.ts";
import { classNames } from "#client/ui/class-names.ts";
import styles from "./migration.module.css";

const cx = classNames(styles);

export const DISCOVERY_OUTCOME = {
  ready: { label: "Ready", tone: "ok" },
  catalog_pending: { label: "Waiting for the catalog", tone: "warn" },
  protected: { label: "Protected", tone: "warn" },
} satisfies Record<
  z.infer<typeof MigrationDiscoveryResultSchema>["entries"][number]["status"],
  { label: string; tone: "ok" | "warn" }
>;

/**
 * Optional, for a Radarr or Sonarr capture that is complete and stable: look
 * up the exact catalog identity of up to ten source records at a time. It
 * adds catalog metadata and nothing else.
 */
export function MigrationDiscovery({
  proposal,
  actorId,
}: {
  proposal: z.infer<typeof MigrationProposalSchema>;
  actorId: string;
}) {
  const titleId = useId();
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
  const result = discovery.data;
  return (
    <section className={cx("subsection")} aria-labelledby={titleId}>
      <h3 id={titleId}>Find catalog identities (optional)</h3>
      <p>
        Media looks up up to ten exact source identities per step. This adds
        catalog metadata only. Series wait for canonical episode projection. No
        requests or file ownership are imported. Regenerate the combined report
        in step 3 after discovery finishes.
      </p>
      <div>
        <Button
          busy={discovery.isPending}
          onClick={() => {
            discovery.mutate();
          }}
        >
          {discovery.isPending
            ? "Resolving identities…"
            : cursor > 0
              ? "Continue catalog discovery"
              : "Discover catalog identities"}
        </Button>
      </div>
      {discovery.error !== null && (
        <ActionFailure
          title="Catalog discovery did not finish this step"
          error={discovery.error}
          state="No identities were added by this step. Run it again to retry from the same place."
        />
      )}
      {result !== undefined && (
        <>
          <p role="status">
            {result.nextCursor === null
              ? "This capture is finished; pending series can be checked again."
              : "More identities remain. Continue with the next ten."}
          </p>
          <DataList label="Catalog discovery results">
            {result.entries.map((entry) => {
              const outcome = DISCOVERY_OUTCOME[entry.status];
              return (
                <DataRow
                  key={entry.sourceId}
                  title={`Source ${entry.sourceId}`}
                  detail={
                    entry.reason === null
                      ? undefined
                      : reasonLabel(entry.reason)
                  }
                  status={<Badge tone={outcome.tone}>{outcome.label}</Badge>}
                />
              );
            })}
          </DataList>
        </>
      )}
    </section>
  );
}
