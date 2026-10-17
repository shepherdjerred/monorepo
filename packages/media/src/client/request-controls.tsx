import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { z } from "zod";
import { CommandResultSchema } from "#shared/api.ts";
import { LanguageSchema } from "#shared/contract.ts";
import type { MediaUser } from "#shared/contract.ts";
import { queryClient, writeApi } from "./api.ts";
import { ErrorNotice, Notice } from "./components.tsx";

export function RequestTitle({
  user,
  mediaId,
  kind,
}: {
  user: MediaUser;
  mediaId: string;
  kind: string;
}) {
  const [languages, setLanguages] = useState("en");
  const [future, setFuture] = useState(kind === "series");
  const [specials, setSpecials] = useState(false);
  const request = useMutation({
    mutationFn: async () => {
      const subtitleLanguages = z
        .array(LanguageSchema)
        .max(20)
        .parse(
          languages
            .split(",")
            .map((language) => language.trim())
            .filter((language) => language.length > 0),
        );
      return writeApi({
        actorId: user.id,
        path: "/requests",
        body: {
          mediaId,
          subtitleLanguages,
          includeFutureEpisodes: future,
          includeSpecials: specials,
        },
        schema: CommandResultSchema,
      });
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["media", mediaId] }),
        queryClient.invalidateQueries({ queryKey: ["requests"] }),
      ]);
    },
  });
  return (
    <form
      className="stack-form"
      onSubmit={(event) => {
        event.preventDefault();
        request.mutate();
      }}
    >
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
        disabled={request.isPending || user.restricted}
      >
        {request.isPending ? "Requesting…" : "Request this title"}
      </button>
      {request.error !== null && <ErrorNotice error={request.error} />}
      {request.isSuccess && <Notice>Request added.</Notice>}
    </form>
  );
}
