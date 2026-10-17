import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { LanguageSchema } from "#shared/contract.ts";
import type { MediaUser } from "#shared/contract.ts";
import { readApi } from "./api.ts";
import { PlexProfilesSchema } from "#shared/plex-admin.ts";
import { ErrorNotice, Notice } from "./components.tsx";
import type { DefaultTargetView } from "#shared/editions/target-view.ts";
import { invalidateTarget } from "./target-controls/api.ts";
import { useTargetCommand } from "./target-controls/mutation.ts";
import { CommandError, commandNeedsReview } from "./target-controls/errors.tsx";

export function RequestTitle({
  user,
  context,
  kind,
}: {
  user: MediaUser;
  context: DefaultTargetView;
  kind: string;
}) {
  const [languages, setLanguages] = useState("en");
  const [future, setFuture] = useState(kind === "series");
  const [specials, setSpecials] = useState(false);
  const [requesterUserId, setRequesterUserId] = useState(user.id);
  const [validationError, setValidationError] = useState<Error | null>(null);
  const profiles = useQuery({
    queryKey: ["plex-profiles"],
    queryFn: async () => readApi("/admin/plex/profiles", PlexProfilesSchema),
    enabled: user.role === "owner",
  });
  const request = useTargetCommand(user.id);
  async function reviewLatest() {
    await invalidateTarget(context.scope.mediaId);
    request.reset();
  }
  function submit() {
    setValidationError(null);
    try {
      const subtitleLanguages = z
        .array(LanguageSchema)
        .max(20)
        .parse(
          languages
            .split(",")
            .map((language) => language.trim())
            .filter((language) => language.length > 0),
        );
      request.submit({
        context,
        command: {
          action: "request",
          subtitleLanguages,
          includeFutureEpisodes: future,
          includeSpecials: specials,
          ...(requesterUserId === user.id ? {} : { requesterUserId }),
        },
      });
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      setValidationError(error);
    }
  }
  return (
    <form
      className="stack-form"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      {user.role === "owner" && (
        <label>
          Request for
          <select
            value={requesterUserId}
            onChange={(event) => {
              setRequesterUserId(event.target.value);
            }}
          >
            <option value={user.id}>Myself</option>
            {profiles.data?.mappings
              .filter((profile) => profile.kind === "managed")
              .map((profile) => (
                <option key={profile.userId} value={profile.userId}>
                  {profile.displayName} — Home ID {profile.homeUserId}
                </option>
              ))}
          </select>
        </label>
      )}
      {profiles.error !== null && <ErrorNotice error={profiles.error} />}
      <label htmlFor="request-subtitles">Subtitle languages</label>
      <input
        id="request-subtitles"
        value={languages}
        onChange={(event) => {
          setLanguages(event.target.value);
        }}
        placeholder="en, zh-CN"
      />
      <p className="helper">
        Comma-separated codes; zh-CN requests Simplified Chinese.
      </p>
      {kind === "series" && (
        <>
          <label className="check-label">
            <input
              type="checkbox"
              checked={future}
              onChange={(event) => {
                setFuture(event.target.checked);
              }}
            />
            Include future episodes
          </label>
          <label className="check-label">
            <input
              type="checkbox"
              checked={specials}
              onChange={(event) => {
                setSpecials(event.target.checked);
              }}
            />
            Include specials
          </label>
        </>
      )}
      <button
        className="button primary"
        type="submit"
        disabled={
          request.isPending ||
          request.isSuccess ||
          user.restricted ||
          context.access !== "detail" ||
          commandNeedsReview(request.error)
        }
      >
        {request.isPending ? "Requesting…" : "Request this title"}
      </button>
      <CommandError
        error={request.error}
        review={() => {
          void reviewLatest();
        }}
      />
      {validationError !== null && <ErrorNotice error={validationError} />}
      {request.isSuccess && <Notice>Request added.</Notice>}
    </form>
  );
}
