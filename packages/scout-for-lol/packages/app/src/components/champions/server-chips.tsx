import type { DiscordGuildId } from "@scout-for-lol/data";
import { Chip } from "@scout-for-lol/design-system/components/surfaces/chip";
import { Check } from "lucide-react";
import {
  toggleServer,
  type ServerOption,
} from "#src/lib/champions/server-selection.ts";

/** One chip per server the viewer shares; a single server needs no choice. */
export function ServerChips(props: {
  servers: readonly ServerOption[];
  selected: readonly DiscordGuildId[] | undefined;
  onChange: (next: DiscordGuildId[] | undefined) => void;
}) {
  if (props.servers.length < 2) return null;
  const selected =
    props.selected ?? props.servers.map((server) => server.guildId);
  return (
    <div
      role="group"
      aria-label="Which servers to include"
      className="flex flex-wrap gap-2"
    >
      {props.servers.map((server) => {
        const on = selected.includes(server.guildId);
        return (
          <Chip
            key={server.guildId}
            pressed={on}
            onClick={() => {
              props.onChange(
                toggleServer(props.servers, props.selected, server.guildId),
              );
            }}
          >
            {on ? (
              <Check size={14} strokeWidth={2.4} aria-hidden="true" />
            ) : null}
            {server.name}
          </Chip>
        );
      })}
    </div>
  );
}
