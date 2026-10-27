import {
  MovieEditionKeySchema,
  MOVIE_EDITION_REGISTRY,
} from "#shared/movie-editions/registry.ts";
import type { CutChoice } from "./prepare.ts";
import type { LibraryEntry, libraryProfileGroups } from "./selection.ts";

export function CutField({
  entry,
  choice,
  onChange,
}: {
  entry: LibraryEntry;
  choice: CutChoice;
  onChange: (choice: CutChoice) => void;
}) {
  return (
    <fieldset>
      <legend>
        Movie cut ·{" "}
        {entry.mappedMedia.map((item) => item.title ?? item.mediaId).join(", ")}
      </legend>
      <p>
        <code>
          {entry.sourceRecord.kind === "file"
            ? entry.sourceRecord.path
            : entry.sourceId}
        </code>
      </p>
      <label>
        Cut classification
        <select
          value={choice.edition}
          onChange={(event) => {
            const value = event.target.value;
            onChange({
              ...choice,
              edition:
                value === "suggest"
                  ? "suggest"
                  : MovieEditionKeySchema.parse(value),
            });
          }}
        >
          <option value="suggest">Suggest from filename for review</option>
          {MovieEditionKeySchema.options.map((key) => (
            <option key={key} value={key}>
              {MOVIE_EDITION_REGISTRY[key].displayLabel}
            </option>
          ))}
        </select>
      </label>
      {choice.edition !== "suggest" && (
        <label>
          Reason for this choice
          <input
            required
            minLength={8}
            maxLength={1000}
            value={choice.reason}
            onChange={(event) => {
              onChange({ ...choice, reason: event.target.value });
            }}
          />
        </label>
      )}
    </fieldset>
  );
}

export function ProfileFields({
  groups,
  choices,
  onChange,
}: {
  groups: ReturnType<typeof libraryProfileGroups>;
  choices: Readonly<Record<string, string>>;
  onChange: (key: string, value: string) => void;
}) {
  return groups.map((group) => (
    <label key={group.key}>
      {group.source} quality profile {group.sourceProfileId}
      <select
        required
        value={
          choices[group.key] ??
          (group.options.length === 1 ? group.options[0]?.profile.id : "")
        }
        onChange={(event) => {
          onChange(group.key, event.target.value);
        }}
      >
        <option value="">Choose an imported profile</option>
        {group.options.map(({ profile }) => (
          <option key={profile.id} value={profile.id}>
            {profile.name} · version {profile.version}
          </option>
        ))}
      </select>
      {group.options.length === 0 && (
        <span>
          Import this quality profile in Profiles before preparing these files.
        </span>
      )}
    </label>
  ));
}
