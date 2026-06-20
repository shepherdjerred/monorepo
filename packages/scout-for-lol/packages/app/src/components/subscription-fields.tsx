import type { SubscriptionFieldsValue } from "#src/lib/use-add-subscription.ts";
import { RegionSelect } from "#src/components/region-select.tsx";
import { Input } from "#src/components/ui/input.tsx";
import { Label } from "#src/components/ui/label.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#src/components/ui/select.tsx";

/**
 * Presentational subscription form fields (channel / region / Riot ID /
 * alias / optional Discord user). Holds no state — the parent owns the
 * value so it can prefill (e.g. the onboarding "track yourself" step).
 * `idPrefix` keeps label htmlFor ids unique across multiple instances.
 */
export function SubscriptionFields(props: {
  idPrefix: string;
  channels: { id: string; name: string }[];
  value: SubscriptionFieldsValue;
  onChange: (next: SubscriptionFieldsValue) => void;
}) {
  const { idPrefix, value, onChange } = props;
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-channel`}>Channel</Label>
        <Select
          value={value.channelId}
          onValueChange={(next) => {
            onChange({ ...value, channelId: next });
          }}
          required
        >
          <SelectTrigger id={`${idPrefix}-channel`}>
            <SelectValue placeholder="Pick a channel" />
          </SelectTrigger>
          <SelectContent>
            {props.channels.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                #{c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-region`}>Region</Label>
        <RegionSelect
          id={`${idPrefix}-region`}
          value={value.region}
          onValueChange={(region) => {
            onChange({ ...value, region });
          }}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-riot-id`}>
          Riot ID <span className="text-muted-foreground">(name#TAG)</span>
        </Label>
        <Input
          id={`${idPrefix}-riot-id`}
          value={value.riotId}
          onChange={(e) => {
            onChange({ ...value, riotId: e.target.value });
          }}
          placeholder="example#NA1"
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-alias`}>Alias</Label>
        <Input
          id={`${idPrefix}-alias`}
          value={value.alias}
          onChange={(e) => {
            onChange({ ...value, alias: e.target.value });
          }}
          placeholder="How it shows up in Scout"
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-discord`}>
          Discord user ID{" "}
          <span className="text-muted-foreground">(optional)</span>
        </Label>
        <Input
          id={`${idPrefix}-discord`}
          value={value.discordUserId}
          onChange={(e) => {
            onChange({ ...value, discordUserId: e.target.value });
          }}
          placeholder="123456789012345678"
        />
      </div>
    </div>
  );
}
