import { useId } from "react";
import { useQuery } from "@tanstack/react-query";
import type { MediaUser } from "#shared/contract.ts";
import { PlexProfilesSchema } from "#shared/plex-admin.ts";
import { readApi } from "#client/api.ts";
import { Choice, Note, Options, Problem, Question, Tick } from "./controls.tsx";
import type { KeepingChoice, SheetSubject, SheetValues } from "./form.ts";

/** Who the request is for. Only the owner asks on behalf of a managed profile. */
export function ForWhom({
  user,
  value,
  disabled,
  onChange,
}: {
  user: MediaUser;
  value: string;
  disabled: boolean;
  onChange: (userId: string) => void;
}) {
  const profiles = useQuery({
    queryKey: ["plex-profiles"],
    queryFn: async () => readApi("/admin/plex/profiles", PlexProfilesSchema),
    enabled: user.role === "owner",
  });
  if (user.role !== "owner") return null;
  return (
    <>
      <Choice
        label="Who is it for"
        value={value}
        disabled={disabled}
        autoFocus
        onChange={onChange}
      >
        <option value={user.id}>Me</option>
        {profiles.data?.mappings
          .filter((profile) => profile.kind === "managed")
          .map((profile) => (
            <option key={profile.userId} value={profile.userId}>
              {profile.displayName}
            </option>
          ))}
      </Choice>
      {profiles.error !== null && (
        <Problem>
          The household’s profiles did not load, so this request can only be for
          you. {profiles.error.message}
        </Problem>
      )}
    </>
  );
}

/** How long the library keeps the title once nobody follows it. */
export function Keeping({
  user,
  value,
  disabled,
  onChange,
}: {
  user: MediaUser;
  value: KeepingChoice;
  disabled: boolean;
  onChange: (value: "keep" | "temporary") => void;
}) {
  const name = useId();
  if (user.role !== "owner") {
    return (
      <Note>
        It stays in the library while you follow it. Media asks you before it
        goes.
      </Note>
    );
  }
  return (
    <Options
      legend="How long to keep it"
      name={name}
      value={value}
      disabled={disabled}
      options={[
        {
          value: "keep",
          label: "Keep for good",
          detail: "It stays in the library even when nobody follows it.",
        },
        {
          value: "temporary",
          label: "Just for now",
          detail: "It stays while someone follows it, then leaves.",
        },
      ]}
      onChange={onChange}
    />
  );
}

/** Which seasons of a series to get, when it is not all of them. */
export function Seasons({
  subject,
  values,
  disabled,
  autoFocus,
  change,
}: {
  subject: Extract<SheetSubject, { kind: "series" }>;
  values: SheetValues;
  disabled: boolean;
  autoFocus: boolean;
  change: (patch: Partial<SheetValues>) => void;
}) {
  const name = useId();
  if (subject.seasons.length === 0) return null;
  return (
    <>
      <Options
        legend="What to get"
        name={name}
        value={values.scope}
        disabled={disabled}
        autoFocus={autoFocus}
        options={[
          {
            value: "series",
            label: "The whole series",
            detail: "Every season there is.",
          },
          {
            value: "seasons",
            label: "Only some seasons",
            detail: "Choose them below.",
          },
        ]}
        onChange={(scope) => {
          change({ scope });
        }}
      />
      {values.scope === "seasons" && (
        <Question legend="Seasons">
          {subject.seasons.map((season) => (
            <Tick
              key={season.seasonNumber}
              label={
                season.episodeCount === null
                  ? season.title
                  : `${season.title}, ${String(season.episodeCount)} episodes`
              }
              checked={values.seasons.includes(season.seasonNumber)}
              disabled={disabled}
              onChange={(checked) => {
                change({
                  seasons: checked
                    ? [...values.seasons, season.seasonNumber]
                    : values.seasons.filter(
                        (chosen) => chosen !== season.seasonNumber,
                      ),
                });
              }}
            />
          ))}
        </Question>
      )}
    </>
  );
}

/** Whether a whole series also brings its future episodes and its specials. */
export function Episodes({
  values,
  disabled,
  change,
}: {
  values: SheetValues;
  disabled: boolean;
  change: (patch: Partial<SheetValues>) => void;
}) {
  return (
    <Question legend="Episodes">
      <Tick
        label="Get new episodes as they air"
        checked={values.future}
        disabled={disabled}
        onChange={(future) => {
          change({ future });
        }}
      />
      <Tick
        label="Include specials"
        checked={values.specials}
        disabled={disabled}
        onChange={(specials) => {
          change({ specials });
        }}
      />
    </Question>
  );
}
