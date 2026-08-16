import { CheckIcon, Clock3Icon, ShieldIcon } from "lucide-react";
import type {
  CustomGameParticipant,
  CustomNightParticipant,
} from "@scout-for-lol/data";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

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
        <span className="block truncate text-xs text-activity-muted-ink">
          {participant.playerAlias ?? "Scout mapping needed"}
        </span>
      </span>
      {participant.held && (
        <ShieldIcon aria-label="Held" className="text-activity-brand" />
      )}
      {participant.awayUntil !== null && (
        <Clock3Icon aria-label="Away" className="text-activity-muted-ink" />
      )}
      {selected === true && (
        <CheckIcon aria-label="Selected" className="text-activity-brand" />
      )}
    </>
  );
  if (onSelect !== undefined) {
    return (
      <Button
        type="button"
        variant="outline"
        className={cn(
          "h-auto w-full justify-start gap-3 p-3",
          selected === true && "border-activity-brand bg-activity-brand/10",
        )}
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
      className={cn(
        "h-auto w-full justify-start gap-3 p-3",
        participant.team === "A" && "border-[var(--team-a)]/60",
        participant.team === "B" && "border-[var(--team-b)]/60",
      )}
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
