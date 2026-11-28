import { useMutation, useQuery } from "@tanstack/react-query";
import type { z } from "zod";
import { queryClient, readApi, writeApi } from "#client/api.ts";
import { dateLabel } from "#client/components.tsx";
import { useUser } from "#client/shell/user.ts";
import {
  QUALITY_GUIDE_VARIANTS,
  type QualityGuideKind,
  type QualityGuideVariant,
} from "#shared/quality-guide/contract.ts";
import type { QualityGuideStatusSchema } from "#shared/quality-guide/view.ts";
import { CommandResultSchema, ProfileDefaultsSchema } from "#shared/api.ts";
import { Button } from "#client/ui/button.tsx";
import { DataList, DataRow } from "#client/ui/data-list.tsx";
import { Badge, Callout, LoadError } from "#client/ui/feedback.tsx";
import { EmptyNote } from "#client/ui/panel.tsx";

export type GuideProfile = z.infer<typeof QualityGuideStatusSchema>[number];
type Sync = NonNullable<GuideProfile["lastSync"]>;

const KIND_NAMES: Readonly<Record<QualityGuideKind, string>> = {
  movie: "movie",
  series: "TV",
};

export function guideSizeTarget(variant: QualityGuideVariant): string {
  const target = QUALITY_GUIDE_VARIANTS[variant].sizeTargetMiBPerMinute;
  if (target === null) return "TRaSH size targets by runtime and quality.";
  const twoHoursGb = (target * 1024 * 1024 * 120) / 1_000_000_000;
  return `Size target ${String(target)} MiB/min, about ${twoHoursGb.toFixed(0)} GB for two hours.`;
}

const SYNC_BADGES: Readonly<
  Record<Sync["status"], { tone: "ok" | "warn" | "danger"; label: string }>
> = {
  updated: { tone: "ok", label: "Updated" },
  unchanged: { tone: "ok", label: "Up to date" },
  deferred: { tone: "warn", label: "Update waiting" },
  failed: { tone: "danger", label: "Update refused" },
};

function syncDetail(profile: GuideProfile): string {
  const sync = profile.lastSync;
  if (sync === null) return "The daily update has not checked it yet.";
  const checked = `Checked ${dateLabel(sync.at)}.`;
  if (sync.status === "failed") {
    return `${checked} The update was not valid, so the profile from before is still in use. Review the guide before trying again.`;
  }
  return sync.status === "deferred"
    ? `${checked} Waiting for a download or an edit of this profile to finish.`
    : checked;
}

/** The living-room profiles and which of them new requests use. */
export function GuideProfiles({
  profiles,
}: {
  profiles: readonly GuideProfile[];
}) {
  const user = useUser();
  const defaults = useQuery({
    queryKey: ["profile-defaults"],
    queryFn: () => readApi("/profile-defaults", ProfileDefaultsSchema),
  });
  const useDefault = useMutation({
    mutationFn: (input: { profileId: string; kind: QualityGuideKind }) => {
      const current = defaults.data?.find((row) => row.kind === input.kind);
      return writeApi({
        actorId: user.id,
        path: `/admin/profile-defaults/${input.kind}`,
        method: "PUT",
        body: {
          profileId: input.profileId,
          expectedVersion: current?.version ?? 0,
        },
        schema: CommandResultSchema,
      });
    },
    onSuccess: async () =>
      queryClient.invalidateQueries({ queryKey: ["profile-defaults"] }),
  });
  function isDefault(profile: GuideProfile): boolean {
    return (
      defaults.data?.some(
        (row) => row.kind === profile.kind && row.profileId === profile.id,
      ) === true
    );
  }
  if (profiles.length === 0) {
    return (
      <EmptyNote>
        No living-room profile exists yet. Preview the guide below to create
        one.
      </EmptyNote>
    );
  }
  return (
    <>
      {defaults.error !== null && (
        <LoadError
          what="The defaults for new requests"
          error={defaults.error}
          retry={() => {
            void defaults.refetch();
          }}
        />
      )}
      <DataList label="Living-room profiles">
        {profiles.map((profile) => (
          <DataRow
            key={profile.id}
            title={profile.name}
            detail={`${guideSizeTarget(profile.variant)} Version ${String(profile.version)}. ${syncDetail(profile)}`}
            status={
              <>
                {profile.lastSync !== null && (
                  <Badge tone={SYNC_BADGES[profile.lastSync.status].tone}>
                    {SYNC_BADGES[profile.lastSync.status].label}
                  </Badge>
                )}
                {isDefault(profile) && (
                  <Badge>
                    Default for new {KIND_NAMES[profile.kind]} requests
                  </Badge>
                )}
              </>
            }
            actions={
              !isDefault(profile) && (
                <Button
                  disabled={
                    useDefault.isPending ||
                    defaults.isPending ||
                    defaults.error !== null
                  }
                  onClick={() => {
                    useDefault.mutate({
                      profileId: profile.id,
                      kind: profile.kind,
                    });
                  }}
                >
                  Use for new {KIND_NAMES[profile.kind]} requests
                </Button>
              )
            }
          />
        ))}
      </DataList>
      {useDefault.error !== null && (
        <Callout tone="danger">
          The default was not changed. {useDefault.error.message}
        </Callout>
      )}
    </>
  );
}
