import type { Dispatch, SetStateAction, SyntheticEvent } from "react";
import { Link } from "react-router-dom";
import {
  CompetitionVisibilitySchema,
  visibilityToString,
  type CompetitionVisibility,
} from "@scout-for-lol/data";
import { Button } from "#src/components/ui/button.tsx";
import { Input } from "#src/components/ui/input.tsx";
import { Label } from "#src/components/ui/label.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#src/components/ui/select.tsx";
import {
  CompetitionDatesFields,
  type DatesState,
} from "#src/components/competition-dates-fields.tsx";
import {
  CompetitionCriteriaFields,
  type CriteriaState,
} from "#src/components/competition-criteria-fields.tsx";

export type FormState = {
  title: string;
  description: string;
  channelId: string;
  visibility: CompetitionVisibility;
  maxParticipants: string;
  dates: DatesState;
  criteria: CriteriaState;
};

export const EMPTY_STATE: FormState = {
  title: "",
  description: "",
  channelId: "",
  visibility: "OPEN",
  maxParticipants: "50",
  dates: { mode: "FIXED_DATES", startDate: "", endDate: "", seasonId: "" },
  criteria: {
    criteriaType: "MOST_GAMES_PLAYED",
    queue: "SOLO",
    championId: "",
    minGames: "10",
  },
};

export function CompetitionFormFields(props: {
  guildId: string;
  isEdit: boolean;
  locked: boolean;
  pending: boolean;
  error: string | null;
  state: FormState;
  setState: Dispatch<SetStateAction<FormState>>;
  channels: { id: string; name: string }[] | undefined;
  onSubmit: (event: SyntheticEvent) => void;
}) {
  const { guildId, isEdit, locked, pending, error, state, setState } = props;

  return (
    <form onSubmit={props.onSubmit} className="space-y-4">
      {locked && (
        <p className="rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
          This competition has started — criteria, dates, and visibility are
          locked. You can still edit the title, description, channel, and
          increase the participant cap.
        </p>
      )}

      <div className="space-y-2">
        <Label htmlFor="competition-title">Title</Label>
        <Input
          id="competition-title"
          value={state.title}
          onChange={(event) => {
            setState((prev) => ({ ...prev, title: event.target.value }));
          }}
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="competition-description">Description</Label>
        <Input
          id="competition-description"
          value={state.description}
          onChange={(event) => {
            setState((prev) => ({ ...prev, description: event.target.value }));
          }}
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="competition-channel">Announcement channel</Label>
        <Select
          value={state.channelId}
          onValueChange={(next) => {
            setState((prev) => ({ ...prev, channelId: next }));
          }}
          required
        >
          <SelectTrigger id="competition-channel">
            <SelectValue placeholder="Pick a channel" />
          </SelectTrigger>
          <SelectContent>
            {(props.channels ?? []).map((channel) => (
              <SelectItem key={channel.id} value={channel.id}>
                #{channel.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="competition-visibility">Visibility</Label>
          <Select
            value={state.visibility}
            disabled={locked}
            onValueChange={(next) => {
              const parsed = CompetitionVisibilitySchema.safeParse(next);
              if (parsed.success) {
                setState((prev) => ({ ...prev, visibility: parsed.data }));
              }
            }}
          >
            <SelectTrigger id="competition-visibility">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CompetitionVisibilitySchema.options.map((option) => (
                <SelectItem key={option} value={option}>
                  {visibilityToString(option)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="competition-max">Max participants</Label>
          <Input
            id="competition-max"
            type="number"
            min={2}
            max={100}
            value={state.maxParticipants}
            onChange={(event) => {
              setState((prev) => ({
                ...prev,
                maxParticipants: event.target.value,
              }));
            }}
          />
        </div>
      </div>

      <CompetitionDatesFields
        value={state.dates}
        disabled={locked}
        onChange={(dates) => {
          setState((prev) => ({ ...prev, dates }));
        }}
      />

      <CompetitionCriteriaFields
        value={state.criteria}
        disabled={locked}
        onChange={(criteria) => {
          setState((prev) => ({ ...prev, criteria }));
        }}
      />

      {error !== null && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex gap-2">
        <Button asChild variant="outline" type="button">
          <Link to={`/g/${guildId}/competitions`}>Cancel</Link>
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : isEdit ? "Save changes" : "Create"}
        </Button>
      </div>
    </form>
  );
}
