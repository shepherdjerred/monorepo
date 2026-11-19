import { useRef, useState } from "react";
import "./styles.css";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ApiError, queryClient, readApi, writeApi } from "#client/api.ts";
import type { MediaUser } from "#shared/contract.ts";
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
import { CommandResultSchema, ProfileDefaultsSchema } from "#shared/api.ts";
import {
  dateLabel,
  ErrorNotice,
  Loading,
  Notice,
} from "#client/components.tsx";

export function QualityGuideAdministration({ user }: { user: MediaUser }) {
  const profiles = useQuery({
    queryKey: ["quality-guide"],
    queryFn: () => readApi("/admin/quality-guide", QualityGuideStatusSchema),
  });
  const defaults = useQuery({
    queryKey: ["profile-defaults"],
    queryFn: () => readApi("/profile-defaults", ProfileDefaultsSchema),
  });
  const [kind, setKind] = useState<QualityGuideKind>("movie");
  const [profileId, setProfileId] = useState<string | null>(null);
  const [overrides, setOverrides] = useState("{}");
  const pending = useRef<QualityGuideApply | null>(null);
  const preview = useMutation({
    mutationFn: async () =>
      writeApi({
        actorId: user.id,
        path: "/admin/quality-guide/preview",
        body: {
          kind,
          scoreOverrides: GuideOverridesSchema.parse(JSON.parse(overrides)),
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
  const locked =
    preview.isPending || apply.isPending || pending.current !== null;
  function resetReview() {
    preview.reset();
    apply.reset();
  }
  return (
    <section className="panel" id="quality-guide">
      <h2 id="quality-guide-heading">Living-room quality</h2>
      <p>
        Samsung QN90B · Apple TV 4K with Infuse · Sonos Arc. Prefer HDR10/HDR10+
        and DD+ Atmos; lossless audio stays neutral. Foreign titles keep their
        original audio and need English captions.
      </p>
      <p className="muted">
        Selected TRaSH rules update daily. Invalid updates keep the previous
        profile. Current downloads finish under their original version before an
        update applies.
      </p>
      {profiles.isPending && <Loading />}
      {profiles.error !== null && <ErrorNotice error={profiles.error} />}
      {defaults.error !== null && <ErrorNotice error={defaults.error} />}
      {profiles.data?.map((profile) => (
        <article className="list-row" key={profile.id}>
          <div>
            <strong>{profile.name}</strong>
            <p>
              Version {profile.version} ·{" "}
              {profile.lastSync === null
                ? "Not checked by the daily job yet"
                : `${profile.lastSync.status} · ${dateLabel(profile.lastSync.at)}`}
            </p>
            {profile.lastSync?.status === "failed" && (
              <p>
                The previous profile is still active. Review the guide update
                before retrying.
              </p>
            )}
            {profile.lastSync?.status === "deferred" && (
              <p>Waiting for the current download or profile edit to settle.</p>
            )}
          </div>
          <button
            className="button subtle"
            type="button"
            disabled={
              useDefault.isPending ||
              defaults.isPending ||
              defaults.error !== null ||
              defaults.data.some(
                (row) =>
                  row.kind === profile.kind && row.profileId === profile.id,
              )
            }
            onClick={() => {
              useDefault.mutate({ profileId: profile.id, kind: profile.kind });
            }}
          >
            {defaults.data?.some(
              (row) =>
                row.kind === profile.kind && row.profileId === profile.id,
            ) === true
              ? "Default for new requests"
              : `Use for new ${profile.kind === "movie" ? "movie" : "TV"} requests`}
          </button>
        </article>
      ))}
      {useDefault.error !== null && <ErrorNotice error={useDefault.error} />}
      <form
        className="stack-form"
        aria-labelledby="quality-guide-heading"
        method="post"
        action="/api/v1/admin/quality-guide/preview"
        onSubmit={(event) => {
          event.preventDefault();
          preview.mutate();
        }}
      >
        <fieldset disabled={locked}>
          <legend>Choose a profile to review</legend>
          {(["movie", "series"] as const).map((value) => (
            <label
              className="check-label"
              key={value}
              htmlFor={`quality-guide-${value}`}
            >
              <input
                id={`quality-guide-${value}`}
                type="radio"
                name="kind"
                value={value}
                checked={kind === value}
                onChange={() => {
                  setKind(GuideKindSchema.parse(value));
                  setProfileId(null);
                  setOverrides("{}");
                  resetReview();
                }}
              />
              {value === "movie" ? "Movies" : "TV"}
            </label>
          ))}
          <label htmlFor="quality-guide-profile">Update a profile</label>
          <select
            id="quality-guide-profile"
            name="profile"
            value={profileId ?? ""}
            onChange={(event) => {
              const selected = event.target.value;
              setProfileId(selected === "" ? null : selected);
              setOverrides(
                JSON.stringify(
                  profiles.data?.find((entry) => entry.id === selected)
                    ?.scoreOverrides ?? {},
                  null,
                  2,
                ),
              );
              resetReview();
            }}
          >
            <option value="">Create the living-room profile</option>
            {profiles.data
              ?.filter((entry) => entry.kind === kind)
              .map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name} · version {entry.version}
                </option>
              ))}
          </select>
          <details>
            <summary>Advanced score overrides</summary>
            <label htmlFor="quality-guide-overrides">
              Overrides by TRaSH format ID
            </label>
            <p id="quality-guide-overrides-help" className="helper">
              A JSON object of selected format IDs and integer scores. Overrides
              survive automatic guide updates. Use {"{}"} to use the household
              policy and guide scores.
            </p>
            <textarea
              id="quality-guide-overrides"
              name="overrides"
              rows={5}
              maxLength={20_000}
              spellCheck={false}
              autoCapitalize="none"
              aria-describedby="quality-guide-overrides-help"
              value={overrides}
              onChange={(event) => {
                setOverrides(event.target.value);
                resetReview();
              }}
            />
          </details>
        </fieldset>
        <button className="button" type="submit" disabled={locked}>
          {" "}
          {preview.isPending
            ? "Loading selected guide…"
            : "Preview current guide"}
        </button>
      </form>
      {preview.error !== null && <ErrorNotice error={preview.error} />}
      {preview.data !== undefined && (
        <div className="notice">
          <h3>{preview.data.name}</h3>
          <p>
            {preview.data.rules.resolved?.customFormats.length} selected formats
            · upgrades through {preview.data.rules.cutoffQuality}. Audio is
            inspected before publication; unknown listing language only permits
            a provisional download.
          </p>
          <button
            className="button"
            type="button"
            disabled={apply.isPending}
            onClick={() => {
              apply.mutate();
            }}
          >
            {apply.isPending
              ? "Applying…"
              : pending.current === null
                ? "Apply reviewed profile"
                : "Retry saved application"}
          </button>
        </div>
      )}
      {apply.error !== null && <ErrorNotice error={apply.error} />}
      {apply.isSuccess && (
        <Notice>
          Profile saved. Choose it as the default above for new requests;
          existing library files are preserved.
        </Notice>
      )}
    </section>
  );
}
