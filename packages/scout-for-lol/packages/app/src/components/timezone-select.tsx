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

// `Intl.supportedValuesOf("timeZone")` omits some ids the app pins — notably
// "UTC", which `Intl.DateTimeFormat` still accepts. Fold the pinned zones in so
// they are both searchable and committable by exact match, not just visible in
// the resting shortlist.
const ALL_ZONE_IDS = new Set(ALL_ZONES.map((zone) => zone.id));
const SEARCHABLE_ZONES: Zone[] = [
  ...PINNED_ZONES.filter((zone) => !ALL_ZONE_IDS.has(zone.id)),
  ...ALL_ZONES,
];

function labelForValue(value: string): string {
  return makeZone(value).label;
}

// `Intl.supportedValuesOf("timeZone")` omits aliases (e.g. `US/Pacific`,
// `Etc/UTC`) and SEARCHABLE_ZONES matching is case-sensitive, but
// `Intl.DateTimeFormat` accepts and canonicalizes any valid IANA id/alias. This
// returns the canonical id for a complete, valid zone string, or undefined for
// partial/invalid input (which throws a RangeError).
function canonicalizeTimezone(value: string): string | undefined {
  if (value.length === 0) {
    return undefined;
  }
  try {
    return new Intl.DateTimeFormat(undefined, {
      timeZone: value,
    }).resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
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
    : SEARCHABLE_ZONES.filter((zone) =>
        zone.id.toLowerCase().includes(trimmed.toLowerCase()),
      );

  return (
    <Combobox<Zone>
      id={props.id}
      value={query}
      onValueChange={(text) => {
        setQuery(text);
        // Commit as soon as the typed/pasted text is itself a complete, valid
        // zone — without this, typing a valid IANA name and submitting without
        // clicking a result silently keeps the old timezone. Match the pinned/
        // supported list first (id or full label), then fall back to
        // canonicalizing via Intl so aliases and differently-cased ids (e.g.
        // `US/Pacific`, `america/los_angeles`) also commit. Partial text
        // resolves to nothing, so this never fires mid-type.
        const trimmedText = text.trim();
        const canonical =
          SEARCHABLE_ZONES.find(
            (zone) => zone.id === trimmedText || zone.label === trimmedText,
          )?.id ?? canonicalizeTimezone(trimmedText);
        if (canonical !== undefined && canonical !== props.value) {
          props.onChange(canonical);
        }
      }}
      onBlur={() => {
        // Reconcile the field with what's actually committed once editing ends:
        // a valid typed zone was already committed above (so this shows its
        // canonical label); invalid/incomplete text reverts to the current
        // selection instead of silently displaying a value the payload never
        // saved.
        setQuery(selectedLabel);
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
