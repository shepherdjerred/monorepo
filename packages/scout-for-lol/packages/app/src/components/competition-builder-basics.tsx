import {
  CompetitionVisibilitySchema,
  visibilityDescription,
  visibilityToString,
} from "@scout-for-lol/data";
import { Input } from "@scout-for-lol/design-system/components/input";
import { Label } from "@scout-for-lol/design-system/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@scout-for-lol/design-system/components/select";
import type { CompetitionBuilderState } from "#src/lib/competition-builder-state.ts";

export function CompetitionBuilderBasics(props: {
  state: CompetitionBuilderState;
  channels: { id: string; name: string }[];
  onChange: (changes: Partial<CompetitionBuilderState>) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="competition-title">Title</Label>
        <Input
          id="competition-title"
          value={props.state.title}
          onChange={(event) => {
            props.onChange({ title: event.target.value });
          }}
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="competition-description">Description</Label>
        <Input
          id="competition-description"
          value={props.state.description}
          onChange={(event) => {
            props.onChange({ description: event.target.value });
          }}
          required
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="competition-channel">Discord channel</Label>
          <Select
            value={props.state.channelId}
            onValueChange={(channelId) => {
              props.onChange({ channelId });
            }}
          >
            <SelectTrigger id="competition-channel">
              <SelectValue placeholder="Pick a channel" />
            </SelectTrigger>
            <SelectContent>
              {props.channels.map((channel) => (
                <SelectItem key={channel.id} value={channel.id}>
                  #{channel.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="competition-cap">Participant cap</Label>
          <Input
            id="competition-cap"
            type="number"
            min={2}
            max={100}
            value={props.state.maxParticipants}
            onChange={(event) => {
              props.onChange({ maxParticipants: event.target.value });
            }}
          />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="competition-visibility">Who participates</Label>
        <Select
          value={props.state.visibility}
          onValueChange={(value) => {
            const parsed = CompetitionVisibilitySchema.safeParse(value);
            if (parsed.success) props.onChange({ visibility: parsed.data });
          }}
        >
          <SelectTrigger id="competition-visibility">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CompetitionVisibilitySchema.options.map((visibility) => (
              <SelectItem key={visibility} value={visibility}>
                {visibilityToString(visibility)} —{" "}
                {visibilityDescription(visibility)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
