import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { ChevronRightIcon } from "lucide-react";
import { CommandResultSchema, type SaveQualityProfile } from "#shared/api.ts";
import { queryClient, writeApi } from "#client/api.ts";
import { useUser } from "#client/shell/user.ts";
import { classNames } from "#client/ui/class-names.ts";
import { Badge, Callout } from "#client/ui/feedback.tsx";
import {
  FieldGroup,
  InlineSelect,
  SelectField,
  TextAreaField,
  TextField,
} from "#client/ui/field.tsx";
import { Form, FormFooter } from "#client/ui/form.tsx";
import { ListEditor } from "#client/ui/list-editor.tsx";
import {
  SIZE_UNITS,
  buildProfile,
  type ProfileFormState,
  type SizeUnit,
} from "./profile-model.ts";
import { ScoreRows } from "./score-rows.tsx";
import {
  CODEC_SUGGESTIONS,
  LANGUAGE_SUGGESTIONS,
  QUALITY_SUGGESTIONS,
  TRAITS,
} from "./vocabulary.ts";
import styles from "./quality.module.css";

const cx = classNames(styles);

const UNIT_NAMES: Readonly<Record<SizeUnit, string>> = {
  MiB: "MiB",
  GiB: "GiB",
  B: "bytes",
};

function unitFrom(value: string): SizeUnit {
  const unit = SIZE_UNITS.find((item) => item === value);
  if (unit === undefined) throw new Error(`${value} is not a size unit`);
  return unit;
}

/** A file size: a number and the unit it is in. */
function SizeField({
  label,
  description,
  name,
  size,
  onChange,
}: {
  label: string;
  description: string;
  name: string;
  size: ProfileFormState["minimumSize"];
  onChange: (size: ProfileFormState["minimumSize"]) => void;
}) {
  return (
    <TextField
      label={label}
      description={description}
      name={name}
      type="number"
      min="0"
      step="any"
      required
      requiredMessage="Enter a size."
      value={size.value}
      onChange={(event) => {
        onChange({ ...size, value: event.target.value });
      }}
      width="full"
      after={
        <InlineSelect
          label={`Unit of the ${label.toLowerCase()}`}
          value={size.unit}
          onChange={(event) => {
            onChange({ ...size, unit: unitFrom(event.target.value) });
          }}
        >
          {SIZE_UNITS.map((unit) => (
            <option key={unit} value={unit}>
              {UNIT_NAMES[unit]}
            </option>
          ))}
        </InlineSelect>
      }
    />
  );
}

/** A request body, and the form state it was built from. */
type Submission = { body: SaveQualityProfile; from: ProfileFormState };

/**
 * The form for one quality profile, new or existing. Every part of the rules
 * has its own control; the one exception is a profile captured from Radarr
 * or Sonarr, which is a snapshot edited as a whole.
 */
export function ProfileForm({
  headingId,
  identity,
  initial,
  saved,
  onSaved,
  onEdit,
}: {
  /** The id of the heading that names this form. */
  headingId: string;
  /** The profile being changed, or `null` for a new one. */
  identity: { id: string; version: number } | null;
  initial: ProfileFormState;
  saved: string | null;
  onSaved: (message: string) => void;
  onEdit: () => void;
}) {
  const user = useUser();
  const [state, setState] = useState(initial);
  // What the server holds: what was loaded, then whatever was last saved.
  const [stored, setStored] = useState(initial);
  const dirty = JSON.stringify(state) !== JSON.stringify(stored);
  function set(patch: Partial<ProfileFormState>) {
    if (!dirty) onEdit();
    setState((current) => ({ ...current, ...patch }));
  }
  function build() {
    return buildProfile(state, {
      ...(identity === null ? {} : { id: identity.id }),
      expectedVersion: identity?.version ?? 0,
    });
  }
  const save = useMutation({
    mutationFn: async ({ body }: Submission) =>
      writeApi({
        actorId: user.id,
        path: "/admin/profiles",
        body,
        schema: CommandResultSchema,
      }),
    onSuccess: async (result, { body, from }) => {
      setStored(from);
      onSaved(
        result.version === undefined
          ? `${body.name} saved.`
          : `${body.name} saved as version ${String(result.version)}.`,
      );
      return queryClient.invalidateQueries({ queryKey: ["profiles"] });
    },
  });
  // The cutoff has to be one of the listed qualities. When it stops being
  // one, the choice is shown as unmade rather than moved to another quality.
  const cutoffListed = state.qualities.includes(state.cutoffQuality);
  return (
    <Form
      labelledBy={headingId}
      dirty={dirty}
      validate={() => {
        const built = build();
        return built.ok ? {} : built.problems;
      }}
      onSubmit={() => {
        const built = build();
        if (built.ok) save.mutate({ body: built.body, from: state });
      }}
    >
      <TextField
        label="Name"
        name="name"
        required
        requiredMessage="Give the profile a name."
        maxLength={100}
        autoComplete="off"
        value={state.name}
        onChange={(event) => {
          set({ name: event.target.value });
        }}
        width="medium"
      />
      <FieldGroup
        legend="Which releases are good enough"
        description="A release is turned down if its quality is not listed, its file is outside the size range, or its score is too low."
      >
        <ListEditor
          legend="Qualities, most wanted first"
          description="Only these are accepted. Between two releases, Media takes the one higher up."
          name="qualities"
          ordered
          items={state.qualities}
          onChange={(qualities) => {
            set({ qualities });
          }}
          suggestions={QUALITY_SUGGESTIONS}
          addLabel="Add a quality"
          otherLabel="Quality name"
          empty="No qualities yet. A profile needs at least one."
          note={(quality) =>
            quality === state.cutoffQuality && (
              <Badge tone="ok">Upgrades stop here</Badge>
            )
          }
        />
        <SizeField
          label="Smallest file"
          description="Anything smaller is turned down."
          name="minimumSize"
          size={state.minimumSize}
          onChange={(minimumSize) => {
            set({ minimumSize });
          }}
        />
        <SizeField
          label="Largest file"
          description="Anything larger is turned down."
          name="maximumSize"
          size={state.maximumSize}
          onChange={(maximumSize) => {
            set({ maximumSize });
          }}
        />
        <TextField
          label="Lowest score to accept"
          description="A release scoring below this is turned down. Scores come from the list further down."
          name="minimumScore"
          type="number"
          step="any"
          required
          requiredMessage="Enter a score. Use 0 to accept any."
          unit="points"
          value={state.minimumScore}
          onChange={(event) => {
            set({ minimumScore: event.target.value });
          }}
        />
        <ListEditor
          legend="Codecs to turn down"
          description="A release in one of these video codecs is never taken."
          name="rejectedCodecs"
          items={state.rejectedCodecs}
          onChange={(rejectedCodecs) => {
            set({ rejectedCodecs });
          }}
          suggestions={CODEC_SUGGESTIONS}
          addLabel="Add a codec"
          otherLabel="Codec name"
          empty="No codec is turned down."
        />
        <ListEditor
          legend="Audio languages a release must have"
          description="A release missing any of these is turned down."
          name="requiredAudioLanguages"
          items={state.requiredAudioLanguages}
          onChange={(requiredAudioLanguages) => {
            set({ requiredAudioLanguages });
          }}
          suggestions={LANGUAGE_SUGGESTIONS}
          addLabel="Add a language"
          otherLabel="Language code"
          empty="No language is required."
        />
      </FieldGroup>
      <FieldGroup
        legend="When to stop upgrading"
        description="Media keeps looking for a better copy of a title until the one it has reaches both of these."
      >
        <SelectField
          label="Quality to stop at"
          name="cutoffQuality"
          required
          requiredMessage="Choose one of the qualities listed above."
          value={cutoffListed ? state.cutoffQuality : ""}
          onChange={(event) => {
            set({ cutoffQuality: event.target.value });
          }}
          width="medium"
        >
          <option value="" disabled>
            Choose a quality
          </option>
          {state.qualities.map((quality) => (
            <option key={quality} value={quality}>
              {quality}
            </option>
          ))}
        </SelectField>
        <TextField
          label="Score to stop at"
          name="cutoffScore"
          type="number"
          step="any"
          required
          requiredMessage="Enter a score. Use 0 to stop on quality alone."
          unit="points"
          value={state.cutoffScore}
          onChange={(event) => {
            set({ cutoffScore: event.target.value });
          }}
        />
      </FieldGroup>
      <ScoreRows
        legend="Scores"
        description={
          <>
            Points a release gains or loses for a trait in its name. Media reads
            these traits: {TRAITS.join(", ")}, and <code>group:NAME</code> for a
            release group. A negative score counts against a release.
          </>
        }
        prefix="tagScores"
        rows={state.tagScores}
        onChange={(tagScores) => {
          set({ tagScores });
        }}
        keyLabel="Trait"
        addLabel="Add a score"
        empty="No trait changes a release’s score."
      />
      <details className={cx("advanced")}>
        <summary>
          <ChevronRightIcon aria-hidden="true" />
          Advanced: a profile captured from Radarr or Sonarr
        </summary>
        <div className={cx("advancedBody")}>
          {state.resolved.trim() !== "" && (
            <Callout tone="warn">
              While this profile carries a captured one, Media judges releases
              by the captured profile’s qualities, formats, and scores, not by
              the rules above.
            </Callout>
          )}
          <TextAreaField
            label="Captured profile (JSON)"
            description="A snapshot taken from the source application, hashed as a whole and holding that application’s own custom-format data, so it is edited as JSON. It is checked against the snapshot’s shape before saving. Leave it empty for a profile that only uses the rules above."
            optional
            name="resolved"
            code
            rows={12}
            spellCheck={false}
            autoCapitalize="none"
            value={state.resolved}
            onChange={(event) => {
              set({ resolved: event.target.value });
            }}
          />
        </div>
      </details>
      <FormFooter
        submitLabel={identity === null ? "Create profile" : "Save new version"}
        pendingLabel="Saving…"
        pending={save.isPending}
        saved={saved}
        error={save.error}
        note={
          identity === null
            ? "A new profile starts at version 1."
            : "Every title using this profile is checked again. The version before is kept."
        }
      />
    </Form>
  );
}
