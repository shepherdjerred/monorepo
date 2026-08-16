import { CheckIcon, Clock3Icon, ShieldIcon } from "lucide-react";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@scout-for-lol/design-system/components/avatar";
import { Badge } from "@scout-for-lol/design-system/components/badge";
import { Button } from "@scout-for-lol/design-system/components/button";
import type {
  CustomGameParticipant,
  CustomNightParticipant,
} from "@scout-for-lol/data";

function initials(name: string): string {
  return name
    .split(/\s+/u)
    .slice(0, 2)
    .map((part) => part.slice(0, 1).toUpperCase())
    .join("");
}

export function NightPlayerCard({
  participant,
  selected,
  onSelect,
}: {
  participant: CustomNightParticipant;
  selected?: boolean;
  onSelect?: () => void;
}) {
  const content = (
    <>
      <Avatar size="sm">
        {participant.avatarUrl !== null && (
          <AvatarImage src={participant.avatarUrl} alt="" />
        )}
        <AvatarFallback>{initials(participant.displayName)}</AvatarFallback>
      </Avatar>
      <span className="min-w-0 flex-1 text-left">
        <span className="block truncate font-medium">
          {participant.displayName}
        </span>
        <span className="block truncate text-xs text-scout-subtle">
          {participant.playerAlias ?? "Scout mapping needed"}
        </span>
      </span>
      {participant.held && (
        <ShieldIcon aria-label="Held" className="text-scout-brand" />
      )}
      {participant.awayUntil !== null && (
        <Clock3Icon aria-label="Away" className="text-scout-subtle" />
      )}
      {selected === true && (
        <CheckIcon aria-label="Selected" className="text-scout-brand" />
      )}
    </>
  );
  if (onSelect !== undefined) {
    return (
      <Button
        type="button"
        variant="outline"
        className={`h-auto w-full justify-start gap-3 p-3 ${
          selected === true ? "border-scout-brand bg-scout-brand/10" : ""
        }`}
        aria-pressed={selected ?? false}
        onClick={onSelect}
      >
        {content}
      </Button>
    );
  }
  return (
    <div className="flex items-center gap-3 rounded-lg border p-3">
      {content}
    </div>
  );
}

export function DraftPlayerCard({
  participant,
  canPick,
  onPick,
}: {
  participant: CustomGameParticipant;
  canPick: boolean;
  onPick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      className={`h-auto w-full justify-start gap-3 p-3 ${
        participant.team === "A"
          ? "border-scout-team-blue/60"
          : participant.team === "B"
            ? "border-scout-team-red/60"
            : ""
      }`}
      disabled={!canPick}
      onClick={onPick}
    >
      <Avatar size="sm">
        <AvatarFallback>{initials(participant.displayName)}</AvatarFallback>
      </Avatar>
      <span className="min-w-0 flex-1 truncate text-left font-medium">
        {participant.displayName}
      </span>
      {participant.captain && <Badge>Captain</Badge>}
      {participant.pickOrder !== null && (
        <Badge variant="secondary">Pick {participant.pickOrder}</Badge>
      )}
    </Button>
  );
}
