import type { RegionValue } from "#src/lib/regions.ts";
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

export function RiotAccountFields(props: {
  riotIdInputId: string;
  regionInputId: string;
  riotId: string;
  region: RegionValue;
  onRiotIdChange: (value: string) => void;
  onRegionChange: (value: RegionValue) => void;
}) {
  return (
    <>
      <TextField
        id={props.riotIdInputId}
        label="Riot ID"
        value={props.riotId}
        onChange={props.onRiotIdChange}
      />
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
