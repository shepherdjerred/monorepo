import { useEffect, useState } from "react";
import { Combobox } from "#src/components/ui/combobox.tsx";

type Zone = {
  id: string;
  label: string;
  offsetMinutes: number;
};

// Formats a zone's UTC offset as "GMT-07:00" (computed once at module load;
// the offset drifts across DST boundaries, which is acceptable for a picker).
function offsetLabel(id: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: id,
    timeZoneName: "longOffset",
  }).formatToParts(new Date());
  return parts.find((part) => part.type === "timeZoneName")?.value ?? "GMT";
}

function offsetToMinutes(label: string): number {
  const match = /GMT(?<sign>[+-])(?<hours>\d{2}):(?<minutes>\d{2})/u.exec(
    label,
  );
  if (match?.groups === undefined) {
    return 0;
  }
  const sign = match.groups["sign"] === "-" ? -1 : 1;
  const hours = Number(match.groups["hours"]);
  const minutes = Number(match.groups["minutes"]);
  return sign * (hours * 60 + minutes);
}

function makeZone(id: string): Zone {
  const offset = offsetLabel(id);
  return {
    id,
    label: `${id} (${offset})`,
    offsetMinutes: offsetToMinutes(offset),
  };
}

const LOCAL_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

// The short "common" group pinned to the top of an unfiltered list: the user's
// own zone, UTC, then the previously hard-coded shortlist.
const PINNED_IDS = [
  ...new Set([
    LOCAL_ZONE,
    "UTC",
    "America/Los_Angeles",
    "America/Denver",
    "America/Chicago",
    "America/New_York",
    "Europe/London",
    "Europe/Berlin",
    "Asia/Tokyo",
    "Australia/Sydney",
  ]),
];

const PINNED_ZONES: Zone[] = PINNED_IDS.map((id) => makeZone(id));

const ALL_ZONES: Zone[] = Intl.supportedValuesOf("timeZone")
  .map((id) => makeZone(id))
  .sort((a, b) =>
    a.offsetMinutes === b.offsetMinutes
      ? a.id.localeCompare(b.id)
      : a.offsetMinutes - b.offsetMinutes,
  );

function labelForValue(value: string): string {
  return makeZone(value).label;
}

export function TimezoneSelect(props: {
  value: string;
  onChange: (tz: string) => void;
  id?: string;
}) {
  const selectedLabel = labelForValue(props.value);
  const [query, setQuery] = useState(selectedLabel);

  // Keep the input text in sync when the selected zone changes from outside
  // (initial default, editing an existing report).
  useEffect(() => {
    setQuery(selectedLabel);
  }, [selectedLabel]);

  const trimmed = query.trim();
  // "Resting" = the input still shows the current selection (or is empty) and
  // the user hasn't started a fresh search, so we surface the pinned group.
  const resting = trimmed.length === 0 || query === selectedLabel;
  const items = resting
    ? PINNED_ZONES
    : ALL_ZONES.filter((zone) =>
        zone.id.toLowerCase().includes(trimmed.toLowerCase()),
      );

  return (
    <Combobox<Zone>
      id={props.id}
      value={query}
      onValueChange={(text) => {
        setQuery(text);
        // Commit as soon as the typed/pasted text is itself a complete, valid
        // zone (id or full label) — without this, typing an exact IANA name
        // and submitting without clicking a result silently keeps the old
        // timezone. Partial text matches nothing, so this never fires mid-type.
        const trimmedText = text.trim();
        const exact = ALL_ZONES.find(
          (zone) => zone.id === trimmedText || zone.label === trimmedText,
        );
        if (exact !== undefined && exact.id !== props.value) {
          props.onChange(exact.id);
        }
      }}
      items={items}
      isLoading={false}
      openOnEmptyQuery
      placeholder="Search timezones…"
      getKey={(zone) => zone.id}
      renderItem={(zone) => zone.label}
      onSelect={(zone) => {
        props.onChange(zone.id);
        setQuery(zone.label);
      }}
    />
  );
}
