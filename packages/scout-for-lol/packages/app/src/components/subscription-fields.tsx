import { useState } from "react";
import type { SubscriptionFieldsValue } from "#src/lib/use-add-subscription.ts";
import { RegionSelect } from "#src/components/region-select.tsx";
import { RiotIdCombobox } from "#src/components/riot-id-combobox.tsx";
import { DiscordMemberCombobox } from "#src/components/discord-member-combobox.tsx";
import { SubscriptionFilterFields } from "#src/components/subscription-filter-fields.tsx";
import { Input } from "#src/components/ui/input.tsx";
import { Label } from "#src/components/ui/label.tsx";
import { findRegion, regionLabel } from "#src/lib/regions.ts";
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
 *
 * The Riot ID and Discord user inputs are typeahead comboboxes backed by
 * `riot.searchSummoners` / `resolveRiotId` and `discord.searchMembers`, which
 * need the guild context, so `guildId` is required.
 */
export function SubscriptionFields(props: {
  idPrefix: string;
  guildId: string;
  channels: { id: string; name: string }[];
  value: SubscriptionFieldsValue;
  onChange: (next: SubscriptionFieldsValue) => void;
}) {
  const { idPrefix, guildId, value, onChange } = props;
  // Selecting a suggestion adopts that account's region, which is correct (the
  // account really does live there) but used to happen silently — a user who
  // deliberately picked EUW could be moved to NA by clicking a same-name
  // suggestion and never know. Applying it and saying so keeps both properties.
  const [regionNotice, setRegionNotice] = useState<string | null>(null);
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
            setRegionNotice(null);
            onChange({ ...value, region });
          }}
        />
        {regionNotice !== null && (
          <p className="text-xs text-muted-foreground" role="status">
            {regionNotice}
          </p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-riot-id`}>
          Riot ID <span className="text-muted-foreground">(name#TAG)</span>
        </Label>
        <RiotIdCombobox
          id={`${idPrefix}-riot-id`}
          guildId={guildId}
          region={value.region}
          value={value.riotId}
          onValueChange={(riotId) => {
            setRegionNotice(null);
            onChange({ ...value, riotId });
          }}
          onSelectAccount={({ riotId, region: accountRegion }) => {
            // Fires right after onValueChange(riotId); rebuild from the
            // selected Riot ID so the region update doesn't clobber it.
            const match = findRegion(accountRegion);
            const changed = match !== null && match !== value.region;
            setRegionNotice(
              changed
                ? `Region set to ${regionLabel(match)} — that's where ${riotId} plays. Change it above if that's not the account you meant.`
                : null,
            );
            onChange({
              ...value,
              riotId,
              ...(match !== null && { region: match }),
            });
          }}
          placeholder="Search a name or type name#TAG"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-alias`}>Player name</Label>
        <Input
          id={`${idPrefix}-alias`}
          value={value.alias}
          onChange={(e) => {
            onChange({ ...value, alias: e.target.value });
          }}
          placeholder="How this person shows up in Scout"
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-discord`}>
          Discord user <span className="text-muted-foreground">(optional)</span>
        </Label>
        <DiscordMemberCombobox
          id={`${idPrefix}-discord`}
          guildId={guildId}
          value={value.discordUserId}
          onChange={(discordUserId) => {
            onChange({ ...value, discordUserId });
          }}
        />
        <p className="text-xs text-muted-foreground">
          Links a <em>new</em> player to this Discord user. Existing players
          keep their current link — manage it from the player page.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-queues`}>
          Notify for{" "}
          <span className="text-muted-foreground">(all queues if empty)</span>
        </Label>
        <SubscriptionFilterFields
          id={`${idPrefix}-queues`}
          value={value.filters}
          onChange={(filters) => {
            onChange({ ...value, filters });
          }}
        />
      </div>
    </div>
  );
}
