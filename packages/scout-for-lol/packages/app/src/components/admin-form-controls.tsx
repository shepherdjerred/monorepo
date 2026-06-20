import { findRegion, type RegionValue } from "#src/lib/regions.ts";
import { Button } from "#src/components/ui/button.tsx";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "#src/components/ui/card.tsx";
import { Input } from "#src/components/ui/input.tsx";
import { Label } from "#src/components/ui/label.tsx";
import { RegionSelect } from "#src/components/region-select.tsx";
import { RiotIdCombobox } from "#src/components/riot-id-combobox.tsx";
import { PlayerAliasCombobox } from "#src/components/player-alias-combobox.tsx";
import { DiscordMemberCombobox } from "#src/components/discord-member-combobox.tsx";

export function AdminCard(props: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{props.title}</CardTitle>
      </CardHeader>
      <CardContent>{props.children}</CardContent>
    </Card>
  );
}

export function TextField(props: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={props.id}>{props.label}</Label>
      <Input
        id={props.id}
        value={props.value}
        onChange={(event) => {
          props.onChange(event.target.value);
        }}
      />
    </div>
  );
}

export function AliasField(props: {
  id: string;
  label: string;
  guildId: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={props.id}>{props.label}</Label>
      <PlayerAliasCombobox
        id={props.id}
        guildId={props.guildId}
        value={props.value}
        onChange={props.onChange}
      />
    </div>
  );
}

export function DiscordUserField(props: {
  id: string;
  label: string;
  guildId: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={props.id}>{props.label}</Label>
      <DiscordMemberCombobox
        id={props.id}
        guildId={props.guildId}
        value={props.value}
        onChange={props.onChange}
      />
    </div>
  );
}

export function RiotAccountFields(props: {
  riotIdInputId: string;
  regionInputId: string;
  riotId: string;
  region: RegionValue;
  onRiotIdChange: (value: string) => void;
  onRegionChange: (value: RegionValue) => void;
  // When provided, the Riot ID field becomes a typeahead over this guild's
  // known accounts (selecting one also pre-fills the region).
  guildId?: string;
}) {
  return (
    <>
      <div className="space-y-2">
        <Label htmlFor={props.riotIdInputId}>Riot ID</Label>
        {props.guildId === undefined ? (
          <Input
            id={props.riotIdInputId}
            value={props.riotId}
            onChange={(event) => {
              props.onRiotIdChange(event.target.value);
            }}
          />
        ) : (
          <RiotIdCombobox
            id={props.riotIdInputId}
            guildId={props.guildId}
            value={props.riotId}
            onValueChange={props.onRiotIdChange}
            onSelectAccount={({ region }) => {
              const match = findRegion(region);
              if (match !== null) props.onRegionChange(match);
            }}
          />
        )}
      </div>
      <div className="space-y-2">
        <Label htmlFor={props.regionInputId}>Region</Label>
        <RegionSelect
          id={props.regionInputId}
          value={props.region}
          onValueChange={props.onRegionChange}
        />
      </div>
    </>
  );
}

export function SubmitButton(props: {
  pending: boolean;
  label: string;
  variant?: "default" | "destructive";
}) {
  return (
    <Button type="submit" disabled={props.pending} variant={props.variant}>
      {props.pending ? "Saving..." : props.label}
    </Button>
  );
}
