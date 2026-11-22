import { useId, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ApiError, queryClient, readApi, writeApi } from "#client/api.ts";
import { useUser } from "#client/shell/user.ts";
import {
  GuideKindSchema,
  GuideOverridesSchema,
  type QualityGuideApply,
  type QualityGuideKind,
} from "#shared/quality-guide/contract.ts";
import {
  QualityGuideApplyResultSchema,
  QualityGuidePreviewResultSchema,
  QualityGuideStatusSchema,
} from "#shared/quality-guide/view.ts";
import { Button } from "#client/ui/button.tsx";
import { classNames } from "#client/ui/class-names.ts";
import { Callout, LoadError } from "#client/ui/feedback.tsx";
import { ChoiceField, SelectField } from "#client/ui/forms/field.tsx";
import { Form } from "#client/ui/forms/form.tsx";
import { Panel, SkeletonRows } from "#client/ui/panel.tsx";
import { GuideProfiles } from "./guide-profiles.tsx";
import type { ScoreRow } from "./profile-model.ts";
import { ScoreRows } from "./score-rows.tsx";
import styles from "./quality.module.css";

const cx = classNames(styles);

function overrideRows(overrides: Readonly<Record<string, number>>): ScoreRow[] {
  return Object.entries(overrides).map(([key, score], index) => ({
    id: `loaded-${String(index)}`,
    key,
    score: String(score),
  }));
}

function formatCount(count: number | undefined): string {
  return count === undefined
    ? "The guide’s formats"
    : `${String(count)} formats from the guide`;
}

function overridesFrom(rows: readonly ScoreRow[]): unknown {
  return Object.fromEntries(rows.map((row) => [row.key, Number(row.score)]));
}

/** The living-room profiles, which follow the published quality guide. */
export function GuideSection() {
  const user = useUser();
  const formHeadingId = useId();
  const profiles = useQuery({
    queryKey: ["quality-guide"],
    queryFn: () => readApi("/admin/quality-guide", QualityGuideStatusSchema),
  });
  const [kind, setKind] = useState<QualityGuideKind>("movie");
  const [profileId, setProfileId] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<readonly ScoreRow[]>([]);
  const pending = useRef<QualityGuideApply | null>(null);
  const preview = useMutation({
    mutationFn: async () =>
      writeApi({
        actorId: user.id,
        path: "/admin/quality-guide/preview",
        body: {
          kind,
          scoreOverrides: GuideOverridesSchema.parse(overridesFrom(overrides)),
        },
        schema: QualityGuidePreviewResultSchema,
      }),
  });
  const apply = useMutation({
    mutationFn: async () => {
      if (pending.current === null) {
        if (preview.data === undefined)
          throw new Error("Preview the selected guide first.");
        if (preview.data.rules.managedGuide === undefined)
          throw new Error("The guide preview omitted its source contract.");
        const profile = profiles.data?.find((entry) => entry.id === profileId);
        if (profileId !== null && profile === undefined)
          throw new Error("Refresh the selected profile before applying.");
        pending.current = {
          kind: preview.data.kind,
          scoreOverrides: preview.data.rules.managedGuide.scoreOverrides,
          expectedRevision: preview.data.revision,
          expectedContentHash: preview.data.contentHash,
          profileId,
          expectedVersion: profile?.version ?? 0,
        };
      }
      return writeApi({
        actorId: user.id,
        path: "/admin/quality-guide/apply",
        body: pending.current,
        schema: QualityGuideApplyResultSchema,
      });
    },
    onSuccess: async () => {
      pending.current = null;
      preview.reset();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["quality-guide"] }),
        queryClient.invalidateQueries({ queryKey: ["profiles"] }),
      ]);
    },
    onError: (error) => {
      if (
        error instanceof ApiError &&
        error.status >= 400 &&
        error.status < 500
      )
        pending.current = null;
    },
  });
  const locked =
    preview.isPending || apply.isPending || pending.current !== null;
  function resetReview() {
    preview.reset();
    apply.reset();
  }
  return (
    <Panel
      id="quality-guide"
      title="Living-room guide"
      description={
        <>
          <p>
            Profiles tuned for the living room: a Samsung QN90B, an Apple TV 4K
            running Infuse, and a Sonos Arc. They prefer HDR10 and HDR10+ with
            Dolby Digital Plus Atmos, and count lossless audio as neither better
            nor worse. A title in another language keeps its original audio and
            needs English captions.
          </p>
          <p>
            The guide’s rules are refreshed every day. An update that is not
            valid is ignored and the profile from before stays. A download
            already under way finishes under the rules it started with.
          </p>
        </>
      }
    >
      {profiles.isPending && (
        <SkeletonRows label="Loading living-room profiles" rows={2} />
      )}
      {profiles.error !== null && (
        <LoadError
          what="Living-room profiles"
          error={profiles.error}
          retry={() => {
            void profiles.refetch();
          }}
        />
      )}
      {profiles.data !== undefined && (
        <GuideProfiles profiles={profiles.data} />
      )}
      <h3 id={formHeadingId}>Review the current guide</h3>
      <Form
        labelledBy={formHeadingId}
        validate={() => {
          const seen = new Set<string>();
          const problems: Record<string, string> = {};
          for (const row of overrides) {
            if (seen.has(row.key)) {
              problems[`overrides.${row.id}.key`] = "This is already listed.";
            }
            seen.add(row.key);
          }
          return problems;
        }}
        onSubmit={() => {
          preview.mutate();
        }}
      >
        <fieldset className={cx("plain")} disabled={locked}>
          <legend className="sr-only">What to review</legend>
          <ChoiceField
            legend="For"
            name="kind"
            value={kind}
            onChange={(value) => {
              setKind(GuideKindSchema.parse(value));
              setProfileId(null);
              setOverrides([]);
              resetReview();
            }}
            options={[
              { value: "movie", label: "Movies" },
              { value: "series", label: "TV" },
            ]}
          />
          <SelectField
            label="Profile to update"
            name="profile"
            value={profileId ?? ""}
            onChange={(event) => {
              const selected = event.target.value;
              setProfileId(selected === "" ? null : selected);
              setOverrides(
                overrideRows(
                  profiles.data?.find((entry) => entry.id === selected)
                    ?.scoreOverrides ?? {},
                ),
              );
              resetReview();
            }}
            width="medium"
          >
            <option value="">Create the living-room profile</option>
            {profiles.data
              ?.filter((entry) => entry.kind === kind)
              .map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name} (version {entry.version})
                </option>
              ))}
          </SelectField>
          <ScoreRows
            legend="Score overrides"
            description="Your own score for one of the guide’s formats, by its 32-character TRaSH format ID. An override stays in place through the daily updates. With none, the guide’s scores and the household’s rules apply."
            prefix="overrides"
            rows={overrides}
            onChange={(rows) => {
              setOverrides(rows);
              resetReview();
            }}
            keyLabel="TRaSH format ID"
            keyPattern="[a-f0-9]{32}"
            keyPatternMessage="Enter the 32 characters of the format ID: digits and the letters a to f."
            wholeScores
            scoreRange={{ min: -100_000, max: 100_000 }}
            addLabel="Add an override"
            empty="No overrides. The guide’s scores apply."
          />
        </fieldset>
        <div>
          <Button
            type="submit"
            variant="primary"
            busy={preview.isPending}
            disabled={locked}
          >
            {preview.isPending ? "Loading the guide…" : "Preview current guide"}
          </Button>
        </div>
      </Form>
      {preview.error !== null && (
        <Callout tone="danger">{preview.error.message}</Callout>
      )}
      {preview.data !== undefined && (
        <Callout
          title={preview.data.name}
          action={
            <Button
              variant="primary"
              busy={apply.isPending}
              onClick={() => {
                apply.mutate();
              }}
            >
              {apply.isPending
                ? "Applying…"
                : pending.current === null
                  ? "Apply reviewed profile"
                  : "Retry saved application"}
            </Button>
          }
        >
          {formatCount(preview.data.rules.resolved?.customFormats.length)},
          upgrading up to {preview.data.rules.cutoffQuality}. Audio is checked
          before a title is published. A release whose listing does not name its
          language is only downloaded provisionally.
        </Callout>
      )}
      {apply.error !== null && (
        <Callout tone="danger">{apply.error.message}</Callout>
      )}
      {apply.isSuccess && (
        <Callout tone="ok">
          Profile saved. To use it for new requests, make it the default in the
          list above. Files already in the library are left as they are.
        </Callout>
      )}
    </Panel>
  );
}
