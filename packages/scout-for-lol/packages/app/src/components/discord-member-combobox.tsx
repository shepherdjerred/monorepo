import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "#src/lib/trpc.ts";
import { useDebouncedValue } from "#src/hooks/use-debounced-value.ts";
import { Combobox } from "#src/components/ui/combobox.tsx";

const SNOWFLAKE = /^\d{17,20}$/;

type Member = {
  id: string;
  username: string;
  displayName: string;
  avatar: string;
};

/**
 * Typeahead for picking a Discord guild member. Surfaces matches by
 * username/nickname via `discord.searchMembers`; selecting one sets the
 * Discord user ID. A raw snowflake typed directly is still accepted (so power
 * users can paste an ID even if member search is unavailable).
 *
 * `value` is the selected Discord user ID (or ""). The parent reads it for
 * submission and should disable submit when it's empty.
 */
export function DiscordMemberCombobox(props: {
  guildId: string;
  value: string;
  onChange: (discordUserId: string) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  id?: string;
}) {
  const trpc = useTRPC();
  const [query, setQuery] = useState("");
  const debounced = useDebouncedValue(query);
  const search = useQuery(
    trpc.discord.searchMembers.queryOptions(
      { guildId: props.guildId, query: debounced.trim() },
      { enabled: debounced.trim().length > 0 },
    ),
  );

  return (
    <Combobox<Member>
      value={query}
      onValueChange={(text) => {
        setQuery(text);
        // Preserve raw-ID entry: a pasted snowflake is a valid value even
        // without selecting a search result.
        props.onChange(SNOWFLAKE.test(text.trim()) ? text.trim() : "");
      }}
      items={search.data ?? []}
      isLoading={search.isFetching}
      getKey={(member) => member.id}
      onSelect={(member) => {
        props.onChange(member.id);
        setQuery(member.displayName);
      }}
      disabled={props.disabled}
      placeholder={props.placeholder ?? "Search members or paste a user ID"}
      emptyText="No matching members."
      className={props.className}
      id={props.id}
      renderItem={(member) => (
        <>
          <img
            src={member.avatar}
            alt=""
            width={20}
            height={20}
            className="h-5 w-5 shrink-0 rounded-full"
          />
          <span className="truncate">
            {member.displayName}
            <span className="text-muted-foreground"> @{member.username}</span>
          </span>
        </>
      )}
    />
  );
}
