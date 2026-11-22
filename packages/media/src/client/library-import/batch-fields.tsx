import { Link } from "react-router";
import {
  MovieEditionKeySchema,
  MOVIE_EDITION_REGISTRY,
} from "#shared/movie-editions/registry.ts";
import { FieldGroup, SelectField, TextField } from "#client/ui/forms/field.tsx";
import { Code } from "#client/ui/workflow.tsx";
import type { CutChoice } from "./prepare.ts";
import type { LibraryEntry, libraryProfileGroups } from "./selection.ts";

function titles(entry: LibraryEntry): string {
  return entry.mappedMedia.map((item) => item.title ?? item.mediaId).join(", ");
}

/** How one movie file is classified: by its filename, or by the owner, with a reason. */
export function CutField({
  entry,
  choice,
  onChange,
}: {
  entry: LibraryEntry;
  choice: CutChoice;
  onChange: (choice: CutChoice) => void;
}) {
  const key = entry.provenanceKey;
  return (
    <FieldGroup
      legend={`Movie cut: ${titles(entry)}`}
      description={
        <Code>
          {entry.sourceRecord.kind === "file"
            ? entry.sourceRecord.path
            : entry.sourceId}
        </Code>
      }
    >
      <SelectField
        label="Cut classification"
        name={`cut-${key}`}
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
        {MovieEditionKeySchema.options.map((option) => (
          <option key={option} value={option}>
            {MOVIE_EDITION_REGISTRY[option].displayLabel}
          </option>
        ))}
      </SelectField>
      {choice.edition !== "suggest" && (
        <TextField
          label="Reason for this choice"
          description="At least 8 characters. It is kept with the plan."
          name={`reason-${key}`}
          required
          requiredMessage="Say why this is the right cut."
          minLength={8}
          maxLength={1000}
          value={choice.reason}
          onChange={(event) => {
            onChange({ ...choice, reason: event.target.value });
          }}
        />
      )}
    </FieldGroup>
  );
}

/** Which of Media's quality profiles stands in for each profile the source used. */
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
    <SelectField
      key={group.key}
      label={`${group.source} quality profile ${group.sourceProfileId}`}
      name={`profile-${group.key}`}
      required
      requiredMessage="Choose an imported quality profile."
      description={
        group.options.length === 0 ? (
          <>
            Import this quality profile in{" "}
            <Link to="/manage/quality">Quality</Link> before preparing these
            files.
          </>
        ) : undefined
      }
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
          {profile.name}, version {profile.version}
        </option>
      ))}
    </SelectField>
  ));
}
