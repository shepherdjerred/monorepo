import {
  CompetitionVisibilitySchema,
  visibilityDescription,
  visibilityToString,
} from "@scout-for-lol/data";
import { Input, Textarea } from "@scout-for-lol/design-system/components/input";
import { Label } from "@scout-for-lol/design-system/components/label";
import {
  BuilderFieldError,
  builderErrorAttributes,
} from "#src/components/builder-field-error.tsx";
import type { CompetitionBuilderState } from "#src/lib/competition-builder-state.ts";

export function CompetitionBuilderBasics(props: {
  state: CompetitionBuilderState;
  channels: { id: string; name: string }[];
  onChange: (changes: Partial<CompetitionBuilderState>) => void;
  errors: Record<
    "title" | "description" | "channelId" | "maxParticipants" | "visibility",
    string | undefined
  >;
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="competition-title">Title</Label>
        <Input
          id="competition-title"
          name="title"
          autoComplete="off"
          maxLength={100}
          value={props.state.title}
          {...builderErrorAttributes(
            props.errors.title,
            "competition-title-error",
          )}
          onChange={(event) => {
            props.onChange({ title: event.target.value });
          }}
          required
        />
        <BuilderFieldError
          id="competition-title-error"
          error={props.errors.title}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="competition-description">Description</Label>
        <Textarea
          id="competition-description"
          name="description"
          autoComplete="off"
          maxLength={500}
          value={props.state.description}
          {...builderErrorAttributes(
            props.errors.description,
            "competition-description-error",
          )}
          onChange={(event) => {
            props.onChange({ description: event.target.value });
          }}
          required
        />
        <BuilderFieldError
          id="competition-description-error"
          error={props.errors.description}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="competition-channel">Discord channel</Label>
          <select
            className="scout-control"
            id="competition-channel"
            name="channelId"
            value={props.state.channelId}
            required
            {...builderErrorAttributes(
              props.errors.channelId,
              "competition-channel-error",
            )}
            onChange={(event) => {
              props.onChange({ channelId: event.currentTarget.value });
            }}
          >
            <option value="" disabled>
              Pick a channel
            </option>
            {props.channels.map((channel) => (
              <option key={channel.id} value={channel.id}>
                #{channel.name}
              </option>
            ))}
          </select>
          <BuilderFieldError
            id="competition-channel-error"
            error={props.errors.channelId}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="competition-cap">Participant cap</Label>
          <Input
            id="competition-cap"
            name="maxParticipants"
            type="number"
            inputMode="numeric"
            min={2}
            max={100}
            step={1}
            required
            value={props.state.maxParticipants}
            {...builderErrorAttributes(
              props.errors.maxParticipants,
              "competition-cap-error",
            )}
            onChange={(event) => {
              props.onChange({ maxParticipants: event.target.value });
            }}
          />
          <BuilderFieldError
            id="competition-cap-error"
            error={props.errors.maxParticipants}
          />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="competition-visibility">Who participates</Label>
        <select
          className="scout-control"
          id="competition-visibility"
          name="visibility"
          value={props.state.visibility}
          required
          {...builderErrorAttributes(
            props.errors.visibility,
            "competition-visibility-error",
          )}
          onChange={(event) => {
            const value = event.currentTarget.value;
            const parsed = CompetitionVisibilitySchema.safeParse(value);
            if (parsed.success) props.onChange({ visibility: parsed.data });
          }}
        >
          {CompetitionVisibilitySchema.options.map((visibility) => (
            <option key={visibility} value={visibility}>
              {visibilityToString(visibility)} —{" "}
              {visibilityDescription(visibility)}
            </option>
          ))}
        </select>
        <BuilderFieldError
          id="competition-visibility-error"
          error={props.errors.visibility}
        />
      </div>
    </div>
  );
}
