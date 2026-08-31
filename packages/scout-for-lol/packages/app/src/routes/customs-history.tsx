import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router";
import { DiscordGuildIdSchema } from "@scout-for-lol/data";
import { useTRPC } from "#src/lib/trpc.ts";

export function CustomsHistory() {
  const { guildId } = useParams();
  const trpc = useTRPC();
  const [selectedNightId, setSelectedNightId] = useState<string | null>(null);
  const parsedGuild = DiscordGuildIdSchema.safeParse(guildId);
  const safeGuildId = parsedGuild.success ? parsedGuild.data : undefined;
  const list = useQuery(
    trpc.customsHistory.list.queryOptions(
      {
        guildId: safeGuildId ?? DiscordGuildIdSchema.parse("12345678901234567"),
      },
      { enabled: safeGuildId !== undefined },
    ),
  );
  const detail = useQuery(
    trpc.customsHistory.detail.queryOptions(
      {
        guildId: safeGuildId ?? DiscordGuildIdSchema.parse("12345678901234567"),
        nightId: selectedNightId ?? "00000000-0000-4000-8000-000000000000",
      },
      { enabled: safeGuildId !== undefined && selectedNightId !== null },
    ),
  );
  if (safeGuildId === undefined) {
    return <p className="text-sm text-scout-danger">Invalid guild id</p>;
  }
  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-medium uppercase text-scout-subtle">Beta</p>
        <h2 className="text-xl font-semibold tracking-tight">
          Customs history
        </h2>
        <p className="mt-1 text-sm text-scout-subtle">
          Riot-verified custom games and their append-only event history.
        </p>
      </div>
      {list.isPending ? (
        <p className="text-sm text-scout-subtle">Loading…</p>
      ) : null}
      {list.isError ? (
        <p className="text-sm text-scout-danger">{list.error.message}</p>
      ) : null}
      <div className="grid gap-4 md:grid-cols-[minmax(16rem,0.75fr)_minmax(0,1.25fr)]">
        <div className="space-y-2">
          {list.data?.map((night) => (
            <button
              className="w-full rounded-md border border-scout-border bg-scout-surface p-4 text-left hover:bg-scout-hover"
              key={night.id}
              onClick={() => {
                setSelectedNightId(night.id);
              }}
              type="button"
            >
              <span className="font-medium">
                {new Date(night.lastActivityAt).toLocaleString()}
              </span>
              <span className="mt-1 block text-sm text-scout-subtle">
                {night.state.replaceAll("_", " ")} ·{" "}
                {night.participants.length.toString()} players
              </span>
            </button>
          ))}
          {list.data?.length === 0 ? (
            <p className="text-sm text-scout-subtle">No custom nights yet.</p>
          ) : null}
        </div>
        <section className="rounded-md border border-scout-border bg-scout-surface p-4">
          {selectedNightId === null ? (
            <p className="text-sm text-scout-subtle">
              Select a night to inspect its games and audit ledger.
            </p>
          ) : null}
          {selectedNightId !== null && detail.isPending ? (
            <p className="text-sm text-scout-subtle">Loading night…</p>
          ) : null}
          {detail.isError ? (
            <p className="text-sm text-scout-danger">{detail.error.message}</p>
          ) : null}
          {detail.data ? (
            <div className="space-y-5">
              <div>
                <h3 className="font-semibold">
                  {detail.data.games.length.toString()} game(s)
                </h3>
                <ul className="mt-2 space-y-2 text-sm">
                  {detail.data.games.map((game) => (
                    <li key={game.id}>
                      Game {game.sequence.toString()} ·{" "}
                      {game.state.replaceAll("_", " ")}
                      {game.winner === null ? "" : ` · Team ${game.winner} won`}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <h3 className="font-semibold">Audit ledger</h3>
                <ol className="mt-2 max-h-96 space-y-2 overflow-auto text-sm">
                  {detail.data.audit.map((event) => (
                    <li
                      className="border-l-2 border-scout-border pl-3"
                      key={event.id}
                    >
                      <span className="font-medium">
                        r{event.revision.toString()} ·{" "}
                        {event.action.replaceAll("_", " ")}
                      </span>
                      <span className="block text-xs text-scout-subtle">
                        {new Date(event.createdAt).toLocaleString()} ·{" "}
                        {event.source}
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}
